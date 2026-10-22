/**
 * Colaboradores: nome e remuneração (fixo + variável) recebidos por webhook de outra plataforma.
 *
 * O formato da plataforma de origem não é fixo, então o receptor é tolerante:
 *  - aceita um colaborador, uma lista, ou { colaboradores | collaborators | data | items | employees: [...] }
 *  - nomes de campo em português ou inglês (nome/name, fixo/salario/fixed, variavel/comissao/variable…)
 *  - valores como número ou texto ("R$ 1.234,56", "1234.56")
 *  - competência opcional (AAAA-MM, MM/AAAA ou data); sem ela, usa o mês atual
 * Cada recebimento fica registrado (webhook_log) com o payload bruto, para conferência.
 */
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from './config.js';
import { createStore, scopedStore } from './store.js';
import { today } from './util.js';

export interface Collaborator {
  id: string;
  name: string;
  role?: string;
  email?: string;
  department?: string;
  active: boolean;
  fixed: number;
  variable: number;
  competence: string;
  updatedAt: string;
  source?: string;
}

export interface CollaboratorPay {
  /** <colaborador>:<AAAA-MM> */
  id: string;
  collaboratorId: string;
  name: string;
  competence: string;
  fixed: number;
  variable: number;
  total: number;
  receivedAt: string;
}

export interface WebhookLog {
  id: string;
  receivedAt: string;
  source: string;
  ok: boolean;
  accepted: number;
  errors: string[];
  payload: unknown;
}

const people = createStore<Collaborator>('collaborators');
const pay = createStore<CollaboratorPay>('collaborator-pay');
const log = createStore<WebhookLog>('webhook-log');

// ---------------------------------------------------------------- leitura tolerante do payload

const norm = (k: string) => k.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]/g, '');

/** Primeiro campo presente entre os nomes aceitos (ignora acentos, maiúsculas, _ e -) */
function pick(obj: Record<string, unknown>, names: string[]): unknown {
  const wanted = new Set(names.map(norm));
  for (const [k, v] of Object.entries(obj)) {
    // só valores simples: objetos aninhados são abertos à parte em parseItem
    if (wanted.has(norm(k)) && v !== null && v !== undefined && v !== '' && typeof v !== 'object') return v;
  }
  return undefined;
}

const FIELDS = {
  id: ['id', 'external_id', 'externalId', 'codigo', 'code', 'matricula', 'colaborador_id', 'employee_id', 'user_id', 'uuid'],
  name: ['nome', 'name', 'colaborador', 'funcionario', 'full_name', 'fullName', 'nome_completo', 'employee', 'employee_name'],
  fixed: ['fixo', 'salario_fixo', 'salario', 'salario_base', 'base', 'fixed', 'fixed_salary', 'salary', 'remuneracao_fixa', 'valor_fixo'],
  variable: ['variavel', 'remuneracao_variavel', 'valor_variavel', 'comissao', 'comissoes', 'bonus', 'premiacao', 'variable', 'commission', 'variable_pay'],
  total: ['total', 'remuneracao_total', 'total_remuneracao', 'valor_total'],
  competence: ['competencia', 'mes', 'mes_referencia', 'referencia', 'periodo', 'month', 'period', 'reference', 'competence', 'data'],
  role: ['cargo', 'funcao', 'role', 'position', 'job_title', 'titulo'],
  email: ['email', 'e_mail', 'mail'],
  department: ['departamento', 'setor', 'area', 'time', 'department', 'team'],
  active: ['ativo', 'active', 'status', 'situacao'],
};

/** "R$ 1.234,56" → 1234.56 · "1234.56" → 1234.56 · 1234.56 → 1234.56 */
export function parseMoney(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? Math.round(v * 100) / 100 : null;
  if (typeof v !== 'string') return null;
  let s = v.replace(/[^\d,.-]/g, '');
  if (!s) return null;
  // vírgula como decimal (padrão brasileiro) quando vier depois do último ponto
  if (s.includes(',') && s.lastIndexOf(',') > s.lastIndexOf('.')) s = s.replace(/\./g, '').replace(',', '.');
  else s = s.replace(/,/g, '');
  const n = Number(s);
  return Number.isFinite(n) ? Math.round(n * 100) / 100 : null;
}

