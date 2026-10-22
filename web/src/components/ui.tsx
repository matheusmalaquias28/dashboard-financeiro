import clsx from 'clsx';
import { Table2, BarChart3 } from 'lucide-react';
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
        <header className="flex items-start justify-between gap-3 px-5 pt-4">
          <div className="min-w-0">
            {title && <h2 className="text-[15px] font-semibold text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[13px] text-muted">{subtitle}</p>}
          </div>
          {action && <div className="shrink-0">{action}</div>}
        </header>
      )}
      <div className={clsx('min-w-0 flex-1 px-5 pb-5 pt-3', bodyClassName)}>{children}</div>
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
        <button
          type="button"
          onClick={() => setAsTable((v) => !v)}
          className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-surface-2"
          aria-pressed={asTable}
        >
          {asTable ? <BarChart3 size={15} /> : <Table2 size={15} />}
          <span className="hidden sm:inline">{asTable ? 'Gráfico' : 'Tabela'}</span>
        </button>
      }
    >
      {asTable ? <div className="max-h-[320px] overflow-auto">{table}</div> : children}
    </Card>
  );
}

const TONE: Record<string, string> = {
  good: 'bg-[color-mix(in_oklab,var(--good)_14%,transparent)] text-good-ink',
  info: 'bg-accent-soft text-accent',
  neutral: 'bg-surface-2 text-ink-2',
  critical: 'bg-[color-mix(in_oklab,var(--critical)_14%,transparent)] text-critical-ink',
  muted: 'bg-surface-2 text-muted line-through',
};

export function StatusBadge({ status }: { status: TxStatus }) {
  const meta = STATUS_META[status];
  return (
    <span className={clsx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-[12px] font-medium', TONE[meta.tone])}>
      <span aria-hidden className="size-1.5 rounded-full bg-current" />
      {meta.label}
    </span>
  );
}

export function Pill({ children, className }: { children: ReactNode; className?: string }) {
  return <span className={clsx('inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-medium', className)}>{children}</span>;
}

export function Swatch({ color, shape = 'rect' }: { color: string; shape?: 'rect' | 'line' | 'dot' }) {
  if (shape === 'line') return <span aria-hidden className="inline-block h-0.5 w-3 rounded-full" style={{ background: color }} />;
  if (shape === 'dot') return <span aria-hidden className="inline-block size-2 rounded-full" style={{ background: color }} />;
  return <span aria-hidden className="inline-block size-2.5 rounded-[3px]" style={{ background: color }} />;
}

export function DataTable({ head, rows }: { head: string[]; rows: ReactNode[][] }) {
  return (
    <table className="w-full text-[13px]">
      <thead className="sticky top-0 bg-surface">
        <tr className="border-b border-line text-left text-muted">
          {head.map((h, i) => (
            <th key={h} className={clsx('py-2 font-medium', i > 0 && 'text-right')}>{h}</th>
          ))}
        </tr>
      </thead>
      <tbody className="tabular">
        {rows.map((r, i) => (
          <tr key={i} className="border-b border-line last:border-0">
            {r.map((c, j) => (
              <td key={j} className={clsx('py-1.5 text-ink-2', j > 0 && 'text-right')}>{c}</td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
