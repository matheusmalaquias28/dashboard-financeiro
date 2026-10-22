import clsx from 'clsx';
import { BarChart3, Table2 } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { STATUS_META } from '../lib/format';
import type { TxStatus } from '../types';

export function Card({ title, subtitle, action, children, className, bodyClassName }: {
  title?: ReactNode;
  subtitle?: ReactNode;
  action?: ReactNode;
  children: ReactNode;
  className?: string;
  bodyClassName?: string;
}) {
  return (
    <section className={clsx('card flex min-w-0 flex-col', className)}>
      {(title || action) && (
        <header className="flex items-start justify-between gap-3 px-6 pt-5">
          <div className="min-w-0">
            {title && <h2 className="text-[16px] font-bold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-1 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={clsx('min-w-0 flex-1 px-6 pb-6 pt-4', bodyClassName)}>{children}</div>
    </section>
  );
}

/** Card de gráfico com alternância para a visão em tabela (acessibilidade / conferência) */
export function ChartCard({ table, children, ...props }: Omit<Parameters<typeof Card>[0], 'action' | 'children'> & { table: ReactNode; children: ReactNode }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card
      {...props}
      action={
        <div className="inline-flex rounded-full border border-line p-0.5" role="radiogroup" aria-label="Visualização">
          {([false, true] as const).map((t) => (
            <button
              key={String(t)}
              type="button"
              role="radio"
              aria-checked={asTable === t}
              onClick={() => setAsTable(t)}
              className={clsx('grid size-8 place-items-center rounded-full transition-colors', asTable === t ? 'bg-surface-3 text-ink' : 'text-muted hover:text-ink')}
              title={t ? 'Tabela' : 'Gráfico'}
              aria-label={t ? 'Ver como tabela' : 'Ver como gráfico'}
            >
              {t ? <Table2 size={15} /> : <BarChart3 size={15} />}
            </button>
          ))}
        </div>
      }
    >
      {asTable ? <div className="max-h-[320px] overflow-auto">{table}</div> : children}
    </Card>
  );
}

const TONE: Record<string, string> = {
  good: 'bg-[color-mix(in_oklab,var(--good)_16%,transparent)] text-good-ink',
  info: 'bg-[color-mix(in_oklab,var(--series-1)_20%,transparent)] text-[var(--series-1)]',
  neutral: 'bg-surface-3 text-ink-2',
  critical: 'bg-[color-mix(in_oklab,var(--critical)_16%,transparent)] text-critical-ink',
  muted: 'bg-surface-3 text-muted line-through',
};

export function StatusBadge({ status }: { status: TxStatus }) {
  const meta = STATUS_META[status];
  return <Badge tone={meta.tone}>{meta.label}</Badge>;
}

export function Badge({ tone, children }: { tone: keyof typeof TONE; children: ReactNode }) {
  return (
    <span className={clsx('inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2.5 py-1 text-[12px] font-semibold', TONE[tone])}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {children}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-semibold', className)}>{children}</span>;
}

export function Swatch({ color, shape = 'rect' }: { color: string; shape?: 'rect' | 'line' | 'dot' }) {
  if (shape === 'line') return <span aria-hidden className="inline-block h-[3px] w-3.5 rounded-full" style={{ background: color }} />;
  if (shape === 'dot') return <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: color }} />;
  return <span aria-hidden className="inline-block size-2.5 rounded-full" style={{ background: color }} />;
}

export function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-[13px]">
      <thead className="sticky top-0 bg-surface">
        <tr className="border-b border-line text-left">
          {head.map((h, i) => (
            <th key={h} className={clsx('eyebrow py-2.5 !font-semibold', i > 0 && 'text-right')}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular">
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line last:border-0">
            {r.map((c, j) => (
              <td key={j} className={clsx('py-2 text-ink-2', j > 0 && 'text-right', j === 0 && 'font-medium text-ink')}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
