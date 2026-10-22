/**
 * Login com Supabase Auth (e-mail + senha) e acesso controlado por dashboard_financeiro.members.
 *
 * - As contas são criadas só no painel do Supabase (Authentication > Users); o painel não tem cadastro.
 * - O Supabase Auth é compartilhado com outra aplicação: ter conta não basta, é preciso ser membro ativo
 *   ('admin' ou 'seller'). As mesmas regras valem no banco via RLS (migração 20261022020000_auth_rls.sql).
 * - A sessão fica em cookies HttpOnly (o navegador nunca vê os tokens); o token de acesso é renovado
 *   sozinho com o refresh token quando expira.
 * - Sem Supabase configurado (só em desenvolvimento) o painel abre como administrador.
 */
import { createClient } from '@supabase/supabase-js';
import type { NextFunction, Request, Response } from 'express';
import { config } from './config.js';
import { authClient, useSupabase, userClient } from './store.js';

export type Role = 'admin' | 'seller';
export interface User {
  id: string;
  email: string;
  role: Role;
  name: string;
}

declare module 'express-serve-static-core' {
  interface Request {
    user?: User;
    /** token do Supabase de quem está logado – usado para consultas sujeitas ao RLS */
    accessToken?: string;
  }
}

const ACCESS = 'df_access';
const REFRESH = 'df_refresh';
const REFRESH_DAYS = 30;
const DEV_USER: User = { id: 'dev', email: 'dev@local', role: 'admin', name: 'Desenvolvimento' };

class AuthError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

// ---------------------------------------------------------------- cookies

function readCookie(req: Request, name: string): string | undefined {
  for (const part of (req.header('cookie') ?? '').split(';')) {
    const [k, ...v] = part.trim().split('=');
    if (k === name) return decodeURIComponent(v.join('='));
  }
  return undefined;
}

function setCookie(req: Request, res: Response, name: string, value: string, maxAgeSec: number) {
  const secure = req.secure || req.header('x-forwarded-proto') === 'https';
  res.append('Set-Cookie', `${name}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAgeSec}${secure ? '; Secure' : ''}`);
}

function setSession(req: Request, res: Response, s: { access_token: string; refresh_token: string; expires_in?: number }) {
  setCookie(req, res, ACCESS, s.access_token, s.expires_in ?? 3600);
  setCookie(req, res, REFRESH, s.refresh_token, REFRESH_DAYS * 86_400);
}

function clearSession(req: Request, res: Response) {
  setCookie(req, res, ACCESS, '', 0);
  setCookie(req, res, REFRESH, '', 0);
}

// ---------------------------------------------------------------- membros

const memberCache = new Map<string, { at: number; member: Omit<User, 'id'> | null }>();

/** Lê o próprio registro de membro com o token do usuário (o RLS só deixa ver a própria linha) */
async function getMember(userId: string, accessToken: string): Promise<Omit<User, 'id'> | null> {
  const hit = memberCache.get(userId);
  if (hit && Date.now() - hit.at < 60_000) return hit.member;
  const { data, error } = await userClient(accessToken).from('members').select('email, name, role, active').eq('user_id', userId).maybeSingle();
  if (error) {
    if (error.code === 'PGRST205' || error.code === '42P01') throw new AuthError(503, 'Login ainda não configurado: rode a migração 20261022020000_auth_rls.sql no Supabase.');
    throw new AuthError(503, `Não foi possível verificar o acesso: ${error.message}`);
  }
  const member = data && data.active ? { email: String(data.email ?? ''), name: String(data.name), role: data.role as Role } : null;
  memberCache.set(userId, { at: Date.now(), member });
  return member;
}

// ---------------------------------------------------------------- sessão

/** Valida a sessão do request (renovando o token se preciso) e devolve o usuário, ou null */
async function resolve(req: Request, res: Response): Promise<{ user: User; accessToken?: string } | null> {
  if (!useSupabase()) return { user: DEV_USER };

  let access = readCookie(req, ACCESS);
  let userId: string | undefined;
  let email = '';

  if (access) {
    const { data, error } = await authClient().auth.getClaims(access);
    if (!error && data?.claims?.sub) {
      userId = String(data.claims.sub);
      email = String(data.claims.email ?? '');
    }
  }

  // token ausente ou vencido: tenta renovar com o refresh token
  if (!userId) {
    const refresh = readCookie(req, REFRESH);
    if (!refresh) return null;
    const { data, error } = await authClient().auth.refreshSession({ refresh_token: refresh });
    if (error || !data.session || !data.user) {
      clearSession(req, res);
      return null;
    }
    setSession(req, res, data.session);
    access = data.session.access_token;
    userId = data.user.id;
    email = data.user.email ?? '';
  }

  const member = await getMember(userId, access!);
  if (!member) return null;
  return { user: { id: userId, ...member, email: member.email || email }, accessToken: access };
}

export async function login(req: Request, res: Response) {
  try {
    if (!useSupabase()) {
      res.json({ authenticated: true, user: DEV_USER });
      return;
    }
    const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
    const password = typeof req.body?.password === 'string' ? req.body.password : '';
    if (!email || !password) throw new AuthError(400, 'Informe e-mail e senha.');

    const { data, error } = await authClient().auth.signInWithPassword({ email, password });
    if (error || !data.session || !data.user) {
      // atraso fixo para desencorajar tentativa e erro
      await new Promise((r) => setTimeout(r, 800));
      const msg = /confirm/i.test(error?.message ?? '') ? 'Confirme o e-mail desta conta no Supabase antes de entrar.' : 'E-mail ou senha incorretos.';
      throw new AuthError(401, msg);
    }
    memberCache.delete(data.user.id);
    const member = await getMember(data.user.id, data.session.access_token);
    if (!member) throw new AuthError(403, 'Sua conta não tem acesso a este painel. Peça ao administrador para liberar.');

    setSession(req, res, data.session);
    res.json({ authenticated: true, user: { id: data.user.id, ...member, email: member.email || email } });
  } catch (err) {
    const status = err instanceof AuthError ? err.status : 500;
    res.status(status).json({ error: err instanceof AuthError ? err.message : 'Falha ao entrar. Tente de novo.' });
  }
}

export async function logout(req: Request, res: Response) {
  const access = readCookie(req, ACCESS);
  if (access && useSupabase()) {
    // encerra a sessão no Supabase também (melhor esforço)
    const admin = createClient(config.supabase.url, config.supabase.serviceKey, { auth: { persistSession: false } });
    await admin.auth.admin.signOut(access).catch(() => undefined);
  }
  clearSession(req, res);
  res.json({ authenticated: false });
}

export async function session(req: Request, res: Response) {
  try {
    const r = await resolve(req, res);
    res.json({ authenticated: !!r, required: useSupabase(), user: r?.user ?? null });
  } catch (err) {
    res.status(err instanceof AuthError ? err.status : 500).json({ authenticated: false, required: true, user: null, error: (err as Error).message });
  }
}

export async function requireAuth(req: Request, res: Response, next: NextFunction) {
  try {
    const r = await resolve(req, res);
    if (!r) {
      res.status(401).json({ error: 'Não autenticado' });
      return;
    }
    req.user = r.user;
    req.accessToken = r.accessToken;
    next();
  } catch (err) {
    res.status(err instanceof AuthError ? err.status : 500).json({ error: (err as Error).message });
  }
}

export function requireAdmin(req: Request, res: Response, next: NextFunction) {
  if (req.user?.role === 'admin') return next();
  res.status(403).json({ error: 'Acesso restrito ao administrador' });
}
