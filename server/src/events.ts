import type { Response } from 'express';
import type { Transaction } from './types.js';

export type LiveEvent =
  | { type: 'transaction'; transaction: Transaction }
  | { type: 'refresh'; source: string; reason: string };

const clients = new Set<Response>();

/** Server-Sent Events: o navegador mantém uma conexão aberta e recebe cada pagamento na hora. */
export function subscribe(res: Response) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });
  res.write(`event: hello\ndata: {}\n\n`);
  clients.add(res);
  const ping = setInterval(() => res.write(`: ping\n\n`), 25_000);
  res.on('close', () => {
    clearInterval(ping);
    clients.delete(res);
  });
}

export function broadcast(event: LiveEvent) {
  const payload = `event: ${event.type}\ndata: ${JSON.stringify(event)}\n\n`;
  for (const res of clients) res.write(payload);
}
