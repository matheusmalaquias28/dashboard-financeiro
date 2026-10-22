import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardData, Transaction } from '../types';

export type LiveState = 'connecting' | 'live' | 'offline';

const POLL_MS = 10_000;

/** Erro de sessão expirada/ausente – o App volta para a tela de login */
export class UnauthorizedError extends Error {}

const OFFLINE = 'Sem conexão com o servidor do painel. Verifique sua internet ou se o servidor está no ar e tente de novo.';

/** Mensagem legível para o usuário: troca o "Failed to fetch" do navegador por uma explicação */
export function friendlyError(err: unknown): string {
  if (err instanceof TypeError) return OFFLINE;
  return (err as Error)?.message || 'Algo deu errado. Tente de novo.';
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(path, { credentials: 'same-origin', ...init });
  } catch (err) {
    if ((err as Error).name === 'AbortError') throw err;
    throw new Error(OFFLINE);
  }
  if (res.status === 401) throw new UnauthorizedError('Sessão expirada');
  if (!res.ok) {
    const body = (await res.json().catch(() => null)) as { error?: string } | null;
    throw new Error(body?.error ?? `O servidor respondeu com erro ${res.status}. Tente de novo em instantes.`);
  }
  return res.json() as Promise<T>;
}

export function useDashboard(onUnauthorized: () => void) {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<LiveState>('connecting');
  /** ids que chegaram ao vivo nesta sessão (para destacar no feed) */
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const inflight = useRef<AbortController | null>(null);
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  const load = useCallback(async (force = false) => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    try {
      if (force) await api('/api/refresh', { method: 'POST', signal: ctrl.signal });
      setData(await api<DashboardData>('/api/dashboard', { signal: ctrl.signal }));
      setError(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) unauthorized.current();
      else if ((err as Error).name !== 'AbortError') setError((err as Error).message);
    } finally {
      if (inflight.current === ctrl) setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
    // atualização periódica de segurança, além do tempo real
    const timer = setInterval(() => void load(), 5 * 60_000);
    return () => clearInterval(timer);
  }, [load]);

  const addLive = useCallback((transaction: Transaction) => {
    setData((d) => (d && !d.transactions.some((t) => t.id === transaction.id) ? { ...d, transactions: [...d.transactions, transaction] } : d));
    setFreshIds((s) => new Set(s).add(transaction.id));
  }, []);

  const liveMode = data?.liveMode;
  const version = data?.version;

  // Servidor próprio: conexão aberta (SSE)
  useEffect(() => {
    if (liveMode !== 'sse') return;
    const es = new EventSource('/api/stream');
    es.addEventListener('hello', () => setLive('live'));
    es.addEventListener('transaction', (ev) => addLive((JSON.parse((ev as MessageEvent).data) as { transaction: Transaction }).transaction));
    es.addEventListener('refresh', () => void load());
    es.onerror = () => setLive(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    es.onopen = () => setLive('live');
    return () => es.close();
  }, [liveMode, load, addLive]);

  // Vercel: consulta /api/live a cada 10s; se a versão mudou (webhook do Asaas, nova venda), recarrega
  useEffect(() => {
    if (liveMode !== 'poll' || version == null) return;
    let since = new Date().toISOString();
    let stopped = false;
    const tick = async () => {
      if (document.hidden) return;
      try {
        const res = await api<{ now: string; version: number; transactions: Transaction[] }>(`/api/live?since=${encodeURIComponent(since)}`);
        if (stopped) return;
        since = res.now;
        res.transactions.forEach(addLive);
        setLive('live');
        if (res.version !== version) void load();
      } catch (err) {
        if (err instanceof UnauthorizedError) unauthorized.current();
        else setLive('connecting');
      }
    };
    void tick();
    const timer = setInterval(tick, POLL_MS);
    return () => {
      stopped = true;
      clearInterval(timer);
    };
  }, [liveMode, version, load, addLive]);

  return { data, error, loading, live, freshIds, reload: () => load(true) };
}
