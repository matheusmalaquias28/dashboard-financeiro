import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Clock, ExternalLink, Radio, XCircle } from 'lucide-react';
import { fmtDate, METHOD_NAME, money, moneyCompact, monthLabel, percent, SOURCE_COLOR, SOURCE_NAME } from '../lib/format';
import type { Projection } from '../lib/metrics';
import type { PaymentMethod, SourceId, SourceStatus, Transaction } from '../types';
import { DemoBadge } from './Kpis';
import { Card, StatusBadge, Swatch } from './ui';

// ---------------------------------------------------------------- composição (barras horizontais)
export function BreakdownCard({ bySource, byMethod, month }: {
  bySource: Array<{ key: SourceId; value: number; count: number }>;
  byMethod: Array<{ key: PaymentMethod; value: number; count: number }>;
  month: string;
}) {
  const total = bySource.reduce((a, b) => a + b.value, 0);
  return (
    <Card title="Composição dos recebimentos" subtitle={monthLabel(month)}>
      <h3 className="mb-2 text-[12px] font-medium uppercase tracking-wide text-muted">Por fonte</h3>
      <Bars rows={bySource.map((r) => ({ label: SOURCE_NAME[r.key], value: r.value, count: r.count, color: SOURCE_COLOR[r.key] }))} total={total} />
      <h3 className="mb-2 mt-5 text-[12px] font-medium uppercase tracking-wide text-muted">Por forma de pagamento</h3>
      {/* uma única série → uma única cor; as categorias não têm ordem natural */}
      <Bars rows={byMethod.map((r) => ({ label: METHOD_NAME[r.key], value: r.value, count: r.count, color: 'var(--series-1)' }))} total={total} />
    </Card>
  );
}

