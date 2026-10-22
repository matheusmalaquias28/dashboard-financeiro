import fs from 'node:fs';
import path from 'node:path';
import { config } from './config.js';
import { DATA_DIR, fetchJson } from './util.js';

/**
 * Persistência dos eventos que só chegam por webhook (ex.: InfinitePay não tem API de extrato)
 * e de um contador de versão, que faz todas as instâncias descartarem o cache após um webhook.
 *
 * - Com UPSTASH_REDIS_REST_URL/TOKEN (ou KV_REST_API_URL/TOKEN, nomes da integração da Vercel):
 *   Redis da Upstash via REST – obrigatório na Vercel, onde não há disco e rodam várias instâncias.
 * - Sem eles: arquivo JSON em server/data (VPS / desenvolvimento local).
 */
export interface Store<T extends { id: string }> {
  /** Retorna false se o item já existia (webhooks podem chegar repetidos) */
  insert(item: T): Promise<boolean>;
  all(): Promise<T[]>;
  /** Contador incrementado a cada webhook; muda o cache de todas as instâncias */
  version(): Promise<number>;
  bump(): Promise<void>;
}

class FileStore<T extends { id: string }> implements Store<T> {
  private items = new Map<string, T>();
  private file: string;
  private ver = 0;

  constructor(name: string) {
    this.file = path.join(DATA_DIR, `${name}.json`);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as T[];
      for (const item of raw) this.items.set(item.id, item);
    } catch {
      // arquivo ainda não existe
    }
  }

  async insert(item: T) {
    if (this.items.has(item.id)) return false;
    this.items.set(item.id, item);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify([...this.items.values()], null, 2));
    return true;
  }

  async all() {
    return [...this.items.values()];
  }

  async version() {
    return this.ver;
  }

  async bump() {
    this.ver++;
  }
}

class RedisStore<T extends { id: string }> implements Store<T> {
  constructor(private key: string, private url: string, private token: string) {}

  private async command<R>(...args: Array<string | number>): Promise<R> {
    const res = await fetchJson<{ result: R; error?: string }>(this.url, {
      method: 'POST',
      headers: { authorization: `Bearer ${this.token}`, 'content-type': 'application/json' },
      body: JSON.stringify(args),
      timeoutMs: 5000,
    });
    if (res.error) throw new Error(`Redis: ${res.error}`);
    return res.result;
  }

  async insert(item: T) {
    // HSETNX grava só se o id ainda não existe – deduplicação atômica entre instâncias
    return (await this.command<number>('HSETNX', `${this.key}:items`, item.id, JSON.stringify(item))) === 1;
  }

  async all() {
    const values = await this.command<string[]>('HVALS', `${this.key}:items`);
    return values.map((v) => JSON.parse(v) as T);
  }

  async version() {
    return Number((await this.command<string | null>('GET', 'dashboard:version')) ?? 0);
  }

  async bump() {
    await this.command('INCR', 'dashboard:version');
  }
}

export function createStore<T extends { id: string }>(name: string): Store<T> {
  const { url, token } = config.redis;
  return url && token ? new RedisStore<T>(name, url, token) : new FileStore<T>(name);
}

export const storeKind = () => (config.redis.url && config.redis.token ? 'redis' : 'file');
