/**
 * Asaas – cobranças recorrentes (API v3).
 * Docs: https://docs.asaas.com/reference
 *  - GET /finance/balance            saldo disponível
 *  - GET /payments                   cobranças (filtros por vencimento e por pagamento)
 *  - GET /subscriptions              assinaturas ativas (base da projeção)
 *  - GET /financialTransactions      extrato (saídas: transferências, taxas, contas pagas)
 *  - GET /customers                  nomes dos clientes
 */
import { config } from '../config.js';
import type { Connector, PaymentMethod, SourceData, Subscription, Transaction, TxStatus, Window } from '../types.js';
import { fetchJson, HttpError, today } from '../util.js';
import { demoAsaas } from './demo.js';

interface AsaasList<T> {
  hasMore: boolean;
  totalCount: number;
  data: T[];
}

interface AsaasPayment {
  id: string;
  customer: string;
  subscription?: string | null;
  installment?: string | null;
  value: number;
  netValue?: number;
  status: string;
  billingType: string;
  dueDate: string;
  paymentDate?: string | null;
  clientPaymentDate?: string | null;
  confirmedDate?: string | null;
  creditDate?: string | null;
  estimatedCreditDate?: string | null;
  description?: string | null;
  invoiceUrl?: string;
  installmentNumber?: number | null;
  deleted?: boolean;
}

interface AsaasSubscription {
  id: string;
  customer: string;
  value: number;
  nextDueDate: string;
  cycle: Subscription['cycle'];
  description?: string | null;
  status: string;
  endDate?: string | null;
  deleted?: boolean;
}

interface AsaasFinancialTx {
  id: string;
  value: number;
  date: string;
  type: string;
  description?: string;
  paymentId?: string | null;
}

const MAX_PAGES = 60; // 6.000 registros por consulta

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(config.asaas.baseUrl + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return fetchJson<T>(url.toString(), {
    headers: {
      access_token: config.asaas.apiKey,
      'User-Agent': 'scale-dashboard-financeiro',
      accept: 'application/json',
    },
  });
}

async function getAll<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const out: T[] = [];
  for (let page = 0; page < MAX_PAGES; page++) {
    const res = await get<AsaasList<T>>(path, { ...params, limit: '100', offset: String(page * 100) });
    out.push(...res.data);
    if (!res.hasMore) break;
  }
  return out;
}

const METHOD: Record<string, PaymentMethod> = {
  PIX: 'pix',
  BOLETO: 'boleto',
  CREDIT_CARD: 'credit_card',
  DEBIT_CARD: 'debit_card',
};

function mapStatus(p: AsaasPayment): TxStatus | null {
  switch (p.status) {
    case 'RECEIVED':
    case 'RECEIVED_IN_CASH':
    case 'DUNNING_RECEIVED':
      return 'received';
    case 'CONFIRMED':
      return 'confirmed';
    case 'OVERDUE':
    case 'DUNNING_REQUESTED':
      return 'overdue';
    case 'PENDING':
    case 'AWAITING_RISK_ANALYSIS':
      return p.dueDate < today() ? 'overdue' : 'pending';
    case 'REFUNDED':
    case 'REFUND_REQUESTED':
    case 'REFUND_IN_PROGRESS':
    case 'CHARGEBACK_REQUESTED':
    case 'CHARGEBACK_DISPUTE':
    case 'AWAITING_CHARGEBACK_REVERSAL':
      return 'refunded';
    default:
      return null;
  }
}

/** Tipos do extrato que representam dinheiro saindo da conta */
const OUT_METHOD: Record<string, PaymentMethod> = {
  TRANSFER: 'transfer',
  PIX_TRANSACTION_DEBIT: 'pix',
  BILL_PAYMENT: 'boleto',
  PAYMENT_FEE: 'fee',
  PAYMENT_MESSAGING_NOTIFICATION_FEE: 'fee',
  PAYMENT_SMS_NOTIFICATION_FEE: 'fee',
  PAYMENT_INSTANT_TEXT_MESSAGE_FEE: 'fee',
  PIX_TRANSACTION_DEBIT_FEE: 'fee',
  TRANSFER_FEE: 'fee',
  BILL_PAYMENT_FEE: 'fee',
  ASAAS_CARD_TRANSACTION: 'debit_card',
};

let customerNames: { at: number; map: Map<string, string> } | null = null;

async function loadCustomerNames(): Promise<Map<string, string>> {
  if (customerNames && Date.now() - customerNames.at < 30 * 60_000) return customerNames.map;
  const list = await getAll<{ id: string; name: string }>('/customers');
  customerNames = { at: Date.now(), map: new Map(list.map((c) => [c.id, c.name])) };
  return customerNames.map;
}