function Bars({ rows, total }: { rows: Array<{ label: string; value: number; count: number; color: string }>; total: number }) {
  if (!rows.length) return <p className="text-[13px] text-muted">Sem recebimentos no período.</p>;
  const max = Math.max(...rows.map((r) => r.value));
  return (
    <ul className="flex flex-col gap-2.5">
      {rows.map((r) => (
        <li key={r.label} title={`${r.label}: ${money(r.value)} em ${r.count} pagamentos`}>
          <div className="mb-1 flex items-baseline justify-between gap-2 text-[13px]">
            <span className="inline-flex items-center gap-2 text-ink-2"><Swatch color={r.color} /> {r.label}</span>
            <span className="tabular text-ink">
              <span className="font-semibold">{moneyCompact(r.value)}</span>
              <span className="ml-1.5 text-muted">{percent(total ? r.value / total : 0)}</span>
            </span>
          </div>
          <div className="h-2 rounded-full bg-surface-2">
            <div className="h-2 rounded-full" style={{ width: `${(r.value / max) * 100}%`, background: r.color }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

// ---------------------------------------------------------------- projeção detalhada
export function ProjectionCard({ p }: { p: Projection }) {
  const parts = [
    { key: 'issued', label: 'Cobranças já emitidas', hint: `${p.issuedCount} cobranças com vencimento no mês`, value: p.issued, color: 'var(--series-1)', kind: 'garantido' },
    { key: 'recurring', label: 'Recorrência a gerar', hint: `${p.recurringCount} mensalidades de assinaturas ativas`, value: p.recurring, color: 'var(--series-3)', kind: 'garantido' },
    { key: 'card', label: 'Cartão a creditar', hint: 'Vendas no cartão já aprovadas, crédito no mês', value: p.cardToCredit, color: 'var(--series-4)', kind: 'garantido' },
    { key: 'est', label: 'Estimativa InfinitePay', hint: 'Média dos últimos 3 meses fechados', value: p.cardEstimate, color: 'var(--series-2)', kind: 'estimado' },
  ].filter((x) => x.value > 0);

  return (
    <Card title={`Projeção para ${monthLabel(p.month)}`} subtitle="Quanto deve entrar no próximo mês">
      <div className="tabular text-[30px] font-semibold tracking-tight text-ink">{money(p.total)}</div>
      {/* barra empilhada com 2px de respiro entre os segmentos */}
      <div className="mt-3 flex h-3 w-full gap-[2px] overflow-hidden rounded-full">
        {parts.map((x) => (
          <div key={x.key} title={`${x.label}: ${money(x.value)}`} style={{ width: `${(x.value / p.total) * 100}%`, background: x.color }} className="h-full first:rounded-l-full last:rounded-r-full" />
        ))}
      </div>
      <ul className="mt-4 flex flex-col gap-3">
        {parts.map((x) => (
          <li key={x.key} className="flex items-start justify-between gap-3">
            <span className="flex min-w-0 items-start gap-2">
              <span className="mt-1"><Swatch color={x.color} /></span>
              <span className="min-w-0">
                <span className="block text-[13px] text-ink">{x.label}</span>
                <span className="block text-[12px] text-muted">{x.hint}</span>
              </span>
            </span>
            <span className="shrink-0 text-right">
              <span className="tabular block text-[13px] font-semibold text-ink">{money(x.value)}</span>
              <span className="block text-[11px] text-muted">{x.kind}</span>
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

// ---------------------------------------------------------------- feed ao vivo InfinitePay
export function LiveFeed({ items, fresh, live, demo }: { items: Transaction[]; fresh: Set<string>; live: boolean; demo: boolean }) {
  return (
    <Card
      title={
        <span className="inline-flex items-center gap-2">
          <Radio size={15} className={live ? 'text-good-ink' : 'text-muted'} /> InfinitePay em tempo real
        </span>
      }
      subtitle="Vendas aprovadas no cartão e Pix via $scalecompany_"
      action={demo ? <DemoBadge /> : undefined}
      bodyClassName="!px-0 !pb-2"
    >
      {items.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13px] text-muted">Aguardando a primeira venda…</p>
      ) : (
        <ul className="max-h-[300px] overflow-auto">
          {items.map((t) => (
            <li key={t.id} className={clsx('flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 last:border-0', fresh.has(t.id) && 'row-new')}>
              <span className="min-w-0">
                <span className="block truncate text-[13px] text-ink">{t.customer ?? t.description}</span>
                <span className="block text-[12px] text-muted">
                  {t.createdAt ? new Date(t.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : t.paidDate && fmtDate(t.paidDate)}
                  {' · '}
                  {METHOD_NAME[t.method]}
                  {t.installments && t.installments > 1 ? ` ${t.installments}x` : ''}
                </span>
              </span>
              <span className="shrink-0 text-right">
                <span className="tabular block text-[13px] font-semibold text-ink">{money(t.amount)}</span>
                {fresh.has(t.id) && <span className="text-[11px] font-medium text-good-ink">agora</span>}
              </span>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- a receber no mês
export function ReceivablesCard({ items, month, today }: { items: Transaction[]; month: string; today: string }) {
  const total = items.reduce((a, t) => a + t.amount, 0);
  return (
    <Card title="Agenda de recebimentos" subtitle={`${items.length} em aberto em ${monthLabel(month)} · ${money(total)}`} bodyClassName="!px-0 !pb-2">
      {items.length === 0 ? (
        <p className="px-5 py-6 text-center text-[13px] text-muted">Nada em aberto neste mês.</p>
      ) : (
        <ul className="max-h-[620px] overflow-auto">
          {items.map((t) => {
            const days = Math.round((Date.parse(`${t.dueDate}T12:00:00Z`) - Date.parse(`${today}T12:00:00Z`)) / 86_400_000);
            return (
              <li key={t.id} className="flex items-center justify-between gap-3 border-b border-line px-5 py-2.5 last:border-0">
                <span className="min-w-0">
                  <span className="block truncate text-[13px] text-ink">{t.customer ?? t.description}</span>
                  <span className="block text-[12px] text-muted">
                    vence {fmtDate(t.dueDate!, 'dd/MM')}
                    {t.status === 'overdue' ? ` · ${-days} dias de atraso` : days === 0 ? ' · hoje' : days > 0 ? ` · em ${days} dias` : ''}
                    {' · '}
                    {METHOD_NAME[t.method]}
                  </span>
                </span>
                <span className="flex shrink-0 flex-col items-end gap-1">
                  <span className="tabular text-[13px] font-semibold text-ink">{money(t.amount)}</span>
                  <StatusBadge status={t.status} />
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}

// ---------------------------------------------------------------- integrações
const STATE_META = {
  connected: { label: 'Conectado', icon: CheckCircle2, cls: 'text-good-ink' },
  demo: { label: 'Demonstração', icon: Clock, cls: 'text-ink-2' },
  pending_access: { label: 'Aguardando acesso', icon: Clock, cls: 'text-muted' },
  error: { label: 'Erro', icon: XCircle, cls: 'text-critical-ink' },
} as const;

export function IntegrationsPanel({ sources }: { sources: SourceStatus[] }) {
  return (
    <Card title="Integrações" subtitle="Status de cada banco e meio de pagamento">
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
        {sources.map((s) => {
          const meta = STATE_META[s.state];
          const Icon = meta.icon;
          return (
            <div key={s.id} className="flex min-w-0 flex-col gap-2 rounded-xl border border-line p-3.5">
              <div className="flex items-center justify-between gap-2">
                <span className="inline-flex items-center gap-2 font-medium text-ink">
                  <Swatch color={SOURCE_COLOR[s.id]} /> {s.name}
                </span>
                <span className={clsx('inline-flex items-center gap-1 text-[12px] font-medium', meta.cls)}>
                  <Icon size={13} /> {meta.label}
                </span>
              </div>
              <div className="text-[12px] text-muted">{s.role}</div>
              <div className={clsx('text-[12px]', s.state === 'error' ? 'text-critical-ink' : 'text-ink-2')}>
                {s.state === 'error' && <AlertTriangle size={12} className="mr-1 inline" />}
                {s.message}
              </div>
              {s.webhookUrl && s.realtime && (
                <div className="text-[11px] text-muted">
                  Webhook: <code className="break-all rounded bg-surface-2 px-1 py-0.5 text-ink-2">{s.webhookUrl}</code>
                </div>
              )}
              {s.nextSteps && s.nextSteps.length > 0 && s.state !== 'connected' && (
                <ol className="ml-4 list-decimal space-y-1 text-[12px] text-ink-2">
                  {s.nextSteps.map((n) => <li key={n}>{n}</li>)}
                </ol>
              )}
            </div>
          );
        })}
      </div>
      <p className="mt-3 inline-flex items-center gap-1 text-[12px] text-muted">
        <ExternalLink size={12} /> Transferências entre as contas da empresa (ex.: Asaas → Inter) ficam fora dos totais para não contar a mesma receita duas vezes.
      </p>
    </Card>
  );
}
