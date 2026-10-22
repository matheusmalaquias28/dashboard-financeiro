/**
 * Google OAuth + API do Gmail via REST (sem SDK).
 * Escopo gmail.modify: ler e aplicar etiquetas (o painel nunca apaga nem envia e-mails).
 * O refresh token é guardado criptografado (AES-256-GCM) com GMAIL_TOKEN_KEY.
 *
 * Gmail pessoal com o app em modo "Teste" no Google Cloud: o Google invalida o refresh token
 * a cada 7 dias – o painel avisa e basta reconectar. Publicar/verificar o app remove esse limite.
 */
import crypto from 'node:crypto';
import { config } from '../config.js';
import { HttpError } from '../util.js';

export const SCOPES = ['https://www.googleapis.com/auth/gmail.modify', 'openid', 'email'];
const GMAIL = 'https://gmail.googleapis.com/gmail/v1/users/me';

// ---------------------------------------------------------------- criptografia do token

function key(): Buffer {
  if (!config.gmail.tokenKey) throw new Error('Defina GMAIL_TOKEN_KEY no servidor');
  return crypto.createHash('sha256').update(config.gmail.tokenKey).digest();
}

export function encrypt(plain: string): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', key(), iv);
  const enc = Buffer.concat([cipher.update(plain, 'utf8'), cipher.final()]);
  return [iv, cipher.getAuthTag(), enc].map((b) => b.toString('base64url')).join('.');
}

export function decrypt(payload: string): string {
  const [iv, tag, enc] = payload.split('.').map((p) => Buffer.from(p, 'base64url'));
  const decipher = crypto.createDecipheriv('aes-256-gcm', key(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString('utf8');
}

// ---------------------------------------------------------------- OAuth

export function authUrl(redirectUri: string, state: string): string {
  const u = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  u.searchParams.set('client_id', config.gmail.clientId);
  u.searchParams.set('redirect_uri', redirectUri);
  u.searchParams.set('response_type', 'code');
  u.searchParams.set('scope', SCOPES.join(' '));
  u.searchParams.set('access_type', 'offline');
  u.searchParams.set('prompt', 'consent'); // garante o refresh token a cada conexão
  u.searchParams.set('include_granted_scopes', 'true');
  u.searchParams.set('state', state);
  return u.toString();
}

async function tokenRequest(params: Record<string, string>) {
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ client_id: config.gmail.clientId, client_secret: config.gmail.clientSecret, ...params }),
    signal: AbortSignal.timeout(15_000),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (!res.ok) throw new HttpError(res.status, String(body.error_description ?? body.error ?? `HTTP ${res.status}`), JSON.stringify(body));
  return body as { access_token: string; expires_in: number; refresh_token?: string; scope?: string; id_token?: string };
}

export const exchangeCode = (code: string, redirectUri: string) => tokenRequest({ code, redirect_uri: redirectUri, grant_type: 'authorization_code' });

/** access token em cache por conta; renova com o refresh token quando vence */
const accessCache = new Map<string, { token: string; expires: number }>();

export class ReconnectRequired extends Error {}

export async function accessToken(account: string, refreshTokenEnc: string): Promise<string> {
  const hit = accessCache.get(account);
  if (hit && hit.expires > Date.now() + 60_000) return hit.token;
  try {
    const t = await tokenRequest({ refresh_token: decrypt(refreshTokenEnc), grant_type: 'refresh_token' });
    accessCache.set(account, { token: t.access_token, expires: Date.now() + t.expires_in * 1000 });
    return t.access_token;
  } catch (err) {
    // invalid_grant = token revogado ou vencido (limite de 7 dias do modo Teste)
    if (err instanceof HttpError && (err.status === 400 || err.status === 401)) throw new ReconnectRequired('A conexão com o Gmail expirou. Reconecte a conta.');
    throw err;
  }
}

export function forgetAccess(account: string) {
  accessCache.delete(account);
}

// ---------------------------------------------------------------- API do Gmail

