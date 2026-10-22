import type { SourceData, Window } from '../types.js';
import { addMonths, endOfMonth, startOfMonth, today, TtlCache } from '../util.js';
import { asaas } from './asaas.js';
import { infinitepay, store } from './infinitepay.js';
import { inter } from './inter.js';
import { cresol, sicoob } from './pending.js';

/** A ordem aqui define a ordem (e a cor) de cada fonte no painel */
export const connectors = [asaas, infinitepay, inter, sicoob, cresol];

const cache = new TtlCache<SourceData[]>(5 * 60_000);

/** Janela fixa: 12 meses para trás (histórico) até o fim do mês seguinte (projeção) */
export function dataWindow(): Window {
  const now = today();
  return { from: startOfMonth(addMonths(now, -12)), to: endOfMonth(addMonths(now, 1)) };
}

export async function loadAll(): Promise<SourceData[]> {
  const window = dataWindow();
  // a versão muda a cada webhook; com o banco isso vale para todas as instâncias
  const version = await store.version().catch(() => 0);
  return cache.get(`${window.from}:${window.to}:${version}`, () => Promise.all(connectors.map((c) => c.load(window, { version }))));
}

export function invalidate() {
  cache.clear();
}
