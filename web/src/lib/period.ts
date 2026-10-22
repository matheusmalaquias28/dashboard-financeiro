/**
 * Período de análise do painel: um intervalo de datas (YYYY-MM-DD, inclusivo) com o atalho que o gerou.
 * Os atalhos são recalculados a partir de "hoje"; o personalizado guarda as datas escolhidas.
 */
import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';

export type PresetId =
  | 'today'
  | 'yesterday'
  | 'this_week'
  | 'last_week'
  | 'last_7'
  | 'last_30'
  | 'last_90'
  | 'this_month'
  | 'last_month'
  | 'next_month'
  | 'this_year'
  | 'month'
  | 'custom';

export interface Period {
  preset: PresetId;
  from: string;
  to: string;
}

// ---------------------------------------------------------------- datas
export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, day] = iso.split('-').map(Number);
  const last = new Date(Date.UTC(y, m - 1 + months + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m - 1 + months, Math.min(day, last), 12)).toISOString().slice(0, 10);
}

export const startOfMonth = (iso: string) => `${iso.slice(0, 7)}-01`;
export function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
}
/** Semana começa na segunda */
export function startOfWeek(iso: string): string {
  const dow = new Date(`${iso}T12:00:00Z`).getUTCDay();
  return addDays(iso, -((dow + 6) % 7));
}
export const daysBetween = (from: string, to: string) => Math.round((Date.parse(`${to}T12:00:00Z`) - Date.parse(`${from}T12:00:00Z`)) / 86_400_000);
export const minDate = (a: string, b: string) => (a < b ? a : b);
export const maxDate = (a: string, b: string) => (a > b ? a : b);
export const inPeriod = (d: string | undefined, p: { from: string; to: string }) => !!d && d >= p.from && d <= p.to;

// ---------------------------------------------------------------- atalhos
export const PRESETS: Array<{ id: Exclude<PresetId, 'custom' | 'month'>; label: string }> = [
  { id: 'today', label: 'Hoje' },
  { id: 'yesterday', label: 'Ontem' },
  { id: 'this_week', label: 'Esta semana' },
  { id: 'last_week', label: 'Semana passada' },
  { id: 'last_7', label: 'Últimos 7 dias' },
  { id: 'last_30', label: 'Últimos 30 dias' },
  { id: 'last_90', label: 'Últimos 90 dias' },
  { id: 'this_month', label: 'Este mês' },
  { id: 'last_month', label: 'Mês passado' },
  { id: 'next_month', label: 'Próximo mês' },
  { id: 'this_year', label: 'Este ano' },
];

export function presetPeriod(id: Exclude<PresetId, 'custom' | 'month'>, today: string): Period {
  const r = (from: string, to: string): Period => ({ preset: id, from, to });
  switch (id) {
    case 'today': return r(today, today);
    case 'yesterday': return r(addDays(today, -1), addDays(today, -1));
    case 'this_week': return r(startOfWeek(today), addDays(startOfWeek(today), 6));
    case 'last_week': return r(addDays(startOfWeek(today), -7), addDays(startOfWeek(today), -1));
    case 'last_7': return r(addDays(today, -6), today);
    case 'last_30': return r(addDays(today, -29), today);
    case 'last_90': return r(addDays(today, -89), today);
    case 'this_month': return r(startOfMonth(today), endOfMonth(today));
    case 'last_month': { const m = addMonths(startOfMonth(today), -1); return r(m, endOfMonth(m)); }
    case 'next_month': { const m = addMonths(startOfMonth(today), 1); return r(m, endOfMonth(m)); }
    case 'this_year': return r(`${today.slice(0, 4)}-01-01`, `${today.slice(0, 4)}-12-31`);
  }
}

export const monthPeriod = (ym: string): Period => ({ preset: 'month', from: `${ym}-01`, to: endOfMonth(`${ym}-01`) });

/** O período cobre exatamente meses inteiros? (para navegar e comparar mês a mês) */
export function wholeMonths(p: Period): number {
  if (p.from !== startOfMonth(p.from) || p.to !== endOfMonth(p.to)) return 0;
  return (Number(p.to.slice(0, 4)) - Number(p.from.slice(0, 4))) * 12 + Number(p.to.slice(5, 7)) - Number(p.from.slice(5, 7)) + 1;
}

/** Avança/volta o período pelo próprio tamanho (dia, semana, mês, ano…) */
export function shiftPeriod(p: Period, dir: 1 | -1): Period {
  const months = wholeMonths(p);
  if (months) {
    const from = addMonths(p.from, dir * months);
    return { preset: months === 1 ? 'month' : 'custom', from, to: endOfMonth(addMonths(from, months - 1)) };
  }
  const len = daysBetween(p.from, p.to) + 1;
  return { preset: 'custom', from: addDays(p.from, dir * len), to: addDays(p.to, dir * len) };
}

/**
 * Período de comparação: o anterior de mesmo tamanho. Se o período ainda não terminou,
 * compara só até o mesmo ponto (ex.: 1–22/out contra 1–22/set) para ser justo.
 */
export function comparisonPeriod(p: Period, today: string): { from: string; to: string } {
  const prev = shiftPeriod(p, -1);
  const effectiveTo = minDate(p.to, today);
  if (effectiveTo < p.from) return { from: prev.from, to: prev.from };
  const elapsed = daysBetween(p.from, effectiveTo);
  return { from: prev.from, to: minDate(addDays(prev.from, elapsed), prev.to) };
}

// ---------------------------------------------------------------- textos
const fmt = (iso: string, pattern: string) => format(parseISO(iso), pattern, { locale: ptBR });
const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);

/** "Hoje", "Outubro de 2026", "20 – 26 out 2026", "1 set – 15 out 2026" */
export function periodLabel(p: Period): string {
  const preset = PRESETS.find((x) => x.id === p.preset);
  if (preset && (p.preset === 'today' || p.preset === 'yesterday')) return `${preset.label} · ${fmt(p.from, "d 'de' MMM")}`;
  if (wholeMonths(p) === 1) return cap(fmt(p.from, "MMMM 'de' yyyy"));
  if (p.from === `${p.from.slice(0, 4)}-01-01` && p.to === `${p.from.slice(0, 4)}-12-31`) return `Ano de ${p.from.slice(0, 4)}`;
  if (p.from === p.to) return cap(fmt(p.from, "EEEE, d 'de' MMM yyyy"));
  const sameYear = p.from.slice(0, 4) === p.to.slice(0, 4);
  const sameMonth = sameYear && p.from.slice(5, 7) === p.to.slice(5, 7);
  const a = sameMonth ? fmt(p.from, 'd') : fmt(p.from, sameYear ? 'd MMM' : 'd MMM yyyy');
  const label = `${a} – ${fmt(p.to, 'd MMM yyyy')}`;
  return preset && p.preset !== 'this_month' ? `${preset.label} · ${label}` : label;
}

export function compareLabel(c: { from: string; to: string }): string {
  if (c.from === c.to) return `vs. ${fmt(c.from, "d 'de' MMM")}`;
  const sameMonth = c.from.slice(0, 7) === c.to.slice(0, 7);
  return `vs. ${sameMonth ? fmt(c.from, 'd') : fmt(c.from, 'd MMM')} – ${fmt(c.to, 'd MMM')}`;
}

export const shortDate = (iso: string) => fmt(iso, 'dd/MM');
