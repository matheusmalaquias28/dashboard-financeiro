import clsx from 'clsx';
import { AlertTriangle, Loader2, PackagePlus, Plus, Trash2 } from 'lucide-react';
import { useMemo, useState, type FormEvent } from 'react';
import { Select } from '../components/controls';
import { friendlyError } from '../lib/useDashboard';
import { Card } from '../components/ui';
import { cents, pct, priceCharge, simulate } from './math';
import { MoneyInput } from './MoneyInput';
import type { Charge, CheckoutConfig, FeeMode } from './types';

interface Row {
  key: number;
  productId?: string;
  description: string;
  quantity: number;
  unitPrice: number;
  listPrice?: number;
}

let rowKey = 0;
const emptyCustomer = { name: '', email: '', phone: '' };

export function ChargeForm({ config, onCreated }: { config: CheckoutConfig; onCreated: (c: Charge) => void }) {
  const products = config.products.filter((p) => p.active);
  const [customer, setCustomer] = useState(emptyCustomer);
  const [rows, setRows] = useState<Row[]>([]);
  const [feeMode, setFeeMode] = useState<FeeMode>('absorb');
  const [refInstallments, setRefInstallments] = useState(1);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const pricing = useMemo(() => priceCharge(rows, config.fees, feeMode, refInstallments), [rows, config.fees, feeMode, refInstallments]);
  const sim = useMemo(() => simulate(pricing.total, config.fees), [pricing.total, config.fees]);

  const addProduct = (id: string) => {
    const p = products.find((x) => x.id === id);
    if (p) setRows((r) => [...r, { key: ++rowKey, productId: p.id, description: p.name, quantity: 1, unitPrice: p.price, listPrice: p.price }]);
  };
  const addCustom = () => setRows((r) => [...r, { key: ++rowKey, description: '', quantity: 1, unitPrice: 0 }]);
  const update = (key: number, patch: Partial<Row>) => setRows((r) => r.map((x) => (x.key === key ? { ...x, ...patch } : x)));
  const remove = (key: number) => setRows((r) => r.filter((x) => x.key !== key));

  const canSubmit = !busy && customer.name.trim() && rows.length > 0 && rows.every((r) => r.description.trim() && r.unitPrice >= 100 && r.quantity >= 1);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!canSubmit) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/checkout/charges', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          customer,
          items: rows.map(({ productId, description, quantity, unitPrice }) => ({ productId, description, quantity, unitPrice })),
          feeMode,
          feeRefInstallments: refInstallments,
          note,
        }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`);
      onCreated(body as Charge);
      setCustomer(emptyCustomer);
      setRows([]);
      setNote('');
    } catch (err) {
      setError(friendlyError(err));
    } finally {
      setBusy(false);
    }
  };

  const input = 'h-11 w-full rounded-xl border border-line bg-surface px-3 text-[14px] text-ink outline-none placeholder:text-muted focus:border-[var(--accent-text)]';
  const label = 'mb-1 block text-[12px] font-medium text-ink-2';

  return (
    <form onSubmit={submit} className="grid grid-cols-1 gap-4 xl:grid-cols-[minmax(0,1fr)_380px]">
      <div className="flex min-w-0 flex-col gap-4">
        <Card title="Cliente">
          <div className="grid gap-3 sm:grid-cols-3">
            <div className="sm:col-span-3">
              <label htmlFor="c-name" className={label}>Nome *</label>
              <input id="c-name" className={input} value={customer.name} onChange={(e) => setCustomer({ ...customer, name: e.target.value })} placeholder="Nome ou empresa" autoComplete="off" />
            </div>
            <div className="sm:col-span-2">
              <label htmlFor="c-email" className={label}>E-mail</label>
              <input id="c-email" type="email" className={input} value={customer.email} onChange={(e) => setCustomer({ ...customer, email: e.target.value })} placeholder="cliente@empresa.com" autoComplete="off" />
            </div>
            <div>
              <label htmlFor="c-phone" className={label}>WhatsApp</label>
              <input id="c-phone" inputMode="tel" className={input} value={customer.phone} onChange={(e) => setCustomer({ ...customer, phone: e.target.value })} placeholder="(11) 99999-9999" autoComplete="off" />
            </div>
          </div>
        </Card>

        <Card
          title="Produtos"
          subtitle={products.length ? 'Escolha do catálogo ou adicione um item avulso. O valor pode ser ajustado.' : 'Nenhum produto no catálogo ainda – adicione um item avulso.'}
        >
          <div className="flex flex-col gap-3">
            {rows.map((r) => {
              const diff = r.listPrice ? (r.unitPrice - r.listPrice) / r.listPrice : 0;
              return (
                <div key={r.key} className="grid grid-cols-[minmax(0,1fr)_auto] gap-2 rounded-xl border border-line p-3 sm:grid-cols-[minmax(0,1fr)_80px_150px_auto] sm:items-end">
                  <div className="col-span-2 sm:col-span-1">
                    <label className={label}>Descrição</label>
                    <input className={input} value={r.description} onChange={(e) => update(r.key, { description: e.target.value })} placeholder="Ex.: Consultoria de marketing" maxLength={100} />
                  </div>
                  <div>
                    <label className={label}>Qtd.</label>
                    <input className={clsx(input, 'text-center')} inputMode="numeric" value={r.quantity} onChange={(e) => update(r.key, { quantity: Math.max(1, Math.min(999, Number(e.target.value.replace(/\D/g, '')) || 1)) })} />
                  </div>
                  <div>
                    <label className={label}>Valor unitário</label>
                    <MoneyInput value={r.unitPrice} onChange={(v) => update(r.key, { unitPrice: v })} ariaLabel="Valor unitário" />
                  </div>
                  <button type="button" onClick={() => remove(r.key)} className="grid size-10 place-items-center self-end rounded-lg text-muted hover:bg-surface-2 hover:text-critical-ink" aria-label="Remover item">
                    <Trash2 size={16} />
                  </button>
                  {r.listPrice != null && Math.abs(diff) > 0.0001 && (
                    <p className={clsx('col-span-2 text-[12px] sm:col-span-4', diff < 0 ? 'text-critical-ink' : 'text-good-ink')}>
                      {diff < 0 ? 'Desconto' : 'Acréscimo'} de {pct(Math.abs(diff * 100))} sobre o preço de tabela ({cents(r.listPrice)})
                    </p>
                  )}
                </div>
              );
            })}

            <div className="flex flex-wrap gap-2">
              {products.length > 0 && (
                <Select
                  ariaLabel="Adicionar produto do catálogo"
                  value={null}
                  onChange={addProduct}
                  placeholder={<span className="inline-flex items-center gap-1.5 text-ink"><PackagePlus size={15} /> Adicionar do catálogo</span>}
                  className="min-w-[240px] flex-1 sm:flex-none"
                  buttonClassName="!rounded-full"
                  options={products.map((p) => ({ value: p.id, label: p.name, text: p.name, hint: cents(p.price) }))}
                />
              )}
              <button type="button" onClick={addCustom} className="inline-flex h-10 items-center gap-1.5 rounded-full border border-dashed border-line-strong px-4 text-[13px] font-semibold text-ink-2 hover:text-ink">
                <Plus size={15} /> Item avulso
              </button>
            </div>
          </div>
        </Card>

        <Card title="Taxa do cartão" subtitle="Quem paga a taxa da InfinitePay nesta venda">
          <div className="grid gap-2 sm:grid-cols-2" role="radiogroup" aria-label="Quem paga a taxa">
            {([
              ['absorb', 'Empresa absorve', 'O cliente paga o valor dos produtos; a taxa sai do que a empresa recebe.'],
              ['customer', 'Cliente paga a taxa', 'Soma a taxa ao valor para a empresa receber o preço cheio.'],
            ] as const).map(([mode, title, desc]) => (
              <button
                key={mode}
                type="button"
                role="radio"
                aria-checked={feeMode === mode}
                onClick={() => setFeeMode(mode)}
                className={clsx('flex gap-3 rounded-2xl border p-4 text-left transition-colors', feeMode === mode ? 'border-[var(--accent-text)] bg-accent-soft' : 'border-line hover:border-line-strong')}
              >
                <span className={clsx('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full border-2', feeMode === mode ? 'border-[var(--accent-text)]' : 'border-line-strong')}>
                  {feeMode === mode && <span className="size-2.5 rounded-full bg-[var(--accent-text)]" />}
                </span>
                <span>
                  <span className="block text-[14px] font-bold text-ink">{title}</span>
                  <span className="mt-0.5 block text-[12px] text-muted">{desc}</span>
                </span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2 text-[13px] text-ink-2">
            <span>{feeMode === 'customer' ? 'Cobrir a taxa de pagamento em até' : 'Estimar o recebimento para pagamento em'}</span>
            <Select
              ariaLabel="Parcelas de referência"
              size="sm"
              value={refInstallments}
              onChange={setRefInstallments}
              className="w-[170px]"
              buttonClassName="!rounded-full"
              options={Array.from({ length: 12 }, (_, i) => i + 1).map((n) => ({ value: n, label: n === 1 ? '1x (à vista)' : `${n}x`, text: String(n), hint: pct(config.fees.cardRates[n - 1]) }))}
            />
          </div>
          {feeMode === 'customer' && (
            <p className="mt-2 text-[12px] text-muted">
              Entra no link como "Taxa de processamento do cartão". Se o cliente pagar no Pix ou em menos parcelas, a empresa recebe um pouco mais.
            </p>
          )}
          <div className="mt-4">
            <label htmlFor="note" className={label}>Observação interna (opcional)</label>
            <input id="note" className={input} value={note} onChange={(e) => setNote(e.target.value)} maxLength={300} placeholder="Ex.: fechado na reunião de 22/10" />
          </div>
        </Card>
      </div>

      {/* resumo fixo ao lado em telas largas */}
      <div className="flex min-w-0 flex-col gap-4 xl:sticky xl:top-4 xl:self-start">
        <Card title="Resumo">
          <dl className="tabular flex flex-col gap-2 text-[14px]">
            <div className="flex justify-between"><dt className="text-ink-2">Produtos</dt><dd className="text-ink">{cents(pricing.subtotal)}</dd></div>
            {feeMode === 'customer' && (
              <div className="flex justify-between"><dt className="text-ink-2">Taxa repassada ao cliente</dt><dd className="text-ink">+ {cents(pricing.surcharge)}</dd></div>
            )}
            <div className="flex justify-between border-t border-line pt-2 text-[16px] font-semibold"><dt className="text-ink">Valor do link</dt><dd className="text-ink">{cents(pricing.total)}</dd></div>
            <div className="flex justify-between"><dt className="text-ink-2">Taxa estimada ({refInstallments}x)</dt><dd className="text-critical-ink">− {cents(pricing.estimatedFee)}</dd></div>
            <div className="flex justify-between font-semibold"><dt className="text-ink">Empresa recebe</dt><dd className="text-good-ink">{cents(pricing.estimatedNet)}</dd></div>
          </dl>
          {!config.feesConfirmed && (
            <p className="mt-3 flex gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] p-2 text-[12px] text-ink-2">
              <AlertTriangle size={14} className="mt-0.5 shrink-0" /> Taxas de exemplo. O administrador precisa revisar as taxas reais da conta.
            </p>
          )}
          {error && <p role="alert" className="mt-3 text-[13px] text-critical-ink">{error}</p>}
          <button
            type="submit"
            disabled={!canSubmit}
            className="mt-4 inline-flex h-11 w-full items-center justify-center gap-2 rounded-lg bg-accent text-[14px] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {busy && <Loader2 size={16} className="animate-spin" />}
            {busy ? 'Gerando link…' : 'Gerar link de pagamento'}
          </button>
        </Card>

        <Card title="Simulador" subtitle="O cliente escolhe a forma de pagamento no checkout" bodyClassName="!px-0 !pb-2">
          {pricing.total === 0 ? (
            <p className="px-5 pb-4 text-[13px] text-muted">Adicione produtos para ver quanto a empresa recebe em cada forma de pagamento.</p>
          ) : (
          <div className="max-h-[360px] overflow-auto">
            <table className="tabular w-full text-[12px]">
              <thead className="sticky top-0 bg-surface text-muted">
                <tr className="border-b border-line">
                  <th className="py-1.5 pl-5 text-left font-medium">Forma</th>
                  <th className="py-1.5 text-right font-medium">Cliente paga</th>
                  <th className="py-1.5 text-right font-medium">Taxa</th>
                  <th className="py-1.5 pr-5 text-right font-medium">Empresa recebe</th>
                </tr>
              </thead>
              <tbody>
                {sim.map((r) => (
                  <tr key={r.key} className={clsx('border-b border-line last:border-0', r.key === `c${refInstallments}` && 'bg-accent-soft')}>
                    <td className="py-1.5 pl-5 text-ink-2">{r.label}</td>
                    <td className="py-1.5 text-right text-ink">
                      {r.installments > 1 ? `${r.installments}x ${cents(r.perInstallment)}` : cents(pricing.total)}
                    </td>
                    <td className="py-1.5 text-right text-muted">{pct(r.rate)}</td>
                    <td className={clsx('py-1.5 pr-5 text-right font-medium', r.net >= pricing.subtotal ? 'text-good-ink' : 'text-ink')}>{cents(r.net)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="px-5 pt-2 text-[11px] text-muted">Parcelas sem os juros da InfinitePay, caso o repasse de juros esteja ativo na conta.</p>
          </div>
          )}
        </Card>
      </div>
    </form>
  );
}
