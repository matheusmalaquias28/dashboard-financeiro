/**
 * Dados de DEMONSTRAÇÃO, usados enquanto uma fonte não tem credencial configurada
 * (e DEMO_MODE=true). São determinísticos: o mesmo dia gera sempre os mesmos números.
 * Tudo que sai daqui leva `demo: true` e o painel sinaliza isso.
 */
import type { PaymentMethod, Subscription, Transaction, TxStatus, Window } from '../types.js';
import { addDays, addMonths, round2, startOfMonth, today } from '../util.js';

function seeded(seedText: string) {
  let h = 1779033703 ^ seedText.length;
  for (let i = 0; i < seedText.length; i++) {
    h = Math.imul(h ^ seedText.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  let a = h >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CLIENTS = [
  'Ótica Visão Clara', 'Clínica Sorriso Pleno', 'Academia Fit Prime', 'Restaurante Sabor Mineiro', 'Pet Shop Amigo Fiel',
  'Imobiliária Horizonte', 'Studio Bella Estética', 'Auto Center Rodrigues', 'Construtora Pilar', 'Farmácia Vida+',
  'Escola Pequeno Saber', 'Odonto Excellence', 'Loja Moda Urbana', 'Advocacia Martins & Lima', 'Padaria Pão Dourado',
  'Contabilidade Exata', 'Barbearia Navalha', 'Hamburgueria Brasa', 'Clínica Dermacare', 'Energia Solar Sul',
  'Moveis Planejados Arte', 'Distribuidora Norte', 'Hotel Serra Azul', 'Agência Viagem Já', 'Laboratório BioAnálise',
  'Pizzaria Forno a Lenha', 'Escritório Arquitetura Linha', 'Cervejaria Artesanal Lupulo', 'Clínica Fisio Movimento', 'Joalheria Brilho',
  'Concessionária Motors', 'Coworking Hub', 'Floricultura Primavera', 'Gráfica Rápida', 'Vidraçaria Cristal',
  'Escola de Idiomas Fluent', 'Nutri Equilíbrio', 'Psicologia Bem Estar', 'Material de Construção Forte', 'Lavanderia Express',
];

const PLANS = [
  { name: 'Gestão de Tráfego', value: 1497 },
  { name: 'Social Media', value: 997 },
  { name: 'Assessoria Completa', value: 2997 },
  { name: 'CRM + Automação', value: 697 },
  { name: 'Gestão de Tráfego Plus', value: 1997 },
];

const DUE_DAYS = [5, 10, 15, 20, 25];

interface DemoClient {
  name: string;
  plan: (typeof PLANS)[number];
  dueDay: number;
  method: PaymentMethod;
  since: string;
  payerProfile: number; // 0..1 – quanto maior, mais atrasa
}

function demoClients(): DemoClient[] {
  const rnd = seeded('asaas-clients');
  const base = startOfMonth(today());
  return CLIENTS.map((name, i) => {
    const r = rnd();
    return {
      name,
      plan: PLANS[Math.floor(rnd() * PLANS.length)],
      dueDay: DUE_DAYS[i % DUE_DAYS.length],
      method: r < 0.5 ? 'pix' : r < 0.8 ? 'boleto' : 'credit_card',
      // carteira crescendo: clientes entram ao longo dos últimos 14 meses
      since: addMonths(base, -Math.floor(rnd() * 14) + (i > 34 ? 1 : 0)),
      payerProfile: rnd(),
    };
  });
}

export function demoAsaas(window: Window): { transactions: Transaction[]; subscriptions: Subscription[]; balance: number } {
  const now = today();
  const clients = demoClients();
  const txs: Transaction[] = [];
  // O Asaas gera a cobrança da assinatura ~15 dias antes do vencimento
  const generatedUntil = addDays(now, 15);

  for (let month = startOfMonth(window.from); month <= window.to; month = addMonths(month, 1)) {
    clients.forEach((c, idx) => {
      if (month < startOfMonth(c.since)) return;
      const due = `${month.slice(0, 8)}${String(c.dueDay).padStart(2, '0')}`;
      if (due > generatedUntil || due < window.from) return;
      const rnd = seeded(`asaas-${idx}-${month}`);
      const id = `pay_demo_${idx}_${month.slice(0, 7)}`;
      let status: TxStatus = 'pending';
      let paidDate: string | undefined;
      let creditDate: string | undefined;

      if (due <= now) {
        const lateDays = c.payerProfile > 0.85 ? Math.floor(rnd() * 25) : Math.floor(rnd() * 4) - 1;
        const paid = addDays(due, lateDays);
        if (paid <= now && rnd() > 0.03) {
          paidDate = paid;
          if (c.method === 'credit_card') {
            creditDate = addDays(paid, 32);
            status = creditDate <= now ? 'received' : 'confirmed';
          } else status = 'received';
        } else status = due < now ? 'overdue' : 'pending';
      }

      const fee = c.method === 'credit_card' ? c.plan.value * 0.0299 + 0.49 : 1.99;
      txs.push({
        id, source: 'asaas', direction: 'in', status, method: c.method,
        amount: c.plan.value, netAmount: round2(c.plan.value - fee),
        dueDate: due, paidDate, creditDate,
        description: `${c.plan.name} – mensalidade`, customer: c.name,
        subscriptionId: `sub_demo_${idx}`, demo: true,
      });
    });

    // cobranças avulsas (setup, projetos pontuais)
    const rnd = seeded(`asaas-avulsas-${month}`);
    const count = 2 + Math.floor(rnd() * 4);
    for (let k = 0; k < count; k++) {
      const day = 1 + Math.floor(rnd() * 27);
      const due = `${month.slice(0, 8)}${String(day).padStart(2, '0')}`;
      if (due > generatedUntil || due < window.from) continue;
      const value = [1500, 2500, 3800, 4500, 6000][Math.floor(rnd() * 5)];
      const paid = due <= now && rnd() > 0.1;
      txs.push({
        id: `pay_demo_av_${month.slice(0, 7)}_${k}`, source: 'asaas', direction: 'in',
        status: paid ? 'received' : due < now ? 'overdue' : 'pending',
        method: rnd() < 0.6 ? 'pix' : 'boleto', amount: value, netAmount: round2(value - 1.99),
        dueDate: due, paidDate: paid ? due : undefined,
        description: 'Implantação / projeto avulso', customer: CLIENTS[Math.floor(rnd() * CLIENTS.length)], demo: true,
      });
    }
  }

  // Saídas: transferências para a conta PJ toda sexta-feira + taxas
  for (let d = window.from; d <= window.to && d <= now; d = addDays(d, 1)) {
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    const rnd = seeded(`asaas-out-${d}`);
    if (weekday === 5) {
      const value = round2(9000 + rnd() * 9000);
      txs.push({
        id: `ft_demo_tr_${d}`, source: 'asaas', direction: 'out', status: 'received', method: 'transfer',
        amount: value, paidDate: d, description: 'Transferência para conta Inter PJ', internal: true, demo: true,
      });
    }
    if (d.endsWith('-10')) {
      txs.push({
        id: `ft_demo_bill_${d}`, source: 'asaas', direction: 'out', status: 'received', method: 'boleto',
        amount: round2(2200 + rnd() * 600), paidDate: d, description: 'Pagamento de conta – ferramentas/SaaS', demo: true,
      });
    }
  }
  for (const t of [...txs]) {
    if (t.direction === 'in' && t.paidDate && t.netAmount != null) {
      txs.push({
        id: `fee_${t.id}`, source: 'asaas', direction: 'out', status: 'received', method: 'fee',
        amount: round2(t.amount - t.netAmount), paidDate: t.paidDate, description: 'Taxa de cobrança', demo: true,
      });
    }
  }

  const subscriptions: Subscription[] = clients.map((c, idx) => {
    let next = `${now.slice(0, 8)}${String(c.dueDay).padStart(2, '0')}`;
    if (next <= now) next = addMonths(next, 1);
    return {
      id: `sub_demo_${idx}`, source: 'asaas', value: c.plan.value, nextDueDate: next, cycle: 'MONTHLY',
      description: c.plan.name, customer: c.name, demo: true,
    };
  });

  const rnd = seeded(`asaas-balance-${now}`);
  return { transactions: txs, subscriptions, balance: round2(12000 + rnd() * 8000) };
}

export function demoInfinitePay(window: Window): Transaction[] {
  const now = today();
  const txs: Transaction[] = [];
  for (let d = window.from; d <= window.to && d < now; d = addDays(d, 1)) {
    txs.push(...demoInfinitePayDay(d, 24));
  }
  // hoje: só as vendas "até agora"
  const hour = Number(new Intl.DateTimeFormat('en-US', { timeZone: 'America/Sao_Paulo', hour: 'numeric', hour12: false }).format(new Date()));
  if (now >= window.from && now <= window.to) txs.push(...demoInfinitePayDay(now, hour));
  return txs;
}

function demoInfinitePayDay(d: string, untilHour: number): Transaction[] {
  const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
  if (weekday === 0) return [];
  const rnd = seeded(`ip-${d}`);
  const count = weekday === 6 ? Math.floor(rnd() * 2) : Math.floor(rnd() * 4);
  const out: Transaction[] = [];
  for (let k = 0; k < count; k++) {
    const hour = 8 + Math.floor(rnd() * 11);
    const minute = Math.floor(rnd() * 60);
    if (hour >= untilHour) continue;
    const card = rnd() < 0.72;
    const value = round2([297, 497, 697, 997, 1497, 1997, 2997][Math.floor(rnd() * 7)] * (0.9 + rnd() * 0.2));
    const installments = card ? [1, 1, 2, 3, 6, 10, 12][Math.floor(rnd() * 7)] : 1;
    out.push({
      id: `ip_demo_${d}_${k}`, source: 'infinitepay', direction: 'in', status: 'received',
      method: card ? 'credit_card' : 'pix', amount: value,
      netAmount: round2(value * (card ? 1 - 0.0315 - 0.012 * (installments - 1) : 1)),
      paidDate: d, installments, description: card ? 'Venda no cartão (link de pagamento)' : 'Venda Pix (link de pagamento)',
      customer: CLIENTS[Math.floor(rnd() * CLIENTS.length)],
      createdAt: new Date(`${d}T${String(hour).padStart(2, '0')}:${String(minute).padStart(2, '0')}:00-03:00`).toISOString(),
      demo: true,
    });
  }
  return out;
}

/** Uma venda aleatória "agora" – alimenta o feed ao vivo no modo demonstração */
export function demoLiveSale(): Transaction {
  const value = round2([297, 497, 997, 1497, 1997][Math.floor(Math.random() * 5)] * (0.9 + Math.random() * 0.2));
  const card = Math.random() < 0.7;
  const installments = card ? [1, 2, 3, 6, 12][Math.floor(Math.random() * 5)] : 1;
  return {
    id: `ip_demo_live_${Date.now()}`, source: 'infinitepay', direction: 'in', status: 'received',
    method: card ? 'credit_card' : 'pix', amount: value,
    netAmount: round2(value * (card ? 0.9685 : 1)), paidDate: today(), installments,
    description: card ? 'Venda no cartão (link de pagamento)' : 'Venda Pix (link de pagamento)',
    customer: CLIENTS[Math.floor(Math.random() * CLIENTS.length)], createdAt: new Date().toISOString(), demo: true,
  };
}

