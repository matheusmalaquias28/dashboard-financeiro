import clsx from 'clsx';
import { AlertTriangle, Info } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { MonthlyFlowChart, CumulativeChart } from './components/Charts';
import { FilterBar } from './components/FilterBar';
import { Header } from './components/Header';
import { KpiSection } from './components/Kpis';
import { OutflowCalendar } from './components/OutflowCalendar';
import { BreakdownCard, IntegrationsPanel, LiveFeed, ProjectionCard, ReceivablesCard } from './components/Panels';
import { TransactionsTable } from './components/TransactionsTable';
import {
  applyFilters, breakdown, computeKpis, computeProjection, cumulativeSeries, dailyFlow, internalOutflow, monthlySeries, receivables, ymOf,
} from './lib/metrics';
import { useDashboard } from './lib/useDashboard';
import type { DashboardData, Filters } from './types';

export default function App() {
  const { data, error, loading, live, freshIds, reload } = useDashboard();

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6 lg:py-7">
      <Header generatedAt={data?.generatedAt} loading={loading} live={live} onRefresh={reload} />
      {error && (
        <div className="card flex items-center gap-2 border-[var(--critical)] px-4 py-3 text-[13px] text-critical-ink">
          <AlertTriangle size={16} /> {error}
        </div>
      )}
      {data ? <Dashboard data={data} loading={loading} live={live === 'live'} freshIds={freshIds} /> : !error && <Skeleton />}
    </div>
  );
}

function Dashboard({ data, loading, live, freshIds }: { data: DashboardData; loading: boolean; live: boolean; freshIds: Set<string> }) {
  const defaults = useMemo<Filters>(
    () => ({ month: ymOf(data.today), sources: data.sources.filter((s) => s.state !== 'pending_access').map((s) => s.id), methods: [] }),
    [data.today, data.sources.map((s) => s.state).join()],
  );
  const [filters, setFilters] = useState<Filters>(defaults);
  useEffect(() => setFilters((f) => ({ ...f, sources: defaults.sources })), [defaults]);

  const txs = useMemo(() => applyFilters(data, filters), [data, filters]);
  const m = filters.month;
  const kpis = useMemo(() => computeKpis(txs, m, data.today), [txs, m, data.today]);
  const projection = useMemo(() => computeProjection(data, txs, filters), [data, txs, filters]);
  const cumulative = useMemo(() => cumulativeSeries(txs, m, data.today), [txs, m, data.today]);
  const monthly = useMemo(() => monthlySeries(txs, ymOf(data.today), 12, ymOf(data.window.from)), [txs, data.today, data.window.from]);
  const [withTransfers, setWithTransfers] = useState(true);
  const txsWithInternal = useMemo(() => applyFilters(data, filters, true), [data, filters]);
  const transfers = useMemo(() => internalOutflow(txsWithInternal, m), [txsWithInternal, m]);
  const days = useMemo(() => dailyFlow(withTransfers ? txsWithInternal : txs, m), [withTransfers, txsWithInternal, txs, m]);
  const bySource = useMemo(() => breakdown(txs, m, (t) => t.source), [txs, m]);
  const byMethod = useMemo(() => breakdown(txs, m, (t) => t.method), [txs, m]);
  const openItems = useMemo(() => receivables(txs, m), [txs, m]);

  // feed e KPI "hoje" da InfinitePay ignoram o mês selecionado: são sempre o agora
  const ipAll = useMemo(
    () => data.transactions.filter((t) => t.source === 'infinitepay' && t.direction === 'in').sort((a, b) => (b.createdAt ?? b.paidDate ?? '').localeCompare(a.createdAt ?? a.paidDate ?? '')),
    [data.transactions],
  );
  const ipToday = ipAll.filter((t) => t.paidDate === data.today);
  const ipSource = data.sources.find((s) => s.id === 'infinitepay');
  const demoSources = data.sources.filter((s) => s.state === 'demo');

  return (
    <>
      {demoSources.length > 0 && (
        <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-4 py-2.5 text-[13px] text-ink-2">
          <Info size={16} className="mt-0.5 shrink-0" />
          <span>
            <strong className="font-semibold text-ink">Dados de demonstração</strong> para {demoSources.map((s) => s.name).join(' e ')}. Configure as credenciais no
            arquivo <code>.env</code> para ver os valores reais (veja o painel de Integrações no fim da página).
          </span>
        </div>
      )}

      <div className="z-20 sm:sticky sm:top-0 -mx-4 bg-[color-mix(in_oklab,var(--page)_88%,transparent)] px-4 py-2 backdrop-blur sm:-mx-6 sm:px-6">
        <FilterBar data={data} filters={filters} onChange={setFilters} defaults={defaults} />
      </div>

      <main className={clsx('flex flex-col gap-4 transition-opacity', loading && 'opacity-70')}>
        <KpiSection
          kpis={kpis}
          month={m}
          cumulative={cumulative}
          projection={projection}
          asaas={data.sources.find((s) => s.id === 'asaas')}
          banks={data.sources}
          ipToday={ipToday}
          transfers={transfers}
          live={live}
        />

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2"><CumulativeChart data={cumulative} month={m} /></div>
          <LiveFeed items={ipAll.slice(0, 30)} fresh={freshIds} live={live} demo={ipSource?.state === 'demo'} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2">
            <MonthlyFlowChart data={monthly} selected={m} onSelect={(ym) => setFilters((f) => ({ ...f, month: ym }))} />
          </div>
          <ProjectionCard p={projection} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <div className="min-w-0 lg:col-span-2"><OutflowCalendar days={days} month={m} today={data.today} withTransfers={withTransfers} onToggleTransfers={setWithTransfers} /></div>
          <BreakdownCard bySource={bySource} byMethod={byMethod} month={m} />
        </div>

        <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
          <ReceivablesCard items={openItems} month={m} today={data.today} />
          <div className="min-w-0 lg:col-span-2"><TransactionsTable txs={txs} month={m} /></div>
        </div>

        <IntegrationsPanel sources={data.sources} />
      </main>

      <footer className="pb-4 pt-2 text-center text-[12px] text-muted">
        Dados de {data.window.from.split('-').reverse().join('/')} a {data.window.to.split('-').reverse().join('/')} · atualizado em {new Date(data.generatedAt).toLocaleString('pt-BR')}
      </footer>
    </>
  );
}

function Skeleton() {
  return (
    <div className="grid animate-pulse gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {Array.from({ length: 8 }, (_, i) => <div key={i} className={clsx('card h-32', i === 0 && 'sm:col-span-2')} />)}
    </div>
  );
}