export async function gmail<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(GMAIL + path, {
      ...init,
      headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(30_000),
    });
    // limite de uso por usuário: espera e tenta de novo
    if (res.status === 429 || res.status === 503) {
      await new Promise((r) => setTimeout(r, 1000 * 2 ** attempt));
      continue;
    }
    const text = await res.text();
    if (res.status === 401) throw new ReconnectRequired('A conexão com o Gmail expirou. Reconecte a conta.');
    if (!res.ok) throw new HttpError(res.status, `Gmail ${res.status} em ${path.split('?')[0]}`, text.slice(0, 400));
    return (text ? JSON.parse(text) : {}) as T;
  }
  throw new HttpError(429, 'Gmail: limite de requisições, tente mais tarde');
}

export interface GmailMessage {
  id: string;
  threadId: string;
  labelIds?: string[];
  snippet?: string;
  internalDate?: string;
  payload?: GmailPart;
}

export interface GmailPart {
  mimeType?: string;
  filename?: string;
  headers?: Array<{ name: string; value: string }>;
  body?: { size?: number; data?: string; attachmentId?: string };
  parts?: GmailPart[];
}

const decodeB64 = (s: string) => Buffer.from(s.replace(/-/g, '+').replace(/_/g, '/'), 'base64').toString('utf8');

function htmlToText(html: string): string {
  return html
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>|<\/(p|div|tr|li|h\d)>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/[ \t]+/g, ' ')
    .replace(/\n\s*\n+/g, '\n')
    .trim();
}

/** Texto, links e anexos de uma mensagem (prefere text/plain; senão converte o HTML) */
export function readMessage(m: GmailMessage) {
  const headers = new Map<string, string>();
  for (const h of m.payload?.headers ?? []) {
    const k = h.name.toLowerCase();
    headers.set(k, headers.has(k) ? `${headers.get(k)}\n${h.value}` : h.value);
  }
  let plain = '';
  let html = '';
  const attachments: string[] = [];
  const walk = (p?: GmailPart) => {
    if (!p) return;
    if (p.filename) attachments.push(p.filename);
    else if (p.body?.data && p.mimeType === 'text/plain') plain += decodeB64(p.body.data) + '\n';
    else if (p.body?.data && p.mimeType === 'text/html') html += decodeB64(p.body.data) + '\n';
    p.parts?.forEach(walk);
  };
  walk(m.payload);
  const links = [...new Set([...(html + plain).matchAll(/https?:\/\/[^\s"'<>)]+/gi)].map((x) => x[0]))].slice(0, 40);
  return {
    from: headers.get('from') ?? '',
    replyTo: headers.get('reply-to') ?? '',
    to: headers.get('to') ?? '',
    subject: headers.get('subject') ?? '(sem assunto)',
    date: headers.get('date') ?? '',
    authResults: headers.get('authentication-results') ?? headers.get('arc-authentication-results') ?? '',
    text: (plain.trim() || htmlToText(html)).slice(0, 20_000),
    links,
    attachments,
  };
}

export async function ensureLabels(token: string): Promise<Record<'cobranca' | 'recebimento' | 'suspeito' | 'nota', string>> {
  const wanted = { cobranca: 'Dashboard/Cobrança', recebimento: 'Dashboard/Recebimento', suspeito: 'Dashboard/Suspeito', nota: 'Dashboard/Nota fiscal' } as const;
  const { labels = [] } = await gmail<{ labels?: Array<{ id: string; name: string }> }>(token, '/labels');
  const out = {} as Record<keyof typeof wanted, string>;
  for (const [k, name] of Object.entries(wanted) as Array<[keyof typeof wanted, string]>) {
    const found = labels.find((l) => l.name === name);
    out[k] = found
      ? found.id
      : (await gmail<{ id: string }>(token, '/labels', { method: 'POST', body: JSON.stringify({ name, labelListVisibility: 'labelShow', messageListVisibility: 'show' }) })).id;
  }
  return out;
}
