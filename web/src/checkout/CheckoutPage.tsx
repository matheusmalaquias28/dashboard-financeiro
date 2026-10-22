import { AlertTriangle, BadgeDollarSign, CheckCircle2, ExternalLink, FlaskConical, Hourglass, Link2, MessageCircle, Percent, Trophy, X } from 'lucide-react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import type { AgentContext } from '../agent/AgentWidget';
import { checkoutContext } from '../agent/context';
import { Header, RefreshButton, type Shell } from '../components/Header';
import { IconBubble, Segmented } from '../components/controls';
import { Card } from '../components/ui';
import { api, UnauthorizedError } from '../lib/useDashboard';
import { ChargeForm } from './ChargeForm';
import { ChargeHistory, CopyButton, whatsappLink } from './ChargeHistory';
import { CheckoutSettings } from './CheckoutSettings';
import { cents } from './math';
import type { Charge, CheckoutState } from './types';

type Tab = 'new' | 'history' | 'settings';
const POLL_MS = 15_000;
const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;

export function CheckoutPage({ shell, onUnauthorized, onAgentContext }: { shell: Shell; onUnauthorized: () => void; onAgentContext: (c: AgentContext) => void }) {
  const [state, setState] = useState<CheckoutState | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string>();
  const [tab, setTab] = useState<Tab>('new');
  const [created, setCreated] = useState<Charge | null>(null);
  const isAdmin = shell.user.role === 'admin';

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setState(await api<CheckoutState>('/api/checkout/state'));
      setLoadedAt(new Date().toISOString());
      setError(null);
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized();
      else setError((err as Error).message);
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  // o status "pago" chega por webhook no servidor; a tela confere a cada 15s
  useEffect(() => {
    void load();
    const t = setInterval(() => !document.hidden && void load(), POLL_MS);
    return () => clearInterval(t);
  }, [load]);

  useEffect(() => {
    if (state) onAgentContext({ page: 'checkout', data: checkoutContext(state) });
  }, [state, onAgentContext]);

  const onCreated = (c: Charge) => {
    setCreated(c);
    setState((s) => (s ? { ...s, charges: [c, ...s.charges] } : s));
  };

  const simulate = async (c: Charge) => {
    const res = await fetch(`/api/checkout/charges/${c.id}/simulate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ method: 'credit_card', installments: c.feeRefInstallments }),
    });
    if (res.ok) void load();
  };

  return (
    <div className="mx-auto flex max-w-[1500px] flex-col gap-4 px-4 py-5 sm:px-6 lg:py-7">
      <Header shell={shell}>
        <RefreshButton onClick={load} loading={loading} at={loadedAt} />
      </Header>

      {error && (
        <div className="card flex items-center gap-2 border-[var(--critical)] px-4 py-3 text-[13px] text-critical-ink">
          <AlertTriangle size={16} /> {error}
        </div>
      )}

      {state && (
        <>
          {state.mock && (
            <div className="flex items-start gap-2 rounded-xl border border-[color-mix(in_oklab,var(--warning)_45%,transparent)] bg-[color-mix(in_oklab,var(--warning)_12%,transparent)] px-4 py-2.5 text-[13px] text-ink-2">
              <FlaskConical size={16} className="mt-0.5 shrink-0" />
              <span>
                <strong className="font-semibold text-ink">Modo de teste:</strong> os links gerados são simulados e não cobram ninguém. Use o botão de frasco no
                histórico para simular o pagamento. Desative com <code>INFINITEPAY_CHECKOUT_MOCK=false</code>.
              </span>
            </div>
          )}

          <Summary charges={state.charges} isAdmin={isAdmin} />

          <div className="-mx-1 max-w-full overflow-x-auto px-1">
            <Segmented<Tab>
              ariaLabel="Seções do checkout"
              value={tab}
              onChange={setTab}
              options={[
                { value: 'new', label: 'Nova cobrança' },
                { value: 'history', label: `Cobranças (${state.charges.length})` },
                ...(isAdmin ? [{ value: 'settings' as Tab, label: 'Taxas e catálogo' }] : []),
              ]}
            />
          </div>

          {tab === 'new' && <ChargeForm config={state.config} onCreated={onCreated} />}
          {tab === 'history' && <ChargeHistory charges={state.charges} isAdmin={isAdmin} sellers={state.sellers} mock={state.mock} onSimulate={simulate} />}
          {tab === 'settings' && isAdmin && (
            <CheckoutSettings config={state.config} webhookUrl={state.webhookUrl} onSaved={(config) => setState((s) => (s ? { ...s, config } : s))} />
          )}
        </>
      )}

      {created && <LinkDialog charge={created} onClose={() => setCreated(null)} onHistory={() => { setCreated(null); setTab('history'); }} />}
    </div>
  );
}

/** Números do mês: o que foi gerado, pago e quanto entra líquido */
function Summary({ charges, isAdmin }: { charges: Charge[]; isAdmin: boolean }) {
  const month = new Date().toISOString().slice(0, 7);
  const s = useMemo(() => {
    const inMonth = charges.filter((c) => c.createdAt.slice(0, 7) === month);
    const paid = charges.filter((c) => c.paidAt?.slice(0, 7) === month);
    const pending = charges.filter((c) => c.status === 'pending');
    const sum = (l: Charge[], f: (c: Charge) => number) => l.reduce((a, c) => a + f(c), 0);
    const bySeller = new Map<string, { paid: number; count: number }>();
    for (const c of paid) {
      const cur = bySeller.get(c.seller) ?? { paid: 0, count: 0 };
      bySeller.set(c.seller, { paid: cur.paid + c.total, count: cur.count + 1 });
    }
    return {
      generated: inMonth.length,
      generatedValue: sum(inMonth, (c) => c.total),
      paidValue: sum(paid, (c) => c.total),
      paidCount: paid.length,
      net: sum(paid, (c) => c.paid?.net ?? 0),
      fees: sum(paid, (c) => c.paid?.fee ?? 0),
      pendingValue: sum(pending, (c) => c.total),
      pendingCount: pending.length,
      conversion: inMonth.length ? inMonth.filter((c) => c.status === 'paid').length / inMonth.length : 0,
      ranking: [...bySeller.entries()].sort((a, b) => b[1].paid - a[1].paid),
    };
  }, [charges, month]);

  const tile = 'card flex min-w-0 flex-col gap-1 p-5';
  const value = 'truncate text-[26px] font-extrabold tracking-tight text-ink';
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      <section className={tile}>
        <IconBubble color="var(--series-in)"><BadgeDollarSign size={17} /></IconBubble>
        <span className="mt-2 text-[13px] font-medium text-muted">Vendido no mês</span>
        <span className={value}>{cents(s.paidValue)}</span>
        <span className="text-[12px] text-muted">{plural(s.paidCount, 'pagamento', 'pagamentos')} · líquido {cents(s.net)}</span>
      </section>
      <section className={tile}>
        <IconBubble color="var(--series-3)"><Hourglass size={17} /></IconBubble>
        <span className="mt-2 text-[13px] font-medium text-muted">Aguardando pagamento</span>
        <span className={value}>{cents(s.pendingValue)}</span>
        <span className="text-[12px] text-muted">{plural(s.pendingCount, 'link em aberto', 'links em aberto')}</span>
      </section>
      <section className={tile}>
        <IconBubble color="var(--series-1)"><Link2 size={17} /></IconBubble>
        <span className="mt-2 text-[13px] font-medium text-muted">Links gerados no mês</span>
        <span className={value}>{s.generated}</span>
        <span className="text-[12px] text-muted">
          {cents(s.generatedValue)} · conversão {Math.round(s.conversion * 100)}%
        </span>
      </section>
      <section className={tile}>
        {isAdmin && s.ranking.length > 0 ? (
          <>
            <IconBubble color="var(--series-2)"><Trophy size={17} /></IconBubble>
            <span className="mt-2 text-[13px] font-medium text-muted">Vendas por vendedor (mês)</span>
            <ul className="mt-1 flex flex-col gap-1 text-[13px]">
              {s.ranking.slice(0, 4).map(([name, v]) => (
                <li key={name} className="flex justify-between gap-2">
                  <span className="truncate text-ink-2">{name}</span>
                  <span className="tabular shrink-0 font-medium text-ink">{cents(v.paid)}</span>
                </li>
              ))}
            </ul>
          </>
        ) : (
          <>
            <IconBubble color="var(--series-2)"><Percent size={17} /></IconBubble>
            <span className="mt-2 text-[13px] font-medium text-muted">Taxas pagas no mês</span>
            <span className={value}>{cents(s.fees)}</span>
            <span className="text-[12px] text-muted">descontadas pela InfinitePay</span>
          </>
        )}
      </section>
    </div>
  );
}

function LinkDialog({ charge, onClose, onHistory }: { charge: Charge; onClose: () => void; onHistory: () => void }) {
  useEffect(() => {
    const esc = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-black/40 p-4" role="dialog" aria-modal="true" aria-labelledby="link-title" onClick={onClose}>
      <div onClick={(e) => e.stopPropagation()} className="w-full max-w-md">
        <Card
          title={
            <span id="link-title" className="inline-flex items-center gap-2">
              <CheckCircle2 size={18} className="text-good-ink" /> Link gerado
            </span>
          }
          subtitle={`${charge.customer.name} · ${cents(charge.total)}`}
          action={
            <button type="button" onClick={onClose} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2" aria-label="Fechar">
              <X size={16} />
            </button>
          }
        >
          <div className="break-all rounded-lg border border-line bg-surface-2 p-3 text-[13px] text-ink">{charge.url}</div>
          <div className="mt-3 flex flex-wrap gap-2">
            <CopyButton text={charge.url} />
            <a href={whatsappLink(charge)} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] text-ink-2 hover:bg-surface-2">
              <MessageCircle size={14} /> Enviar no WhatsApp
            </a>
            {!charge.mock && (
              <a href={charge.url} target="_blank" rel="noreferrer" className="inline-flex h-8 items-center gap-1.5 rounded-lg border border-line px-2.5 text-[12px] text-ink-2 hover:bg-surface-2">
                <ExternalLink size={14} /> Abrir
              </a>
            )}
          </div>
          <p className="mt-3 text-[12px] text-muted">
            Empresa recebe ≈ {cents(charge.estimatedNet)} se o cliente pagar em {charge.feeRefInstallments}x. Quando o pagamento for aprovado, a cobrança aparece como paga
            no histórico.
          </p>
          <button type="button" onClick={onHistory} className="mt-4 h-10 w-full rounded-lg border border-line text-[13px] font-medium text-ink hover:bg-surface-2">
            Ver cobranças
          </button>
        </Card>
      </div>
    </div>
  );
}
