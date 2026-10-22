import clsx from 'clsx';
import { AlertTriangle, ArrowLeftRight, Banknote, Building2, CalendarCheck, CheckCircle2, Clock, CreditCard, ExternalLink, Landmark, QrCode, Radio, Receipt, Repeat, ScanBarcode, Sparkles, Wallet, XCircle } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { fmtDate, METHOD_NAME, money, monthLabel, percent, SOURCE_COLOR, SOURCE_NAME } from '../lib/format';
import type { Projection } from '../lib/metrics';
import type { PaymentMethod, SourceId, SourceStatus, Transaction } from '../types';
import { IconBubble, Segmented } from './controls';
import { DemoBadge } from './Kpis';
import { Card, StatusBadge, Swatch } from './ui';

// ---------------------------------------------------------------- composição (barra segmentada + lista)
const SOURCE_ICON: Record<SourceId, ReactNode> = {
  asaas: <Repeat size={16} />,
  infinitepay: <CreditCard size={16} />,
  inter: <Landmark size={16} />,
  sicoob: <Building2 size={16} />,
  cresol: <Building2 size={16} />,
};

const METHOD_STYLE: Record<PaymentMethod, { color: string; icon: ReactNode }> = {
  pix: { color: 'var(--series-4)', icon: <QrCode size={16} /> },
  boleto: { color: 'var(--series-3)', icon: <ScanBarcode size={16} /> },
  credit_card: { color: 'var(--series-1)', icon: <CreditCard size={16} /> },
  debit_card: { color: 'var(--series-5)', icon: <Wallet size={16} /> },
  transfer: { color: 'var(--series-2)', icon: <ArrowLeftRight size={16} /> },
  fee: { color: 'var(--muted)', icon: <Receipt size={16} /> },
  other: { color: 'var(--muted)', icon: <Banknote size={16} /> },
};

interface Row {
  key: string;
  label: string;
  value: number;
  count: number;
  color: string;
  icon: ReactNode;
}

/** Barra horizontal dividida em segmentos com respiro entre eles (parte de um todo) */
export function SegmentBar({ rows, total }: { rows: Array<{ key: string; label: string; value: number; color: string }>; total: number }) {
  if (!total) return <div className="h-3 rounded-full bg-surface-2" />;
  return (
    <div className="flex h-3 w-full gap-1" role="img" aria-label={rows.map((r) => `${r.label} ${percent(r.value / total)}`).join(', ')}>
      {rows.filter((r) => r.value > 0).map((r) => (
        <div key={r.key} title={`${r.label}: ${money(r.value)}`} className="h-full min-w-[6px] rounded-full" style={{ width: `${(r.value / total) * 100}%`, background: r.color }} />
      ))}
    </div>
  );
}

function CategoryList({ rows, total, noun }: { rows: Row[]; total: number; noun: string }) {
  if (!rows.length) return <p className="py-4 text-[13px] text-muted">Sem recebimentos no período.</p>;
  return (
    <ul className="flex flex-col">
      {rows.map((r) => (
        <li key={r.key} className="flex items-center gap-3 py-2.5" title={`${r.label}: ${money(r.value)} em ${r.count} pagamentos`}>
          <IconBubble color={r.color} size="lg">{r.icon}</IconBubble>
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold leading-snug text-ink">{r.label}</span>
            <span className="block text-[12px] text-muted">
              {percent(total ? r.value / total : 0)} {noun} · {r.count} pag.
            </span>
          </span>
          <span className="tabular shrink-0 text-[14px] font-bold text-ink">{money(r.value)}</span>
        </li>
      ))}
    </ul>
  );
}

export function BreakdownCard({ bySource, byMethod, label }: {
  bySource: Array<{ key: SourceId; value: number; count: number }>;
  byMethod: Array<{ key: PaymentMethod; value: number; count: number }>;
  label: string;
}) {
  const [by, setBy] = useState<'source' | 'method'>('method');
  const total = bySource.reduce((a, b) => a + b.value, 0);
  const rows: Row[] =
    by === 'source'
      ? bySource.map((r) => ({ key: r.key, label: SOURCE_NAME[r.key], value: r.value, count: r.count, color: SOURCE_COLOR[r.key], icon: SOURCE_ICON[r.key] }))
      : byMethod.map((r) => ({ key: r.key, label: METHOD_NAME[r.key], value: r.value, count: r.count, ...METHOD_STYLE[r.key] }));

  return (
    <Card
      title="Composição"
      subtitle={`Recebimentos · ${label}`}
      action={<Segmented size="sm" ariaLabel="Agrupar por" value={by} onChange={setBy} options={[{ value: 'method', label: 'Forma' }, { value: 'source', label: 'Fonte' }]} />}
    >
      <div className="text-[30px] font-extrabold tracking-tight text-ink">{money(total)}</div>
      <div className="mt-3">
        <SegmentBar rows={rows} total={total} />
      </div>
      <div className="mt-3">
        <CategoryList rows={rows} total={total} noun="dos recebimentos" />
      </div>
    </Card>
  );
}

// ---------------------------------------------------------------- projeção detalhada
export function ProjectionCard({ p }: { p: Projection }) {
  const parts = [
    { key: 'issued', label: 'Cobranças já emitidas', hint: `${p.issuedCount} com vencimento no mês`, value: p.issued, color: 'var(--series-1)', icon: <CalendarCheck size={16} />, kind: 'garantido' },
    { key: 'recurring', label: 'Recorrência a gerar', hint: `${p.recurringCount} mensalidades de assinaturas`, value: p.recurring, color: 'var(--series-4)', icon: <Repeat size={16} />, kind: 'garantido' },
    { key: 'card', label: 'Cartão a creditar', hint: 'Vendas aprovadas, crédito no mês', value: p.cardToCredit, color: 'var(--series-3)', icon: <CreditCard size={16} />, kind: 'garantido' },
    { key: 'est', label: 'Estimativa InfinitePay', hint: 'Média dos últimos 3 meses', value: p.cardEstimate, color: 'var(--series-2)', icon: <Sparkles size={16} />, kind: 'estimado' },
  ].filter((x) => x.value > 0);

  return (
    <Card title={`Projeção · ${monthLabel(p.month)}`} subtitle="Quanto deve entrar no próximo mês">
      <div className="text-[30px] font-extrabold tracking-tight text-ink">{money(p.total)}</div>
      <div className="mt-3">
        <SegmentBar rows={parts} total={p.total} />
      </div>
      <ul className="mt-3 flex flex-col">
        {parts.map((x) => (
          <li key={x.key} className="flex items-center gap-3 py-2.5">
            <IconBubble color={x.color} size="lg">{x.icon}</IconBubble>
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] font-semibold leading-snug text-ink">{x.label}</span>
              <span className="block text-[12px] text-muted">{x.hint}</span>
            </span>
            <span className="shrink-0 text-right">
              <span className="tabular block text-[14px] font-bold text-ink">{money(x.value)}</span>
              <span className={clsx('block text-[11px] font-semibold', x.kind === 'garantido' ? 'text-good-ink' : 'text-muted')}>{x.kind}</span>
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
export function ReceivablesCard({ items, label, today }: { items: Transaction[]; label: string; today: string }) {
  const total = items.reduce((a, t) => a + t.amount, 0);
  return (
    <Card title="Agenda de recebimentos" subtitle={`${items.length} em aberto · vencimento em ${label} · ${money(total)}`} bodyClassName="!px-0 !pb-2">
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
