import clsx from 'clsx';
import { Check, ChevronDown, RotateCcw, Wallet } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { METHOD_NAME, SOURCE_COLOR, SOURCE_NAME } from '../lib/format';
import { ALL_METHODS } from '../lib/metrics';
import type { DashboardData, Filters, PaymentMethod, SourceId } from '../types';
import { DateRangePicker } from './DateRangePicker';

export function FilterBar({ data, filters, onChange, defaults }: {
  data: DashboardData;
  filters: Filters;
  onChange: (f: Filters) => void;
  defaults: Filters;
}) {
  const activeSources = data.sources.filter((s) => s.state !== 'pending_access');
  const toggleSource = (id: SourceId) => {
    const has = filters.sources.includes(id);
    if (has && filters.sources.length === 1) return; // ao menos uma fonte
    onChange({ ...filters, sources: has ? filters.sources.filter((s) => s !== id) : [...filters.sources, id] });
  };

  const isDefault =
    filters.period.from === defaults.period.from &&
    filters.period.to === defaults.period.to &&
    filters.methods.length === 0 &&
    filters.sources.length === defaults.sources.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* período */}
      <DateRangePicker value={filters.period} onChange={(period) => onChange({ ...filters, period })} today={data.today} min={data.window.from} max={data.window.to} />

      <span aria-hidden className="mx-1 hidden h-6 w-px bg-[var(--border-strong)] sm:block" />

      {/* fontes */}
      <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Fontes">
        {activeSources.map((s) => {
          const on = filters.sources.includes(s.id);
          return (
            <button
              key={s.id}
              type="button"
              onClick={() => toggleSource(s.id)}
              aria-pressed={on}
              className={clsx(
                'inline-flex h-10 items-center gap-2 rounded-full border pl-2 pr-4 text-[13px] font-semibold transition-colors',
                on ? 'border-line-strong bg-surface-2 text-ink' : 'border-dashed border-line bg-transparent text-muted hover:text-ink-2',
              )}
            >
              <span className="grid size-6 place-items-center rounded-full" style={{ background: on ? SOURCE_COLOR[s.id] : 'var(--surface-3)' }}>
                {on && <Check size={13} strokeWidth={3.5} className="text-white" />}
              </span>
              {SOURCE_NAME[s.id]}
            </button>
          );
        })}
      </div>

      <MethodSelect value={filters.methods} onChange={(methods) => onChange({ ...filters, methods })} />

      {!isDefault && (
        <button
          type="button"
          onClick={() => onChange(defaults)}
          className="inline-flex h-10 items-center gap-1.5 rounded-full px-3 text-[13px] font-semibold text-muted hover:text-ink"
        >
          <RotateCcw size={14} /> Limpar
        </button>
      )}
    </div>
  );
}

/** Seleção múltipla das formas de pagamento */
function MethodSelect({ value, onChange }: { value: PaymentMethod[]; onChange: (v: PaymentMethod[]) => void }) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
  }, []);

  const label = value.length === 0 ? 'Todas as formas' : value.length === 1 ? METHOD_NAME[value[0]] : `${value.length} formas`;
  const toggle = (m: PaymentMethod) => onChange(value.includes(m) ? value.filter((x) => x !== m) : [...value, m]);

  const Box = ({ on }: { on: boolean }) => (
    <span className={clsx('grid size-[18px] place-items-center rounded-md border', on ? 'border-transparent bg-accent text-on-accent' : 'border-line-strong')}>
      {on && <Check size={12} strokeWidth={3.5} />}
    </span>
  );

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="listbox"
        className={clsx(
          'inline-flex h-10 items-center gap-2 rounded-full border bg-surface px-4 text-[13px] transition-colors',
          open ? 'border-[var(--accent-text)]' : 'border-line hover:border-line-strong',
        )}
      >
        <Wallet size={15} className="text-muted" />
        <span className="font-semibold text-ink">{label}</span>
        {value.length > 0 && <span className="rounded-full bg-accent px-1.5 text-[11px] font-bold text-on-accent">{value.length}</span>}
        <ChevronDown size={15} className={clsx('text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <div role="listbox" aria-multiselectable="true" aria-label="Formas de pagamento" className="pop-in absolute left-0 z-40 mt-1.5 w-60 rounded-2xl border border-line-strong bg-surface-2 p-1.5 shadow-2xl shadow-black/40">
          <button type="button" role="option" aria-selected={value.length === 0} onClick={() => onChange([])} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] font-semibold text-ink hover:bg-surface-3">
            <Box on={value.length === 0} /> Todas as formas
          </button>
          <div className="mx-2 my-1 h-px bg-[var(--border)]" />
          {ALL_METHODS.map((m) => (
            <button key={m} type="button" role="option" aria-selected={value.includes(m)} onClick={() => toggle(m)} className="flex w-full items-center gap-2.5 rounded-xl px-3 py-2 text-left text-[13px] text-ink-2 hover:bg-surface-3 hover:text-ink">
              <Box on={value.includes(m)} /> {METHOD_NAME[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
