/**
 * Banco Inter PJ – API Banking v2 (saldo e extrato).
 * Docs: https://developers.inter.co/references/banking
 * Requer: integração criada no Internet Banking PJ (escopo extrato.read), client_id/secret
 * e o certificado (.crt + .key) baixado no momento da criação – autenticação mTLS.
 *
 * Status: implementado conforme a documentação, ainda não validado com credenciais reais.
 */
import fs from 'node:fs';
import path from 'node:path';
import { Agent } from 'undici';
import { config } from '../config.js';
import type { Connector, PaymentMethod, SourceData, Transaction, Window } from '../types.js';
import { chunkRange, fetchJson, ROOT_DIR, today } from '../util.js';

interface InterExtrato {
  transacoes: Array<{
    dataEntrada: string;
    tipoTransacao: string; // PIX, BOLETO_COBRANCA, TRANSFERENCIA, PAGAMENTO, ...
    tipoOperacao: 'C' | 'D';
    valor: string;
    titulo: string;
    descricao: string;
  }>;
}

let dispatcher: Agent | null = null;
let token: { value: string; expiresAt: number } | null = null;

function mtls(): Agent {
  if (dispatcher) return dispatcher;
  // Em hospedagens sem disco (Vercel) o certificado vem das variáveis INTER_CERT_BASE64 / INTER_KEY_BASE64
  const load = (b64: string, p: string) => (b64 ? Buffer.from(b64, 'base64') : fs.readFileSync(path.resolve(ROOT_DIR, p)));
  dispatcher = new Agent({
    connect: { cert: load(config.inter.certBase64, config.inter.certPath), key: load(config.inter.keyBase64, config.inter.keyPath) },
  });
  return dispatcher;
}

async function accessToken(): Promise<string> {
  if (token && Date.now() < token.expiresAt) return token.value;
  const body = new URLSearchParams({
    client_id: config.inter.clientId,
    client_secret: config.inter.clientSecret,
    grant_type: 'client_credentials',
    scope: 'extrato.read',
  });
  const res = await fetchJson<{ access_token: string; expires_in: number }>(`${config.inter.baseUrl}/oauth/v2/token`, {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body,
    dispatcher: mtls(),
  });
  token = { value: res.access_token, expiresAt: Date.now() + (res.expires_in - 60) * 1000 };
  return token.value;
}

async function get<T>(pathname: string, params: Record<string, string> = {}): Promise<T> {
  const url = new URL(config.inter.baseUrl + pathname);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  const headers: Record<string, string> = { authorization: `Bearer ${await accessToken()}` };
  if (config.inter.account) headers['x-conta-corrente'] = config.inter.account;
  return fetchJson<T>(url.toString(), { headers, dispatcher: mtls() });
}

const METHOD: Record<string, PaymentMethod> = {
  PIX: 'pix',
  BOLETO_COBRANCA: 'boleto',
  PAGAMENTO: 'boleto',
  TRANSFERENCIA: 'transfer',
  TARIFA: 'fee',
  CARTAO: 'debit_card',
};

/** Créditos vindos das nossas próprias contas de recebimento já foram contados na origem */
const INTERNAL = /asaas|infinite ?pay|cloudwalk/i;

export const inter: Connector = {
  id: 'inter',

  async load(window: Window): Promise<SourceData> {
    const base = { id: 'inter' as const, name: 'Banco Inter', role: 'Conta PJ', realtime: false };

    if (!config.inter.clientId || !config.inter.clientSecret) {
      return {
        status: {
          ...base, state: 'pending_access', message: 'Aguardando acesso à API', balance: null, balanceUpdatedAt: null,
          nextSteps: [
            'Internet Banking PJ > Soluções para sua empresa > Nova integração',
            'Marcar o escopo "Consultar extrato e saldo" (extrato.read)',
            'Baixar o certificado e salvar em certs/inter.crt e certs/inter.key',
            'Preencher INTER_CLIENT_ID e INTER_CLIENT_SECRET no .env',
          ],
        },
        transactions: [],
        subscriptions: [],
      };
    }

    try {
      const saldo = await get<{ disponivel: number }>('/banking/v2/saldo');
      const to = window.to < today() ? window.to : today();
      const transactions: Transaction[] = [];
      // a API limita o período do extrato; consultamos em janelas de 90 dias
      for (const [from, end] of chunkRange(window.from, to, 90)) {
        const extrato = await get<InterExtrato>('/banking/v2/extrato', { dataInicio: from, dataFim: end });
        extrato.transacoes.forEach((t, i) => {
          const text = `${t.titulo} ${t.descricao}`;
          transactions.push({
            id: `inter_${t.dataEntrada}_${i}_${t.valor}`,
            source: 'inter',
            direction: t.tipoOperacao === 'C' ? 'in' : 'out',
            status: 'received',
            method: METHOD[t.tipoTransacao] ?? 'other',
            amount: Math.abs(Number(t.valor)),
            paidDate: t.dataEntrada,
            description: t.descricao || t.titulo,
            internal: t.tipoOperacao === 'C' && INTERNAL.test(text),
          });
        });
      }
      return {
        status: { ...base, state: 'connected', message: `${transactions.length} lançamentos no período`, balance: saldo.disponivel, balanceUpdatedAt: new Date().toISOString() },
        transactions,
        subscriptions: [],
      };
    } catch (err) {
      return {
        status: { ...base, state: 'error', message: `Falha ao consultar o Inter: ${(err as Error).message}`, balance: null, balanceUpdatedAt: null },
        transactions: [],
        subscriptions: [],
      };
    }
  },
};
