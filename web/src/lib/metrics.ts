import type { DashboardData, Filters, PaymentMethod, SourceId, Subscription, Transaction } from '../types';
import { addDays as addDaysP, compareLabel, comparisonPeriod, daysBetween, inPeriod, type Period } from './period';

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

export function internalOutflow(txs: Transaction[], p: Period): number {
  return sum(txs.filter((t) => t.internal && t.direction === 'out' && inPeriod(t.paidDate, p)));
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

export function computeKpis(txs: Transaction[], p: Period, today: string, dataFrom: string): Kpis {
  // comparação justa: período anterior de mesmo tamanho, até o mesmo ponto se o atual não terminou.
  // Se o período anterior começa antes dos dados carregados, não há base: melhor não comparar.
  const cmp = comparisonPeriod(p, today);
  const hasBase = cmp.from >= dataFrom;

  const paidThis = txs.filter((t) => isPaidIn(t) && inPeriod(t.paidDate, p));
  const dueThis = txs.filter((t) => t.direction === 'in' && (t.status === 'pending' || t.status === 'overdue') && inPeriod(t.dueDate, p));
  const outThis = txs.filter((t) => t.direction === 'out' && inPeriod(t.paidDate, p));

  return {
    received: sum(paidThis),
    receivedConfirmed: sum(paidThis.filter((t) => t.status === 'confirmed')),
    receivedCount: paidThis.length,
    receivedCompare: hasBase ? sum(txs.filter((t) => isPaidIn(t) && inPeriod(t.paidDate, cmp))) : 0,
    compareLabel: hasBase ? compareLabel(cmp) : 'sem dados do período anterior para comparar',
    receivable: sum(dueThis),
    receivablePending: sum(dueThis.filter((t) => t.status === 'pending')),
    receivableOverdue: sum(dueThis.filter((t) => t.status === 'overdue')),
    receivableCount: dueThis.length,
    overdueTotal: sum(txs.filter((t) => t.direction === 'in' && t.status === 'overdue')),
    outflow: sum(outThis),
    outflowDays: new Set(outThis.map((t) => t.paidDate)).size,
    outflowCompare: hasBase ? sum(txs.filter((t) => t.direction === 'out' && inPeriod(t.paidDate, cmp))) : 0,
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
  /** posição do dia no período (1, 2, 3…) */
  day: number;
  date: string;
  /** data equivalente no período de comparação */
  prevDate: string;
  atual: number | null;
  anterior: number | null;
  diario: number;
}

/** Acumulado dia a dia no período, alinhado ao período anterior de mesmo tamanho */
export function cumulativeSeries(txs: Transaction[], p: Period, today: string, dataFrom: string): CumulativePoint[] {
  const len = daysBetween(p.from, p.to) + 1;
  const cmp = comparisonPeriod(p, today);
  const byDate = new Map<string, number>();
  for (const t of txs) if (isPaidIn(t) && t.paidDate) byDate.set(t.paidDate, (byDate.get(t.paidDate) ?? 0) + t.amount);

  // meses inteiros comparam com o mês anterior; os demais períodos com os dias imediatamente antes
  const prevStart = cmp.from;
  const out: CumulativePoint[] = [];
  let a = 0;
  let b = 0;
  for (let i = 0; i < len; i++) {
    const date = addDaysP(p.from, i);
    const prevDate = addDaysP(prevStart, i);
    const daily = byDate.get(date) ?? 0;
    a += daily;
    b += byDate.get(prevDate) ?? 0;
    out.push({ day: i + 1, date, prevDate, atual: date <= today ? a : null, anterior: prevDate < p.from && prevStart >= dataFrom ? b : null, diario: daily });
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

export function breakdown<K extends string>(txs: Transaction[], p: Period, key: (t: Transaction) => K): Array<{ key: K; value: number; count: number }> {
  const map = new Map<K, { value: number; count: number }>();
  for (const t of txs) {
    if (!isPaidIn(t) || !inPeriod(t.paidDate, p)) continue;
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

export function dailyFlow(txs: Transaction[], p: Period): DayFlow[] {
  const len = daysBetween(p.from, p.to) + 1;
  const days: DayFlow[] = Array.from({ length: len }, (_, i) => ({ date: addDaysP(p.from, i), entradas: 0, saidas: 0, items: [] }));
  const index = new Map(days.map((d, i) => [d.date, i]));
  for (const t of txs) {
    const i = t.paidDate ? index.get(t.paidDate) : undefined;
    if (i == null) continue;
    const day = days[i];
    if (t.direction === 'out') {
      day.saidas += t.amount;
      day.items.push(t);
    } else if (isPaidIn(t)) day.entradas += t.amount;
  }
  return days;
}

export function receivables(txs: Transaction[], p: Period): Transaction[] {
  return txs
    .filter((t) => t.direction === 'in' && (t.status === 'pending' || t.status === 'overdue') && inPeriod(t.dueDate, p))
    .sort((a, b) => (a.status === b.status ? a.dueDate!.localeCompare(b.dueDate!) : a.status === 'overdue' ? -1 : 1));
}

export const ALL_SOURCES: SourceId[] = ['asaas', 'infinitepay', 'inter', 'sicoob', 'cresol'];
export const ALL_METHODS: PaymentMethod[] = ['pix', 'boleto', 'credit_card', 'debit_card', 'transfer', 'fee', 'other'];

export interface WeekDay {
  label: string;
  date: string;
  value: number;
  future: boolean;
}

/** Recebimentos da semana atual (segunda a domingo), para o gráfico de barras do destaque */
export function weekSeries(txs: Transaction[], today: string): WeekDay[] {
  const d = new Date(`${today}T12:00:00Z`);
  const monday = addDays(today, -((d.getUTCDay() + 6) % 7));
  const labels = ['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'];
  return labels.map((label, i) => {
    const date = addDays(monday, i);
    const value = txs.filter((t) => isPaidIn(t) && t.paidDate === date).reduce((a, t) => a + t.amount, 0);
    return { label, date, value, future: date > today };
  });
}
