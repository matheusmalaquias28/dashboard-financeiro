/**
 * Sincronização do Gmail: primeira leitura dos últimos 90 dias (em partes, retomando de onde parou)
 * e depois só os e-mails novos. Cada e-mail é lido uma vez; os financeiros vão para a IA e recebem
 * etiqueta no Gmail (Dashboard/Cobrança, Recebimento, Nota fiscal, Suspeito).
 */
import { config } from '../config.js';
import { createStore } from '../store.js';
import { analyzeWithAI, looksFinancial, signals, type Analysis, type Category } from './analyze.js';
import { accessToken, ensureLabels, gmail, readMessage, ReconnectRequired, type GmailMessage } from './google.js';

export interface GmailAccount {
  id: string;
  email: string;
  refreshTokenEnc: string;
  connectedAt: string;
  active: boolean;
  lastSyncAt?: string;
  lastError?: string;
  needsReconnect?: boolean;
  backfillDone?: boolean;
  backfillPageToken?: string;
  labels?: Record<string, string>;
  stats?: { read: number; financial: number; analyzed: number };
}

export type EmailStatus = 'novo' | 'pago' | 'conferido' | 'ignorado' | 'golpe' | 'legitimo';

export interface EmailItem extends Partial<Analysis> {
  id: string;
  threadId: string;
  account: string;
  from: string;
  fromDomain: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  attachments: string[];
  category: Category;
  analyzed: boolean;
  signals: string[];
  suspicious: boolean;
  status: EmailStatus;
  analyzedAt?: string;
  /** e-mail com cara de financeiro que ainda não passou pela IA (fica para a próxima rodada) */
  pending?: boolean;
  error?: string;
}

export const accounts = createStore<GmailAccount>('gmail-accounts');
export const messages = createStore<EmailItem>('gmail-messages');

const EXCLUDE = '-in:sent -in:drafts -in:chats';
const domainOf = (addr: string) => /@([^>\s]+)/.exec(addr)?.[1]?.toLowerCase() ?? '';

async function pool<T, R>(items: T[], size: number, fn: (t: T) => Promise<R>): Promise<R[]> {
  const out: R[] = [];
  for (let i = 0; i < items.length; i += size) out.push(...(await Promise.all(items.slice(i, i + size).map(fn))));
  return out;
}

async function applyLabels(token: string, labels: Record<string, string>, item: EmailItem) {
  const add = [
    item.category === 'cobranca' && labels.cobranca,
    item.category === 'recebimento' && labels.recebimento,
    item.category === 'nota_fiscal' && labels.nota,
    item.suspicious && labels.suspeito,
  ].filter(Boolean) as string[];
  if (add.length) await gmail(token, `/messages/${item.id}/modify`, { method: 'POST', body: JSON.stringify({ addLabelIds: add }) });
}

export interface SyncResult {
  account: string;
  read: number;
  financial: number;
  analyzed: number;
  suspicious: number;
  backfillDone: boolean;
  error?: string;
}

