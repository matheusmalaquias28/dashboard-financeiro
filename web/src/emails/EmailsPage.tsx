import clsx from 'clsx';
import {
  AlertTriangle, ArrowDownLeft, CheckCircle2, ExternalLink, FileText, Loader2, Mail, Receipt, RefreshCw, Search, ShieldAlert, ShieldCheck, Unplug,
} from 'lucide-react';
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgentContext } from '../agent/AgentWidget';
import { IconBubble, Segmented, Select } from '../components/controls';
import { Header, RefreshButton, type Shell } from '../components/Header';
import { Card } from '../components/ui';
import { money } from '../lib/format';
import { api, friendlyError, UnauthorizedError } from '../lib/useDashboard';

type Category = 'cobranca' | 'recebimento' | 'nota_fiscal' | 'outro';
type Status = 'novo' | 'pago' | 'conferido' | 'ignorado' | 'golpe' | 'legitimo';

interface EmailItem {
  id: string;
  threadId: string;
  account: string;
  from: string;
  fromDomain: string;
  subject: string;
  snippet: string;
  receivedAt: string;
  attachments: string[];
  category: Category;
  analyzed: boolean;
  pending?: boolean;
  summary?: string;
  amount?: number | null;
  dueDate?: string | null;
  counterpart?: string | null;
  method?: string;
  paymentId?: string | null;
  suspicious: boolean;
  risk?: 'baixo' | 'medio' | 'alto';
  reasons?: string[];
  signals: string[];
  status: Status;
  error?: string;
}

interface Account {
  email: string;
  connectedAt: string;
  lastSyncAt?: string;
  lastError?: string;
  needsReconnect?: boolean;
  backfillDone?: boolean;
  stats?: { read: number; financial: number; analyzed: number };
}

type Filter = 'cobranca' | 'recebimento' | 'nota_fiscal' | 'suspeitos' | 'todos';

const CAT: Record<Category, { label: string; color: string; icon: ReactNode }> = {
  cobranca: { label: 'Cobrança', color: 'var(--series-3)', icon: <Receipt size={17} /> },
  recebimento: { label: 'Recebimento', color: 'var(--series-in)', icon: <ArrowDownLeft size={17} /> },
  nota_fiscal: { label: 'Nota fiscal', color: 'var(--series-5)', icon: <FileText size={17} /> },
  outro: { label: 'Aguardando análise', color: 'var(--muted)', icon: <Mail size={17} /> },
};

const STATUS_LABEL: Record<Status, string> = { novo: 'Em aberto', pago: 'Pago', conferido: 'Conferido', ignorado: 'Ignorado', golpe: 'Golpe', legitimo: 'Legítimo' };
const METHOD: Record<string, string> = { boleto: 'Boleto', pix: 'Pix', cartao: 'Cartão', transferencia: 'Transferência', outro: 'Outro', nenhuma: '—' };

