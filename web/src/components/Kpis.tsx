import clsx from 'clsx';
import { AlertTriangle, ArrowDown, ArrowUp, CalendarClock, CreditCard, Landmark, Receipt, Sparkles } from 'lucide-react';
import type { ReactNode } from 'react';
import { money, moneyCompact, monthLabel, percent } from '../lib/format';
import type { Kpis, Projection, WeekDay } from '../lib/metrics';
import type { SourceStatus, Transaction } from '../types';
import { IconBubble } from './controls';

/** Variação em pílula: verde quando é bom, vermelho quando é ruim (seta + sinal, nunca só a cor) */
function Delta({ current, previous, upIsGood = true, label }: { current: number; previous: number; upIsGood?: boolean; label?: string }) {
  if (previous <= 0) return label ? <span className="text-[12px] text-muted">sem base de comparação</span> : null;
  const change = (current - previous) / previous;
  const up = change >= 0;
  const good = up === upIsGood;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-2 gap-y-1 text-[12px]">
      <span className={clsx('inline-flex items-center gap-0.5 text-[13px] font-bold', good ? 'text-good-ink' : 'text-critical-ink')}>
        {up ? <ArrowUp size={14} strokeWidth={2.75} /> : <ArrowDown size={14} strokeWidth={2.75} />}
        {percent(Math.abs(change))}
      </span>
      {label && <span className="text-muted">{label}</span>}
    </span>
  );
}

function Tile({ icon, color, label, value, children, badge }: { icon: ReactNode; color: string; label: string; value: ReactNode; children?: ReactNode; badge?: ReactNode }) {
  return (
    <section className="card flex min-w-0 flex-col gap-3 p-5">
      <div className="flex items-center justify-between gap-2">
        <IconBubble color={color}>{icon}</IconBubble>
        {badge}
      </div>
      <div>
        <div className="text-[13px] font-medium text-muted">{label}</div>
        <div className="mt-1 truncate text-[26px] font-extrabold leading-tight tracking-tight text-ink">{value}</div>
      </div>
      {children && <div className="flex flex-col gap-1 text-[12px] text-muted">{children}</div>}
    </section>
  );
}

/** Barras em pílula da semana (dias futuros viram um círculo tracejado), como no app de referência */
function WeekBars({ days }: { days: WeekDay[] }) {
  const max = Math.max(...days.map((d) => d.value), 1);
  const total = days.reduce((a, d) => a + d.value, 0);
  return (
    <div className="flex min-w-0 flex-col rounded-[18px] bg-surface-2 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <span className="text-[13px] font-medium text-muted">Recebido nesta semana</span>
        <span className="tabular text-[12px] text-muted">{moneyCompact(max)}</span>
      </div>
      <div className="mt-0.5 text-[20px] font-extrabold tracking-tight text-ink">{money(total)}</div>
      <div className="mt-3 grid h-[104px] grid-cols-7 items-end gap-2" role="list" aria-label="Recebido por dia nesta semana">
        {days.map((d) => (
          <div key={d.date} role="listitem" className="flex h-full flex-col items-center justify-end gap-2" title={`${d.label}: ${money(d.value)}`}>
            <div className="flex w-full flex-1 items-end justify-center">
              {d.future ? (
                <span className="mb-0.5 size-4 rounded-full border-2 border-dashed border-[var(--axis)]" aria-label={`${d.label}: ainda não chegou`} />
              ) : (
                <span
                  className="w-full max-w-[18px] rounded-full bg-[var(--series-in)]"
                  style={{ height: `${Math.max(12, (d.value / max) * 100)}%`, opacity: d.value ? 1 : 0.25 }}
                  aria-label={`${d.label}: ${money(d.value)}`}
                />
              )}
            </div>
            <span className="text-[11px] font-medium text-muted">{d.label}</span>
          </div>
        ))}
      </div>
    </div>
  );
}

