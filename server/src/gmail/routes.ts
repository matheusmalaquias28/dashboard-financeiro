import crypto from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import { config } from '../config.js';
import { scopedStore } from '../store.js';
import { authUrl, encrypt, exchangeCode, forgetAccess, gmail, decrypt } from './google.js';
import { accounts, syncAccount, syncAll, type EmailItem, type EmailStatus, type GmailAccount } from './sync.js';

const STATE_COOKIE = 'df_gmail_state';

/** URL de retorno do Google: o mesmo endereço pelo qual o admin abriu o painel (local ou produção) */
function redirectUri(req: Request) {
  const proto = (req.header('x-forwarded-proto') ?? req.protocol).split(',')[0];
  const host = req.header('x-forwarded-host') ?? req.header('host');
  return `${proto}://${host}/api/gmail/callback`;
}

const configured = () => !!(config.gmail.clientId && config.gmail.clientSecret && config.gmail.tokenKey);
const publicAccount = (a: GmailAccount) => ({ ...a, refreshTokenEnc: undefined, labels: undefined, backfillPageToken: undefined });

export const gmailApi = Router();

gmailApi.get('/status', async (req, res) => {
  try {
    let list: GmailAccount[] = [];
    let tablesReady = true;
    try {
      list = (await accounts.all()).filter((a) => a.active);
    } catch (err) {
      if (!/Could not find the table|PGRST205|42P01/.test((err as Error).message)) throw err;
      tablesReady = false;
    }
    res.json({ configured: configured() && tablesReady, missing: { google: !(config.gmail.clientId && config.gmail.clientSecret), key: !config.gmail.tokenKey, tables: !tablesReady }, redirectUri: redirectUri(req), accounts: list.map(publicAccount) });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

gmailApi.get('/connect', (req, res) => {
  if (!configured()) {
    res.status(400).send('Configure GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET e GMAIL_TOKEN_KEY no servidor.');
    return;
  }
  const state = crypto.randomBytes(16).toString('base64url');
  const secure = req.secure || req.header('x-forwarded-proto') === 'https';
  res.append('Set-Cookie', `${STATE_COOKIE}=${state}; Path=/api/gmail; HttpOnly; SameSite=Lax; Max-Age=600${secure ? '; Secure' : ''}`);
  res.redirect(authUrl(redirectUri(req), state));
});

gmailApi.get('/callback', async (req: Request, res: Response) => {
  const back = (q: string) => res.redirect(`/#/emails?${q}`);
  try {
    const cookieState = /(?:^|;\s*)df_gmail_state=([^;]+)/.exec(req.header('cookie') ?? '')?.[1];
    if (req.query.error) return back(`gmail=erro&motivo=${encodeURIComponent(String(req.query.error))}`);
    if (!req.query.code || !cookieState || cookieState !== req.query.state) return back('gmail=erro&motivo=estado_invalido');

    const t = await exchangeCode(String(req.query.code), redirectUri(req));
    if (!t.refresh_token) return back('gmail=erro&motivo=sem_refresh_token');
    const profile = await gmail<{ emailAddress: string }>(t.access_token, '/profile');
    const email = profile.emailAddress.toLowerCase();
    const current = await accounts.get(email);
    forgetAccess(email);
    await accounts.put({
      ...(current ?? {}),
      id: email,
      email,
      refreshTokenEnc: encrypt(t.refresh_token),
      connectedAt: current?.connectedAt ?? new Date().toISOString(),
      active: true,
      needsReconnect: false,
      lastError: undefined,
    } as GmailAccount);
    back('gmail=conectado');
  } catch (err) {
    console.error('[gmail] falha ao conectar', err);
    back(`gmail=erro&motivo=${encodeURIComponent((err as Error).message.slice(0, 120))}`);
  }
});

gmailApi.post('/disconnect', async (req, res) => {
  const acc = await accounts.get(String(req.body?.email ?? ''));
  if (!acc) {
    res.status(404).json({ error: 'Conta não encontrada' });
    return;
  }
  // revoga no Google (melhor esforço) e apaga o token guardado
  if (acc.refreshTokenEnc) await fetch(`https://oauth2.googleapis.com/revoke?token=${encodeURIComponent(decrypt(acc.refreshTokenEnc))}`, { method: 'POST' }).catch(() => undefined);
  forgetAccess(acc.email);
  await accounts.put({ ...acc, active: false, refreshTokenEnc: '' });
  res.json({ ok: true });
});

gmailApi.post('/sync', async (req, res) => {
  try {
    const email = typeof req.body?.email === 'string' ? req.body.email : undefined;
    const list = (await accounts.all()).filter((a) => a.active && a.refreshTokenEnc && (!email || a.email === email));
    const results = [];
    for (const a of list) results.push(await syncAccount(a, { timeBudgetMs: 120_000 }));
    res.json({ results });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** E-mails financeiros (e suspeitos) – lidos com o token do usuário, sob o RLS (só admin) */
gmailApi.get('/messages', async (req, res) => {
  try {
    let all: EmailItem[];
    try {
      all = await scopedStore<EmailItem>('gmail-messages', req.accessToken).all();
    } catch (err) {
      // tabelas do agente ainda não criadas: a aba mostra o passo que falta em vez de um erro
      if (/Could not find the table|PGRST205|42P01/.test((err as Error).message)) {
        res.json({ items: [], totals: { read: 0, financial: 0, pending: 0 }, setup: 'migration' });
        return;
      }
      throw err;
    }
    const items = all.filter((m) => m.category !== 'outro' || m.suspicious || m.pending).sort((a, b) => b.receivedAt.localeCompare(a.receivedAt));
    res.json({ items, totals: { read: all.length, financial: items.length, pending: all.filter((m) => m.pending).length } });
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

const STATUSES: EmailStatus[] = ['novo', 'pago', 'conferido', 'ignorado', 'golpe', 'legitimo'];

gmailApi.patch('/messages/:id', async (req, res) => {
  try {
    const status = req.body?.status as EmailStatus;
    if (!STATUSES.includes(status)) {
      res.status(400).json({ error: 'Status inválido' });
      return;
    }
    const store = scopedStore<EmailItem>('gmail-messages', req.accessToken);
    const item = await store.get(String(req.params.id));
    if (!item) {
      res.status(404).json({ error: 'E-mail não encontrado' });
      return;
    }
    // "não é golpe" tira a marca de suspeito; "é golpe" coloca
    const next: EmailItem = { ...item, status, suspicious: status === 'legitimo' ? false : status === 'golpe' ? true : item.suspicious };
    await store.put(next);
    res.json(next);
  } catch (err) {
    res.status(500).json({ error: (err as Error).message });
  }
});

/** Agendamento (Vercel Cron chama com Authorization: Bearer CRON_SECRET) – fora do login */
export async function gmailCron(req: Request, res: Response) {
  const secret = config.cronSecret;
  if (!secret || req.header('authorization') !== `Bearer ${secret}`) {
    res.status(401).json({ error: 'não autorizado' });
    return;
  }
  res.json({ results: await syncAll({ timeBudgetMs: 240_000 }) });
}