export const asaas: Connector = {
  id: 'asaas',

  async load(window: Window): Promise<SourceData> {
    const base = {
      id: 'asaas' as const,
      name: 'Asaas',
      role: 'Pagamentos recorrentes',
      realtime: true,
      webhookUrl: `${config.publicUrl}/webhooks/asaas`,
    };

    if (!config.asaas.apiKey) {
      if (!config.demoMode) {
        return {
          status: { ...base, state: 'pending_access', message: 'Configure ASAAS_API_KEY no .env', balance: null, balanceUpdatedAt: null },
          transactions: [],
          subscriptions: [],
        };
      }
      const demo = demoAsaas(window);
      return {
        status: {
          ...base, state: 'demo', message: 'Sem ASAAS_API_KEY – exibindo dados de demonstração',
          balance: demo.balance, balanceUpdatedAt: new Date().toISOString(),
          nextSteps: ['Gerar chave em Asaas > Integrações > Chaves de API', 'Colar em ASAAS_API_KEY no arquivo .env e reiniciar'],
        },
        transactions: demo.transactions,
        subscriptions: demo.subscriptions,
      };
    }

    try {
      const [balance, byDue, byPayment, subs, extrato, names] = await Promise.all([
        get<{ balance: number }>('/finance/balance'),
        getAll<AsaasPayment>('/payments', { 'dueDate[ge]': window.from, 'dueDate[le]': window.to }),
        getAll<AsaasPayment>('/payments', { 'paymentDate[ge]': window.from, 'paymentDate[le]': window.to }),
        getAll<AsaasSubscription>('/subscriptions', { status: 'ACTIVE' }),
        getAll<AsaasFinancialTx>('/financialTransactions', { startDate: window.from, finishDate: window.to }),
        loadCustomerNames().catch(() => new Map<string, string>()),
      ]);

      const payments = new Map<string, AsaasPayment>();
      for (const p of [...byDue, ...byPayment]) if (!p.deleted) payments.set(p.id, p);

      const transactions: Transaction[] = [];
      for (const p of payments.values()) {
        const status = mapStatus(p);
        if (!status) continue;
        transactions.push({
          id: p.id,
          source: 'asaas',
          direction: 'in',
          status,
          method: METHOD[p.billingType] ?? 'other',
          amount: p.value,
          netAmount: p.netValue,
          dueDate: p.dueDate,
          paidDate: p.paymentDate ?? p.clientPaymentDate ?? p.confirmedDate ?? undefined,
          creditDate: p.creditDate ?? p.estimatedCreditDate ?? undefined,
          description: p.description || (p.subscription ? 'Mensalidade (assinatura)' : 'Cobrança avulsa'),
          customer: names.get(p.customer) ?? p.customer,
          subscriptionId: p.subscription ?? undefined,
          receiptUrl: p.invoiceUrl,
        });
      }

      for (const f of extrato) {
        if (f.value >= 0) continue;
        transactions.push({
          id: f.id,
          source: 'asaas',
          direction: 'out',
          status: 'received',
          method: OUT_METHOD[f.type] ?? (f.type.endsWith('_FEE') ? 'fee' : 'other'),
          amount: Math.abs(f.value),
          paidDate: f.date,
          description: f.description || f.type,
          // TRANSFER = saque para conta bancária da própria empresa: não é despesa
          internal: f.type === 'TRANSFER',
        });
      }

      const subscriptions: Subscription[] = subs
        .filter((s) => !s.deleted)
        .map((s) => ({
          id: s.id,
          source: 'asaas',
          value: s.value,
          nextDueDate: s.nextDueDate,
          cycle: s.cycle,
          description: s.description || 'Assinatura',
          customer: names.get(s.customer) ?? s.customer,
          endDate: s.endDate ?? undefined,
        }));

      return {
        status: { ...base, state: 'connected', message: `${payments.size} cobranças, ${subscriptions.length} assinaturas ativas`, balance: balance.balance, balanceUpdatedAt: new Date().toISOString() },
        transactions,
        subscriptions,
      };
    } catch (err) {
      const detail = err instanceof HttpError && err.status === 401 ? 'chave de API inválida ou do ambiente errado (ASAAS_ENV)' : (err as Error).message;
      return {
        status: { ...base, state: 'error', message: `Falha ao consultar o Asaas: ${detail}`, balance: null, balanceUpdatedAt: null },
        transactions: [],
        subscriptions: [],
      };
    }
  },
};
