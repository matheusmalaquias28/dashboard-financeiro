import clsx from 'clsx';
import { useMemo, useState } from 'react';
import { axisMoney, fmtDate, METHOD_NAME, money, monthLabel } from '../lib/format';
import type { DayFlow } from '../lib/metrics';
import { DataTable } from './ui';

const WEEKDAYS = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
const WEEKDAYS_PLURAL = ['domingos', 'segundas', 'terças', 'quartas', 'quintas', 'sextas', 'sábados'];
const HEAT = ['var(--heat-1)', 'var(--heat-2)', 'var(--heat-3)', 'var(--heat-4)', 'var(--heat-5)'];

/** "Dias de saída": calendar heatmap do mês – a cor é a intensidade das saídas no dia (rampa de um só tom) */
export function OutflowCalendar({ days, month, today, withTransfers, onToggleTransfers }: {
  days: DayFlow[];
  month: string;
  today: string;
  withTransfers: boolean;
  onToggleTransfers: (v: boolean) => void;
}) {
  const [selected, setSelected] = useState<string | null>(null);
  const [asTable, setAsTable] = useState(false);
  const max = Math.max(...days.map((d) => d.saidas), 1);
  const offset = new Date(`${month}-01T12:00:00Z`).getUTCDay();
  const outDays = days.filter((d) => d.saidas > 0);
  const total = outDays.reduce((a, d) => a + d.saidas, 0);
  const peak = outDays.reduce<DayFlow | null>((acc, d) => (!acc || d.saidas > acc.saidas ? d : acc), null);

  // dia da semana com mais saídas – ajuda a enxergar o padrão (ex.: transferências toda sexta)
  const weekdayPattern = useMemo(() => {
    const acc = new Array(7).fill(0);
    for (const d of outDays) acc[new Date(`${d.date}T12:00:00Z`).getUTCDay()] += d.saidas;
    const idx = acc.indexOf(Math.max(...acc));
    return outDays.length ? WEEKDAYS_PLURAL[idx] : null;
  }, [outDays]);

  const level = (v: number) => (v <= 0 ? -1 : Math.min(4, Math.floor((v / max) * 5 - 1e-9)));
  const detail = days.find((d) => d.date === selected) ?? null;

  return (
    <section className="card flex min-w-0 flex-col">
      <header className="flex flex-wrap items-start justify-between gap-x-3 gap-y-1 px-5 pt-4">
        <div>
          <h2 className="text-[15px] font-semibold text-ink">Dias de saída</h2>
          <p className="mt-0.5 text-[13px] text-muted">
            {outDays.length} dias com saída em {monthLabel(month)} · {money(total)}
            {weekdayPattern && <> · pico de saídas: {weekdayPattern}</>}
          </p>
        </div>
        <div className="-ml-2.5 flex flex-wrap items-center gap-1 sm:ml-0 sm:justify-end">
          <label className="inline-flex h-8 cursor-pointer items-center gap-2 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-surface-2">
            <input type="checkbox" checked={withTransfers} onChange={(e) => onToggleTransfers(e.target.checked)} className="accent-[var(--accent)]" />
            Transferências entre contas
          </label>
          <button type="button" onClick={() => setAsTable((v) => !v)} className="h-8 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-surface-2">
            {asTable ? 'Calendário' : 'Tabela'}
          </button>
        </div>
      </header>

      <div className="grid min-w-0 flex-1 gap-5 px-5 pb-5 pt-3 md:grid-cols-[minmax(0,1fr)_240px]">
        {asTable ? (
          <div className="max-h-[320px] overflow-auto md:col-span-2">
            <DataTable
              head={['Dia', 'Saídas', 'Entradas', 'Lançamentos']}
              rows={outDays.map((d) => [fmtDate(d.date, 'dd/MM (EEE)'), money(d.saidas), money(d.entradas), String(d.items.length)])}
            />
          </div>
        ) : (
          <>
            <div>
              <div className="grid grid-cols-7 gap-1 text-center text-[11px] text-muted">
                {WEEKDAYS.map((w) => <div key={w} className="pb-1">{w}</div>)}
                {Array.from({ length: offset }, (_, i) => <div key={`e${i}`} />)}
                {days.map((d) => {
                  const lv = level(d.saidas);
                  const isSel = selected === d.date;
                  const future = d.date > today;
                  return (
                    <button
                      key={d.date}
                      type="button"
                      onClick={() => setSelected(isSel ? null : d.date)}
                      onMouseEnter={() => d.saidas > 0 && setSelected(d.date)}
                      title={`${fmtDate(d.date)} · saídas ${money(d.saidas)} · entradas ${money(d.entradas)}`}
                      className={clsx(
                        'relative flex aspect-square min-h-9 flex-col items-start justify-between rounded-md p-1 text-left transition-[outline]',
                        isSel ? 'outline-2 outline-offset-1 outline-[var(--ink)]' : 'hover:outline-2 hover:outline-offset-1 hover:outline-[var(--axis)]',
                        future && 'opacity-50',
                      )}
                      style={{ background: lv < 0 ? 'var(--heat-0)' : HEAT[lv] }}
                    >
                      <span className={clsx('text-[11px] font-medium leading-none', lv >= 3 ? 'text-white' : 'text-ink-2', d.date === today && 'underline underline-offset-2')}>
                        {Number(d.date.slice(8))}
                      </span>
                      {d.saidas > 0 && (
                        <span className={clsx('hidden w-full truncate text-[10px] leading-none sm:block', lv >= 3 ? 'text-white/90' : 'text-ink-2')}>
                          {axisMoney(d.saidas)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
              <div className="mt-3 flex items-center gap-2 text-[11px] text-muted">
                menos
                <span className="size-3 rounded-[3px]" style={{ background: 'var(--heat-0)' }} />
                {HEAT.map((c) => <span key={c} className="size-3 rounded-[3px]" style={{ background: c }} />)}
                mais saídas
              </div>
            </div>

            <div className="min-w-0 border-t border-line pt-4 md:border-l md:border-t-0 md:pl-5 md:pt-0">
              {detail && detail.saidas > 0 ? (
                <>
                  <div className="text-[12px] text-muted">{fmtDate(detail.date, "EEEE, dd 'de' MMMM")}</div>
                  <div className="tabular mt-0.5 text-[20px] font-semibold text-ink">{money(detail.saidas)}</div>
                  <div className="text-[12px] text-muted">entradas no dia: {money(detail.entradas)}</div>
                  <ul className="mt-3 flex max-h-[190px] flex-col gap-2 overflow-auto pr-1">
                    {[...detail.items].sort((a, b) => b.amount - a.amount).map((t) => (
                      <li key={t.id} className="flex items-start justify-between gap-2 text-[12px]">
                        <span className="min-w-0">
                          <span className="block truncate text-ink-2">{t.description}</span>
                          <span className="text-muted">{t.internal ? 'Entre contas da empresa' : METHOD_NAME[t.method]}</span>
                        </span>
                        <span className="tabular shrink-0 font-medium text-ink">{money(t.amount)}</span>
                      </li>
                    ))}
                  </ul>
                </>
              ) : (
                <>
                  <div className="text-[12px] text-muted">Maior saída do mês</div>
                  {peak ? (
                    <>
                      <div className="tabular mt-0.5 text-[20px] font-semibold text-ink">{money(peak.saidas)}</div>
                      <div className="text-[12px] text-muted">{fmtDate(peak.date, "EEEE, dd/MM")}</div>
                    </>
                  ) : (
                    <div className="mt-1 text-[13px] text-ink-2">Nenhuma saída no período.</div>
                  )}
                  <p className="mt-4 text-[12px] text-muted">Passe o mouse ou toque num dia para ver os lançamentos.</p>
                </>
              )}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
