/**
 * Asaas – cobranças recorrentes (API v3).
 * Docs: https://docs.asaas.com/reference
 *  - GET /finance/balance            saldo disponível
 *  - GET /payments                   cobranças (filtros por vencimento e por pagamento)
 *  - GET /subscriptions              assinaturas ativas (base da projeção)
 *  - GET /financialTransactions      extrato (saídas: transferências, taxas, contas pagas)
 *  - GET /customers                  nomes dos clientes
 *
 * Cota do Asaas: 25 mil requisições a cada 12h por conta (e no máximo 50 GETs simultâneos).
 * Por isso os dados vão para o cache por mês: meses fechados ficam 12h, os recentes 10 min
 * (ou até um webhook do Asaas avisar de mudança). Uma atualização normal custa ~20 requisições.
 */
import { config } from '../config.js';
import { peek, remember } from '../store.js';
import type { Connector, PaymentMethod, SourceData, Subscription, Transaction, TxStatus, Window } from '../types.js';
import { addMonths, endOfMonth, HttpError, startOfMonth, today } from '../util.js';
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
const MAX_CONCURRENT = 10; // abaixo do limite de 50 GETs simultâneos do Asaas (cada página de /payments leva ~5s)
const RECENT_TTL = 10 * 60;
const CLOSED_TTL = 12 * 3600;

let running = 0;
const queue: Array<() => void> = [];
async function limited<T>(fn: () => Promise<T>): Promise<T> {
  if (running >= MAX_CONCURRENT) await new Promise<void>((r) => queue.push(r));
  running++;
  try {
    return await fn();
  } finally {
    running--;
    queue.shift()?.();
  }
}

/**
 * Além da cota de 12h, cada endpoint tem limite por minuto (ex.: /payments 140, /financialTransactions 20),
 * informado nos cabeçalhos RateLimit-Remaining / RateLimit-Reset. Acompanhamos esses números e esperamos
 * a janela virar em vez de levar 429 (que bloqueia o IP até o reset).
 */
