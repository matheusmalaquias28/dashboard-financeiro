import fs from 'node:fs';
import path from 'node:path';
import { DATA_DIR } from './util.js';

/**
 * Armazenamento simples em arquivo JSON para eventos que só chegam por webhook
 * (ex.: InfinitePay não tem API de extrato). Para alto volume, trocar por um banco.
 */
export class JsonStore<T extends { id: string }> {
  private items = new Map<string, T>();
  private file: string;

  constructor(name: string) {
    this.file = path.join(DATA_DIR, `${name}.json`);
    try {
      const raw = JSON.parse(fs.readFileSync(this.file, 'utf8')) as T[];
      for (const item of raw) this.items.set(item.id, item);
    } catch {
      // arquivo ainda não existe
    }
  }

  has(id: string) {
    return this.items.has(id);
  }

  /** Retorna false se o item já existia (webhooks podem chegar repetidos) */
  upsert(item: T): boolean {
    const isNew = !this.items.has(item.id);
    this.items.set(item.id, item);
    fs.mkdirSync(DATA_DIR, { recursive: true });
    fs.writeFileSync(this.file, JSON.stringify([...this.items.values()], null, 2));
    return isNew;
  }

  all(): T[] {
    return [...this.items.values()];
  }
}
