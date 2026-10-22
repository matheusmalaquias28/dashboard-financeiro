import crypto from 'node:crypto';
import { Router } from 'express';
import { config } from '../config.js';
import { invalidate } from '../connectors/index.js';
import { recordWebhook, verifyPayment, type InfinitePayWebhook } from '../connectors/infinitepay.js';
import { broadcast } from '../events.js';

export const webhooks = Router();

const safeEqual = (a: string, b: string) => a.length === b.length && crypto.timingSafeEqual(Buffer.from(a), Buffer.from(b));

/**
 * Asaas: cadastrar em Asaas > Integrações > Webhooks, com o mesmo token de ASAAS_WEBHOOK_TOKEN.
 * Eventos úteis: PAYMENT_RECEIVED, PAYMENT_CONFIRMED, PAYMENT_OVERDUE, PAYMENT_CREATED, TRANSFER_DONE.
 */
webhooks.post('/asaas', (req, res) => {
  const token = req.header('asaas-access-token') ?? '';
  if (!config.asaas.webhookToken || !safeEqual(token, config.asaas.webhookToken)) {
    res.status(401).json({ error: 'token inválido' });
    return;
  }
  const event = String(req.body?.event ?? '');
  invalidate();
  broadcast({ type: 'refresh', source: 'asaas', reason: event });
  res.json({ received: true });
});

async function handleInfinitePay(body: InfinitePayWebhook, res: import('express').Response) {
  if (!body?.transaction_nsu || typeof body.amount !== 'number') {
    res.status(400).json({ error: 'payload inválido' });
    return;
  }
  // Responde rápido (a InfinitePay pede < 1s); a confirmação roda em seguida
  res.json({ received: true });
  try {
    if (config.infinitepay.verifyWebhook && !(await verifyPayment(body))) {
      console.warn(`[infinitepay] webhook ${body.transaction_nsu} NÃO confirmado em payment_check – ignorado`);
      return;
    }
    const { isNew } = recordWebhook(body);
    if (isNew) invalidate();
  } catch (err) {
    console.error('[infinitepay] erro ao processar webhook', err);
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
