import clsx from 'clsx';
import { Check, ChevronDown, ChevronLeft, ChevronRight, RotateCcw } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { METHOD_NAME, monthLabel, SOURCE_COLOR, SOURCE_NAME } from '../lib/format';
import { ALL_METHODS, shiftMonth, ymOf } from '../lib/metrics';
import type { DashboardData, Filters, PaymentMethod, SourceId } from '../types';

export function FilterBar({ data, filters, onChange, defaults }: {
  data: DashboardData;
  filters: Filters;
  onChange: (f: Filters) => void;
  defaults: Filters;
}) {
  const first = ymOf(data.window.from);
  const last = ymOf(data.window.to);
  const months: string[] = [];
  for (let m = last; m >= first; m = shiftMonth(m, -1)) months.push(m);

  const activeSources = data.sources.filter((s) => s.state !== 'pending_access');
  const toggleSource = (id: SourceId) => {
    const has = filters.sources.includes(id);
    if (has && filters.sources.length === 1) return; // ao menos uma fonte
    onChange({ ...filters, sources: has ? filters.sources.filter((s) => s !== id) : [...filters.sources, id] });
  };

  const isDefault = filters.month === defaults.month && filters.methods.length === 0 && filters.sources.length === defaults.sources.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {/* período */}
      <div className="flex h-9 items-center rounded-lg border border-line bg-surface">
        <button
          type="button"
          className="grid h-full w-9 place-items-center text-ink-2 hover:bg-surface-2 disabled:opacity-30"
          onClick={() => onChange({ ...filters, month: shiftMonth(filters.month, -1) })}
          disabled={filters.month <= first}
          aria-label="Mês anterior"
        >
          <ChevronLeft size={16} />
        </button>
        <select
          value={filters.month}
          onChange={(e) => onChange({ ...filters, month: e.target.value })}
          className="h-full min-w-[150px] cursor-pointer appearance-none bg-transparent px-2 text-center text-[13px] font-medium text-ink outline-none"
          aria-label="Mês de referência"
        >
          {months.map((m) => (
            <option key={m} value={m}>
              {monthLabel(m)}
              {m === ymOf(data.today) ? ' (atual)' : ''}
            </option>
          ))}
        </select>
        <button
          type="button"
          className="grid h-full w-9 place-items-center text-ink-2 hover:bg-surface-2 disabled:opacity-30"
          onClick={() => onChange({ ...filters, month: shiftMonth(filters.month, 1) })}
          disabled={filters.month >= last}
          aria-label="Próximo mês"
        >
          <ChevronRight size={16} />
        </button>
      </div>

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
                'inline-flex h-9 items-center gap-2 rounded-lg border px-3 text-[13px] transition-colors',
                on ? 'border-line bg-surface text-ink' : 'border-dashed border-line bg-transparent text-muted',
              )}
            >
              <span className="size-2.5 rounded-[3px]" style={{ background: on ? SOURCE_COLOR[s.id] : 'var(--axis)' }} />
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
          className="inline-flex h-9 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-surface-2"
        >
          <RotateCcw size={14} /> Limpar
        </button>
      )}
    </div>
  );
}

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

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        className={clsx('inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px]', value.length ? 'text-ink' : 'text-ink-2')}
      >
        Pagamento: <span className="font-medium text-ink">{label}</span>
        <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute left-0 z-30 mt-1 w-56 rounded-xl border border-line bg-surface p-1 shadow-lg">
          <button
            type="button"
            onClick={() => onChange([])}
            className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-surface-2"
          >
            <span className="grid w-4 place-items-center">{value.length === 0 && <Check size={16} strokeWidth={3} />}</span>
            Todas as formas
          </button>
          <div className="my-1 h-px bg-[var(--grid)]" />
          {ALL_METHODS.map((m) => (
            <button
              key={m}
              type="button"
              onClick={() => toggle(m)}
              className="flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] text-ink hover:bg-surface-2"
            >
              <span className="grid w-4 place-items-center">{value.includes(m) && <Check size={16} strokeWidth={3} />}</span>
              {METHOD_NAME[m]}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
