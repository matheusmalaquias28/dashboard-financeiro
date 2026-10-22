import { format, parseISO } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import type { PaymentMethod, SourceId, TxStatus } from '../types';

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
const brlCompact = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL', notation: 'compact', maximumFractionDigits: 1 });
const num = new Intl.NumberFormat('pt-BR', { notation: 'compact', maximumFractionDigits: 1 });
const pct = new Intl.NumberFormat('pt-BR', { style: 'percent', maximumFractionDigits: 1 });

export const money = (v: number) => brl.format(v);
export const moneyCompact = (v: number) => (Math.abs(v) < 10_000 ? brl.format(Math.round(v)).replace(/,00$/, '') : brlCompact.format(v));
export const axisMoney = (v: number) => (v === 0 ? '0' : num.format(v));
export const percent = (v: number) => pct.format(v);

export const fmtDate = (iso: string, pattern = 'dd/MM/yyyy') => format(parseISO(iso), pattern, { locale: ptBR });
export const monthLabel = (ym: string) => {
  const s = format(parseISO(`${ym}-01`), "MMMM 'de' yyyy", { locale: ptBR });
  return s.charAt(0).toUpperCase() + s.slice(1);
};
export const monthShort = (ym: string) => {
  const s = format(parseISO(`${ym}-01`), 'MMM/yy', { locale: ptBR });
  return s.charAt(0).toUpperCase() + s.slice(1);
};

export const SOURCE_COLOR: Record<SourceId, string> = {
  asaas: 'var(--series-1)',
  infinitepay: 'var(--series-2)',
  inter: 'var(--series-3)',
  sicoob: 'var(--series-4)',
  cresol: 'var(--series-5)',
};

export const SOURCE_NAME: Record<SourceId, string> = {
  asaas: 'Asaas',
  infinitepay: 'InfinitePay',
  inter: 'Inter',
  sicoob: 'Sicoob',
  cresol: 'Cresol',
};

export const METHOD_NAME: Record<PaymentMethod, string> = {
  pix: 'Pix',
  boleto: 'Boleto',
  credit_card: 'Cartão de crédito',
  debit_card: 'Cartão de débito',
  transfer: 'Transferência',
  fee: 'Taxas',
  other: 'Outros',
};

export const STATUS_META: Record<TxStatus, { label: string; tone: 'good' | 'info' | 'neutral' | 'critical' | 'muted' }> = {
  received: { label: 'Recebido', tone: 'good' },
  confirmed: { label: 'Confirmado', tone: 'info' },
  pending: { label: 'A vencer', tone: 'neutral' },
  overdue: { label: 'Vencido', tone: 'critical' },
  refunded: { label: 'Estornado', tone: 'muted' },
};
