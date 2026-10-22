import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Copy, Download, Search, Users, Wallet, Webhook, XCircle, Zap } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState, type ReactNode } from 'react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import type { AgentContext } from '../agent/AgentWidget';
import { IconBubble, Segmented, Select } from '../components/controls';
import { Header, RefreshButton, type Shell } from '../components/Header';
import { SegmentBar } from '../components/Panels';
import { Card, ChartCard, DataTable, Swatch } from '../components/ui';
import { axisMoney, money, monthLabel, monthShort, percent } from '../lib/format';
import { api, UnauthorizedError } from '../lib/useDashboard';

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
}

export interface CollaboratorPay {
  id: string;
  collaboratorId: string;
  name: string;
  competence: string;
  fixed: number;
  variable: number;
  total: number;
  receivedAt: string;
}

interface WebhookLog {
  id: string;
  receivedAt: string;
  source: string;
  ok: boolean;
  accepted: number;
  errors: string[];
  payload: unknown;
}

export interface CollaboratorsState {
  collaborators: Collaborator[];
  pay: CollaboratorPay[];
  logs: WebhookLog[];
  webhookUrl: string | null;
  configured: boolean;
}

type SortKey = 'name' | 'fixed' | 'variable' | 'total';

const EXAMPLE = `{
  "competencia": "2026-10",
  "colaboradores": [
    { "id": "123", "nome": "Ana Souza", "cargo": "Vendas", "fixo": 3500.00, "variavel": 1250.50 },
    { "id": "124", "nome": "Bruno Lima", "cargo": "Tráfego", "fixo": 4000.00, "variavel": 0 }
  ]
}`;

