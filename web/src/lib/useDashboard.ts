import { useCallback, useEffect, useRef, useState } from 'react';
import type { DashboardData, Transaction } from '../types';

export type LiveState = 'connecting' | 'live' | 'offline';

export function useDashboard() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [live, setLive] = useState<LiveState>('connecting');
  /** ids que chegaram ao vivo nesta sessão (para destacar no feed) */
  const [freshIds, setFreshIds] = useState<Set<string>>(new Set());
  const inflight = useRef<AbortController | null>(null);

  const load = useCallback(async (force = false) => {
    inflight.current?.abort();
    const ctrl = new AbortController();
    inflight.current = ctrl;
    setLoading(true);
    try {
      if (force) await fetch('/api/refresh', { method: 'POST', signal: ctrl.signal });
      const res = await fetch('/api/dashboard', { signal: ctrl.signal });
      if (!res.ok) throw new Error(`Erro ${res.status} ao carregar o painel`);
      setData(await res.json());
      setError(null);
    } catch (err) {
      if ((err as Error).name !== 'AbortError') setError((err as Error).message);
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

  useEffect(() => {
    const es = new EventSource('/api/stream');
    es.addEventListener('hello', () => setLive('live'));
    es.addEventListener('transaction', (ev) => {
      const { transaction } = JSON.parse((ev as MessageEvent).data) as { transaction: Transaction };
      setData((d) => (d && !d.transactions.some((t) => t.id === transaction.id) ? { ...d, transactions: [...d.transactions, transaction] } : d));
      setFreshIds((s) => new Set(s).add(transaction.id));
    });
    es.addEventListener('refresh', () => void load());
    es.onerror = () => setLive(es.readyState === EventSource.CLOSED ? 'offline' : 'connecting');
    es.onopen = () => setLive('live');
    return () => es.close();
  }, [load]);

  return { data, error, loading, live, freshIds, reload: () => load(true) };
}