/** "2026-10", "10/2026", "2026-10-15", "outubro/2026" → "2026-10" */
export function parseCompetence(v: unknown): string | null {
  if (typeof v !== 'string' && typeof v !== 'number') return null;
  const s = String(v).trim().toLowerCase();
  let m = /^(\d{4})[-/](\d{1,2})/.exec(s);
  if (m) return `${m[1]}-${m[2].padStart(2, '0')}`;
  m = /^(\d{1,2})[-/](\d{4})$/.exec(s);
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  m = /^\d{1,2}[-/](\d{1,2})[-/](\d{4})/.exec(s); // dd/mm/aaaa
  if (m) return `${m[2]}-${m[1].padStart(2, '0')}`;
  const months = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
  m = /^([a-zç]+)\W*(\d{4})$/.exec(s);
  if (m) {
    const i = months.findIndex((p) => m![1].startsWith(p));
    if (i >= 0) return `${m[2]}-${String(i + 1).padStart(2, '0')}`;
  }
  return null;
}

function parseActive(v: unknown): boolean {
  if (v === undefined) return true;
  if (typeof v === 'boolean') return v;
  const s = norm(String(v));
  return !['false', '0', 'nao', 'inativo', 'inactive', 'desligado', 'demitido', 'deleted', 'removed'].includes(s);
}

const slug = (s: string) => norm(s).slice(0, 60) || crypto.randomBytes(4).toString('hex');

function listFrom(body: unknown): unknown[] {
  if (Array.isArray(body)) return body;
  if (body && typeof body === 'object') {
    const obj = body as Record<string, unknown>;
    const keys = new Set(['colaboradores', 'collaborators', 'funcionarios', 'employees', 'items', 'data', 'records', 'rows'].map(norm));
    const list = Object.entries(obj).find(([k, v]) => keys.has(norm(k)) && v && typeof v === 'object')?.[1];
    if (Array.isArray(list)) return list;
    if (list && typeof list === 'object') return [list];
    return [obj];
  }
  return [];
}

interface Parsed {
  collaborator: Collaborator;
  pay: CollaboratorPay;
}

/** Converte um item do payload; devolve erro legível se faltar o essencial */
export function parseItem(raw: unknown, fallbackCompetence: string, now: string, source: string): Parsed | string {
  if (!raw || typeof raw !== 'object') return 'item não é um objeto';
  const o = raw as Record<string, unknown>;
  // aceita campos aninhados comuns (ex.: { colaborador: { nome }, remuneracao: { fixo, variavel } })
  const flat: Record<string, unknown> = { ...o };
  for (const v of Object.values(o)) if (v && typeof v === 'object' && !Array.isArray(v)) Object.assign(flat, v as Record<string, unknown>, o);

  const name = String(pick(flat, FIELDS.name) ?? '').trim();
  if (!name) return 'sem nome (use "nome" ou "name")';
  const fixedRaw = pick(flat, FIELDS.fixed);
  const variableRaw = pick(flat, FIELDS.variable);
  const totalRaw = pick(flat, FIELDS.total);
  let fixed = parseMoney(fixedRaw);
  let variable = parseMoney(variableRaw);
  const total = parseMoney(totalRaw);
  if (fixed == null && variable == null && total == null) return `${name}: sem valores de fixo/variável`;
  // se veio só total e um dos dois, deduz o outro
  if (total != null && fixed != null && variable == null) variable = Math.round((total - fixed) * 100) / 100;
  if (total != null && variable != null && fixed == null) fixed = Math.round((total - variable) * 100) / 100;
  if (fixed == null && variable == null && total != null) fixed = total;
  fixed ??= 0;
  variable ??= 0;

  const competenceRaw = pick(flat, FIELDS.competence);
  const competence = parseCompetence(competenceRaw) ?? fallbackCompetence;
  const idRaw = pick(flat, FIELDS.id);
  const email = pick(flat, FIELDS.email);
  const id = idRaw != null ? String(idRaw).slice(0, 80) : email ? `email:${String(email).toLowerCase()}` : `nome:${slug(name)}`;

  const collaborator: Collaborator = {
    id,
    name: name.slice(0, 120),
    role: pick(flat, FIELDS.role) != null ? String(pick(flat, FIELDS.role)).slice(0, 80) : undefined,
    email: email != null ? String(email).slice(0, 120) : undefined,
    department: pick(flat, FIELDS.department) != null ? String(pick(flat, FIELDS.department)).slice(0, 80) : undefined,
    active: parseActive(pick(flat, FIELDS.active)),
    fixed,
    variable,
    competence,
    updatedAt: now,
    source,
  };
  return {
    collaborator,
    pay: { id: `${id}:${competence}`, collaboratorId: id, name: collaborator.name, competence, fixed, variable, total: Math.round((fixed + variable) * 100) / 100, receivedAt: now },
  };
}

// ---------------------------------------------------------------- webhook

const safeEqual = (a: string, b: string) => {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
};

/** Guarda o payload bruto para conferência (cortado se for muito grande) */
function rawPayload(body: unknown): unknown {
  const text = JSON.stringify(body ?? null);
  return text.length <= 50_000 ? body ?? null : { cortado: true, tamanho: text.length, inicio: text.slice(0, 5_000) };
}

