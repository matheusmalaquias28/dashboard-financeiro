import type { DashboardData, Filters, PaymentMethod, SourceId, Subscription, Transaction } from '../types';

// ---------------------------------------------------------------- datas (strings YYYY-MM-DD)
export const ymOf = (iso: string) => iso.slice(0, 7);

export function shiftMonth(ym: string, delta: number): string {
  const [y, m] = ym.split('-').map(Number);
  const d = new Date(Date.UTC(y, m - 1 + delta, 1));
  return d.toISOString().slice(0, 7);
}

export function daysInMonth(ym: string): number {
  const [y, m] = ym.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0)).getUTCDate();
}

function addDays(iso: string, days: number) {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function addMonthsKeepDay(iso: string, months: number) {
  const [y, m, day] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(day, last), 12)).toISOString().slice(0, 10);
}

const CYCLE_STEP: Record<Subscription['cycle'], (iso: string) => string> = {
  WEEKLY: (d) => addDays(d, 7),
  BIWEEKLY: (d) => addDays(d, 14),
  MONTHLY: (d) => addMonthsKeepDay(d, 1),
  BIMONTHLY: (d) => addMonthsKeepDay(d, 2),
  QUARTERLY: (d) => addMonthsKeepDay(d, 3),
  SEMIANNUALLY: (d) => addMonthsKeepDay(d, 6),
  YEARLY: (d) => addMonthsKeepDay(d, 12),
};

const sum = (list: Transaction[]) => list.reduce((acc, t) => acc + t.amount, 0);
const isPaidIn = (t: Transaction) => t.direction === 'in' && (t.status === 'received' || t.status === 'confirmed');

// ---------------------------------------------------------------- filtro global
/**
 * Por padrão remove movimentações internas (transferência entre contas da empresa), que não são
 * receita nem despesa. O calendário de saídas pode incluí-las para mostrar os dias de saque.
 */
export function applyFilters(data: DashboardData, f: Filters, includeInternal = false): Transaction[] {
  const sources = new Set(f.sources);
  const methods = new Set(f.methods);
  return data.transactions.filter(
    (t) => (includeInternal || !t.internal) && sources.has(t.source) && (methods.size === 0 || methods.has(t.method)),
  );
}

export function internalOutflow(txs: Transaction[], ym: string): number {
  return sum(txs.filter((t) => t.internal && t.direction === 'out' && t.paidDate && ymOf(t.paidDate) === ym));
}

// ---------------------------------------------------------------- KPIs
export interface Kpis {
  received: number;
  receivedConfirmed: number;
  receivedCount: number;
  receivedCompare: number;
  compareLabel: string;
  receivable: number;
  receivablePending: number;
  receivableOverdue: number;
  receivableCount: number;
  overdueTotal: number;
  outflow: number;
  outflowDays: number;
  outflowCompare: number;
}

export function computeKpis(txs: Transaction[], ym: string, today: string): Kpis {
  const prev = shiftMonth(ym, -1);
  const isCurrent = ym === ymOf(today);
  // mês corrente: compara com o mês anterior até o mesmo dia (comparação justa)
  const cutoffDay = isCurrent ? today.slice(8, 10) : '31';
  const inPrevWindow = (d?: string) => !!d && ymOf(d) === prev && d.slice(8, 10) <= cutoffDay;

  const paidThis = txs.filter((t) => isPaidIn(t) && t.paidDate && ymOf(t.paidDate) === ym);
  const dueThis = txs.filter((t) => t.direction === 'in' && (t.status === 'pending' || t.status === 'overdue') && t.dueDate && ymOf(t.dueDate) === ym);
  const outThis = txs.filter((t) => t.direction === 'out' && t.paidDate && ymOf(t.paidDate) === ym);

  return {
    received: sum(paidThis),
    receivedConfirmed: sum(paidThis.filter((t) => t.status === 'confirmed')),
    receivedCount: paidThis.length,
    receivedCompare: sum(txs.filter((t) => isPaidIn(t) && inPrevWindow(t.paidDate))),
    compareLabel: isCurrent ? `vs. mesmo período de ${prev.slice(5)}/${prev.slice(0, 4)}` : 'vs. mês anterior',
    receivable: sum(dueThis),
    receivablePending: sum(dueThis.filter((t) => t.status === 'pending')),
    receivableOverdue: sum(dueThis.filter((t) => t.status === 'overdue')),
    receivableCount: dueThis.length,
    overdueTotal: sum(txs.filter((t) => t.direction === 'in' && t.status === 'overdue')),
    outflow: sum(outThis),
    outflowDays: new Set(outThis.map((t) => t.paidDate)).size,
    outflowCompare: sum(txs.filter((t) => t.direction === 'out' && inPrevWindow(t.paidDate))),
  };
}

// ---------------------------------------------------------------- projeção
export interface Projection {
  month: string;
  issued: number;
  issuedCount: number;
  recurring: number;
  recurringCount: number;
  cardToCredit: number;
  cardEstimate: number;
  total: number;
}

/**
 * Quanto deve entrar no mês seguinte ao atual:
 *  - cobranças já emitidas com vencimento no mês
 *  - assinaturas ativas cujo boleto/pix daquele mês ainda não foi gerado
 *  - vendas no cartão já confirmadas que serão creditadas no mês
 *  - estimativa InfinitePay: média dos 3 últimos meses fechados
 */
