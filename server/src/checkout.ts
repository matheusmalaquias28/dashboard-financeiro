/**
 * Checkout InfinitePay dentro do painel: vendedores geram links de pagamento, escolhem se o cliente
 * paga a taxa ou se a empresa absorve, e acompanham quando cada cobrança é paga (via webhook).
 * Docs: https://www.infinitepay.io/checkout-documentacao
 *
 * Valores em CENTAVOS (como a API da InfinitePay). Taxas em % (ex.: 3.15).
 */
import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { requireAdmin } from './auth.js';
import { config } from './config.js';
import type { InfinitePayWebhook } from './connectors/infinitepay.js';
import { createStore, scopedStore, useSupabase, userClient, type Store } from './store.js';
import { fetchJson, HttpError } from './util.js';

export interface FeeConfig {
  /** Taxa do Pix, em % */
  pixRate: number;
  /** Taxa do cartão para 1x…12x, em % (12 posições) */
  cardRates: number[];
}

export interface Product {
  id: string;
  name: string;
  /** centavos */
  price: number;
  active: boolean;
}

export interface CheckoutConfig {
  id: 'config';
  fees: FeeConfig;
  /** false enquanto o administrador não revisar as taxas de exemplo */
  feesConfirmed: boolean;
  products: Product[];
  updatedAt?: string;
  updatedBy?: string;
}

export interface ChargeItem {
  productId?: string;
  description: string;
  quantity: number;
  /** centavos */
  unitPrice: number;
  /** preço de tabela do catálogo, para registrar desconto/acréscimo dado pelo vendedor */
  listPrice?: number;
}

export type FeeMode = 'absorb' | 'customer';

