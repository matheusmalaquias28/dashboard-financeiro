// Espelho de server/src/checkout.ts – valores em centavos, taxas em %
import type { User } from '../types';

export interface FeeConfig {
  pixRate: number;
  cardRates: number[];
}

export interface Product {
  id: string;
  name: string;
  price: number;
  active: boolean;
}

export interface CheckoutConfig {
  id: 'config';
  fees: FeeConfig;
  feesConfirmed: boolean;
  products: Product[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface ChargeItem {
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  listPrice?: number;
}

export type FeeMode = 'absorb' | 'customer';

export interface Charge {
  id: string;
  seller: string;
  customer: { name: string; email?: string; phone?: string };
  items: ChargeItem[];
  note?: string;
  subtotal: number;
  feeMode: FeeMode;
  feeRefInstallments: number;
  surcharge: number;
  total: number;
  estimatedFee: number;
  estimatedNet: number;
  url: string;
  status: 'pending' | 'paid';
  createdAt: string;
  paidAt?: string;
  paid?: {
    amount: number;
    paidAmount: number;
    installments: number;
    method: string;
    fee: number;
    net: number;
    receiptUrl?: string;
    transactionNsu: string;
  };
  mock?: boolean;
}

export interface CheckoutState {
  user: User;
  config: CheckoutConfig;
  charges: Charge[];
  sellers?: string[];
  handle: string;
  mock: boolean;
  webhookUrl: string;
}
