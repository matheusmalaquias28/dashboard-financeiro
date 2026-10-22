/**
 * InfinitePay – vendas no cartão de crédito / Pix pela InfiniteTag ($scalecompany_).
 * Docs: https://www.infinitepay.io/checkout-documentacao
 *
 * A InfinitePay não oferece API pública de extrato nem de saldo. O "tempo real" funciona assim:
 *   1. Os links de pagamento são criados com webhook_url = <PUBLIC_URL>/webhooks/infinitepay
 *   2. Na aprovação, a InfinitePay faz POST nesse endpoint
 *   3. Confirmamos o pagamento em /payment_check (o webhook não tem assinatura)
 *   4. Gravamos em server/data/infinitepay.json e enviamos ao navegador via SSE
 * Vendas na maquininha (POS) não passam por esse fluxo: exigem API de parceiro da CloudWalk.
 */
import { config } from '../config.js';
import { broadcast } from '../events.js';
import { createStore } from '../store.js';
import type { Connector, SourceData, Transaction, Window } from '../types.js';
import { fetchJson, round2, today } from '../util.js';
import { demoInfinitePay, demoLiveSale } from './demo.js';

export interface InfinitePayWebhook {
  invoice_slug?: string;
  slug?: string;
  amount: number; // centavos
  paid_amount?: number; // centavos (inclui juros do parcelamento)
  installments?: number;
  capture_method?: 'credit_card' | 'pix' | string;
  transaction_nsu: string;
  order_nsu?: string;
  receipt_url?: string;
  items?: Array<{ description?: string; quantity?: number; price?: number }>;
}

export const store = createStore<Transaction>('infinitepay');
const demoLive: Transaction[] = [];

async function usingDemo() {
  return config.demoMode && (await store.all()).length === 0;
}

/** Vendas que chegaram depois de `since` (ISO) – usado pelo painel no modo de consulta periódica */
export async function salesSince(since: string): Promise<Transaction[]> {
  const all = (await usingDemo()) ? demoLive : await store.all();
  return all.filter((t) => (t.createdAt ?? '') > since);
}

export async function verifyPayment(p: InfinitePayWebhook): Promise<boolean> {
  const slug = p.invoice_slug ?? p.slug;
  if (!slug || !p.order_nsu) return false;
  const res = await fetchJson<{ success?: boolean; paid?: boolean }>(`${config.infinitepay.apiUrl}/payment_check`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ handle: config.infinitepay.handle, order_nsu: p.order_nsu, transaction_nsu: p.transaction_nsu, slug }),
    timeoutMs: 8000,
  });
  return res.paid === true;
}

export async function recordWebhook(p: InfinitePayWebhook): Promise<{ isNew: boolean; transaction: Transaction }> {
  const paid = (p.paid_amount ?? p.amount) / 100;
  const transaction: Transaction = {
    id: `ip_${p.transaction_nsu}`,
    source: 'infinitepay',
    direction: 'in',
    status: 'received',
    method: p.capture_method === 'pix' ? 'pix' : p.capture_method === 'credit_card' ? 'credit_card' : 'other',
    amount: round2(p.amount / 100),
    netAmount: undefined,
    paidDate: today(),
    installments: p.installments ?? 1,
    description: p.items?.map((i) => i.description).filter(Boolean).join(', ') || 'Link de pagamento InfinitePay',
    customer: p.order_nsu ? `Pedido ${p.order_nsu}` : undefined,
    receiptUrl: p.receipt_url,
    createdAt: new Date().toISOString(),
  };
  if (paid > transaction.amount) transaction.description += ` (pago R$ ${paid.toFixed(2)} c/ juros)`;
  const isNew = await store.insert(transaction);
  if (isNew) {
    await store.bump();
    broadcast({ type: 'transaction', transaction });
  }
  return { isNew, transaction };
}

/** No modo demonstração, simula uma venda a cada 30–90s para o feed ao vivo */
export function startDemoTicker() {
  const tick = async () => {
    if (await usingDemo().catch(() => false)) {
      const sale = demoLiveSale();
      demoLive.push(sale);
      broadcast({ type: 'transaction', transaction: sale });
    }
    setTimeout(tick, 30_000 + Math.random() * 60_000);
  };
  setTimeout(tick, 15_000);
}

export const infinitepay: Connector = {
  id: 'infinitepay',

  async load(window: Window): Promise<SourceData> {
    const webhookPath = config.infinitepay.webhookSecret ? `/webhooks/infinitepay/${config.infinitepay.webhookSecret}` : '/webhooks/infinitepay';
    const base = {
      id: 'infinitepay' as const,
      name: 'InfinitePay',
      role: `Cartão de crédito · $${config.infinitepay.handle}`,
      realtime: true,
      balance: null,
      balanceUpdatedAt: null,
      webhookUrl: config.publicUrl + webhookPath,
    };
    const inWindow = (t: Transaction) => !!t.paidDate && t.paidDate >= window.from && t.paidDate <= window.to;

    let stored: Transaction[];
    try {
      stored = await store.all();
    } catch (err) {
      return {
        status: { ...base, state: 'error', message: `Falha ao ler as vendas salvas: ${(err as Error).message}` },
        transactions: [],
        subscriptions: [],
      };
    }

    if (config.demoMode && stored.length === 0) {
      return {
        status: {
          ...base, state: 'demo', message: 'Nenhuma venda recebida via webhook ainda – exibindo demonstração',
          nextSteps: [
            'Publicar o servidor em uma URL pública (HTTPS)',
            `Criar os links de pagamento com webhook_url = ${base.webhookUrl}`,
            'Vendas da maquininha exigem API de parceiro: solicitar à InfinitePay/CloudWalk',
          ],
        },
        transactions: [...demoInfinitePay(window), ...demoLive.filter(inWindow)],
        subscriptions: [],
      };
    }

    const transactions = stored.filter(inWindow);
    const last = stored.reduce<string | undefined>((acc, t) => (!acc || (t.createdAt ?? '') > acc ? t.createdAt : acc), undefined);
    return {
      status: {
        ...base, state: 'connected',
        message: last ? `Última venda recebida em ${new Date(last).toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' })}` : 'Aguardando vendas via webhook',
        nextSteps: ['Saldo não disponível: a InfinitePay não expõe API de saldo'],
      },
      transactions,
      subscriptions: [],
    };
  },
};
