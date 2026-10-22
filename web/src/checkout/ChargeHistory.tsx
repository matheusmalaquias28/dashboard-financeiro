import { Check, Copy, ExternalLink, FlaskConical, MessageCircle, Search } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Segmented, Select } from '../components/controls';
import { Card } from '../components/ui';
import { cents } from './math';
import type { Charge } from './types';

export function whatsappLink(c: Charge): string {
  const text = `Olá, ${c.customer.name.split(' ')[0]}! Segue o link para pagamento de ${cents(c.total)} (Pix ou cartão em até 12x): ${c.url}`;
  const phone = c.customer.phone?.replace(/\D/g, '');
  return `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(text)}`;
}

export function CopyButton({ text, label = 'Copiar link' }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        void navigator.clipboard?.writeText(text).then(() => {
          setDone(true);
          setTimeout(() => setDone(false), 1500);
        });
      }}
      className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] text-ink-2 hover:bg-surface-2"
      title={label}
    >
      {done ? <Check size={14} className="text-good-ink" /> : <Copy size={14} />}
      <span className="hidden sm:inline">{done ? 'Copiado' : label}</span>
    </button>
  );
}

const METHOD: Record<string, string> = { pix: 'Pix', credit_card: 'Cartão' };

export function ChargeHistory({ charges, isAdmin, sellers, mock, onSimulate }: {
  charges: Charge[];
  isAdmin: boolean;
  sellers?: string[];
  mock: boolean;
  onSimulate: (c: Charge) => void;
}) {
  const [q, setQ] = useState('');
  const [status, setStatus] = useState<'all' | 'pending' | 'paid'>('all');
  const [seller, setSeller] = useState('all');

  const sellerOptions = useMemo(() => [...new Set([...(sellers ?? []), ...charges.map((c) => c.seller)])].sort(), [sellers, charges]);
  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return charges.filter(
      (c) =>
        (status === 'all' || c.status === status) &&
        (seller === 'all' || c.seller === seller) &&
        (!term || `${c.customer.name} ${c.customer.email ?? ''} ${c.items.map((i) => i.description).join(' ')} ${c.id}`.toLowerCase().includes(term)),
    );
  }, [charges, q, status, seller]);

  return (
    <Card title={isAdmin ? 'Cobranças de todos os vendedores' : 'Minhas cobranças'} subtitle={`${rows.length} de ${charges.length} · o status muda sozinho quando o cliente paga`}>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <label className="relative min-w-[200px] flex-1">
          <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Buscar cliente ou produto"
            className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-[13px] text-ink outline-none placeholder:text-muted focus:border-[var(--accent-text)]"
          />
        </label>
        <Segmented ariaLabel="Status" value={status} onChange={setStatus} options={[{ value: 'all', label: 'Todas' }, { value: 'pending', label: 'Aguardando' }, { value: 'paid', label: 'Pagas' }]} />
        {isAdmin && (
          <Select
            ariaLabel="Vendedor"
            value={seller}
            onChange={setSeller}
            className="w-[210px]"
            buttonClassName="!rounded-full"
            align="right"
            options={[{ value: 'all', label: 'Todos os vendedores' }, ...sellerOptions.map((s) => ({ value: s, label: s }))]}
          />
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full min-w-[760px] text-[13px]">
          <thead>
            <tr className="border-b border-line text-left text-[12px] text-muted">
              <th className="py-2 pr-3 font-medium">Criada</th>
              <th className="py-2 pr-3 font-medium">Cliente / produtos</th>
              {isAdmin && <th className="py-2 pr-3 font-medium">Vendedor</th>}
              <th className="py-2 pr-3 font-medium">Taxa</th>
              <th className="py-2 pr-3 text-right font-medium">Valor</th>
              <th className="py-2 pr-3 text-right font-medium">Empresa recebe</th>
              <th className="py-2 pr-3 font-medium">Status</th>
              <th className="py-2 text-right font-medium">Link</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="border-b border-line align-top last:border-0">
                <td className="tabular whitespace-nowrap py-2.5 pr-3 text-ink-2">
                  {new Date(c.createdAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                </td>
                <td className="max-w-[260px] py-2.5 pr-3">
                  <span className="block truncate text-ink">{c.customer.name}</span>
                  <span className="block truncate text-[12px] text-muted">{c.items.map((i) => (i.quantity > 1 ? `${i.quantity}× ${i.description}` : i.description)).join(', ')}</span>
                  {c.note && <span className="block truncate text-[12px] italic text-muted">{c.note}</span>}
                </td>
                {isAdmin && <td className="whitespace-nowrap py-2.5 pr-3 text-ink-2">{c.seller}</td>}
                <td className="whitespace-nowrap py-2.5 pr-3 text-[12px] text-ink-2">{c.feeMode === 'customer' ? `Cliente (até ${c.feeRefInstallments}x)` : 'Empresa'}</td>
                <td className="tabular whitespace-nowrap py-2.5 pr-3 text-right font-medium text-ink">{cents(c.total)}</td>
                <td className="tabular whitespace-nowrap py-2.5 pr-3 text-right">
                  {c.paid ? (
                    <span className="font-medium text-good-ink">{cents(c.paid.net)}</span>
                  ) : (
                    <span className="text-muted" title="Estimativa – o valor real depende da forma de pagamento">≈ {cents(c.estimatedNet)}</span>
                  )}
                </td>
                <td className="whitespace-nowrap py-2.5 pr-3">
                  {c.status === 'paid' ? (
                    <span className="inline-flex flex-col">
                      <span className="inline-flex items-center gap-1 rounded-full bg-[color-mix(in_oklab,var(--good)_14%,transparent)] px-2 py-0.5 text-[12px] font-medium text-good-ink">
                        <span aria-hidden className="size-1.5 rounded-full bg-current" /> Pago
                      </span>
                      <span className="mt-0.5 text-[11px] text-muted">
                        {METHOD[c.paid!.method] ?? c.paid!.method}
                        {c.paid!.installments > 1 ? ` ${c.paid!.installments}x` : ''} ·{' '}
                        {new Date(c.paidAt!).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                      </span>
                    </span>
                  ) : (
                    <span className="inline-flex items-center gap-1 rounded-full bg-surface-2 px-2 py-0.5 text-[12px] font-medium text-ink-2">
                      <span aria-hidden className="size-1.5 rounded-full bg-current" /> Aguardando
                    </span>
                  )}
                </td>
                <td className="py-2.5">
                  <div className="flex justify-end gap-1">
                    {c.status === 'pending' && <CopyButton text={c.url} label="Copiar" />}
                    {c.status === 'pending' && (
                      <a href={whatsappLink(c)} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-lg border border-line text-ink-2 hover:bg-surface-2" title="Enviar no WhatsApp">
                        <MessageCircle size={14} />
                      </a>
                    )}
                    {c.paid?.receiptUrl && (
                      <a href={c.paid.receiptUrl} target="_blank" rel="noreferrer" className="grid size-8 place-items-center rounded-lg border border-line text-ink-2 hover:bg-surface-2" title="Comprovante">
                        <ExternalLink size={14} />
                      </a>
                    )}
                    {mock && c.mock && c.status === 'pending' && (
                      <button type="button" onClick={() => onSimulate(c)} className="grid size-8 place-items-center rounded-lg border border-dashed border-line text-ink-2 hover:bg-surface-2" title="Simular pagamento (modo de teste)">
                        <FlaskConical size={14} />
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr><td colSpan={isAdmin ? 8 : 7} className="py-8 text-center text-muted">Nenhuma cobrança por aqui ainda.</td></tr>
            )}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
