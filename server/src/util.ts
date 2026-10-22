import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
export const DATA_DIR = path.join(ROOT_DIR, 'server', 'data');

/** Data local (America/Sao_Paulo) no formato YYYY-MM-DD */
export function today(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Sao_Paulo' }).format(new Date());
}

export function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function addMonths(iso: string, months: number): string {
  const [y, m, day] = iso.split('-').map(Number);
  const target = new Date(Date.UTC(y, m - 1 + months, 1, 12));
  const lastDay = new Date(Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0)).getUTCDate();
  target.setUTCDate(Math.min(day, lastDay));
  return target.toISOString().slice(0, 10);
}

export function startOfMonth(iso: string): string {
  return `${iso.slice(0, 7)}-01`;
}

export function endOfMonth(iso: string): string {
  const [y, m] = iso.split('-').map(Number);
  return new Date(Date.UTC(y, m, 0, 12)).toISOString().slice(0, 10);
}

/** Divide um intervalo em janelas de no máximo `days` dias (APIs com limite de período). */
export function chunkRange(from: string, to: string, days: number): Array<[string, string]> {
  const out: Array<[string, string]> = [];
  let cursor = from;
  while (cursor <= to) {
    const end = addDays(cursor, days - 1);
    out.push([cursor, end < to ? end : to]);
    cursor = addDays(end, 1);
  }
  return out;
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export class HttpError extends Error {
  constructor(public status: number, message: string, public body?: string) {
    super(message);
  }
}

/** fetch com timeout e erro descritivo */
export async function fetchJson<T>(url: string, init: RequestInit & { timeoutMs?: number; dispatcher?: unknown } = {}): Promise<T> {
  const { timeoutMs = 20_000, ...rest } = init;
  const res = await fetch(url, { ...rest, signal: AbortSignal.timeout(timeoutMs) } as RequestInit);
  const text = await res.text();
  if (!res.ok) throw new HttpError(res.status, `HTTP ${res.status} em ${new URL(url).pathname}`, text.slice(0, 500));
  return (text ? JSON.parse(text) : {}) as T;
}

/** Cache em memória com TTL e deduplicação de chamadas concorrentes */
export class TtlCache<T> {
  private entries = new Map<string, { at: number; value: Promise<T> }>();
  constructor(private ttlMs: number) {}

  get(key: string, load: () => Promise<T>): Promise<T> {
    const hit = this.entries.get(key);
    if (hit && Date.now() - hit.at < this.ttlMs) return hit.value;
    const value = load();
    this.entries.set(key, { at: Date.now(), value });
    value.catch(() => this.entries.delete(key));
    return value;
  }

  clear() {
    this.entries.clear();
  }
}