const today = () => new Date().toISOString().slice(0, 10);
const daysTo = (d: string) => Math.round((Date.parse(`${d}T12:00:00Z`) - Date.parse(`${today()}T12:00:00Z`)) / 86_400_000);
const fmtDay = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;
const senderName = (from: string) => from.replace(/<[^>]+>/, '').replace(/"/g, '').trim() || from;

export function EmailsPage({ shell, onUnauthorized, onAgentContext }: { shell: Shell; onUnauthorized: () => void; onAgentContext: (c: AgentContext) => void }) {
  const [status, setStatus] = useState<{ configured: boolean; missing?: { google: boolean; key: boolean; tables: boolean }; redirectUri: string; accounts: Account[] } | null>(null);
  const [items, setItems] = useState<EmailItem[]>([]);
  const [totals, setTotals] = useState({ read: 0, financial: 0, pending: 0 });
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ ok: boolean; text: string } | null>(null);
  const [loading, setLoading] = useState(false);
  const [syncing, setSyncing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<string>();
  const [filter, setFilter] = useState<Filter>('cobranca');
  const [onlyOpen, setOnlyOpen] = useState<'open' | 'all'>('open');
  const [q, setQ] = useState('');
  const autoSynced = useRef(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [s, m] = await Promise.all([
        api<{ configured: boolean; missing?: { google: boolean; key: boolean; tables: boolean }; redirectUri: string; accounts: Account[] }>('/api/gmail/status'),
        api<{ items: EmailItem[]; totals: typeof totals }>('/api/gmail/messages'),
      ]);
      setStatus(s);
      setItems(m.items);
      setTotals(m.totals);
      setLoadedAt(new Date().toISOString());
      setError(null);
      return s;
    } catch (err) {
      if (err instanceof UnauthorizedError) onUnauthorized();
      else setError(friendlyError(err));
      return null;
    } finally {
      setLoading(false);
    }
  }, [onUnauthorized]);

  const sync = useCallback(async () => {
    setSyncing(true);
    try {
      const r = await api<{ results: Array<{ read: number; analyzed: number; suspicious: number; backfillDone: boolean; error?: string }> }>('/api/gmail/sync', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}' });
      const x = r.results[0];
      if (x?.error) setNotice({ ok: false, text: x.error });
      else if (x) setNotice({ ok: true, text: `${x.read} e-mails lidos, ${x.analyzed} analisados${x.suspicious ? `, ${x.suspicious} suspeitos` : ''}.${x.backfillDone ? '' : ' Ainda lendo os últimos 90 dias – continua na próxima sincronização.'}` });
      await load();
    } catch (err) {
      setNotice({ ok: false, text: friendlyError(err) });
    } finally {
      setSyncing(false);
    }
  }, [load]);

  useEffect(() => {
    // volta do Google (OAuth): mostra o resultado e limpa a URL
    const params = new URLSearchParams(window.location.hash.split('?')[1] ?? '');
    if (params.get('gmail') === 'conectado') setNotice({ ok: true, text: 'Gmail conectado. A primeira leitura dos últimos 90 dias começa agora.' });
    if (params.get('gmail') === 'erro') setNotice({ ok: false, text: `Não foi possível conectar: ${params.get('motivo') ?? 'erro desconhecido'}` });
    if (params.has('gmail')) history.replaceState(null, '', '#/emails');

    void load().then((s) => {
      // ao abrir a aba, sincroniza se a última leitura tiver mais de 10 minutos
      const acc = s?.accounts[0];
      if (acc && !acc.needsReconnect && !autoSynced.current && (!acc.lastSyncAt || Date.now() - Date.parse(acc.lastSyncAt) > 10 * 60_000)) {
        autoSynced.current = true;
        void sync();
      }
    });
  }, [load, sync]);

  const setItemStatus = async (item: EmailItem, next: Status) => {
    try {
      const updated = await api<EmailItem>(`/api/gmail/messages/${item.id}`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ status: next }) });
      setItems((all) => all.map((i) => (i.id === item.id ? updated : i)));
    } catch (err) {
      setNotice({ ok: false, text: friendlyError(err) });
    }
  };

  const disconnect = async (email: string) => {
    if (!window.confirm(`Desconectar ${email}? O painel para de ler esta caixa (os e-mails já analisados continuam aqui).`)) return;
    await api('/api/gmail/disconnect', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email }) }).catch(() => undefined);
    await load();
  };

  const open = (i: EmailItem) => !['pago', 'conferido', 'ignorado', 'golpe'].includes(i.status);
  const isSuspect = (i: EmailItem) => i.suspicious && i.status !== 'legitimo';

  const kpis = useMemo(() => {
    const charges = items.filter((i) => i.category === 'cobranca' && open(i) && !isSuspect(i));
    const due7 = charges.filter((i) => i.dueDate && daysTo(i.dueDate) <= 7);
    const since = new Date(Date.now() - 30 * 86_400_000).toISOString();
    const receipts = items.filter((i) => i.category === 'recebimento' && i.receivedAt >= since);
    const suspects = items.filter((i) => isSuspect(i) && i.status !== 'golpe' && i.status !== 'ignorado');
    const sum = (l: EmailItem[]) => l.reduce((a, i) => a + (i.amount ?? 0), 0);
    return { toPay: sum(charges), toPayCount: charges.length, due7: sum(due7), due7Count: due7.length, receipts: sum(receipts), receiptsCount: receipts.length, suspects: suspects.length };
  }, [items]);

  const rows = useMemo(() => {
    const term = q.trim().toLowerCase();
    return items
      .filter((i) => (filter === 'todos' ? true : filter === 'suspeitos' ? isSuspect(i) || i.status === 'golpe' : i.category === filter && !isSuspect(i)))
      .filter((i) => onlyOpen === 'all' || open(i))
      .filter((i) => !term || `${i.subject} ${i.from} ${i.counterpart ?? ''} ${i.summary ?? ''}`.toLowerCase().includes(term))
      .sort((a, b) => (filter === 'cobranca' ? (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999') : b.receivedAt.localeCompare(a.receivedAt)));
  }, [items, filter, onlyOpen, q]);

  useEffect(() => {
    onAgentContext({
      page: 'emails',
      data: {
        resumo: { aPagar: kpis.toPay, cobrancasEmAberto: kpis.toPayCount, vencendoEm7Dias: kpis.due7, recebimentosUltimos30Dias: kpis.receipts, suspeitos: kpis.suspects },
        emails: items.slice(0, 60).map((i) => ({
          tipo: i.category, assunto: i.subject, remetente: i.from, contraparte: i.counterpart, valor: i.amount, vencimento: i.dueDate, forma: i.method,
          suspeito: isSuspect(i), risco: i.risk, motivos: i.reasons, status: STATUS_LABEL[i.status], resumo: i.summary,
        })),
      },
    });
  }, [items, kpis, onAgentContext]);

  const acc = status?.accounts[0];

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
      {notice && (
        <div className={clsx('card flex items-start gap-2 px-4 py-3 text-[13px]', notice.ok ? 'text-ink-2' : 'border-[var(--critical)] text-critical-ink')}>
          {notice.ok ? <CheckCircle2 size={16} className="mt-0.5 text-good-ink" /> : <AlertTriangle size={16} className="mt-0.5" />}
          <span className="flex-1">{notice.text}</span>
          <button type="button" onClick={() => setNotice(null)} className="text-muted hover:text-ink" aria-label="Fechar aviso">×</button>
        </div>
      )}

      {status && (
        <>
          <ConnectionCard status={status} acc={acc} syncing={syncing} onSync={sync} onDisconnect={disconnect} totals={totals} />

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Tile icon={<Receipt size={17} />} color="var(--series-3)" label="Cobranças a pagar" value={money(kpis.toPay)} hint={`${kpis.toPayCount} em aberto (sem as suspeitas)`} />
            <Tile icon={<AlertTriangle size={17} />} color="var(--series-2)" label="Vencendo em até 7 dias" value={money(kpis.due7)} hint={`${kpis.due7Count} cobranças, incluindo as vencidas`} />
            <Tile icon={<ArrowDownLeft size={17} />} color="var(--series-in)" label="Recebimentos avisados (30 dias)" value={money(kpis.receipts)} hint={`${kpis.receiptsCount} e-mails de pagamento recebido`} />
            <Tile icon={<ShieldAlert size={17} />} color="var(--critical)" label="Cobranças suspeitas" value={String(kpis.suspects)} hint="possíveis golpes para revisar" />
          </div>

          <Card title="E-mails financeiros" subtitle={`${rows.length} nesta visão · ${totals.read} e-mails lidos no total`}>
            <div className="mb-4 flex flex-wrap items-center gap-2">
              <div className="max-w-full overflow-x-auto">
                <Segmented<Filter>
                  ariaLabel="Tipo de e-mail"
                  value={filter}
                  onChange={setFilter}
                  options={[
                    { value: 'cobranca', label: 'Cobranças' },
                    { value: 'recebimento', label: 'Recebimentos' },
                    { value: 'nota_fiscal', label: 'Notas fiscais' },
                    { value: 'suspeitos', label: `Suspeitos${kpis.suspects ? ` (${kpis.suspects})` : ''}` },
                    { value: 'todos', label: 'Todos' },
                  ]}
                />
              </div>
              <Select
                ariaLabel="Situação"
                value={onlyOpen}
                onChange={setOnlyOpen}
                className="w-[170px]"
                buttonClassName="!rounded-full"
                options={[{ value: 'open', label: 'Em aberto' }, { value: 'all', label: 'Todas as situações' }]}
              />
              <label className="relative min-w-[200px] flex-1">
                <Search size={15} className="pointer-events-none absolute left-3.5 top-1/2 -translate-y-1/2 text-muted" />
                <input
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Buscar remetente, assunto ou empresa"
                  className="h-10 w-full rounded-full border border-line bg-surface pl-10 pr-4 text-[13px] text-ink outline-none placeholder:text-muted focus:border-[var(--accent-text)]"
                />
              </label>
            </div>

            <ul className="flex flex-col gap-2">
              {rows.map((i) => (
                <EmailRow key={i.id} item={i} suspect={isSuspect(i)} onStatus={(s) => setItemStatus(i, s)} />
              ))}
              {rows.length === 0 && (
                <li className="py-10 text-center text-[13px] text-muted">
                  {acc ? 'Nenhum e-mail nesta visão.' : 'Conecte o Gmail para o agente começar a ler e organizar os e-mails.'}
                </li>
              )}
            </ul>
          </Card>
        </>
      )}
    </div>
  );
}

function Tile({ icon, color, label, value, hint }: { icon: ReactNode; color: string; label: string; value: string; hint: string }) {
  return (
    <section className="card flex min-w-0 flex-col gap-3 p-5">
      <IconBubble color={color}>{icon}</IconBubble>
      <div>
        <div className="text-[13px] font-medium text-muted">{label}</div>
        <div className="mt-1 truncate text-[26px] font-extrabold leading-tight tracking-tight text-ink">{value}</div>
      </div>
      <div className="text-[12px] text-muted">{hint}</div>
    </section>
  );
}

function ConnectionCard({ status, acc, syncing, onSync, onDisconnect, totals }: {
  status: { configured: boolean; missing?: { google: boolean; key: boolean; tables: boolean }; redirectUri: string };
  acc?: Account;
  syncing: boolean;
  onSync: () => void;
  onDisconnect: (email: string) => void;
  totals: { read: number; financial: number; pending: number };
}) {
  if (!status.configured) {
    return (
      <Card title="Conectar o Gmail" subtitle="Falta configurar o acesso ao Google no servidor">
        <ol className="ml-5 list-decimal space-y-1.5 text-[13px] text-ink-2">
          {status.missing?.tables && (
            <li>
              <strong>Banco:</strong> rode <code>supabase/migrations/20261022030000_gmail.sql</code> no SQL Editor do Supabase.
            </li>
          )}
          <li>Google Cloud Console: crie um projeto e ative a <strong>Gmail API</strong>.</li>
          <li>Tela de consentimento OAuth: tipo <strong>Externo</strong>, em modo Teste, e adicione o seu Gmail em <strong>Usuários de teste</strong>.</li>
          <li>Credenciais &gt; ID do cliente OAuth &gt; <strong>Aplicativo da Web</strong>, com este URI de redirecionamento: <code className="break-all rounded bg-surface-2 px-1.5 py-0.5 text-ink">{status.redirectUri}</code> (e o equivalente de produção).</li>
          <li>Coloque <code>GOOGLE_CLIENT_ID</code> e <code>GOOGLE_CLIENT_SECRET</code> no <code>.env</code> e reinicie o servidor.</li>
        </ol>
      </Card>
    );
  }
  if (!acc) {
    return (
      <Card title="Conectar o Gmail" subtitle="O agente lê os e-mails, separa cobranças e recebimentos, aponta golpes e etiqueta tudo no Gmail">
        <a href="/api/gmail/connect" className="inline-flex h-11 items-center gap-2 rounded-full bg-accent px-5 text-[14px] font-bold text-on-accent hover:opacity-90">
          <Mail size={16} /> Conectar conta do Gmail
        </a>
        <p className="mt-3 text-[12px] text-muted">Permissão pedida: ler e-mails e aplicar etiquetas. O painel nunca envia nem apaga e-mails.</p>
      </Card>
    );
  }
  return (
    <section className={clsx('card flex flex-wrap items-center justify-between gap-4 p-5', acc.needsReconnect && 'border-[var(--critical)]')}>
      <div className="flex min-w-0 items-center gap-3">
        <IconBubble color={acc.needsReconnect ? 'var(--critical)' : 'var(--series-in)'} size="lg">
          {acc.needsReconnect ? <Unplug size={18} /> : <Mail size={18} />}
        </IconBubble>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-ink">{acc.email}</div>
          <div className="text-[12px] text-muted">
            {acc.needsReconnect
              ? 'A conexão expirou (o Google pede reconexão a cada 7 dias para apps em teste).'
              : `Última leitura: ${acc.lastSyncAt ? new Date(acc.lastSyncAt).toLocaleString('pt-BR') : 'ainda não'} · ${totals.read} lidos · ${totals.financial} financeiros${totals.pending ? ` · ${totals.pending} aguardando análise` : ''}`}
            {!acc.needsReconnect && !acc.backfillDone && ' · lendo os últimos 90 dias…'}
          </div>
          {acc.lastError && !acc.needsReconnect && <div className="text-[12px] text-critical-ink">{acc.lastError}</div>}
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {acc.needsReconnect ? (
          <a href="/api/gmail/connect" className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-bold text-on-accent">Reconectar</a>
        ) : (
          <button type="button" onClick={onSync} disabled={syncing} className="inline-flex h-10 items-center gap-2 rounded-full bg-accent px-4 text-[13px] font-bold text-on-accent hover:opacity-90 disabled:opacity-60">
            {syncing ? <Loader2 size={15} className="animate-spin" /> : <RefreshCw size={15} />} {syncing ? 'Lendo e-mails…' : 'Sincronizar agora'}
          </button>
        )}
        <button type="button" onClick={() => onDisconnect(acc.email)} className="h-10 rounded-full border border-line px-4 text-[13px] font-semibold text-ink-2 hover:text-ink">
          Desconectar
        </button>
      </div>
    </section>
  );
}

function EmailRow({ item: i, suspect, onStatus }: { item: EmailItem; suspect: boolean; onStatus: (s: Status) => void }) {
  const [openReasons, setOpenReasons] = useState(false);
  const meta = suspect ? { label: 'Suspeito', color: 'var(--critical)', icon: <ShieldAlert size={17} /> } : CAT[i.category];
  const due = i.dueDate ? daysTo(i.dueDate) : null;
  const reasons = [...new Set([...(i.reasons ?? []), ...i.signals])];
  const gmailUrl = `https://mail.google.com/mail/u/?authuser=${encodeURIComponent(i.account)}#all/${i.threadId}`;
  const btn = 'h-8 rounded-full border border-line px-3 text-[12px] font-semibold text-ink-2 hover:border-line-strong hover:text-ink';

  return (
    <li className={clsx('rounded-2xl border p-4', suspect ? 'border-[color-mix(in_oklab,var(--critical)_40%,transparent)] bg-[color-mix(in_oklab,var(--critical)_6%,transparent)]' : 'border-line')}>
      <div className="flex flex-wrap items-start gap-3">
        <IconBubble color={meta.color} size="lg">{meta.icon}</IconBubble>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[14px] font-bold text-ink">{i.counterpart || senderName(i.from)}</span>
            <span className="rounded-full px-2 py-0.5 text-[11px] font-semibold" style={{ background: `color-mix(in oklab, ${meta.color} 16%, transparent)`, color: meta.color }}>
              {meta.label}
              {suspect && i.risk ? ` · risco ${i.risk}` : ''}
            </span>
            {i.status !== 'novo' && <span className="rounded-full bg-surface-3 px-2 py-0.5 text-[11px] font-semibold text-ink-2">{STATUS_LABEL[i.status]}</span>}
          </div>
          <div className="mt-0.5 truncate text-[13px] text-ink-2">{i.subject}</div>
          <div className="mt-1 text-[12px] text-muted">
            {i.summary ?? i.snippet}
          </div>
          <div className="mt-1 text-[11px] text-muted">
            {senderName(i.from) !== (i.counterpart ?? '') && <>{i.from} · </>}
            recebido {new Date(i.receivedAt).toLocaleDateString('pt-BR')}
            {i.method && i.method !== 'nenhuma' && <> · {METHOD[i.method] ?? i.method}</>}
            {i.attachments.length > 0 && <> · 📎 {i.attachments.slice(0, 2).join(', ')}</>}
          </div>
          {i.paymentId && <div className="mt-1 break-all font-mono text-[11px] text-ink-2">{i.paymentId}</div>}
          {reasons.length > 0 && (
            <button type="button" onClick={() => setOpenReasons((o) => !o)} className={clsx('mt-2 text-[12px] font-semibold', suspect ? 'text-critical-ink' : 'text-muted')}>
              {openReasons ? 'Ocultar' : 'Ver'} {suspect ? 'motivos da suspeita' : 'sinais observados'} ({reasons.length})
            </button>
          )}
          {openReasons && (
            <ul className="mt-1 ml-4 list-disc space-y-0.5 text-[12px] text-ink-2">
              {reasons.map((r) => <li key={r}>{r}</li>)}
            </ul>
          )}
        </div>
        <div className="shrink-0 text-right">
          {i.amount != null && <div className="tabular text-[18px] font-extrabold text-ink">{money(i.amount)}</div>}
          {i.dueDate && (
            <div className={clsx('text-[12px] font-semibold', i.category === 'cobranca' && due != null && due < 0 ? 'text-critical-ink' : i.category === 'cobranca' && due != null && due <= 7 ? 'text-[var(--series-3)]' : 'text-muted')}>
              {i.category === 'cobranca' ? (due != null && due < 0 ? `venceu em ${fmtDay(i.dueDate)}` : due === 0 ? 'vence hoje' : `vence ${fmtDay(i.dueDate)}`) : fmtDay(i.dueDate)}
            </div>
          )}
          {i.pending && <div className="text-[12px] text-muted">aguardando análise</div>}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-1.5 pl-14">
        <a href={gmailUrl} target="_blank" rel="noreferrer" className={clsx(btn, 'inline-flex items-center gap-1')}>
          <ExternalLink size={12} /> Abrir no Gmail
        </a>
        {i.category === 'cobranca' && !suspect && i.status !== 'pago' && <button type="button" className={btn} onClick={() => onStatus('pago')}>Marcar como pago</button>}
        {i.category !== 'cobranca' && i.status !== 'conferido' && !suspect && <button type="button" className={btn} onClick={() => onStatus('conferido')}>Conferido</button>}
        {suspect ? (
          <>
            <button type="button" className={clsx(btn, 'inline-flex items-center gap-1 text-critical-ink')} onClick={() => onStatus('golpe')}><ShieldAlert size={12} /> Confirmar golpe</button>
            <button type="button" className={clsx(btn, 'inline-flex items-center gap-1')} onClick={() => onStatus('legitimo')}><ShieldCheck size={12} /> Não é golpe</button>
          </>
        ) : (
          i.category === 'cobranca' && <button type="button" className={btn} onClick={() => onStatus('golpe')}>Marcar como golpe</button>
        )}
        {i.status !== 'ignorado' && <button type="button" className={btn} onClick={() => onStatus('ignorado')}>Ignorar</button>}
        {i.status !== 'novo' && <button type="button" className={btn} onClick={() => onStatus('novo')}>Reabrir</button>}
      </div>
    </li>
  );
}
