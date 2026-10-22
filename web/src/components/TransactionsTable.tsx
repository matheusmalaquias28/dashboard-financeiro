import clsx from 'clsx';
import { ArrowDown, ArrowUp, ChevronLeft, ChevronRight, Download, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { fmtDate, METHOD_NAME, money, monthLabel, SOURCE_COLOR, SOURCE_NAME, STATUS_META } from '../lib/format';
import { ymOf } from '../lib/metrics';
import type { Transaction, TxStatus } from '../types';
import { Card, StatusBadge, Swatch } from './ui';

type Dir = 'all' | 'in' | 'out';
type SortKey = 'date' | 'amount';
const PAGE = 12;

const dateOf = (t: Transaction) => t.paidDate ?? t.dueDate ?? '';

export function TransactionsTable({ txs, month }: { txs: Transaction[]; month: string }) {
  const [q, setQ] = useState('');
  const [dir, setDir] = useState<Dir>('all');
  const [status, setStatus] = useState<TxStatus | 'all'>('all');
  const [sort, setSort] = useState<{ key: SortKey; desc: boolean }>({ key: 'date', desc: true });
  const [page, setPage] = useState(0);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    const list = txs.filter((t) => {
      const d = dateOf(t);
      if (!d || ymOf(d) !== month) return false;
      if (dir !== 'all' && t.direction !== dir) return false;
      if (status !== 'all' && t.status !== status) return false;
      if (term && !`${t.customer ?? ''} ${t.description} ${SOURCE_NAME[t.source]}`.toLowerCase().includes(term)) return false;
      return true;
    });
    list.sort((a, b) => {
      const c = sort.key === 'amount' ? a.amount - b.amount : dateOf(a).localeCompare(dateOf(b));
      return sort.desc ? -c : c;
    });
    return list;
  }, [txs, month, q, dir, status, sort]);

  useEffect(() => setPage(0), [month, q, dir, status, sort]);
  const pages = Math.max(1, Math.ceil(rows.length / PAGE));
  const view = rows.slice(page * PAGE, page * PAGE + PAGE);
  const totalIn = rows.filter((t) => t.direction === 'in').reduce((a, t) => a + t.amount, 0);
  const totalOut = rows.filter((t) => t.direction === 'out').reduce((a, t) => a + t.amount, 0);

  const exportCsv = () => {
    const head = ['data', 'vencimento', 'fonte', 'tipo', 'status', 'forma', 'cliente', 'descricao', 'valor', 'liquido'];
    const esc = (v: unknown) => `"${String(v ?? '').replace(/"/g, '""')}"`;
    const lines = rows.map((t) =>
      [t.paidDate, t.dueDate, SOURCE_NAME[t.source], t.direction === 'in' ? 'entrada' : 'saída', STATUS_META[t.status].label, METHOD_NAME[t.method], t.customer, t.description, t.amount.toFixed(2).replace('.', ','), t.netAmount?.toFixed(2).replace('.', ',')]
        .map(esc)
        .join(';'),
    );
    const blob = new Blob(['﻿' + [head.join(';'), ...lines].join('\n')], { type: 'text/csv;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = `movimentacoes-${month}.csv`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  const SortBtn = ({ k, children }: { k: SortKey; children: string }) => (
    <button type="button" onClick={() => setSort((s) => ({ key: k, desc: s.key === k ? !s.desc : true }))} className="inline-flex items-center gap-1 hover:text-ink">
      {children}
      {sort.key === k && (sort.desc ? <ArrowDown size={12} /> : <ArrowUp size={12} />)}
    </button>
  );

  return (
    <Card
      title="Movimentações"
      subtitle={`${monthLabel(month)} · ${rows.length} lançamentos · entradas ${money(totalIn)} · saídas ${money(totalOut)}`}
      action={
        <button type="button" onClick={exportCsv} className="inline-flex h-8 items-center gap-1.5 rounded-lg px-2.5 text-[13px] text-ink-2 hover:bg-surface-2">
          <Download size={15} /> <span className="hidden sm:inline">CSV</span>
        </button>
      }
    >
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[180px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente ou descrição"
            className="h-9 w-full rounded-lg border border-line bg-surface pl-8 pr-3 text-[13px] text-ink outline-none placeholder:text-muted focus:border-[var(--accent)]"
          />
        </label>
        <div className="flex h-9 rounded-lg border border-line p-0.5 text-[13px]">
          {(['all', 'in', 'out'] as const).map((d) => (
            <button key={d} type="button" onClick={() => setDir(d)} className={clsx('rounded-md px-3', dir === d ? 'bg-surface-2 font-medium text-ink' : 'text-ink-2')}>
              {{ all: 'Todas', in: 'Entradas', out: 'Saídas' }[d]}
            </button>
          ))}
        </div>
        <select
          value={status}
          onChange={(e) => setStatus(e.target.value as TxStatus | 'all')}
          className="h-9 rounded-lg border border-line bg-surface px-2 text-[13px] text-ink-2"
          aria-label="Status"
        >
          <option value="all">Todos os status</option>
          {(Object.keys(STATUS_META) as TxStatus[]).map((s) => <option key={s} value={s}>{STATUS_META[s].label}</option>)}
        </select>
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              <th className="py-2 pr-3 font-medium"><SortBtn k="date">Data</SortBtn></th>
              <th className="py-2 pr-3 font-medium">Cliente / descrição</th>
              <th className="py-2 pr-3 font-medium">Fonte</th>
              <th className="py-2 pr-3 font-medium">Forma</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 text-right font-medium"><SortBtn k="amount">Valor</SortBtn></th>
            </tr>
          </thead>
          <tbody>
            {view.map((t) => (
              <tr key={t.id} className="border-b border-line last:border-0 hover:bg-surface-2/60">
                <td className="tabular whitespace-nowrap py-2 pr-3 text-ink-2">{fmtDate(dateOf(t), 'dd/MM')}</td>
                <td className="max-w-[280px] py-2 pr-3">
                  <span className="block truncate text-ink">{t.customer ?? t.description}</span>
                  {t.customer && <span className="block truncate text-[12px] text-muted">{t.description}</span>}
                </td>
                <td className="whitespace-nowrap py-2 pr-3 text-ink-2"><span className="inline-flex items-center gap-1.5"><Swatch color={SOURCE_COLOR[t.source]} />{SOURCE_NAME[t.source]}</span></td>
                <td className="whitespace-nowrap py-2 pr-3 text-ink-2">{METHOD_NAME[t.method]}</td>
                <td className="py-2 pr-3"><StatusBadge status={t.status} /></td>
                <td className={clsx('tabular whitespace-nowrap py-2 text-right font-medium', t.direction === 'out' ? 'text-critical-ink' : 'text-ink')}>
                  {t.direction === 'out' ? '− ' : ''}
                  {money(t.amount)}
                </td>
              </tr>
            ))}
            {view.length === 0 && (
              <tr><td colSpan={6} className="py-8 text-center text-muted">Nenhuma movimentação com esses filtros.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {pages > 1 && (
        <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
          <span>Página {page + 1} de {pages}</span>
          <div className="flex gap-1">
            <button type="button" disabled={page === 0} onClick={() => setPage((p) => p - 1)} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-30" aria-label="Página anterior"><ChevronLeft size={15} /></button>
            <button type="button" disabled={page >= pages - 1} onClick={() => setPage((p) => p + 1)} className="grid size-8 place-items-center rounded-lg border border-line disabled:opacity-30" aria-label="Próxima página"><ChevronRight size={15} /></button>
          </div>
        </div>
      )}
    </Card>
  );
}
