export type SourceId = 'asaas' | 'infinitepay' | 'inter' | 'sicoob' | 'cresol';

export type Direction = 'in' | 'out';

/**
 * received  – dinheiro creditado
 * confirmed – pago pelo cliente, aguardando crédito (ex.: cartão no Asaas)
 * pending   – a vencer
 * overdue   – vencido e não pago
 * refunded  – estornado
 */
export type TxStatus = 'received' | 'confirmed' | 'pending' | 'overdue' | 'refunded';

export type PaymentMethod = 'pix' | 'boleto' | 'credit_card' | 'debit_card' | 'transfer' | 'fee' | 'other';

/** Formato único em que todos os conectores entregam movimentações. */
export interface Transaction {
  id: string;
  source: SourceId;
  direction: Direction;
  status: TxStatus;
  method: PaymentMethod;
  /** Valor bruto, sempre positivo (a direção indica entrada/saída) */
  amount: number;
  /** Valor líquido de taxas, quando a fonte informa */
  netAmount?: number;
  /** Data do pagamento/crédito (YYYY-MM-DD) – presente quando já pago */
  paidDate?: string;
  /** Data de vencimento (YYYY-MM-DD) – presente para cobranças */
  dueDate?: string;
  /** Data prevista de crédito na conta (cartão) */
  creditDate?: string;
  description: string;
  customer?: string;
  /** Recorrência do Asaas que gerou a cobrança */
  subscriptionId?: string;
  installments?: number;
  receiptUrl?: string;
  /** ISO timestamp do evento em tempo real (webhooks) */
  createdAt?: string;
  /**
   * Movimentação entre contas da própria empresa (ex.: Asaas → Inter).
   * Fica fora dos totais para não contar a mesma receita duas vezes.
   */
  internal?: boolean;
  demo?: boolean;
}

export interface Subscription {
  id: string;
  source: SourceId;
  value: number;
  nextDueDate: string;
  cycle: 'WEEKLY' | 'BIWEEKLY' | 'MONTHLY' | 'BIMONTHLY' | 'QUARTERLY' | 'SEMIANNUALLY' | 'YEARLY';
  description: string;
  customer?: string;
  endDate?: string;
  demo?: boolean;
}

export type ConnectorState = 'connected' | 'demo' | 'pending_access' | 'error';

export interface SourceStatus {
  id: SourceId;
  name: string;
  role: string;
  state: ConnectorState;
  message: string;
  balance: number | null;
  balanceUpdatedAt: string | null;
  realtime: boolean;
  webhookUrl?: string;
  nextSteps?: string[];
}

export interface SourceData {
  status: SourceStatus;
  transactions: Transaction[];
  subscriptions: Subscription[];
}

export interface Window {
  /** YYYY-MM-DD inclusive */
  from: string;
  to: string;
}

export interface Connector {
  id: SourceId;
  /** ctx.version muda a cada webhook: invalida os caches das partes que mudam com frequência */
  load(window: Window, ctx?: { version: number }): Promise<SourceData>;
}