const buckets = new Map<string, { remaining: number; resetAt: number }>();
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function get<T>(path: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(config.asaas.baseUrl + path);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return limited(async () => {
    for (let attempt = 0; attempt < 4; attempt++) {
      const bucket = buckets.get(path);
      if (bucket && bucket.remaining <= 0 && Date.now() < bucket.resetAt) await sleep(bucket.resetAt - Date.now() + 300);
      if (bucket) bucket.remaining--;

      const res = await fetch(url, {
        headers: { access_token: config.asaas.apiKey, 'User-Agent': 'scale-dashboard-financeiro', accept: 'application/json' },
        signal: AbortSignal.timeout(30_000),
      });
      const remaining = Number(res.headers.get('ratelimit-remaining'));
      const reset = Number(res.headers.get('ratelimit-reset'));
      if (res.headers.has('ratelimit-remaining') && Number.isFinite(remaining) && Number.isFinite(reset)) {
        buckets.set(path, { remaining, resetAt: Date.now() + reset * 1000 });
      }
      if (res.status === 429) {
        await sleep((Number.isFinite(reset) && reset > 0 ? reset : 15) * 1000 + 500);
        continue;
      }
      const text = await res.text();
      if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} em ${path}`, text.slice(0, 500));
      return JSON.parse(text) as T;
    }
    throw new HttpError(429, `HTTP 429 em ${path}`);
  });
}

/** Busca a 1ª página, descobre o total e pede as demais em paralelo (respeitando o limite) */
async function getAll<T>(path: string, params: Record<string, string> = {}): Promise<T[]> {
  const page = (offset: number) => get<AsaasList<T>>(path, { ...params, limit: '100', offset: String(offset) });
  const first = await page(0);
  const out = [...first.data];
  if (!first.hasMore) return out;
  if (typeof first.totalCount !== 'number') {
    // sem total: segue página a página
    for (let p = 1, res = first; res.hasMore && p < MAX_PAGES; p++) {
      res = await page(p * 100);
      out.push(...res.data);
    }
    return out;
  }
  const offsets: number[] = [];
  for (let o = 100; o < Math.min(first.totalCount, MAX_PAGES * 100); o += 100) offsets.push(o);
  for (const res of await Promise.all(offsets.map(page))) out.push(...res.data);
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

async function loadCustomerNames(): Promise<Map<string, string>> {
  const list = await remember('asaas:customers', 6 * 3600, async () =>
    (await getAll<{ id: string; name: string }>('/customers')).map((c) => [c.id, c.name] as [string, string]),
  );
  return new Map(list);
}

function toTransaction(p: AsaasPayment): Transaction | null {
  const status = mapStatus(p);
  if (!status) return null;
  return {
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
    // id do cliente; o nome é resolvido depois (a lista de clientes tem cache próprio)
    customer: p.customer,
    subscriptionId: p.subscription ?? undefined,
    receiptUrl: p.invoiceUrl,
  };
}

function outflow(f: AsaasFinancialTx): Transaction {
  return {
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
  };
}

/** Cobranças vencidas ou pagas no mês */
function loadPayments(monthStart: string, recent: boolean, version: number): Promise<Transaction[]> {
  const from = monthStart;
  const to = endOfMonth(monthStart);
  const key = `asaas:cobrancas:${monthStart.slice(0, 7)}:${recent ? `v${version}` : 'fechado'}`;
  return remember(key, recent ? RECENT_TTL : CLOSED_TTL, async () => {
    const [byDue, byPayment] = await Promise.all([
      getAll<AsaasPayment>('/payments', { 'dueDate[ge]': from, 'dueDate[le]': to }),
      getAll<AsaasPayment>('/payments', { 'paymentDate[ge]': from, 'paymentDate[le]': to }),
    ]);
    const out: Transaction[] = [];
    for (const p of [...byDue, ...byPayment]) {
      const t = !p.deleted && toTransaction(p);
      if (t) out.push(t);
    }
    return out;
  });
}

/** Saídas do extrato no mês (taxas, saques, contas pagas, Pix enviados) */
async function fetchOutflows(monthStart: string): Promise<Transaction[]> {
  const extrato = await getAll<AsaasFinancialTx>('/financialTransactions', { startDate: monthStart, finishDate: endOfMonth(monthStart) });
  return extrato.filter((f) => f.value < 0).map(outflow);
}

/**
 * O extrato só aceita 20 requisições por minuto, e um mês tem várias páginas. Meses fechados não mudam:
 * ficam 30 dias no cache e, se ainda não estiverem lá, são baixados aos poucos em segundo plano
 * (o painel mostra as cobranças na hora e as saídas desses meses aparecem conforme ficam prontas).
 */
const OUTFLOWS_CLOSED_TTL = 30 * 86_400;
const warming = new Set<string>();
let warmQueue = Promise.resolve();

async function loadOutflows(monthStart: string, recent: boolean, version: number): Promise<Transaction[] | null> {
  if (recent) return remember(`asaas:saidas:${monthStart.slice(0, 7)}:v${version}`, RECENT_TTL, () => fetchOutflows(monthStart));
  const key = `asaas:saidas:${monthStart.slice(0, 7)}:fechado`;
  const cached = await peek<Transaction[]>(key);
  if (cached) return cached;
  if (!warming.has(key)) {
    warming.add(key);
    warmQueue = warmQueue
      .then(() => remember(key, OUTFLOWS_CLOSED_TTL, () => fetchOutflows(monthStart)))
      .then(() => undefined)
      .catch((err) => console.warn('[asaas] extrato de', monthStart.slice(0, 7), 'falhou:', (err as Error).message))
      .finally(() => warming.delete(key));
  }
  return null;
}

export const asaas: Connector = {
  id: 'asaas',

  async load(window: Window, ctx?: { version: number }): Promise<SourceData> {
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
      const version = ctx?.version ?? 0;
      // meses a partir do anterior ao atual mudam com frequência; os mais antigos quase nunca
      const recentFrom = startOfMonth(addMonths(today(), -1));
      const months: string[] = [];
      for (let m = startOfMonth(window.from); m <= window.to; m = addMonths(m, 1)) months.push(m);

      const currentMonth = startOfMonth(today());
      const [live, names, payments, outflows] = await Promise.all([
        remember(`asaas:live:v${version}`, RECENT_TTL, async () => {
          const [balance, subs] = await Promise.all([
            get<{ balance: number }>('/finance/balance'),
            getAll<AsaasSubscription>('/subscriptions', { status: 'ACTIVE' }),
          ]);
          return { balance: balance.balance, subs: subs.filter((x) => !x.deleted), at: new Date().toISOString() };
        }),
        loadCustomerNames().catch(() => new Map<string, string>()),
        Promise.all(months.map((m) => loadPayments(m, m >= recentFrom, version))),
        // extrato: só até o mês atual (o futuro não tem lançamentos)
        Promise.all(months.filter((m) => m <= currentMonth).map((m) => loadOutflows(m, m >= recentFrom, version))),
      ]);
      const pendingOutflowMonths = outflows.filter((o) => o === null).length;

      // a mesma cobrança aparece em mais de um mês (vence em um, é paga em outro):
      // os meses recentes vêm por último e prevalecem, pois têm o status mais novo
      const byId = new Map<string, Transaction>();
      for (const list of [...payments, ...outflows]) for (const t of list ?? []) byId.set(t.id, t);
      const transactions = [...byId.values()].map((t) =>
        t.direction === 'in' && t.customer ? { ...t, customer: names.get(t.customer) ?? t.customer } : t,
      );

      const subscriptions: Subscription[] = live.subs.map((x) => ({
        id: x.id,
        source: 'asaas',
        value: x.value,
        nextDueDate: x.nextDueDate,
        cycle: x.cycle,
        description: x.description || 'Assinatura',
        customer: names.get(x.customer) ?? x.customer,
        endDate: x.endDate ?? undefined,
      }));
      const charges = transactions.filter((t) => t.direction === 'in').length;

      return {
        status: {
          ...base,
          state: 'connected',
          message:
            `${charges} cobranças, ${subscriptions.length} assinaturas ativas` +
            (pendingOutflowMonths ? ` · carregando o extrato de ${pendingOutflowMonths} meses anteriores (limite do Asaas: 20 consultas/min)` : ''),
          balance: live.balance,
          balanceUpdatedAt: live.at,
        },
        transactions,
        subscriptions,
      };
    } catch (err) {
      const detail =
        err instanceof HttpError && err.status === 401
          ? 'chave de API inválida ou do ambiente errado (ASAAS_ENV)'
          : err instanceof HttpError && err.status === 429
            ? 'limite de requisições do Asaas atingido; os dados voltam sozinhos em alguns minutos'
            : (err as Error).message;
      return {
        status: { ...base, state: 'error', message: `Falha ao consultar o Asaas: ${detail}`, balance: null, balanceUpdatedAt: null },
        transactions: [],
        subscriptions: [],
      };
    }
  },
};