export interface Charge {
  /** também é o order_nsu enviado à InfinitePay */
  id: string;
  seller: string;
  /** id do usuário (Supabase Auth) que gerou – usado pelo RLS para o vendedor ver só as próprias */
  sellerId?: string;
  customer: { name: string; email?: string; phone?: string };
  items: ChargeItem[];
  note?: string;
  subtotal: number;
  feeMode: FeeMode;
  /** parcelamento usado como referência para calcular a taxa repassada / estimada */
  feeRefInstallments: number;
  /** taxa somada ao valor quando o cliente paga a taxa */
  surcharge: number;
  /** valor do link */
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

/**
 * Taxas de EXEMPLO – a InfinitePay não expõe a tabela por API e ela varia por conta/plano.
 * O painel avisa até o administrador revisar e salvar as taxas reais.
 */
const DEFAULT_FEES: FeeConfig = {
  pixRate: 0,
  cardRates: [3.15, 4.99, 5.79, 6.59, 7.39, 8.19, 8.99, 9.79, 10.59, 11.39, 12.19, 12.99],
};

const DEFAULT_CONFIG: CheckoutConfig = {
  id: 'config',
  fees: DEFAULT_FEES,
  feesConfirmed: false,
  products: [],
};

// acesso do servidor (webhook da InfinitePay); as telas usam scopedStore com o token do usuário (RLS)
const configStore = createStore<CheckoutConfig>('checkout-config');
const charges = createStore<Charge>('checkout-charges');
const userConfig = (req: Request) => scopedStore<CheckoutConfig>('checkout-config', req.accessToken);
const userCharges = (req: Request) => scopedStore<Charge>('checkout-charges', req.accessToken);

export async function getCheckoutConfig(store: Store<CheckoutConfig> = configStore): Promise<CheckoutConfig> {
  return (await store.get('config')) ?? DEFAULT_CONFIG;
}

// ---------------------------------------------------------------- cálculo de taxas

export function rateFor(fees: FeeConfig, method: 'pix' | 'credit_card', installments = 1): number {
  return method === 'pix' ? fees.pixRate : (fees.cardRates[Math.min(12, Math.max(1, installments)) - 1] ?? 0);
}

/** Quanto somar ao valor para que, descontada a taxa, a empresa receba o subtotal inteiro */
export function surchargeFor(subtotal: number, ratePct: number): number {
  if (ratePct <= 0) return 0;
  return Math.ceil(subtotal / (1 - ratePct / 100)) - subtotal;
}

export const feeOn = (amount: number, ratePct: number) => Math.round((amount * ratePct) / 100);

export function priceCharge(items: ChargeItem[], fees: FeeConfig, feeMode: FeeMode, refInstallments: number) {
  const subtotal = items.reduce((acc, i) => acc + i.unitPrice * i.quantity, 0);
  const refRate = rateFor(fees, 'credit_card', refInstallments);
  const surcharge = feeMode === 'customer' ? surchargeFor(subtotal, refRate) : 0;
  const total = subtotal + surcharge;
  const estimatedFee = feeOn(total, refRate);
  return { subtotal, surcharge, total, estimatedFee, estimatedNet: total - estimatedFee };
}

// ---------------------------------------------------------------- InfinitePay

export function infinitePayWebhookUrl(): string {
  const path = config.infinitepay.webhookSecret ? `/webhooks/infinitepay/${config.infinitepay.webhookSecret}` : '/webhooks/infinitepay';
  return config.publicUrl + path;
}

async function createInfinitePayLink(charge: Charge): Promise<string> {
  const items = charge.items.map((i) => ({ quantity: i.quantity, price: i.unitPrice, description: i.description.slice(0, 100) }));
  if (charge.surcharge > 0) items.push({ quantity: 1, price: charge.surcharge, description: 'Taxa de processamento do cartão' });

  const body = {
    handle: config.infinitepay.handle,
    order_nsu: charge.id,
    webhook_url: infinitePayWebhookUrl(),
    items,
    customer: {
      name: charge.customer.name,
      ...(charge.customer.email ? { email: charge.customer.email } : {}),
      ...(charge.customer.phone ? { phone_number: charge.customer.phone } : {}),
    },
  };
  const headers: Record<string, string> = { 'content-type': 'application/json' };
  if (config.infinitepay.apiToken) headers.authorization = `Bearer ${config.infinitepay.apiToken}`;

  const res = await fetchJson<{ url?: string; payment_url?: string; link?: string }>(`${config.infinitepay.apiUrl}/links`, {
    method: 'POST',
    headers,
    body: JSON.stringify(body),
    timeoutMs: 15_000,
  });
  const url = res.url ?? res.payment_url ?? res.link;
  if (!url) throw new Error('A InfinitePay não devolveu o link de pagamento');
  return url;
}

/**
 * Chamado pelo webhook da InfinitePay (já confirmado): marca a cobrança como paga e calcula a taxa real.
 * Devolve a cobrança para enriquecer o lançamento do painel financeiro (cliente, vendedor).
 */
export async function markChargePaid(p: InfinitePayWebhook): Promise<Charge | undefined> {
  if (!p.order_nsu) return undefined;
  const charge = await charges.get(p.order_nsu);
  if (!charge || charge.status === 'paid') return charge;
  const { fees } = await getCheckoutConfig();
  const method = p.capture_method === 'pix' ? 'pix' : 'credit_card';
  const installments = p.installments ?? 1;
  const fee = feeOn(p.amount, rateFor(fees, method, installments));
  const paid: Charge = {
    ...charge,
    status: 'paid',
    paidAt: new Date().toISOString(),
    paid: {
      amount: p.amount,
      paidAmount: p.paid_amount ?? p.amount,
      installments,
      method: p.capture_method ?? 'credit_card',
      fee,
      net: p.amount - fee,
      receiptUrl: p.receipt_url,
      transactionNsu: p.transaction_nsu,
    },
  };
  await charges.put(paid);
  return paid;
}

// ---------------------------------------------------------------- rotas

class ValidationError extends Error {}

const text = (v: unknown, max: number) => (typeof v === 'string' ? v.trim().slice(0, max) : '');
const intIn = (v: unknown, min: number, max: number) => {
  const n = Number(v);
  return Number.isInteger(n) && n >= min && n <= max ? n : null;
};

function normalizePhone(raw: string): string | undefined {
  const digits = raw.replace(/\D/g, '');
  if (!digits) return undefined;
  if (digits.length === 10 || digits.length === 11) return `+55${digits}`;
  if (digits.length >= 12 && digits.length <= 13) return `+${digits}`;
  throw new ValidationError('Telefone inválido: use DDD + número');
}

const isMine = (req: Request, c: Charge) => (c.sellerId ? c.sellerId === req.user?.id : c.seller === req.user?.name);

/** O RLS já filtra no banco; o filtro aqui cobre o modo sem Supabase (desenvolvimento) */
function visibleCharges(req: Request, list: Charge[]) {
  const mine = req.user?.role === 'admin' ? list : list.filter((c) => isMine(req, c));
  return mine.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

/** Vendedores cadastrados (members com papel 'seller'); o RLS só deixa o administrador listar todos */
async function listSellers(req: Request): Promise<string[]> {
  if (!useSupabase() || !req.accessToken) return [];
  const { data } = await userClient(req.accessToken).from('members').select('name').eq('role', 'seller').eq('active', true);
  return (data ?? []).map((m) => String(m.name));
}

export const checkout = Router();

checkout.get('/state', async (req, res) => {
  try {
    const [cfg, list, sellers] = await Promise.all([
      getCheckoutConfig(userConfig(req)),
      userCharges(req).all(),
      req.user?.role === 'admin' ? listSellers(req) : Promise.resolve(undefined),
    ]);
    res.json({
      user: req.user,
      config: cfg,
      charges: visibleCharges(req, list),
      sellers,
      handle: config.infinitepay.handle,
      mock: config.infinitepay.checkoutMock,
      webhookUrl: infinitePayWebhookUrl(),
    });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

checkout.post('/charges', async (req: Request, res: Response) => {
  try {
    const cfg = await getCheckoutConfig(userConfig(req));
    const b = req.body ?? {};

    const name = text(b.customer?.name, 100);
    if (!name) throw new ValidationError('Informe o nome do cliente');
    const email = text(b.customer?.email, 120);
    if (email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new ValidationError('E-mail do cliente inválido');
    const phone = normalizePhone(text(b.customer?.phone, 30));

    if (!Array.isArray(b.items) || b.items.length === 0 || b.items.length > 20) throw new ValidationError('Adicione de 1 a 20 itens');
    const items: ChargeItem[] = b.items.map((raw: Record<string, unknown>, idx: number) => {
      const quantity = intIn(raw.quantity, 1, 999);
      const unitPrice = intIn(raw.unitPrice, 100, 100_000_000);
      if (!quantity) throw new ValidationError(`Item ${idx + 1}: quantidade inválida`);
      if (!unitPrice) throw new ValidationError(`Item ${idx + 1}: valor mínimo é R$ 1,00`);
      const productId = text(raw.productId, 60) || undefined;
      const product = productId ? cfg.products.find((p) => p.id === productId && p.active) : undefined;
      if (productId && !product) throw new ValidationError(`Item ${idx + 1}: produto não está mais no catálogo`);
      const description = text(raw.description, 100) || product?.name || '';
      if (!description) throw new ValidationError(`Item ${idx + 1}: informe a descrição`);
      return { productId, description, quantity, unitPrice, listPrice: product?.price };
    });

    const feeMode: FeeMode = b.feeMode === 'customer' ? 'customer' : 'absorb';
    const feeRefInstallments = intIn(b.feeRefInstallments, 1, 12) ?? 1;
    const pricing = priceCharge(items, cfg.fees, feeMode, feeRefInstallments);

    const charge: Charge = {
      id: `sc-${Date.now().toString(36)}-${crypto.randomBytes(3).toString('hex')}`,
      seller: req.user!.name,
      sellerId: req.user!.id,
      customer: { name, email: email || undefined, phone },
      items,
      note: text(b.note, 300) || undefined,
      feeMode,
      feeRefInstallments,
      ...pricing,
      url: '',
      status: 'pending',
      createdAt: new Date().toISOString(),
      mock: config.infinitepay.checkoutMock || undefined,
    };

    charge.url = config.infinitepay.checkoutMock
      ? `https://checkout.infinitepay.io/${config.infinitepay.handle}?simulado=${charge.id}`
      : await createInfinitePayLink(charge);

    // gravada com o token do usuário: o RLS confere que a cobrança é dele
    await userCharges(req).put(charge);
    res.status(201).json(charge);
  } catch (err) {
    if (err instanceof ValidationError) res.status(400).json({ error: err.message });
    else if (err instanceof HttpError) res.status(502).json({ error: `InfinitePay recusou a cobrança (${err.status}): ${err.body ?? ''}`.slice(0, 400) });
    else res.status(500).json({ error: (err as Error).message });
  }
});

/** Só no modo de teste: simula o webhook de pagamento para conferir o fluxo inteiro */
checkout.post('/charges/:id/simulate', async (req, res) => {
  if (!config.infinitepay.checkoutMock) {
    res.status(404).json({ error: 'Simulação desativada' });
    return;
  }
  const charge = await userCharges(req).get(String(req.params.id));
  if (!charge || (req.user?.role !== 'admin' && !isMine(req, charge))) {
    res.status(404).json({ error: 'Cobrança não encontrada' });
    return;
  }
  const method = req.body?.method === 'pix' ? 'pix' : 'credit_card';
  const installments = method === 'pix' ? 1 : (intIn(req.body?.installments, 1, 12) ?? 1);
  // o mesmo caminho do webhook real
  const { processInfinitePayPayment } = await import('./routes/webhooks.js');
  await processInfinitePayPayment({
    amount: charge.total,
    paid_amount: charge.total,
    installments,
    capture_method: method,
    transaction_nsu: `sim-${charge.id}`,
    order_nsu: charge.id,
    items: charge.items.map((i) => ({ description: i.description, quantity: i.quantity, price: i.unitPrice })),
  });
  res.json(await charges.get(charge.id));
});

checkout.put('/config', requireAdmin, async (req, res) => {
  try {
    const b = req.body ?? {};
    const pct = (v: unknown) => {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n >= 50) throw new ValidationError('Taxas devem estar entre 0% e 50%');
      return Math.round(n * 100) / 100;
    };
    if (!Array.isArray(b.fees?.cardRates) || b.fees.cardRates.length !== 12) throw new ValidationError('Informe as taxas de 1x a 12x');
    const products: Product[] = (Array.isArray(b.products) ? b.products : []).map((p: Record<string, unknown>) => {
      const name = text(p.name, 100);
      const price = intIn(p.price, 100, 100_000_000);
      if (!name || !price) throw new ValidationError('Cada produto precisa de nome e preço (mínimo R$ 1,00)');
      return { id: text(p.id, 60) || `prod-${crypto.randomBytes(4).toString('hex')}`, name, price, active: p.active !== false };
    });
    const cfg: CheckoutConfig = {
      id: 'config',
      fees: { pixRate: pct(b.fees.pixRate), cardRates: b.fees.cardRates.map(pct) },
      feesConfirmed: true,
      products,
      updatedAt: new Date().toISOString(),
      updatedBy: req.user?.name,
    };
    await userConfig(req).put(cfg);
    res.json(cfg);
  } catch (err) {
    res.status(err instanceof ValidationError ? 400 : 500).json({ error: (err as Error).message });
  }
});