export function computeProjection(data: DashboardData, txs: Transaction[], f: Filters): Projection {
  const month = shiftMonth(ymOf(data.today), 1);
  const start = `${month}-01`;
  const end = `${month}-${String(daysInMonth(month)).padStart(2, '0')}`;
  const sources = new Set(f.sources);

  const issued = txs.filter((t) => t.direction === 'in' && (t.status === 'pending' || t.status === 'overdue') && t.dueDate && ymOf(t.dueDate) === month);
  const issuedKeys = new Set(issued.map((t) => `${t.subscriptionId}|${t.dueDate}`));

  let recurring = 0;
  let recurringCount = 0;
  for (const s of data.subscriptions) {
    if (!sources.has(s.source)) continue;
    let due = s.nextDueDate;
    for (let guard = 0; due <= end && guard < 60; guard++, due = CYCLE_STEP[s.cycle](due)) {
      if (due < start || (s.endDate && due > s.endDate)) continue;
      if (issuedKeys.has(`${s.id}|${due}`)) continue;
      recurring += s.value;
      recurringCount++;
    }
  }

  const cardToCredit = sum(txs.filter((t) => t.status === 'confirmed' && t.creditDate && ymOf(t.creditDate) === month));

  let cardEstimate = 0;
  if (sources.has('infinitepay')) {
    const current = ymOf(data.today);
    const lastMonths = [1, 2, 3].map((k) => shiftMonth(current, -k));
    const ip = txs.filter((t) => t.source === 'infinitepay' && isPaidIn(t) && t.paidDate && lastMonths.includes(ymOf(t.paidDate)));
    cardEstimate = sum(ip) / 3;
  }

  const issuedSum = sum(issued);
  return {
    month,
    issued: issuedSum,
    issuedCount: issued.length,
    recurring,
    recurringCount,
    cardToCredit,
    cardEstimate,
    total: issuedSum + recurring + cardToCredit + cardEstimate,
  };
}

// ---------------------------------------------------------------- séries
export interface CumulativePoint {
  day: number;
  atual: number | null;
  anterior: number | null;
  diario: number;
}

export function cumulativeSeries(txs: Transaction[], ym: string, today: string): CumulativePoint[] {
  const prev = shiftMonth(ym, -1);
  const n = daysInMonth(ym);
  const byDay = (target: string) => {
    const arr = new Array(32).fill(0);
    for (const t of txs) if (isPaidIn(t) && t.paidDate && ymOf(t.paidDate) === target) arr[Number(t.paidDate.slice(8, 10))] += t.amount;
    return arr;
  };
  const cur = byDay(ym);
  const old = byDay(prev);
  const prevDays = daysInMonth(prev);
  const lastDay = ym === ymOf(today) ? Number(today.slice(8, 10)) : ym > ymOf(today) ? 0 : n;

  const out: CumulativePoint[] = [];
  let a = 0;
  let b = 0;
  for (let d = 1; d <= n; d++) {
    a += cur[d];
    b += d <= prevDays ? old[d] : 0;
    out.push({ day: d, atual: d <= lastDay ? a : null, anterior: d <= prevDays ? b : null, diario: cur[d] });
  }
  return out;
}

export interface MonthlyPoint {
  ym: string;
  entradas: number;
  saidas: number;
  saldo: number;
}

export function monthlySeries(txs: Transaction[], endYm: string, months: number, firstYm: string): MonthlyPoint[] {
  const out: MonthlyPoint[] = [];
  for (let k = months - 1; k >= 0; k--) {
    const ym = shiftMonth(endYm, -k);
    if (ym < firstYm) continue;
    const entradas = sum(txs.filter((t) => isPaidIn(t) && t.paidDate && ymOf(t.paidDate) === ym));
    const saidas = sum(txs.filter((t) => t.direction === 'out' && t.paidDate && ymOf(t.paidDate) === ym));
    out.push({ ym, entradas, saidas, saldo: entradas - saidas });
  }
  return out;
}

export function breakdown<K extends string>(txs: Transaction[], ym: string, key: (t: Transaction) => K): Array<{ key: K; value: number; count: number }> {
  const map = new Map<K, { value: number; count: number }>();
  for (const t of txs) {
    if (!isPaidIn(t) || !t.paidDate || ymOf(t.paidDate) !== ym) continue;
    const k = key(t);
    const cur = map.get(k) ?? { value: 0, count: 0 };
    cur.value += t.amount;
    cur.count++;
    map.set(k, cur);
  }
  return [...map.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.value - a.value);
}

export interface DayFlow {
  date: string;
  entradas: number;
  saidas: number;
  items: Transaction[];
}

export function dailyFlow(txs: Transaction[], ym: string): DayFlow[] {
  const n = daysInMonth(ym);
  const days: DayFlow[] = Array.from({ length: n }, (_, i) => ({ date: `${ym}-${String(i + 1).padStart(2, '0')}`, entradas: 0, saidas: 0, items: [] }));
  for (const t of txs) {
    if (!t.paidDate || ymOf(t.paidDate) !== ym) continue;
    const day = days[Number(t.paidDate.slice(8, 10)) - 1];
    if (t.direction === 'out') {
      day.saidas += t.amount;
      day.items.push(t);
    } else if (isPaidIn(t)) day.entradas += t.amount;
  }
  return days;
}

export function receivables(txs: Transaction[], ym: string): Transaction[] {
  return txs
    .filter((t) => t.direction === 'in' && (t.status === 'pending' || t.status === 'overdue') && t.dueDate && ymOf(t.dueDate) === ym)
    .sort((a, b) => (a.status === b.status ? a.dueDate!.localeCompare(b.dueDate!) : a.status === 'overdue' ? -1 : 1));
}

export const ALL_SOURCES: SourceId[] = ['asaas', 'infinitepay', 'inter', 'sicoob', 'cresol'];
export const ALL_METHODS: PaymentMethod[] = ['pix', 'boleto', 'credit_card', 'debit_card', 'transfer', 'fee', 'other'];