/** Uma rodada de sincronização, limitada em quantidade e tempo (cabe numa função da Vercel) */
export async function syncAccount(acc: GmailAccount, opts: { maxMessages?: number; maxAI?: number; timeBudgetMs?: number } = {}): Promise<SyncResult> {
  const started = Date.now();
  const maxMessages = opts.maxMessages ?? 150;
  const maxAI = opts.maxAI ?? 40;
  const budget = opts.timeBudgetMs ?? 200_000;
  const result: SyncResult = { account: acc.email, read: 0, financial: 0, analyzed: 0, suspicious: 0, backfillDone: !!acc.backfillDone };

  try {
    const token = await accessToken(acc.email, acc.refreshTokenEnc);
    const labels = acc.labels ?? (await ensureLabels(token));
    // tudo que já foi lido desta conta, carregado uma vez por rodada
    const stored = (await messages.all()).filter((m) => m.account === acc.email);
    const known = new Set(stored.map((m) => m.id));

    // 1) quais mensagens ler nesta rodada
    const ids: string[] = [];
    let pageToken = acc.backfillDone ? undefined : acc.backfillPageToken;
    const q = acc.backfillDone
      ? `${EXCLUDE} after:${Math.floor(new Date(acc.lastSyncAt ?? acc.connectedAt).getTime() / 1000) - 2 * 86_400}`
      : `${EXCLUDE} newer_than:90d`;
    let backfillFinished = !!acc.backfillDone;
    while (ids.length < maxMessages) {
      const page = await gmail<{ messages?: Array<{ id: string }>; nextPageToken?: string }>(
        token,
        `/messages?maxResults=100&q=${encodeURIComponent(q)}${pageToken ? `&pageToken=${pageToken}` : ''}`,
      );
      for (const m of page.messages ?? []) if (!known.has(m.id) && ids.length < maxMessages) ids.push(m.id);
      pageToken = page.nextPageToken;
      if (!pageToken) {
        if (!acc.backfillDone) backfillFinished = true;
        break;
      }
    }

    // 2) ler, filtrar e analisar
    const sameSender = async (domain: string) =>
      stored
        .filter((m) => m.fromDomain === domain && m.category !== 'outro')
        .slice(-6)
        .map((m) => `${m.receivedAt.slice(0, 10)} · ${m.category} · ${m.amount != null ? `R$ ${m.amount}` : 'sem valor'} · ${m.method ?? '-'} · ${m.paymentId ?? 'sem identificador'}${m.status === 'golpe' ? ' · MARCADO COMO GOLPE' : ''}`);

    let aiLeft = config.openai.apiKey ? maxAI : 0;
    await pool(ids, 5, async (id) => {
      if (Date.now() - started > budget) return;
      const raw = await gmail<GmailMessage>(token, `/messages/${id}?format=full`);
      const p = readMessage(raw);
      const base: EmailItem = {
        id,
        threadId: raw.threadId,
        account: acc.email,
        from: p.from,
        fromDomain: domainOf(p.from),
        subject: p.subject.slice(0, 300),
        snippet: (raw.snippet ?? '').slice(0, 300),
        receivedAt: new Date(Number(raw.internalDate ?? Date.now())).toISOString(),
        attachments: p.attachments.slice(0, 10),
        category: 'outro',
        analyzed: false,
        signals: [],
        suspicious: false,
        status: 'novo',
      };
      result.read++;
      if (!looksFinancial(p, raw.snippet ?? '')) {
        await messages.put(base);
        return;
      }
      const remember = (item: EmailItem) => {
        stored.push(item);
        return messages.put(item);
      };
      result.financial++;
      base.signals = signals(p);
      if (aiLeft <= 0) {
        // sem IA (ou cota da rodada esgotada): fica pendente para a próxima rodada
        await remember({ ...base, pending: true, error: config.openai.apiKey ? 'aguardando análise' : 'sem OPENAI_API_KEY' });
        return;
      }
      aiLeft--;
      try {
        const a = await analyzeWithAI(p, base.signals, await sameSender(base.fromDomain));
        const item: EmailItem = { ...base, ...a, analyzed: true, analyzedAt: new Date().toISOString(), signals: base.signals };
        await remember(item);
        result.analyzed++;
        if (item.suspicious) result.suspicious++;
        await applyLabels(token, labels, item);
      } catch (err) {
        await remember({ ...base, pending: true, error: `falha na análise: ${(err as Error).message}`.slice(0, 200) });
      }
    });

    // 3) e-mails que ficaram sem análise em rodadas anteriores
    if (aiLeft > 0) {
      const pending = stored.filter((m) => m.pending && !ids.includes(m.id)).slice(0, aiLeft);
      for (const m of pending) {
        if (Date.now() - started > budget) break;
        const raw = await gmail<GmailMessage>(token, `/messages/${m.id}?format=full`);
        const p = readMessage(raw);
        try {
          const a = await analyzeWithAI(p, m.signals, await sameSender(m.fromDomain));
          const item: EmailItem = { ...m, ...a, analyzed: true, pending: false, analyzedAt: new Date().toISOString(), error: undefined };
          await messages.put(item);
          result.analyzed++;
          if (item.suspicious) result.suspicious++;
          await applyLabels(token, labels, item);
        } catch {
          // tenta de novo na próxima rodada
        }
      }
    }

    result.backfillDone = backfillFinished;
    const prev = acc.stats ?? { read: 0, financial: 0, analyzed: 0 };
    await accounts.put({
      ...acc,
      labels,
      lastSyncAt: new Date().toISOString(),
      lastError: undefined,
      needsReconnect: false,
      backfillDone: backfillFinished,
      backfillPageToken: backfillFinished ? undefined : pageToken,
      stats: { read: prev.read + result.read, financial: prev.financial + result.financial, analyzed: prev.analyzed + result.analyzed },
    });
  } catch (err) {
    result.error = (err as Error).message;
    await accounts.put({ ...acc, lastError: result.error, needsReconnect: err instanceof ReconnectRequired || acc.needsReconnect });
  }
  return result;
}

export async function syncAll(opts?: Parameters<typeof syncAccount>[1]): Promise<SyncResult[]> {
  const list = (await accounts.all()).filter((a) => a.active && a.refreshTokenEnc);
  const out: SyncResult[] = [];
  for (const a of list) out.push(await syncAccount(a, opts));
  return out;
}
