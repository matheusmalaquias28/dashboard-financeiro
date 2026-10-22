// Mesmo cálculo de server/src/checkout.ts (o servidor recalcula e é quem vale)
import type { ChargeItem, FeeConfig, FeeMode } from './types';

export const rateFor = (fees: FeeConfig, method: 'pix' | 'credit_card', installments = 1) =>
  method === 'pix' ? fees.pixRate : (fees.cardRates[Math.min(12, Math.max(1, installments)) - 1] ?? 0);

export const surchargeFor = (subtotal: number, ratePct: number) => (ratePct <= 0 ? 0 : Math.ceil(subtotal / (1 - ratePct / 100)) - subtotal);

export const feeOn = (amount: number, ratePct: number) => Math.round((amount * ratePct) / 100);

export function priceCharge(items: Pick<ChargeItem, 'unitPrice' | 'quantity'>[], fees: FeeConfig, feeMode: FeeMode, refInstallments: number) {
  const subtotal = items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
  const refRate = rateFor(fees, 'credit_card', refInstallments);
  const surcharge = feeMode === 'customer' ? surchargeFor(subtotal, refRate) : 0;
  const total = subtotal + surcharge;
  const estimatedFee = feeOn(total, refRate);
  return { subtotal, surcharge, total, estimatedFee, estimatedNet: total - estimatedFee, refRate };
}

/** Linha do simulador: o que acontece se o cliente pagar desta forma */
export interface SimRow {
  key: string;
  label: string;
  installments: number;
  rate: number;
  fee: number;
  net: number;
  perInstallment: number;
}

export function simulate(total: number, fees: FeeConfig): SimRow[] {
  const rows: SimRow[] = [{ key: 'pix', label: 'Pix', installments: 1, rate: fees.pixRate, fee: feeOn(total, fees.pixRate), net: 0, perInstallment: total }];
  for (let n = 1; n <= 12; n++) {
    const rate = rateFor(fees, 'credit_card', n);
    rows.push({ key: `c${n}`, label: n === 1 ? 'Crédito à vista' : `Crédito ${n}x`, installments: n, rate, fee: feeOn(total, rate), net: 0, perInstallment: Math.round(total / n) });
  }
  return rows.map((r) => ({ ...r, net: total - r.fee }));
}

const brl = new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' });
export const cents = (v: number) => brl.format(v / 100);
export const pct = (v: number) => `${v.toLocaleString('pt-BR', { maximumFractionDigits: 2 })}%`;