export function CollaboratorsPage({ shell, onUnauthorized, onAgentContext }: { shell: Shell; onUnauthorized: () => void; onAgentContext: (c: AgentContext) => void }) {
  const [state, setState] = useState<CollaboratorsState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string>();
  const [competence, setCompetence] = useState<string | null>(null);
  const [q, setQ] = useState('');
  const [show, setShow] = useState<'active' | 'all'>('active');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'total', desc: true });

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await api<CollaboratorsState>('/api/colaboradores'));
      setLoadedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized();
      else setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  // novos dados chegam por webhook: confere a cada 30s
  useEffect(() => {
    void load();
    const t = setInterval(() => !document.hidden && void load(), 30_000);
    return () => clearInterval(t);
  }, [load]);

  const competences = useMemo(() => [...new Set((state?.pay ?? []).map((p) => p.competence))].sort().reverse(), [state]);
  const current = competence ?? competences[0] ?? null;

  const byId = useMemo(() => new Map((state?.collaborators ?? []).map((c) => [c.id, c])), [state]);
  // "Ativos" vale para tudo na tela: tabela, totais, comparação e histórico
  const visiblePay = useMemo(
    () => (state?.pay ?? []).filter((p) => show === 'all' || byId.get(p.collaboratorId)?.active !== false),
    [state, show, byId],
  );
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = visiblePay
      .filter((p) => p.competence === current)
      .map((p) => ({ ...p, person: byId.get(p.collaboratorId) }))
      .filter((r) => !term || `${r.name} ${r.person?.role ?? ''} ${r.person?.department ?? ''}`.toLowerCase().includes(term));
    list.sort((a, b) => {
      const c = sort.key === 'name' ? a.name.localeCompare(b.name, 'pt-BR') : a[sort.key] - b[sort.key];
      return sort.desc ? -c : c;
    });
    return list;
  }, [visiblePay, current, byId, q, sort]);

  const totals = useMemo(() => {
    const fixed = rows.reduce((a, r) => a + r.fixed, 0);
    const variable = rows.reduce((a, r) => a + r.variable, 0);
    return { fixed, variable, total: fixed + variable, count: rows.length };
  }, [rows]);

  const prev = useMemo(() => {
    const i = competences.indexOf(current ?? '');
    const pc = i >= 0 ? competences[i + 1] : undefined;
    if (!pc) return null;
    const list = visiblePay.filter((p) => p.competence === pc);
    return { competence: pc, total: list.reduce((a, p) => a + p.total, 0) };
  }, [competences, current, visiblePay]);

  const history = useMemo(() => {
    const map = new Map<string, { competence: string; fixo: number; variavel: number }>();
    for (const p of visiblePay) {
      const cur = map.get(p.competence) ?? { competence: p.competence, fixo: 0, variavel: 0 };
      cur.fixo += p.fixed;
      cur.variavel += p.variable;
      map.set(p.competence, cur);
    }
    return [...map.values()].sort((a, b) => a.competence.localeCompare(b.competence)).slice(-12);
  }, [visiblePay]);

  // o assistente conversa sobre o que está na tela
  useEffect(() => {
    if (!state) return;
    onAgentContext({
      page: 'colaboradores',
      data: {
        competencia: current ? monthLabel(current) : null,
        totais: { colaboradores: totals.count, fixo: totals.fixed, variavel: totals.variable, folhaTotal: totals.total },
        competenciaAnterior: prev ? { competencia: monthLabel(prev.competence), folhaTotal: prev.total } : null,
        historicoMensal: history.map((h) => ({ mes: h.competence, fixo: h.fixo, variavel: h.variavel, total: h.fixo + h.variavel })),
        colaboradores: rows.map((r) => ({ nome: r.name, cargo: r.person?.role, fixo: r.fixed, variavel: r.variable, total: r.total, ativo: r.person?.active !== false })),
      },
    });
  }, [state, current, totals, prev, history, rows, onAgentContext]);

  const exportCsv = () => {
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const fmt = (n: number) => n.toFixed(2).replace('.', ',');
    const lines = rows.map((r) => [r.name, r.person?.role, r.person?.department, r.person?.email, r.competence, fmt(r.fixed), fmt(r.variable), fmt(r.total)].map(esc).join(';'));
    const blob = new Blob(['﻿' + ['nome;cargo;setor;email;competencia;fixo;variavel;total', ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `colaboradores-${current ?? 'sem-dados'}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const SortBtn = ({ k, children, right }: { k: SortKey; children: string; right?: boolean }) => (
    <button type="button" onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : k !== 'name' }))} className={clsx('inline-flex items-center gap-1 hover:text-ink', right && 'ml-auto')}>
      {children}
      {sort.key === k && <span aria-hidden>{sort.desc ? '↓' : '↑'}</span>}
    </button>
  );

  const variableShare = totals.total ? totals.variable / totals.total : 0;
  const delta = prev && prev.total > 0 ? (totals.total - prev.total) / prev.total : null;

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6 lg:py-7">
      <Header shell={shell}>
        <RefreshButton onClick={load} loading={loading} at={loadedAt} />
      </Header>

      {error && (
        <div className="card flex items-center gap-2 border-[var(--critical)] px-4 py-3 text-[13px] text-critical-ink">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {state && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Select
              ariaLabel="Competência"
              value={current}
              onChange={setCompetence}
              placeholder="Sem competências"
              className="w-[230px]"
              buttonClassName="!rounded-full"
              options={competences.map((c) => ({ value: c, label: monthLabel(c), text: monthLabel(c) }))}
            />
            <Segmented ariaLabel="Quem mostrar" value={show} onChange={setShow} options={[{ value: 'active', label: 'Ativos' }, { value: 'all', label: 'Todos' }]} />
          </div>

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <section className="card relative flex min-w-0 flex-col gap-4 overflow-hidden p-6 sm:col-span-2">
              <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-[var(--accent)] opacity-[0.07] blur-3xl" />
              <div className="relative">
                <div className="eyebrow">Folha · {current ? monthLabel(current) : 'sem dados'}</div>
                <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                  <span className="text-[40px] font-extrabold leading-none tracking-tight text-ink sm:text-[52px]">{money(totals.total)}</span>
                  {delta != null && (
                    <span className={clsx('text-[13px] font-bold', delta <= 0 ? 'text-good-ink' : 'text-critical-ink')}>
                      {delta >= 0 ? '↑' : '↓'} {percent(Math.abs(delta))}
                    </span>
                  )}
                </div>
                <p className="mt-2 text-[13px] text-muted">{prev ? `vs. ${monthLabel(prev.competence)} (${money(prev.total)})` : 'fixo + variável de todos os colaboradores da competência'}</p>
              </div>
              <div className="relative">
                <SegmentBar
                  total={totals.total}
                  rows={[
                    { key: 'fixo', label: 'Fixo', value: totals.fixed, color: 'var(--series-1)' },
                    { key: 'variavel', label: 'Variável', value: totals.variable, color: 'var(--series-in)' },
                  ]}
                />
                <div className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-[13px]">
                  <span className="inline-flex items-center gap-2 text-ink-2"><Swatch color="var(--series-1)" /> Fixo <strong className="text-ink">{money(totals.fixed)}</strong></span>
                  <span className="inline-flex items-center gap-2 text-ink-2"><Swatch color="var(--series-in)" /> Variável <strong className="text-ink">{money(totals.variable)}</strong> <span className="text-muted">({percent(variableShare)})</span></span>
                </div>
              </div>
            </section>

            <Tile icon={<Users size={17} />} color="var(--series-4)" label="Colaboradores" value={String(totals.count)} hint={`${state.collaborators.filter((c) => c.active).length} ativos no cadastro`} />
            <Tile icon={<Wallet size={17} />} color="var(--series-3)" label="Média por colaborador" value={money(totals.count ? totals.total / totals.count : 0)} hint={`fixo médio ${money(totals.count ? totals.fixed / totals.count : 0)}`} />
          </div>

          <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
            <div className="min-w-0 lg:col-span-2">
              <ChartCard
                title="Folha por competência"
                subtitle={
                  <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
                    <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-1)" /> Fixo</span>
                    <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-in)" /> Variável</span>
                  </span>
                }
                table={<DataTable head={['Competência', 'Fixo', 'Variável', 'Total']} rows={history.map((h) => [monthLabel(h.competence), money(h.fixo), money(h.variavel), money(h.fixo + h.variavel)])} />}
              >
                {history.length ? (
                  <div className="h-[260px]">
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={history} margin={{ top: 8, right: 8, bottom: 0, left: 0 }} barCategoryGap="30%">
                        <CartesianGrid vertical={false} stroke="var(--grid)" />
                        <XAxis dataKey="competence" stroke="var(--axis)" tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} tickFormatter={monthShort} />
                        <YAxis stroke="var(--axis)" tick={{ fill: 'var(--muted)', fontSize: 12 }} tickLine={false} axisLine={false} tickFormatter={axisMoney} width={48} />
                        <Tooltip
                          cursor={{ fill: 'var(--surface-2)' }}
                          content={({ active, payload }) => {
                            if (!active || !payload?.length) return null;
                            const p = payload[0].payload as { competence: string; fixo: number; variavel: number };
                            return (
                              <div className="min-w-[190px] rounded-2xl border border-line-strong bg-surface-2 px-3.5 py-3 text-[13px] shadow-2xl shadow-black/40">
                                <div className="mb-2 text-[12px] font-semibold text-muted">{monthLabel(p.competence)}</div>
                                <div className="flex items-center gap-2"><Swatch color="var(--series-1)" /> <strong className="text-ink">{money(p.fixo)}</strong> <span className="text-ink-2">fixo</span></div>
                                <div className="flex items-center gap-2"><Swatch color="var(--series-in)" /> <strong className="text-ink">{money(p.variavel)}</strong> <span className="text-ink-2">variável</span></div>
                                <div className="mt-1 border-t border-line pt-1 font-bold text-ink">{money(p.fixo + p.variavel)} total</div>
                              </div>
                            );
                          }}
                        />
                        {/* barras empilhadas com respiro entre fixo e variável */}
                        <Bar dataKey="fixo" stackId="f" fill="var(--series-1)" stroke="var(--surface)" strokeWidth={2} maxBarSize={22} isAnimationActive={false} />
                        <Bar dataKey="variavel" stackId="f" fill="var(--series-in)" stroke="var(--surface)" strokeWidth={2} radius={[8, 8, 0, 0]} maxBarSize={22} isAnimationActive={false} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                ) : (
                  <p className="py-10 text-center text-[13px] text-muted">Ainda não chegou nenhum dado pelo webhook.</p>
                )}
              </ChartCard>
            </div>
            <WebhookCard state={state} />
          </div>

          <Card
            title="Colaboradores"
            subtitle={`${rows.length} na competência ${current ? monthLabel(current) : '—'} · atualizado pela outra plataforma via webhook`}
            action={
              <button type="button" onClick={exportCsv} disabled={!rows.length} className="inline-flex h-9 items-center gap-1.5 rounded-full border border-line px-3.5 text-[13px] font-semibold text-ink-2 hover:text-ink disabled:opacity-40">
                <Download size={15} /> CSV
              </button>
            }
          >
            <label className="relative mb-3 block max-w-sm">
              <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
              <input
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Buscar nome, cargo ou setor"
                className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-[13px] text-ink outline-none placeholder:text-muted focus:border-[var(--accent-text)]"
              />
            </label>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[720px] text-[13px]">
                <thead>
                  <tr className="border-b border-line text-left text-[12px] text-muted">
                    <th className="py-2.5 pr-3 font-semibold"><SortBtn k="name">Colaborador</SortBtn></th>
                    <th className="py-2.5 pr-3 text-right font-semibold"><SortBtn k="fixed" right>Fixo</SortBtn></th>
                    <th className="py-2.5 pr-3 text-right font-semibold"><SortBtn k="variable" right>Variável</SortBtn></th>
                    <th className="py-2.5 pr-3 text-right font-semibold"><SortBtn k="total" right>Total</SortBtn></th>
                    <th className="w-[180px] py-2.5 pl-3 font-semibold">Composição</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r) => (
                    <tr key={r.id} className="border-b border-line last:border-0">
                      <td className="py-3 pr-3">
                        <div className="flex items-center gap-3">
                          <span className="grid size-9 shrink-0 place-items-center rounded-full bg-surface-3 text-[12px] font-bold text-ink">
                            {r.name.split(' ').filter(Boolean).map((p) => p[0]).slice(0, 2).join('').toUpperCase()}
                          </span>
                          <span className="min-w-0">
                            <span className="block truncate font-semibold text-ink">
                              {r.name}
                              {r.person?.active === false && <span className="ml-2 rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-muted">inativo</span>}
                            </span>
                            <span className="block truncate text-[12px] text-muted">{[r.person?.role, r.person?.department].filter(Boolean).join(' · ') || '—'}</span>
                          </span>
                        </div>
                      </td>
                      <td className="tabular py-3 pr-3 text-right text-ink-2">{money(r.fixed)}</td>
                      <td className="tabular py-3 pr-3 text-right text-ink-2">{money(r.variable)}</td>
                      <td className="tabular py-3 pr-3 text-right font-bold text-ink">{money(r.total)}</td>
                      <td className="py-3 pl-3" title={`Variável: ${percent(r.total ? r.variable / r.total : 0)}`}>
                        <SegmentBar total={r.total} rows={[{ key: 'f', label: 'Fixo', value: r.fixed, color: 'var(--series-1)' }, { key: 'v', label: 'Variável', value: r.variable, color: 'var(--series-in)' }]} />
                      </td>
                    </tr>
                  ))}
                  {rows.length === 0 && (
                    <tr>
                      <td colSpan={5} className="py-10 text-center text-muted">
                        {state.pay.length ? 'Ninguém com esses filtros.' : 'Aguardando o primeiro envio da outra plataforma.'}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ icon, color, label, value, hint }: { icon: ReactNode; color: string; label: string; value: string; hint: string }) {
  return (
    <section className="card flex min-w-0 flex-col gap-3 p-5">
      <IconBubble color={color}>{icon}</IconBubble>
      <div>
        <div className="text-[13px] font-medium text-muted">{label}</div>
        <div className="mt-1 truncate text-[26px] font-extrabold leading-tight tracking-tight text-ink">{value}</div>
      </div>
      <div className="text-[12px] text-muted">{hint}</div>
    </section>
  );
}

/** Endereço do webhook, formato aceito e últimos recebimentos */
function WebhookCard({ state }: { state: CollaboratorsState }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = (text: string, key: string) =>
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(key);
      setTimeout(() => setCopied(null), 1500);
    });
  const last = state.logs[0];

  return (
    <Card title={<span className="inline-flex items-center gap-2"><Webhook size={16} className="text-accent-text" /> Integração</span>} subtitle="A outra plataforma envia os dados para este endereço (POST, JSON)">
      {state.webhookUrl ? (
        <>
          <div className="break-all rounded-2xl border border-line bg-surface-2 p-3 font-mono text-[12px] text-ink">{state.webhookUrl}</div>
          <button type="button" onClick={() => copy(state.webhookUrl!, 'url')} className="mt-2 inline-flex h-9 items-center gap-1.5 rounded-full bg-accent px-4 text-[13px] font-bold text-on-accent hover:opacity-90">
            <Copy size={14} /> {copied === 'url' ? 'Copiado' : 'Copiar endereço'}
          </button>
        </>
      ) : (
        <p className="rounded-2xl bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] p-3 text-[12px] text-ink-2">Defina COLLABORATORS_WEBHOOK_SECRET no servidor para ativar o endereço.</p>
      )}

      <div className="mt-5 eyebrow">Último recebimento</div>
      {last ? (
        <div className="mt-2 flex items-start gap-2 text-[13px]">
          {last.ok ? <CheckCircle2 size={16} className="mt-0.5 text-good-ink" /> : <XCircle size={16} className="mt-0.5 text-critical-ink" />}
          <span>
            <span className="block text-ink">
              {new Date(last.receivedAt).toLocaleString('pt-BR')} · {last.accepted} colaborador{last.accepted === 1 ? '' : 'es'}
            </span>
            {last.errors.length > 0 && <span className="block text-[12px] text-critical-ink">{last.errors.slice(0, 3).join(' · ')}</span>}
          </span>
        </div>
      ) : (
        <p className="mt-2 inline-flex items-center gap-1.5 text-[13px] text-muted"><Zap size={14} /> Nenhum envio recebido ainda.</p>
      )}

      <details className="mt-5 group">
        <summary className="cursor-pointer text-[13px] font-semibold text-ink-2 hover:text-ink">Formato aceito</summary>
        <p className="mt-2 text-[12px] text-muted">
          Um colaborador ou uma lista. Campos em português ou inglês: nome/name, fixo/salario/fixed, variavel/comissao/bonus/variable, e opcionais id, cargo, setor,
          email, ativo e competencia (AAAA-MM; sem ela, vale o mês atual). Valores podem vir como 3500.5 ou "R$ 3.500,50".
        </p>
        <pre className="mt-2 overflow-x-auto rounded-2xl bg-surface-2 p-3 text-[11px] leading-relaxed text-ink-2">{EXAMPLE}</pre>
        <button type="button" onClick={() => copy(EXAMPLE, 'ex')} className="mt-2 text-[12px] font-semibold text-accent-text hover:underline">
          {copied === 'ex' ? 'Copiado' : 'Copiar exemplo'}
        </button>
      </details>

      {state.logs.length > 1 && (
        <details className="mt-3">
          <summary className="cursor-pointer text-[13px] font-semibold text-ink-2 hover:text-ink">Histórico de envios ({state.logs.length})</summary>
          <ul className="mt-2 flex flex-col gap-1.5 text-[12px]">
            {state.logs.map((l) => (
              <li key={l.id} className="flex items-center gap-2 text-ink-2">
                {l.ok ? <CheckCircle2 size={13} className="text-good-ink" /> : <XCircle size={13} className="text-critical-ink" />}
                {new Date(l.receivedAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })} · {l.accepted} ok
                {l.errors.length > 0 && <span className="text-critical-ink">· {l.errors.length} com erro</span>}
              </li>
            ))}
          </ul>
        </details>
      )}
    </Card>
  );
}
