import crypto from 'node:crypto';
import { Router } from 'express';
import { markChargePaid } from '../checkout.js';
import { config } from '../config.js';
import { invalidate } from '../connectors/index.js';
import { recordWebhook, store, verifyPayment, type InfinitePayWebhook } from '../connectors/infinitepay.js';
import { broadcast } from '../events.js';

export const webhooks = Router();

const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Asaas: cadastrar em Asaas > Integrações > Webhooks, com o mesmo token de ASAAS_WEBHOOK_TOKEN.
 * Eventos úteis: PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_OVERDUE, PAYMENT_CREATED, TRANSFER_DONE.
 */
webhooks.post('/asaas', async (req, res) => {
  const token = req.header('asaas-access-token') ?? '';
  if (!config.asaas.webhookToken || !safeEqual(token, config.asaas.webhookToken)) {
    res.status(401).json({ error: 'token inválido' });
    return;
  }
  const event = String(req.body?.event ?? '');
  invalidate();
  // a versão compartilhada faz as outras instâncias (Vercel) descartarem o cache também
  await store.bump().catch((err) => console.error('[asaas] falha ao sinalizar atualização', err));
  broadcast({ type: 'refresh', source: 'asaas', reason: event });
  res.json({ received: true });
});

/** Pagamento já confirmado: baixa a cobrança do checkout (se for uma) e lança no painel financeiro */
export async function processInfinitePayPayment(body: InfinitePayWebhook) {
  const charge = await markChargePaid(body);
  const { isNew } = await recordWebhook(
    body,
    charge && { customer: charge.customer.name, description: `${charge.items.map((i) => i.description).join(', ')} · vendedor: ${charge.seller}` },
  );
  if (isNew) invalidate();
}

async function handleInfinitePay(body: InfinitePayWebhook, res: import('express').Response) {
  if (!body?.transaction_nsu || typeof body.amount !== 'number') {
    res.status(400).json({ error: 'payload inválido' });
    return;
  }
  // Processa antes de responder: em funções serverless o trabalho após a resposta pode ser interrompido.
  // 200 = recebido (inclusive quando ignorado); 400 = falha temporária, a InfinitePay tenta de novo.
  try {
    if (config.infinitepay.verifyWebhook && !(await verifyPayment(body))) {
      console.warn(`[infinitepay] webhook ${body.transaction_nsu} NÃO confirmado em payment_check – ignorado`);
      res.json({ received: true, ignored: true });
      return;
    }
    await processInfinitePayPayment(body);
    res.json({ received: true });
  } catch (err) {
    console.error('[infinitepay] erro ao processar webhook', err);
    res.status(400).json({ error: 'falha temporária, tente novamente' });
  }
}

webhooks.post('/infinitepay', (req, res) => {
  if (config.infinitepay.webhookSecret) {
    res.status(404).end();
    return;
  }
  void handleInfinitePay(req.body, res);
});

webhooks.post('/infinitepay/:secret', (req, res) => {
  if (!config.infinitepay.webhookSecret || !safeEqual(req.params.secret, config.infinitepay.webhookSecret)) {
    res.status(404).end();
    return;
  }
  void handleInfinitePay(req.body, res);
});
