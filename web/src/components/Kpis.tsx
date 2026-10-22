import clsx from 'clsx';
import { AlertTriangle, ArrowDownRight, ArrowUpRight, CalendarClock, CreditCard, Landmark, LogOut, TrendingUp, Wallet } from 'lucide-react';
import type { ReactNode } from 'react';
import { Area, AreaChart, ResponsiveContainer } from 'recharts';
import { money, moneyCompact, monthLabel, percent } from '../lib/format';
import type { CumulativePoint, Kpis, Projection } from '../lib/metrics';
import type { SourceStatus, Transaction } from '../types';

function Delta({ current, previous, upIsGood = true, label }: { current: number; previous: number; upIsGood?: boolean; label: string }) {
  if (previous <= 0) return <span className="text-[12px] text-muted">sem base de comparação</span>;
  const change = (current - previous) / previous;
  const up = change >= 0;
  const good = up === upIsGood;
  return (
    <span className="inline-flex flex-wrap items-center gap-x-1.5 text-[12px]">
      <span className={clsx('inline-flex items-center font-semibold', good ? 'text-good-ink' : 'text-critical-ink')}>
        {up ? <ArrowUpRight size={14} /> : <ArrowDownRight size={14} />}
        {up ? '+' : ''}
        {percent(change)}
      </span>
      <span className="text-muted">{label}</span>
    </span>
  );
}

function Tile({ icon, label, value, children, className, badge }: { icon: ReactNode; label: string; value: ReactNode; children?: ReactNode; className?: string; badge?: ReactNode }) {
  return (
    <section className={clsx('card flex min-w-0 flex-col gap-2 p-4', className)}>
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex min-w-0 items-center gap-2 text-[13px] text-ink-2">
          <span className="grid size-7 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink-2">{icon}</span>
          <span className="truncate">{label}</span>
        </span>
        {badge}
      </div>
      <div className="truncate text-[26px] font-semibold leading-tight tracking-tight text-ink">{value}</div>
      {children && <div className="flex flex-col gap-1 text-[12px] text-muted">{children}</div>}
    </section>
  );
}

export function KpiSection({ kpis, month, cumulative, projection, asaas, banks, ipToday, transfers, live }: {
  kpis: Kpis;
  month: string;
  cumulative: CumulativePoint[];
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
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {/* Hero */}
      <section className="card relative flex min-w-0 flex-col overflow-hidden p-5 sm:col-span-2">
        <div className="flex items-center gap-2 text-[13px] text-ink-2">
          <span className="grid size-7 place-items-center rounded-lg bg-accent-soft text-accent"><Wallet size={15} /></span>
          Recebimentos em {monthLabel(month)}
        </div>
        <div className="mt-2 flex flex-wrap items-end justify-between gap-x-6 gap-y-2">
          <div>
            <div className="text-[44px] font-semibold leading-none tracking-tight text-ink sm:text-[52px]">{money(kpis.received)}</div>
            <div className="mt-3 flex flex-col gap-1">
              <Delta current={kpis.received} previous={kpis.receivedCompare} label={kpis.compareLabel} />
              <span className="text-[12px] text-muted">
                {kpis.receivedCount} pagamentos
                {kpis.receivedConfirmed > 0 && <> · {moneyCompact(kpis.receivedConfirmed)} no cartão aguardando crédito</>}
              </span>
            </div>
          </div>
          <div className="h-[72px] w-full max-w-[280px] sm:w-[45%]" aria-hidden>
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cumulative} margin={{ top: 4, right: 0, bottom: 0, left: 0 }}>
                <Area dataKey="anterior" stroke="var(--series-prev)" strokeWidth={1.5} fill="none" isAnimationActive={false} dot={false} />
                <Area dataKey="atual" stroke="var(--series-in)" strokeWidth={2} fill="var(--series-in)" fillOpacity={0.1} isAnimationActive={false} dot={false} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>
      </section>

      <Tile icon={<CalendarClock size={15} />} label={`A receber em ${monthLabel(month).split(' ')[0].toLowerCase()}`} value={money(kpis.receivable)}>
        <span>{kpis.receivableCount} cobranças em aberto</span>
        {kpis.receivableOverdue > 0 && (
          <span className="inline-flex items-center gap-1 text-critical-ink">
            <AlertTriangle size={12} /> {money(kpis.receivableOverdue)} já vencido
          </span>
        )}
      </Tile>

      <Tile icon={<TrendingUp size={15} />} label={`Projeção · ${monthLabel(projection.month).split(' ')[0].toLowerCase()}`} value={money(projection.total)}>
        <span>Cobranças emitidas + recorrência + cartão</span>
        <span>
          {moneyCompact(projection.issued + projection.recurring)} garantidos · {moneyCompact(projection.cardEstimate)} estimado
        </span>
      </Tile>

      <Tile
        icon={<Landmark size={15} />}
        label="Saldo no Asaas"
        value={asaas?.balance != null ? money(asaas.balance) : '—'}
        badge={asaas?.state === 'demo' ? <DemoBadge /> : undefined}
      >
        <span>{asaas?.balanceUpdatedAt ? `Atualizado às ${new Date(asaas.balanceUpdatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}` : asaas?.message}</span>
        {otherBalances.map((b) => (
          <span key={b.id}>
            {b.name}: {money(b.balance!)}
          </span>
        ))}
      </Tile>

      <Tile
        icon={<CreditCard size={15} />}
        label="InfinitePay hoje"
        value={money(ipTotal)}
        badge={
          <span className="inline-flex items-center gap-1.5 text-[11px] font-medium text-good-ink">
            <span className={clsx('relative inline-block size-1.5 rounded-full', live ? 'live-dot bg-good' : 'bg-axis')} />
            {live ? 'ao vivo' : 'offline'}
          </span>
        }
      >
        <span>{ipToday.length} vendas hoje</span>
        {lastSale?.createdAt && <span>Última: {money(lastSale.amount)} às {new Date(lastSale.createdAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}</span>}
      </Tile>

      <Tile icon={<LogOut size={15} />} label={`Despesas em ${monthLabel(month).split(' ')[0].toLowerCase()}`} value={money(kpis.outflow)}>
        <span>{kpis.outflowDays} dias com despesa{transfers > 0 && <> · {moneyCompact(transfers)} transferidos entre contas</>}</span>
        <Delta current={kpis.outflow} previous={kpis.outflowCompare} upIsGood={false} label="vs. mês anterior" />
      </Tile>

      <Tile icon={<AlertTriangle size={15} />} label="Inadimplência (total vencido)" value={money(kpis.overdueTotal)}>
        <span>Todas as cobranças vencidas e não pagas nos últimos 12 meses</span>
      </Tile>
    </div>
  );
}

export function DemoBadge() {
  return (
    <span className="rounded-full bg-[color-mix(in_oklab,var(--warning)_22%,transparent)] px-2 py-0.5 text-[11px] font-medium text-ink-2" title="Fonte sem credencial: valores de demonstração">
      demo
    </span>
  );
}
