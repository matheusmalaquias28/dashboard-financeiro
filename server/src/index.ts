import fs from 'node:fs';
import path from 'node:path';
import express, { type NextFunction, type Request, type Response } from 'express';
import { config } from './config.js';
import { connectors, dataWindow, invalidate, loadAll } from './connectors/index.js';
import { startDemoTicker } from './connectors/infinitepay.js';
import { subscribe } from './events.js';
import { webhooks } from './routes/webhooks.js';
import { ROOT_DIR, today } from './util.js';

const app = express();
app.disable('x-powered-by');
app.use(express.json({ limit: '1mb' }));

// Webhooks ficam fora da autenticação (cada um valida seu próprio token)
app.use('/webhooks', webhooks);

function basicAuth(req: Request, res: Response, next: NextFunction) {
  const { user, password } = config.auth;
  if (!user || !password) return next();
  const [scheme, encoded] = (req.header('authorization') ?? '').split(' ');
  const decoded = scheme === 'Basic' && encoded ? Buffer.from(encoded, 'base64').toString() : '';
  const sep = decoded.indexOf(':');
  if (sep > 0 && decoded.slice(0, sep) === user && decoded.slice(sep + 1) === password) return next();
  res.set('WWW-Authenticate', 'Basic realm="Dashboard Financeiro"').status(401).send('Autenticação necessária');
}
app.use(basicAuth);

app.get('/api/health', (_req, res) => {
  res.json({ ok: true, today: today() });
});

app.get('/api/dashboard', async (_req, res) => {
  try {
    const data = await loadAll();
    res.json({
      generatedAt: new Date().toISOString(),
      today: today(),
      window: dataWindow(),
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

app.get('/api/stream', (_req, res) => subscribe(res));

// Em produção, o mesmo servidor entrega o frontend compilado (npm run build)
const webDist = path.join(ROOT_DIR, 'web', 'dist');
if (fs.existsSync(webDist)) {
  app.use(express.static(webDist));
  app.get('/{*path}', (_req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.listen(config.port, () => {
  console.log(`API em http://localhost:${config.port}`);
  console.log(`Fontes: ${connectors.map((c) => c.id).join(', ')} · modo demonstração: ${config.demoMode ? 'sim' : 'não'}`);
  if (!config.auth.user) console.warn('Atenção: DASHBOARD_USER/DASHBOARD_PASSWORD vazios – o painel está sem senha.');
  startDemoTicker();
});
