import fs from 'node:fs';
import path from 'node:path';
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import { config } from './config.js';
import { DATA_DIR } from './util.js';

/**
 * Persistência do painel. Com SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY tudo vai para o Postgres
 * do Supabase, no schema próprio "dashboard_financeiro" (ver supabase/migrations):
 *   - vendas da InfinitePay recebidas por webhook (a InfinitePay não tem API de extrato)
 *   - cobranças e configuração do checkout
 *   - cache das APIs externas (o Asaas tem cota de 25 mil requisições a cada 12h)
 *   - contador de versão, que faz todas as instâncias descartarem o cache após um webhook
 * Sem Supabase (só em desenvolvimento): arquivos JSON em server/data e cache em memória.
 */
export interface Store<T extends { id: string }> {
  /** Retorna false se o item já existia (webhooks podem chegar repetidos) */
  insert(item: T): Promise<boolean>;
  /** Grava (cria ou substitui) */
  put(item: T): Promise<void>;
  get(id: string): Promise<T | undefined>;
  all(): Promise<T[]>;
  /** Contador incrementado a cada webhook; muda o cache de todas as instâncias */
  version(): Promise<number>;
  bump(): Promise<void>;
}

export const useSupabase = () => !!(config.supabase.url && config.supabase.serviceKey);
export const storeKind = () => (useSupabase() ? `supabase (${config.supabase.schema})` : 'arquivo local');

