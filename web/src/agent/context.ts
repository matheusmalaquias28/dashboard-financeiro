/**
 * Resumos compactos do que está na tela, enviados ao agente junto com cada pergunta.
 * Só agregados e listas curtas – nunca o extrato inteiro – para caber no contexto e custar pouco.
 */
import type { Charge, CheckoutState } from '../checkout/types';
import { METHOD_NAME, monthLabel, SOURCE_NAME } from '../lib/format';
import { periodLabel } from '../lib/period';
import type { DayFlow, Kpis, MonthlyPoint, Projection } from '../lib/metrics';
import type { DashboardData, Filters, Transaction } from '../types';

const r2 = (n: number) => Math.round(n * 100) / 100;

export function financeContext(args: {
  data: DashboardData;
  filters: Filters;
  kpis: Kpis;
  projection: Projection;
  monthly: MonthlyPoint[];
  bySource: Array<{ key: string; value: number; count: number }>;
  byMethod: Array<{ key: string; value: number; count: number }>;
  openItems: Transaction[];
  days: DayFlow[];
  transfers: number;
  txs: Transaction[];
}) {
  const { data, filters, kpis, projection, monthly, bySource, byMethod, openItems, days, transfers, txs } = args;
  const p = filters.period;
  const overdueByCustomer = new Map<string, { total: number; count: number; oldestDue: string }>();
  for (const t of txs) {
    if (t.direction !== 'in' || t.status !== 'overdue') continue;
    const k = t.customer ?? t.description;
    const cur = overdueByCustomer.get(k) ?? { total: 0, count: 0, oldestDue: t.dueDate ?? '' };
    overdueByCustomer.set(k, { total: cur.total + t.amount, count: cur.count + 1, oldestDue: t.dueDate && t.dueDate < cur.oldestDue ? t.dueDate : cur.oldestDue });
  }
  const biggestOut = days.flatMap((d) => d.items).sort((a, b) => b.amount - a.amount).slice(0, 10);

  return {
    periodoSelecionado: { descricao: periodLabel(p), de: p.from, ate: p.to, comparadoCom: kpis.compareLabel },
    hoje: data.today,
    filtros: {
      fontes: filters.sources.map((s) => SOURCE_NAME[s]),
      formasDePagamento: filters.methods.length ? filters.methods.map((x) => METHOD_NAME[x]) : 'todas',
    },
    indicadoresDoPeriodo: {
      recebido: r2(kpis.received),
      recebidoNoCartaoAguardandoCredito: r2(kpis.receivedConfirmed),
      quantidadeDePagamentos: kpis.receivedCount,
      recebidoNoPeriodoDeComparacao: r2(kpis.receivedCompare),
      comparacao: kpis.compareLabel,
      aReceberNoPeriodo: r2(kpis.receivable),
      aReceberAVencer: r2(kpis.receivablePending),
      aReceberJaVencido: r2(kpis.receivableOverdue),
      cobrancasEmAberto: kpis.receivableCount,
      despesas: r2(kpis.outflow),
      despesasNoPeriodoDeComparacao: r2(kpis.outflowCompare),
      diasComDespesa: kpis.outflowDays,
      transferenciasEntreContasDaEmpresa: r2(transfers),
      inadimplenciaTotal12Meses: r2(kpis.overdueTotal),
    },
    saldos: data.sources.filter((s) => s.balance != null).map((s) => ({ conta: s.name, saldo: r2(s.balance!) })),
    projecaoProximoMes: {
      mes: monthLabel(projection.month),
      total: r2(projection.total),
      cobrancasJaEmitidas: r2(projection.issued),
      recorrenciaAGerar: r2(projection.recurring),
      cartaoACreditar: r2(projection.cardToCredit),
      estimativaInfinitePayMedia3Meses: r2(projection.cardEstimate),
    },
    historicoMensal: monthly.map((p) => ({ mes: p.ym, entradas: r2(p.entradas), despesas: r2(p.saidas), resultado: r2(p.saldo) })),
    recebidoPorFonte: bySource.map((b) => ({ fonte: SOURCE_NAME[b.key as keyof typeof SOURCE_NAME] ?? b.key, valor: r2(b.value), pagamentos: b.count })),
    recebidoPorForma: byMethod.map((b) => ({ forma: METHOD_NAME[b.key as keyof typeof METHOD_NAME] ?? b.key, valor: r2(b.value), pagamentos: b.count })),
    cobrancasEmAbertoNoPeriodo: openItems.slice(0, 40).map((t) => ({ cliente: t.customer ?? t.description, valor: r2(t.amount), vencimento: t.dueDate, status: t.status === 'overdue' ? 'vencida' : 'a vencer' })),
    clientesInadimplentes: [...overdueByCustomer.entries()]
      .sort((a, b) => b[1].total - a[1].total)
      .slice(0, 20)
      .map(([cliente, v]) => ({ cliente, totalVencido: r2(v.total), cobrancas: v.count, vencimentoMaisAntigo: v.oldestDue })),
    maioresSaidasDoPeriodo: biggestOut.map((t) => ({ data: t.paidDate, valor: r2(t.amount), descricao: t.description, entreContasDaEmpresa: !!t.internal })),
    integracoes: data.sources.map((s) => ({ fonte: s.name, estado: s.state, mensagem: s.message })),
  };
}

export function checkoutContext(state: CheckoutState) {
  const month = new Date().toISOString().slice(0, 7);
  const summary = (list: Charge[]) => ({
    quantidade: list.length,
    valor: r2(list.reduce((a, c) => a + c.total, 0) / 100),
  });
  const inMonth = state.charges.filter((c) => c.createdAt.slice(0, 7) === month);
  return {
    usuario: state.user.role === 'admin' ? 'administrador (vê todas as cobranças)' : `vendedor ${state.user.name} (só as próprias cobranças)`,
    observacao: 'Valores em reais. Cobranças são links de pagamento da InfinitePay; o cliente escolhe Pix ou cartão em até 12x.',
    taxasDaConta: {
      pixPercentual: state.config.fees.pixRate,
      cartaoPercentualDe1a12x: state.config.fees.cardRates,
      revisadasPeloAdministrador: state.config.feesConfirmed,
    },
    catalogo: state.config.products.filter((p) => p.active).map((p) => ({ produto: p.name, preco: r2(p.price / 100) })),
    mesAtual: {
      gerados: summary(inMonth),
      pagos: summary(inMonth.filter((c) => c.status === 'paid')),
      aguardando: summary(state.charges.filter((c) => c.status === 'pending')),
      liquidoRecebido: r2(inMonth.reduce((a, c) => a + (c.paid?.net ?? 0), 0) / 100),
      taxasPagas: r2(inMonth.reduce((a, c) => a + (c.paid?.fee ?? 0), 0) / 100),
    },
    ultimasCobrancas: state.charges.slice(0, 40).map((c) => ({
      criadaEm: c.createdAt.slice(0, 16).replace('T', ' '),
      vendedor: c.seller,
      cliente: c.customer.name,
      produtos: c.items.map((i) => `${i.quantity}x ${i.description}`).join(', '),
      valor: r2(c.total / 100),
      taxa: c.feeMode === 'customer' ? `repassada ao cliente (até ${c.feeRefInstallments}x)` : 'absorvida pela empresa',
      status: c.status === 'paid' ? `paga (${c.paid?.method === 'pix' ? 'Pix' : `cartão ${c.paid?.installments}x`})` : 'aguardando pagamento',
      empresaRecebe: r2((c.paid?.net ?? c.estimatedNet) / 100),
    })),
  };
}
