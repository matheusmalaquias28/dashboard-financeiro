/**
 * Login só com senha (DASHBOARD_PASSWORD). Segurança básica inicial:
 * - a sessão é um cookie HttpOnly assinado com HMAC derivado da própria senha, sem estado no servidor
 *   (funciona com várias instâncias na Vercel). Trocar a senha encerra todas as sessões.
 * - sem DASHBOARD_PASSWORD o painel fica aberto (desenvolvimento).
 */
import crypto from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';

const COOKIE = 'dash_session';
const MAX_AGE_DAYS = 30;

const enabled = () => !!config.auth.password;

function sign(expires: number): string {
  return crypto.createHmac('sha256', `dashboard-session:${config.auth.password}`).update(String(expires)).digest('base64url');
}

function safeEqual(a: string, b: string) {
  const ha = crypto.createHash('sha256').update(a).digest();
  const hb = crypto.createHash('sha256').update(b).digest();
  return crypto.timingSafeEqual(ha, hb);
}

function readCookie(req: Request): string | undefined {
  const header = req.header('cookie') ?? '';
  for (const part of header.split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === COOKIE) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

export function isAuthenticated(req: Request): boolean {
  if (!enabled()) return true;
  const [exp, mac] = (readCookie(req) ?? '').split('.');
  const expires = Number(exp);
  if (!expires || !mac || expires < Date.now()) return false;
  return safeEqual(mac, sign(expires));
}

function setCookie(req: Request, res: Response, value: string, maxAgeSec: number) {
  const secure = req.secure || req.header('x-forwarded-proto') === 'https';
  res.append(
    'Set-Cookie',
    `${COOKIE}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`,
  );
}

export async function login(req: Request, res: Response) {
  if (!enabled()) {
    res.json({ authenticated: true });
    return;
  }
  const password = typeof req.body?.password === 'string' ? req.body.password : '';
  if (!safeEqual(password, config.auth.password)) {
    // atraso fixo para desencorajar tentativa e erro
    await new Promise((r) => setTimeout(r, 800));
    res.status(401).json({ error: 'Senha incorreta' });
    return;
  }
  const expires = Date.now() + MAX_AGE_DAYS * 86_400_000;
  setCookie(req, res, `${expires}.${sign(expires)}`, MAX_AGE_DAYS * 86_400);
  res.json({ authenticated: true });
}

export function logout(req: Request, res: Response) {
  setCookie(req, res, '', 0);
  res.json({ authenticated: false });
}

export function session(req: Request, res: Response) {
  res.json({ authenticated: isAuthenticated(req), required: enabled() });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (isAuthenticated(req)) return next();
  res.status(401).json({ error: 'Não autenticado' });
}