export function KpiSection({ kpis, label, week, projection, asaas, banks, ipToday, transfers, live }: {
  kpis: Kpis;
  label: string;
  week: WeekDay[];
  projection: Projection;
  asaas?: SourceStatus;
  banks: SourceStatus[];
  ipToday: Transaction[];
  transfers: number;
  live: boolean;
}) {
  const ipTotal = ipToday.reduce((a, t) => a + t.amount, 0);
  const lastSale = ipToday.reduce<Transaction | undefined>((acc, t) => (!acc || (t.createdAt ?? '') > (acc.createdAt ?? '') ? t : acc), undefined);
  const otherBalances = banks.filter((b) => b.id !== 'asaas' && b.balance != null);

  return (
    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
      {/* Destaque */}
      <section className="card relative grid min-w-0 gap-5 overflow-hidden p-6 sm:col-span-2 md:grid-cols-[minmax(0,1fr)_minmax(0,300px)]">
        <div aria-hidden className="pointer-events-none absolute -left-24 -top-24 size-72 rounded-full bg-[var(--accent)] opacity-[0.07] blur-3xl" />
        <div className="relative flex min-w-0 flex-col justify-between gap-6">
          <div>
            <div className="eyebrow">Recebimentos · {label}</div>
            <div className="mt-3 flex flex-wrap items-baseline gap-x-3 gap-y-1">
              <span className="text-[40px] font-extrabold leading-none tracking-tight text-ink sm:text-[52px]">{money(kpis.received)}</span>
              <Delta current={kpis.received} previous={kpis.receivedCompare} />
            </div>
            <p className="mt-2 text-[13px] text-muted">{kpis.compareLabel}</p>
          </div>
          <div className="flex flex-wrap gap-x-8 gap-y-3">
            <div>
              <div className="text-[12px] text-muted">Pagamentos</div>
              <div className="text-[18px] font-bold text-ink">{kpis.receivedCount}</div>
            </div>
            <div>
              <div className="text-[12px] text-muted">Ticket médio</div>
              <div className="text-[18px] font-bold text-ink">{money(kpis.receivedCount ? kpis.received / kpis.receivedCount : 0)}</div>
            </div>
            {kpis.receivedConfirmed > 0 && (
              <div>
                <div className="text-[12px] text-muted">Cartão a creditar</div>
                <div className="text-[18px] font-bold text-ink">{moneyCompact(kpis.receivedConfirmed)}</div>
              </div>
            )}
          </div>
        </div>
        <WeekBars days={week} />
      </section>

      <Tile icon={<CalendarClock size={17} />} color="var(--series-1)" label="A receber no período" value={money(kpis.receivable)}>
        <span>{kpis.receivableCount} cobranças em aberto</span>
        {kpis.receivableOverdue > 0 && (
          <span className="inline-flex items-center gap-1 font-semibold text-critical-ink">
            <AlertTriangle size={12} /> {money(kpis.receivableOverdue)} já vencido
          </span>
        )}
      </Tile>

      <Tile icon={<Sparkles size={17} />} color="var(--series-in)" label={`Projeção · ${monthLabel(projection.month).split(' ')[0].toLowerCase()}`} value={money(projection.total)}>
        <span>
          <strong className="font-semibold text-ink-2">{moneyCompact(projection.issued + projection.recurring + projection.cardToCredit)}</strong> garantidos ·{' '}
          {moneyCompact(projection.cardEstimate)} estimado
        </span>
        <span>Cobranças emitidas + recorrência + cartão</span>
      </Tile>

      <Tile icon={<Landmark size={17} />} color="var(--series-4)" label="Saldo no Asaas" value={asaas?.balance != null ? money(asaas.balance) : '—'} badge={asaas?.state === 'demo' ? <DemoBadge /> : undefined}>
        <span>{asaas?.balanceUpdatedAt ? `Atualizado às ${new Date(asaas.balanceUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : asaas?.message}</span>
        {otherBalances.map((b) => (
          <span key={b.id}>
            {b.name}: {money(b.balance!)}
          </span>
        ))}
      </Tile>

      <Tile
        icon={<CreditCard size={17} />}
        color="var(--series-2)"
        label="InfinitePay hoje"
        value={money(ipTotal)}
        badge={
          <span className="inline-flex items-center gap-1.5 rounded-full bg-surface-2 px-2.5 py-1 text-[11px] font-semibold text-ink-2">
            <span className={clsx('relative inline-block size-1.5 rounded-full', live ? 'live-dot bg-good' : 'bg-[var(--axis)]')} />
            {live ? 'ao vivo' : 'offline'}
          </span>
        }
      >
        <span>{ipToday.length} vendas hoje</span>
        {lastSale?.createdAt && <span>Última: {money(lastSale.amount)} às {new Date(lastSale.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
      </Tile>

      <Tile icon={<Receipt size={17} />} color="var(--series-3)" label="Despesas no período" value={money(kpis.outflow)}>
        <Delta current={kpis.outflow} previous={kpis.outflowCompare} upIsGood={false} label={kpis.compareLabel} />
        <span>{kpis.outflowDays} dias com despesa{transfers > 0 && <> · {moneyCompact(transfers)} entre contas</>}</span>
      </Tile>

      <Tile icon={<AlertTriangle size={17} />} color="var(--critical)" label="Inadimplência total" value={money(kpis.overdueTotal)}>
        <span>Vencido e não pago nos últimos 12 meses</span>
      </Tile>
    </div>
  );
}

export function DemoBadge() {
  return (
    <span className="rounded-full bg-[color-mix(in_oklab,var(--warning)_22%,transparent)] px-2.5 py-1 text-[11px] font-semibold text-ink-2" title="Fonte sem credencial: valores de demonstração">
      demo
    </span>
  );
}
