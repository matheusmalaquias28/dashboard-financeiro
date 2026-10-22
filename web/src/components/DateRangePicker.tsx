/**
 * Seletor de período: atalhos (hoje, semana, mês, ano…) + calendário para escolher um dia,
 * um intervalo personalizado ou um mês inteiro (clicando no nome do mês).
 */
import clsx from 'clsx';
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import {
  addDays, addMonths, daysBetween, endOfMonth, maxDate, minDate, monthPeriod, periodLabel, PRESETS, presetPeriod, shiftPeriod, startOfMonth,
  startOfWeek, type Period,
} from '../lib/period';

const MONTHS = ['Janeiro', 'Fevereiro', 'Março', 'Abril', 'Maio', 'Junho', 'Julho', 'Agosto', 'Setembro', 'Outubro', 'Novembro', 'Dezembro'];
const MONTHS_SHORT = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez'];
const WEEK = ['S', 'T', 'Q', 'Q', 'S', 'S', 'D'];

const fmtShort = (iso: string) => `${Number(iso.slice(8, 10))} ${MONTHS_SHORT[Number(iso.slice(5, 7)) - 1]} ${iso.slice(0, 4)}`;

export function DateRangePicker({ value, onChange, today, min, max }: {
  value: Period;
  onChange: (p: Period) => void;
  today: string;
  min: string;
  max: string;
}) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Period>(value);
  const [anchor, setAnchor] = useState<string | null>(null);
  const [hover, setHover] = useState<string | null>(null);
  const [cursor, setCursor] = useState(startOfMonth(value.to)); // mês exibido à direita
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    setDraft(value);
    setAnchor(null);
    setCursor(startOfMonth(value.to));
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('mousedown', close);
    document.addEventListener('keydown', esc);
    return () => {
      document.removeEventListener('mousedown', close);
      document.removeEventListener('keydown', esc);
    };
    // ao abrir, parte sempre do período aplicado
  }, [open]);

  // atalhos não são recortados (o ano é jan–dez); só o calendário limita os dias aos dados carregados
  const apply = (p: Period) => {
    onChange(p);
    setOpen(false);
  };

  const pickDay = (d: string) => {
    if (!anchor) {
      setAnchor(d);
      setDraft({ preset: 'custom', from: d, to: d });
    } else {
      setDraft({ preset: 'custom', from: minDate(anchor, d), to: maxDate(anchor, d) });
      setAnchor(null);
    }
  };

  // durante a escolha, o intervalo acompanha o mouse
  const shown = anchor && hover ? { from: minDate(anchor, hover), to: maxDate(anchor, hover) } : draft;
  const len = daysBetween(shown.from, shown.to) + 1;
  const canPrev = shiftPeriod(value, -1).to >= min;
  const canNext = shiftPeriod(value, 1).from <= max;
  const navBtn = 'grid size-10 shrink-0 place-items-center rounded-full border border-line bg-surface text-ink-2 transition-colors hover:border-line-strong hover:text-ink disabled:opacity-30';

  return (
    <div ref={ref} className="relative flex items-center gap-1.5">
      <button type="button" className={navBtn} onClick={() => onChange(shiftPeriod(value, -1))} disabled={!canPrev} aria-label="Período anterior">
        <ChevronLeft size={16} />
      </button>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-haspopup="dialog"
        className={clsx(
          'inline-flex h-10 min-w-0 max-w-[min(340px,calc(100vw-140px))] items-center gap-2 rounded-full border bg-surface px-4 text-[13px] transition-colors',
          open ? 'border-[var(--accent-text)]' : 'border-line hover:border-line-strong',
        )}
      >
        <CalendarDays size={15} className="shrink-0 text-muted" />
        <span className="truncate font-semibold text-ink">{periodLabel(value)}</span>
        <ChevronDown size={15} className={clsx('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      <button type="button" className={navBtn} onClick={() => onChange(shiftPeriod(value, 1))} disabled={!canNext} aria-label="Próximo período">
        <ChevronRight size={16} />
      </button>

      {open && (
        <div
          role="dialog"
          aria-label="Escolher período"
          className="pop-in fixed inset-x-3 top-24 z-50 flex max-h-[calc(100dvh-7rem)] flex-col overflow-hidden rounded-3xl border border-line-strong bg-surface-2 shadow-2xl shadow-black/50 sm:absolute sm:inset-x-auto sm:left-0 sm:top-12 sm:w-[640px]"
        >
          <div className="flex min-h-0 flex-1 flex-col overflow-auto sm:flex-row">
            {/* atalhos */}
            <ul className="flex shrink-0 gap-1 overflow-x-auto border-b border-line p-2 sm:w-[200px] sm:flex-col sm:overflow-visible sm:border-b-0 sm:border-r">
              {PRESETS.map((p) => {
                const on = draft.preset === p.id;
                return (
                  <li key={p.id}>
                    <button
                      type="button"
                      onClick={() => {
                        const next = presetPeriod(p.id, today);
                        setDraft(next);
                        setAnchor(null);
                        setCursor(startOfMonth(next.to));
                      }}
                      onDoubleClick={() => apply(presetPeriod(p.id, today))}
                      className={clsx(
                        'flex w-full items-center gap-2 whitespace-nowrap rounded-xl px-3 py-2 text-left text-[13px] transition-colors',
                        on ? 'bg-surface-3 font-bold text-ink' : 'text-ink-2 hover:bg-surface-3/60 hover:text-ink',
                      )}
                    >
                      <span className="hidden w-4 sm:inline-block">{on && <Check size={16} strokeWidth={3} className="text-accent-text" />}</span>
                      {p.label}
                    </button>
                  </li>
                );
              })}
            </ul>

            {/* calendário */}
            <div className="min-w-0 flex-1 p-4">
              <MonthCalendar
                month={cursor}
                onMonth={setCursor}
                range={shown}
                anchor={anchor}
                today={today}
                min={min}
                max={max}
                onPick={pickDay}
                onHover={setHover}
                onPickMonth={(ym) => {
                  const p = monthPeriod(ym);
                  setDraft(p);
                  setAnchor(null);
                }}
              />
              <p className="mt-3 text-[12px] text-muted">
                Clique em um dia e depois em outro para escolher um intervalo. Clique no nome do mês para escolher o mês inteiro.
              </p>
              {(shown.from < min || shown.to > max) && (
                <p className="mt-2 text-[12px] font-semibold text-ink-2">
                  Há dados de {fmtShort(min)} a {fmtShort(max)}; o restante do período aparece zerado.
                </p>
              )}
            </div>
          </div>

          <footer className="flex flex-wrap items-center justify-between gap-3 border-t border-line px-4 py-3">
            <div className="text-[13px]">
              <span className="font-bold text-ink">{shown.from === shown.to ? fmtShort(shown.from) : `${fmtShort(shown.from)} – ${fmtShort(shown.to)}`}</span>
              <span className="ml-2 text-muted">{len === 1 ? '1 dia' : `${len} dias`}</span>
            </div>
            <div className="flex gap-2">
              <button type="button" onClick={() => setOpen(false)} className="h-10 rounded-full px-4 text-[13px] font-semibold text-ink-2 hover:text-ink">
                Cancelar
              </button>
              <button
                type="button"
                onClick={() => apply(draft)}
                className="h-10 rounded-full bg-accent px-5 text-[13px] font-bold text-on-accent hover:opacity-90"
              >
                Aplicar
              </button>
            </div>
          </footer>
        </div>
      )}
    </div>
  );
}

function MonthCalendar({ month, onMonth, range, anchor, today, min, max, onPick, onHover, onPickMonth }: {
  month: string;
  onMonth: (m: string) => void;
  range: { from: string; to: string };
  anchor: string | null;
  today: string;
  min: string;
  max: string;
  onPick: (d: string) => void;
  onHover: (d: string | null) => void;
  onPickMonth: (ym: string) => void;
}) {
  const [yearView, setYearView] = useState(false);
  const year = Number(month.slice(0, 4));
  const first = startOfWeek(month);
  const last = addDays(startOfWeek(endOfMonth(month)), 6);
  const cells: string[] = [];
  for (let d = first; d <= last; d = addDays(d, 1)) cells.push(d);
  const arrow = 'grid size-9 place-items-center rounded-full text-ink-2 hover:bg-surface-3 hover:text-ink disabled:opacity-30';

  if (yearView) {
    return (
      <div>
        <div className="mb-3 flex items-center justify-between">
          <button type="button" className={arrow} onClick={() => onMonth(addMonths(month, -12))} disabled={`${year - 1}-12-31` < min} aria-label="Ano anterior"><ChevronLeft size={16} /></button>
          <button type="button" onClick={() => setYearView(false)} className="rounded-full px-3 py-1.5 text-[15px] font-bold text-ink hover:bg-surface-3">{year}</button>
          <button type="button" className={arrow} onClick={() => onMonth(addMonths(month, 12))} disabled={`${year + 1}-01-01` > max} aria-label="Próximo ano"><ChevronRight size={16} /></button>
        </div>
        <div className="grid grid-cols-3 gap-2">
          {MONTHS.map((name, i) => {
            const ym = `${year}-${String(i + 1).padStart(2, '0')}`;
            const disabled = endOfMonth(`${ym}-01`) < min || `${ym}-01` > max;
            const selected = range.from === `${ym}-01` && range.to === endOfMonth(`${ym}-01`);
            return (
              <button
                key={ym}
                type="button"
                disabled={disabled}
                onClick={() => {
                  onPickMonth(ym);
                  onMonth(`${ym}-01`);
                  setYearView(false);
                }}
                className={clsx(
                  'h-12 rounded-2xl text-[13px] font-semibold transition-colors disabled:opacity-25',
                  selected ? 'bg-accent text-on-accent' : 'bg-surface text-ink-2 hover:bg-surface-3 hover:text-ink',
                  ym === today.slice(0, 7) && !selected && 'ring-1 ring-[var(--accent-text)]',
                )}
              >
                {name}
              </button>
            );
          })}
        </div>
      </div>
    );
  }

  return (
    <div onMouseLeave={() => onHover(null)}>
      <div className="mb-3 flex items-center justify-between">
        <button type="button" className={arrow} onClick={() => onMonth(addMonths(month, -1))} disabled={addDays(month, -1) < min} aria-label="Mês anterior"><ChevronLeft size={16} /></button>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={() => onPickMonth(month.slice(0, 7))}
            className="rounded-full px-3 py-1.5 text-[15px] font-bold text-ink hover:bg-surface-3"
            title="Selecionar o mês inteiro"
          >
            {MONTHS[Number(month.slice(5, 7)) - 1]}
          </button>
          <button type="button" onClick={() => setYearView(true)} className="rounded-full px-2 py-1.5 text-[15px] font-bold text-muted hover:bg-surface-3 hover:text-ink" title="Ver os meses do ano">
            {year}
          </button>
        </div>
        <button type="button" className={arrow} onClick={() => onMonth(addMonths(month, 1))} disabled={addMonths(month, 1) > max} aria-label="Próximo mês"><ChevronRight size={16} /></button>
      </div>
      <div className="grid grid-cols-7 text-center text-[11px] font-semibold text-muted">
        {WEEK.map((w, i) => <div key={i} className="pb-2">{w}</div>)}
      </div>
      <div className="grid grid-cols-7 gap-y-1" role="grid">
        {cells.map((d) => {
          const outside = d.slice(0, 7) !== month.slice(0, 7);
          const disabled = d < min || d > max;
          const isStart = d === range.from;
          const isEnd = d === range.to;
          const inRange = d > range.from && d < range.to;
          const edge = isStart || isEnd;
          return (
            <div
              key={d}
              className={clsx(
                'relative flex h-10 items-center justify-center',
                inRange && 'bg-accent-soft',
                isStart && range.from !== range.to && 'bg-gradient-to-r from-transparent from-50% to-[var(--accent-soft)] to-50%',
                isEnd && range.from !== range.to && 'bg-gradient-to-l from-transparent from-50% to-[var(--accent-soft)] to-50%',
              )}
            >
              <button
                type="button"
                disabled={disabled}
                onClick={() => onPick(d)}
                onMouseEnter={() => onHover(d)}
                aria-pressed={edge}
                aria-label={d}
                className={clsx(
                  'relative z-10 grid size-10 place-items-center rounded-full text-[13px] transition-colors disabled:cursor-not-allowed disabled:opacity-20',
                  edge ? 'bg-accent font-bold text-on-accent' : outside ? 'text-muted/60 hover:bg-surface-3' : 'font-medium text-ink hover:bg-surface-3',
                  d === today && !edge && 'ring-1 ring-inset ring-[var(--accent-text)]',
                  anchor === d && 'ring-2 ring-[var(--accent-text)] ring-offset-2 ring-offset-[var(--surface-2)]',
                )}
              >
                {Number(d.slice(8, 10))}
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}