// o schema é dinâmico (sem tipos gerados); as linhas são sempre { id/key, data/value }
let client: SupabaseClient<any, string, string> | null = null;
function db() {
  if (!client) {
    client = createClient(config.supabase.url, config.supabase.serviceKey, {
      db: { schema: config.supabase.schema },
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/**
 * Cliente "em nome do usuário": chave anon + token de quem está logado. As consultas feitas com ele
 * passam pelo RLS do banco (políticas em supabase/migrations/20261022020000_auth_rls.sql).
 */
export function userClient(accessToken: string): SupabaseClient<any, string, string> {
  return createClient(config.supabase.url, config.supabase.anonKey, {
    db: { schema: config.supabase.schema },
    global: { headers: { Authorization: `Bearer ${accessToken}` } },
    auth: { persistSession: false, autoRefreshToken: false },
  });
}

/** Cliente de autenticação (login, renovação de sessão, validação de token) com a chave anon */
let authOnly: SupabaseClient | null = null;
export function authClient(): SupabaseClient {
  authOnly ??= createClient(config.supabase.url, config.supabase.anonKey, { auth: { persistSession: false, autoRefreshToken: false } });
  return authOnly;
}

function fail(op: string, error: { message: string; code?: string } | null): never {
  const hint =
    error?.code === 'PGRST106' || /schema/i.test(error?.message ?? '')
      ? ` – o schema "${config.supabase.schema}" foi criado e adicionado em Project Settings > Data API > Exposed schemas?`
      : error?.code === '42P01'
        ? ' – rode o SQL de supabase/migrations no SQL Editor'
        : '';
  throw new Error(`Supabase (${op}): ${error?.message ?? 'erro desconhecido'}${hint}`);
}

/** Nome da tabela de cada coleção */
const TABLES: Record<string, string> = {
  infinitepay: 'infinitepay_sales',
  'checkout-charges': 'checkout_charges',
  'checkout-config': 'checkout_config',
  collaborators: 'collaborators',
  'collaborator-pay': 'collaborator_pay',
  'webhook-log': 'webhook_log',
  'gmail-accounts': 'gmail_accounts',
  'gmail-messages': 'gmail_messages',
};

class SupabaseStore<T extends { id: string }> implements Store<T> {
  /** client padrão = service_role (servidor); com userClient() as consultas obedecem ao RLS */
  constructor(private table: string, private client: SupabaseClient<any, string, string> = db()) {}

  async insert(item: T) {
    // insere só se o id ainda não existe – deduplicação atômica entre instâncias
    const { data, error } = await this.client
      .from(this.table)
      .upsert({ id: item.id, data: item }, { onConflict: 'id', ignoreDuplicates: true })
      .select('id');
    if (error) fail(`inserir em ${this.table}`, error);
    return (data?.length ?? 0) > 0;
  }

  async put(item: T) {
    const { error } = await this.client
      .from(this.table)
      .upsert({ id: item.id, data: item, updated_at: new Date().toISOString() }, { onConflict: 'id' });
    if (error) fail(`gravar em ${this.table}`, error);
  }

  async get(id: string) {
    const { data, error } = await this.client.from(this.table).select('data').eq('id', id).maybeSingle();
    if (error) fail(`ler ${this.table}`, error);
    return (data?.data as T | undefined) ?? undefined;
  }

  async all() {
    // o Supabase devolve no máximo 1000 linhas por consulta: pagina
    const out: T[] = [];
    for (let from = 0; ; from += 1000) {
      const { data, error } = await this.client.from(this.table).select('data').order('id').range(from, from + 999);
      if (error) fail(`listar ${this.table}`, error);
      out.push(...(data ?? []).map((r) => r.data as T));
      if (!data || data.length < 1000) return out;
    }
  }

  async version() {
    const { data, error } = await db().from('counters').select('value').eq('key', 'dashboard_version').maybeSingle();
    if (error) fail('ler versão', error);
    return Number(data?.value ?? 0);
  }

  async bump() {
    const { error } = await db().rpc('bump_counter', { counter_key: 'dashboard_version' });
    if (error) fail('atualizar versão', error);
  }
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

  private save() {
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify([...this.items.values()], null, 2));
  }

  async insert(item: T) {
    if (this.items.has(item.id)) return false;
    this.items.set(item.id, item);
    this.save();
    return true;
  }

  async put(item: T) {
    this.items.set(item.id, item);
    this.save();
  }

  async get(id: string) {
    return this.items.get(id);
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

// em modo arquivo, uma instância por coleção (várias instâncias regravariam o arquivo umas das outras)
const fileStores = new Map<string, FileStore<{ id: string }>>();

export function createStore<T extends { id: string }>(name: string): Store<T> {
  const table = TABLES[name];
  if (!table) throw new Error(`Coleção desconhecida: ${name}`);
  if (useSupabase()) return new SupabaseStore<T>(table);
  if (!fileStores.has(name)) fileStores.set(name, new FileStore(name));
  return fileStores.get(name) as unknown as Store<T>;
}

/**
 * Coleção vista pelo usuário logado: com Supabase, cada leitura/gravação usa o token dele e o banco
 * aplica o RLS (vendedor só vê as próprias cobranças etc.). Sem Supabase (desenvolvimento), arquivo local.
 */
export function scopedStore<T extends { id: string }>(name: string, accessToken: string | undefined): Store<T> {
  if (!useSupabase() || !accessToken) return createStore<T>(name);
  return new SupabaseStore<T>(TABLES[name], userClient(accessToken));
}

// ---------------------------------------------------------------- cache compartilhado

const memoryCache = new Map<string, { expires: number; value: unknown }>();
const inflight = new Map<string, Promise<unknown>>();

async function readCache<T>(key: string): Promise<T | undefined> {
  if (!useSupabase()) {
    const hit = memoryCache.get(key);
    return hit && hit.expires > Date.now() ? (hit.value as T) : undefined;
  }
  const { data, error } = await db().from('cache').select('value').eq('key', key).gt('expires_at', new Date().toISOString()).maybeSingle();
  if (error) {
    console.warn('[cache] leitura falhou', key, error.message);
    return undefined;
  }
  return (data?.value as T | undefined) ?? undefined;
}

async function writeCache(key: string, value: unknown, ttlSec: number) {
  if (!useSupabase()) {
    memoryCache.set(key, { expires: Date.now() + ttlSec * 1000, value });
    return;
  }
  const now = Date.now();
  const { error } = await db()
    .from('cache')
    .upsert({ key, value, expires_at: new Date(now + ttlSec * 1000).toISOString(), updated_at: new Date(now).toISOString() }, { onConflict: 'key' });
  if (error) console.warn('[cache] gravação falhou', key, error.message);
  // faxina das entradas vencidas (versões antigas de cache após webhooks), no máximo 1x por minuto,
  // para a tabela não crescer e ocupar espaço do banco compartilhado
  if (now - lastCleanup > 60_000) {
    lastCleanup = now;
    await db().from('cache').delete().lt('expires_at', new Date(now - 5 * 60_000).toISOString());
  }
}
let lastCleanup = 0;

/** Lê do cache sem carregar nada (undefined se não houver) */
export function peek<T>(key: string): Promise<T | undefined> {
  return readCache<T>(key);
}

/**
 * Guarda o resultado de `load` por `ttlSec` segundos. Com Supabase o cache vale para todas as
 * instâncias (na Vercel cada instância nova começaria do zero); sem ele fica na memória do processo.
 * Usado para não estourar a cota de APIs externas (ex.: Asaas, 25 mil requisições a cada 12h).
 */
export async function remember<T>(key: string, ttlSec: number, load: () => Promise<T>): Promise<T> {
  const cached = await readCache<T>(key);
  if (cached !== undefined) return cached;
  // chamadas simultâneas para a mesma chave compartilham a mesma consulta
  const pending = inflight.get(key);
  if (pending) return pending as Promise<T>;
  const promise = load()
    .then(async (value) => {
      await writeCache(key, value, ttlSec);
      return value;
    })
    .finally(() => inflight.delete(key));
  inflight.set(key, promise);
  return promise;
}

/** Confere na inicialização se o banco está pronto (schema criado e exposto) e explica o que falta */
export async function checkStore(): Promise<string | null> {
  if (!useSupabase()) return null;
  const { error } = await db().from('counters').select('key').limit(1);
  if (!error) return null;
  return error.code === 'PGRST106'
    ? `schema "${config.supabase.schema}" não encontrado: rode supabase/migrations no SQL Editor e adicione-o em Project Settings > Data API > Exposed schemas`
    : `${error.code ?? ''} ${error.message}`.trim();
}
