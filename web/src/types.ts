// Espelho de server/src/types.ts
export type SourceId = 'asaas' | 'infinitepay' | 'inter' | 'sicoob' | 'cresol';
export type Direction = 'in' | 'out';
export type TxStatus = 'received' | 'confirmed' | 'pending' | 'overdue' | 'refunded';
export type PaymentMethod = 'pix' | 'boleto' | 'credit_card' | 'debit_card' | 'transfer' | 'fee' | 'other';

export interface Transaction {
  id: string;
  source: SourceId;
  direction: Direction;
  status: TxStatus;
  method: PaymentMethod;
  amount: number;
  netAmount?: number;
  paidDate?: string;
  dueDate?: string;
  creditDate?: string;
  description: string;
  customer?: string;
  subscriptionId?: string;
  installments?: number;
  receiptUrl?: string;
  createdAt?: string;
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

export interface DashboardData {
  generatedAt: string;
  today: string;
  window: { from: string; to: string };
  /** sse = servidor próprio (conexão aberta); poll = Vercel (consulta periódica) */
  liveMode: 'sse' | 'poll';
  version: number;
  sources: SourceStatus[];
  transactions: Transaction[];
  subscriptions: Subscription[];
}

export interface User {
  id: string;
  email: string;
  role: 'admin' | 'seller';
  name: string;
}

export type View = 'financeiro' | 'checkout' | 'colaboradores' | 'emails';

export interface Filters {
  /** período de análise (intervalo de datas) */
  period: import('./lib/period').Period;
  sources: SourceId[];
  methods: PaymentMethod[];
}
