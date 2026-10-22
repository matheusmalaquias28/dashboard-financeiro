import { AlertTriangle, Loader2, Plus, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { Card } from '../components/ui';
import { friendlyError } from '../lib/useDashboard';
import { cents } from './math';
import { MoneyInput } from './MoneyInput';
import type { CheckoutConfig, Product } from './types';

/** Configurações do administrador: taxas da conta InfinitePay e catálogo de produtos */
export function CheckoutSettings({ config, webhookUrl, onSaved }: { config: CheckoutConfig; webhookUrl: string; onSaved: (c: CheckoutConfig) => void }) {
  const [pixRate, setPixRate] = useState(String(config.fees.pixRate).replace('.', ','));
  const [cardRates, setCardRates] = useState(config.fees.cardRates.map((r) => String(r).replace('.', ',')));
  const [products, setProducts] = useState<Product[]>(config.products);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<{ ok: boolean; text: string } | null>(null);

  const num = (s: string) => Number(s.replace(',', '.'));

  const save = async () => {
    setBusy(true);
    setMsg(null);
    try {
      const res = await fetch('/api/checkout/config', {
        method: 'PUT',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ fees: { pixRate: num(pixRate), cardRates: cardRates.map(num) }, products }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error ?? `Erro ${res.status}`);
      onSaved(body as CheckoutConfig);
      setProducts((body as CheckoutConfig).products);
      setMsg({ ok: true, text: 'Configurações salvas.' });
    } catch (err) {
      setMsg({ ok: false, text: friendlyError(err) });
    } finally {
      setBusy(false);
    }
  };

  const rateInput = 'tabular h-9 w-full rounded-lg border border-line bg-surface px-2 pr-6 text-right text-[13px] text-ink outline-none focus:border-[var(--accent-text)]';

  return (
    <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
      <Card title="Taxas da conta InfinitePay" subtitle="Usadas no simulador, na taxa repassada ao cliente e no valor líquido de cada venda">
        {!config.feesConfirmed && (
          <p className="mb-3 flex gap-1.5 rounded-lg bg-[color-mix(in_oklab,var(--warning)_14%,transparent)] p-2 text-[12px] text-ink-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            Estes valores são exemplos. Confira as taxas do seu plano no app da InfinitePay e salve.
          </p>
        )}
        <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
          <RateField label="Pix" value={pixRate} onChange={setPixRate} className={rateInput} />
          {cardRates.map((v, i) => (
            <RateField
              key={i}
              label={i === 0 ? 'Crédito 1x' : `${i + 1}x`}
              value={v}
              onChange={(nv) => setCardRates((all) => all.map((x, j) => (j === i ? nv : x)))}
              className={rateInput}
            />
          ))}
        </div>
        <p className="mt-3 text-[12px] text-muted">
          Se na InfinitePay estiver ativado "repassar juros do parcelamento ao cliente", a InfinitePay cobra os juros do cliente por conta própria:
          nesse caso use em 2x–12x a mesma taxa do crédito à vista.
        </p>
        <p className="mt-2 text-[12px] text-muted">
          Webhook usado nos links: <code className="break-all rounded bg-surface-2 px-1 py-0.5 text-ink-2">{webhookUrl}</code>
        </p>
      </Card>

      <Card title="Catálogo de produtos" subtitle="Os vendedores escolhem daqui; o preço pode ser ajustado na hora, e o desconto fica registrado">
        <div className="flex flex-col gap-2">
          {products.map((p, i) => (
            <div key={p.id} className="grid grid-cols-[minmax(0,1fr)_140px_auto] items-center gap-2">
              <input
                value={p.name}
                onChange={(e) => setProducts((all) => all.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
                placeholder="Nome do produto"
                maxLength={100}
                className="h-10 w-full rounded-lg border border-line bg-surface px-3 text-[14px] text-ink outline-none focus:border-[var(--accent-text)]"
                aria-label="Nome do produto"
              />
              <MoneyInput value={p.price} onChange={(v) => setProducts((all) => all.map((x, j) => (j === i ? { ...x, price: v } : x)))} ariaLabel="Preço" />
              <button
                type="button"
                onClick={() => setProducts((all) => all.filter((_, j) => j !== i))}
                className="grid size-10 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-critical-ink"
                aria-label={`Remover ${p.name || 'produto'}`}
              >
                <Trash2 size={16} />
              </button>
            </div>
          ))}
          {products.length === 0 && <p className="text-[13px] text-muted">Nenhum produto cadastrado.</p>}
          <button
            type="button"
            onClick={() => setProducts((all) => [...all, { id: '', name: '', price: 0, active: true }])}
            className="inline-flex h-10 w-fit items-center gap-1.5 rounded-lg border border-dashed border-line px-3 text-[13px] text-ink-2 hover:bg-surface-2"
          >
            <Plus size={15} /> Adicionar produto
          </button>
          {products.length > 0 && <p className="text-[12px] text-muted">{products.length} produtos · ticket médio de tabela {cents(products.reduce((a, p) => a + p.price, 0) / products.length)}</p>}
        </div>
      </Card>

      <div className="flex flex-wrap items-center gap-3 xl:col-span-2">
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="inline-flex h-10 items-center gap-2 rounded-lg bg-accent px-5 text-[14px] font-semibold text-on-accent hover:opacity-90 disabled:opacity-50"
        >
          {busy && <Loader2 size={16} className="animate-spin" />} Salvar configurações
        </button>
        {msg && <span role="status" className={msg.ok ? 'text-[13px] text-good-ink' : 'text-[13px] text-critical-ink'}>{msg.text}</span>}
      </div>
    </div>
  );
}

function RateField({ label, value, onChange, className }: { label: string; value: string; onChange: (v: string) => void; className: string }) {
  return (
    <label className="block">
      <span className="mb-1 block text-[12px] text-ink-2">{label}</span>
      <span className="relative block">
        <input value={value} onChange={(e) => onChange(e.target.value.replace(/[^\d,.]/g, ''))} inputMode="decimal" className={className} />
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[12px] text-muted">%</span>
      </span>
    </label>
  );
}