export const collaboratorsWebhookPath = () => `/webhooks/colaboradores/${config.collaborators.webhookSecret}`;

async function receive(req: Request, res: Response) {
  const now = new Date().toISOString();
  const source = String(req.header('user-agent') ?? 'desconhecida').slice(0, 120);
  // competência: do item > do topo do envio > da URL (?competencia=) > mês atual
  const top = req.body && typeof req.body === 'object' && !Array.isArray(req.body) ? parseCompetence(pick(req.body as Record<string, unknown>, FIELDS.competence)) : null;
  const fallback = top ?? parseCompetence(String(req.query.competencia ?? req.query.mes ?? '')) ?? today().slice(0, 7);
  const items = listFrom(req.body);
  const errors: string[] = [];
  const accepted: Parsed[] = [];
  items.forEach((raw, i) => {
    const r = parseItem(raw, fallback, now, source);
    if (typeof r === 'string') errors.push(`item ${i + 1}: ${r}`);
    else accepted.push(r);
  });

  try {
    for (const { collaborator, pay: p } of accepted) {
      // o cadastro guarda sempre a competência mais recente recebida
      const current = await people.get(collaborator.id);
      // campos que não vieram neste envio (cargo, e-mail, setor) mantêm o valor anterior
      const merged: Collaborator = {
        ...current,
        ...Object.fromEntries(Object.entries(collaborator).filter(([, v]) => v !== undefined)),
      } as Collaborator;
      // fixo/variável do cadastro = competência mais recente recebida
      if (current && current.competence > collaborator.competence) {
        merged.fixed = current.fixed;
        merged.variable = current.variable;
        merged.competence = current.competence;
      }
      await people.put(merged);
      await pay.put(p);
    }
    await log.put({
      id: `${now}-${crypto.randomBytes(3).toString('hex')}`,
      receivedAt: now,
      source,
      ok: accepted.length > 0,
      accepted: accepted.length,
      errors,
      payload: rawPayload(req.body),
    });
  } catch (err) {
    console.error('[colaboradores] falha ao gravar', err);
    // 500: a plataforma de origem pode tentar de novo
    res.status(500).json({ ok: false, error: 'falha temporária ao gravar, tente novamente' });
    return;
  }

  if (!accepted.length) {
    res.status(400).json({ ok: false, received: items.length, accepted: 0, errors: errors.length ? errors : ['nenhum colaborador no corpo da requisição'] });
    return;
  }
  res.json({ ok: true, received: items.length, accepted: accepted.length, errors, collaborators: accepted.map((a) => ({ id: a.collaborator.id, name: a.collaborator.name, competence: a.pay.competence, fixed: a.pay.fixed, variable: a.pay.variable })) });
}

export const collaboratorsWebhook = Router();

/** /webhooks/colaboradores/<segredo> – o segredo na URL autentica a plataforma de origem */
collaboratorsWebhook.post('/:secret', (req, res) => {
  const secret = config.collaborators.webhookSecret;
  if (!secret || !safeEqual(String(req.params.secret), secret)) {
    res.status(404).end();
    return;
  }
  void receive(req, res);
});

/** Alternativa: /webhooks/colaboradores com o segredo no cabeçalho (Authorization: Bearer … ou x-webhook-token) */
collaboratorsWebhook.post('/', (req, res) => {
  const secret = config.collaborators.webhookSecret;
  const given = (req.header('authorization') ?? '').replace(/^Bearer\s+/i, '') || req.header('x-webhook-token') || '';
  if (!secret || !given || !safeEqual(given, secret)) {
    res.status(401).json({ ok: false, error: 'token inválido' });
    return;
  }
  void receive(req, res);
});

// ---------------------------------------------------------------- API do painel (administrador)

export const collaboratorsApi = Router();

collaboratorsApi.get('/', async (req, res) => {
  try {
    // leitura com o token do usuário: o RLS só libera para administradores
    const [list, history, logs] = await Promise.all([
      scopedStore<Collaborator>('collaborators', req.accessToken).all(),
      scopedStore<CollaboratorPay>('collaborator-pay', req.accessToken).all(),
      scopedStore<WebhookLog>('webhook-log', req.accessToken).all(),
    ]);
    const recent = logs.sort((a, b) => b.receivedAt.localeCompare(a.receivedAt)).slice(0, 15);
    res.json({
      collaborators: list.sort((a, b) => a.name.localeCompare(b.name, 'pt-BR')),
      pay: history,
      logs: recent,
      webhookUrl: config.collaborators.webhookSecret ? config.publicUrl + collaboratorsWebhookPath() : null,
      configured: !!config.collaborators.webhookSecret,
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});
