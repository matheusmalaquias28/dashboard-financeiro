/**
 * Controles personalizados (no lugar dos nativos do navegador): Select com lista suspensa,
 * controle segmentado e interruptor. Todos funcionam com teclado e leitor de tela.
 */
import clsx from 'clsx';
import { Check, ChevronDown } from 'lucide-react';
import { useEffect, useId, useRef, useState, type KeyboardEvent, type ReactNode } from 'react';

export interface Option<V extends string | number> {
  value: V;
  label: ReactNode;
  /** texto para busca por digitação e leitores de tela */
  text?: string;
  hint?: ReactNode;
  icon?: ReactNode;
  disabled?: boolean;
}

export function Select<V extends string | number>({
  value,
  options,
  onChange,
  ariaLabel,
  placeholder = 'Selecione',
  prefix,
  className,
  buttonClassName,
  align = 'left',
  size = 'md',
}: {
  value: V | null;
  options: Option<V>[];
  onChange: (v: V) => void;
  ariaLabel: string;
  placeholder?: ReactNode;
  prefix?: ReactNode;
  className?: string;
  buttonClassName?: string;
  align?: 'left' | 'right';
  size?: 'sm' | 'md';
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const ref = useRef<HTMLDivElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const id = useId();
  const selected = options.find((o) => o.value === value);

  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false);
    document.addEventListener('mousedown', close);
    return () => document.removeEventListener('mousedown', close);
  }, [open]);

  useEffect(() => {
    if (open) listRef.current?.querySelector<HTMLElement>(`[data-index="${active}"]`)?.scrollIntoView({ block: 'nearest' });
  }, [open, active]);

  const openList = () => {
    setActive(Math.max(0, options.findIndex((o) => o.value === value)));
    setOpen(true);
  };
  const choose = (i: number) => {
    const o = options[i];
    if (!o || o.disabled) return;
    onChange(o.value);
    setOpen(false);
  };
  const move = (delta: number) => {
    let i = active;
    for (let n = 0; n < options.length; n++) {
      i = (i + delta + options.length) % options.length;
      if (!options[i].disabled) break;
    }
    setActive(i);
  };

  const onKey = (e: KeyboardEvent) => {
    if (!open) {
      if (['ArrowDown', 'ArrowUp', 'Enter', ' '].includes(e.key)) {
        e.preventDefault();
        openList();
      }
      return;
    }
    if (e.key === 'ArrowDown') { e.preventDefault(); move(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
    else if (e.key === 'Home') { e.preventDefault(); setActive(0); }
    else if (e.key === 'End') { e.preventDefault(); setActive(options.length - 1); }
    else if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); choose(active); }
    else if (e.key === 'Escape' || e.key === 'Tab') setOpen(false);
    else if (e.key.length === 1) {
      // busca pela primeira letra
      const k = e.key.toLowerCase();
      const i = options.findIndex((o, idx) => idx > active && (o.text ?? String(o.label)).toLowerCase().startsWith(k));
      const j = i >= 0 ? i : options.findIndex((o) => (o.text ?? String(o.label)).toLowerCase().startsWith(k));
      if (j >= 0) setActive(j);
    }
  };

  return (
    <div ref={ref} className={clsx('relative', className)}>
      <button
        type="button"
        role="combobox"
        aria-label={ariaLabel}
        aria-expanded={open}
        aria-controls={`${id}-list`}
        aria-activedescendant={open ? `${id}-${active}` : undefined}
        onClick={() => (open ? setOpen(false) : openList())}
        onKeyDown={onKey}
        className={clsx(
          'inline-flex w-full items-center gap-2 rounded-xl border bg-surface text-left text-ink transition-colors',
          size === 'sm' ? 'h-9 px-3 text-[13px]' : 'h-10 px-3.5 text-[14px]',
          open ? 'border-[var(--accent-text)]' : 'border-line hover:border-line-strong',
          buttonClassName,
        )}
      >
        {prefix && <span className="shrink-0 text-muted">{prefix}</span>}
        {selected?.icon}
        <span className={clsx('min-w-0 flex-1 truncate font-medium', !selected && 'text-muted')}>{selected?.label ?? placeholder}</span>
        <ChevronDown size={15} className={clsx('shrink-0 text-muted transition-transform', open && 'rotate-180')} />
      </button>
      {open && (
        <ul
          ref={listRef}
          id={`${id}-list`}
          role="listbox"
          aria-label={ariaLabel}
          className={clsx(
            'pop-in absolute z-40 mt-1.5 max-h-72 min-w-full overflow-auto rounded-2xl border border-line-strong bg-surface-2 p-1.5 shadow-2xl shadow-black/40',
            align === 'right' ? 'right-0' : 'left-0',
          )}
        >
          {options.map((o, i) => {
            const isSel = o.value === value;
            return (
              <li
                key={String(o.value)}
                id={`${id}-${i}`}
                data-index={i}
                role="option"
                aria-selected={isSel}
                aria-disabled={o.disabled}
                onMouseEnter={() => setActive(i)}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => choose(i)}
                className={clsx(
                  'flex cursor-pointer items-center gap-2.5 whitespace-nowrap rounded-xl px-3 py-2 text-[13px]',
                  i === active && 'bg-surface-3',
                  isSel ? 'font-semibold text-ink' : 'text-ink-2',
                  o.disabled && 'cursor-not-allowed opacity-40',
                )}
              >
                {o.icon}
                <span className="flex-1">{o.label}</span>
                {o.hint && <span className="text-[12px] text-muted">{o.hint}</span>}
                <Check size={15} strokeWidth={3} className={clsx('text-accent-text', !isSel && 'invisible')} />
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/** Grupo de botões em pílula (uma opção ativa) */
export function Segmented<V extends string>({ value, options, onChange, ariaLabel, size = 'md' }: {
  value: V;
  options: Array<{ value: V; label: ReactNode }>;
  onChange: (v: V) => void;
  ariaLabel: string;
  size?: 'sm' | 'md';
}) {
  return (
    <div role="radiogroup" aria-label={ariaLabel} className={clsx('inline-flex rounded-full border border-line bg-surface p-1', size === 'sm' ? 'h-9' : 'h-10')}>
      {options.map((o) => {
        const on = o.value === value;
        return (
          <button
            key={o.value}
            type="button"
            role="radio"
            aria-checked={on}
            onClick={() => onChange(o.value)}
            className={clsx(
              'whitespace-nowrap rounded-full px-3.5 text-[13px] font-semibold transition-colors',
              on ? 'bg-ink text-page' : 'text-muted hover:text-ink',
            )}
          >
            {o.label}
          </button>
        );
      })}
    </div>
  );
}

/** Interruptor liga/desliga */
export function Switch({ checked, onChange, label }: { checked: boolean; onChange: (v: boolean) => void; label: ReactNode }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="inline-flex items-center gap-2.5 text-[13px] text-ink-2 hover:text-ink">
      <span className={clsx('relative h-5 w-9 rounded-full transition-colors', checked ? 'bg-accent' : 'bg-surface-3')}>
        <span className={clsx('absolute top-0.5 size-4 rounded-full shadow transition-all', checked ? 'left-[18px] bg-on-accent' : 'left-0.5 bg-muted')} />
      </span>
      {label}
    </button>
  );
}

/** Ícone dentro de um círculo colorido (como nas listas por categoria) */
export function IconBubble({ children, color, size = 'md' }: { children: ReactNode; color: string; size?: 'sm' | 'md' | 'lg' }) {
  return (
    <span
      aria-hidden
      className={clsx('grid shrink-0 place-items-center rounded-full', size === 'sm' ? 'size-8' : size === 'lg' ? 'size-11' : 'size-9')}
      style={{ background: `color-mix(in oklab, ${color} 16%, transparent)`, color }}
    >
      {children}
    </span>
  );
}
