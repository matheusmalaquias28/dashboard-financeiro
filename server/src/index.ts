import fs from 'node:fs';
import path from 'node:path';
import express from 'express';
import { login, logout, requireAdmin, requireAuth, session } from './auth.js';
import { agent } from './agent.js';
import { checkout } from './checkout.js';
import { collaboratorsApi, collaboratorsWebhook } from './collaborators.js';
import { gmailApi, gmailCron } from './gmail/routes.js';
import { syncAll } from './gmail/sync.js';
import { config } from './config.js';
import { connectors, dataWindow, invalidate, loadAll } from './connectors/index.js';
import { salesSince, startDemoTicker, store } from './connectors/infinitepay.js';
import { subscribe } from './events.js';
import { webhooks } from './routes/webhooks.js';
import { checkStore, storeKind } from './store.js';
import { ROOT_DIR, today } from './util.js';

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', true);
app.use(express.json({ limit: '1mb' }));

// Webhooks ficam fora do login (cada um valida seu próprio token)
app.use('/webhooks/colaboradores', collaboratorsWebhook);
app.use('/webhooks', webhooks);

// Rotas públicas da API
app.get('/api/health', (_req, res) => {
  res.json({ ok: true, today: today() });
});
app.get('/api/session', session);
app.post('/api/login', login);
app.post('/api/logout', logout);

// Tarefa agendada do agente de e-mails (autenticada pelo CRON_SECRET, não pelo login)
app.get('/api/gmail/cron', gmailCron);

// Daqui para baixo, só com sessão válida
app.use('/api', requireAuth);

// Checkout: vendedores e administrador (cada vendedor só vê as próprias cobranças)
app.use('/api/checkout', checkout);

// Agente (OpenAI): todos os usuários logados; o contexto depende do papel
app.use('/api/agent', agent);

// Agente de e-mails (Gmail): só o administrador
app.use('/api/gmail', requireAdmin, gmailApi);

// Colaboradores (remuneração): só o administrador
app.use('/api/colaboradores', requireAdmin, collaboratorsApi);

// Painel financeiro: só o administrador
app.use(['/api/dashboard', '/api/refresh', '/api/stream', '/api/live'], requireAdmin);

app.get('/api/dashboard', async (_req, res) => {
  try {
    const data = await loadAll();
    res.json({
      generatedAt: new Date().toISOString(),
      today: today(),
      window: dataWindow(),
      liveMode: config.liveMode,
      version: await store.version().catch(() => 0),
      sources: data.map((d) => d.status),
      transactions: data.flatMap((d) => d.transactions),
      subscriptions: data.flatMap((d) => d.subscriptions),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: (err as Error).message });
  }
});

app.post('/api/refresh', (_req, res) => {
  invalidate();
  res.json({ ok: true });
});

// Tempo real em servidor próprio: conexão aberta (SSE)
app.get('/api/stream', (_req, res) => subscribe(res));

// Tempo real na Vercel: o painel pergunta a cada poucos segundos o que chegou desde a última vez
app.get('/api/live', async (req, res) => {
  try {
    const since = typeof req.query.since === 'string' ? req.query.since : new Date().toISOString();
    const [transactions, version] = await Promise.all([salesSince(since), store.version()]);
    res.json({ now: new Date().toISOString(), version, transactions });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

// Na Vercel o app vira uma função (export default abaixo) e o frontend é o serviço "web".
// Fora dela (VPS, npm start), este mesmo processo escuta a porta e entrega o frontend compilado.
if (!process.env.VERCEL) {
  const webDist = path.join(ROOT_DIR, 'web', 'dist');
  if (fs.existsSync(webDist)) {
    app.use(express.static(webDist));
    app.get('/{*path}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
  }

  app.listen(config.port, () => {
    console.log(`API em http://localhost:${config.port}`);
    console.log(`Fontes: ${connectors.map((c) => c.id).join(', ')} · modo demonstração: ${config.demoMode ? 'sim' : 'não'} · armazenamento: ${storeKind()}`);
    if (!config.supabase.anonKey) console.warn('Atenção: sem Supabase (SUPABASE_ANON_KEY) o painel abre sem login – só para desenvolvimento.');
    startDemoTicker();
    void checkStore().then((problem) => problem && console.error('[banco] ' + problem));
    // fora da Vercel, o próprio servidor confere o Gmail a cada 15 min
    setInterval(() => void syncAll().catch((err) => console.error('[gmail] sincronização falhou', err)), 15 * 60_000);
  });
}

export default app;
