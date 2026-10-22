import clsx from 'clsx';
import { ArrowUp, Bot, Eraser, Square, X } from 'lucide-react';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import type { User, View } from '../types';
import { friendlyError } from '../lib/useDashboard';
import { Markdown } from './Markdown';

interface Msg {
  role: 'user' | 'assistant';
  text: string;
  error?: boolean;
}

/** O que a tela aberta mostra agora – vai junto com cada pergunta */
export interface AgentContext {
  page: View;
  data: unknown;
}

const SUGGESTIONS: Record<View, string[]> = {
  financeiro: [
    'Resuma o mês: quanto entrou, quanto falta receber e o que chama atenção?',
    'Quais clientes estão com cobranças vencidas e quanto isso representa?',
    'Como está a tendência de recebimentos nos últimos meses?',
    'A projeção do próximo mês está saudável comparada à média?',
  ],
  emails: [
    'Quais cobranças vencem nos próximos dias e quanto somam?',
    'Explique por que estes e-mails foram marcados como suspeitos.',
    'Há cobranças repetidas ou de fornecedores que não reconheço?',
  ],
  colaboradores: [
    'Resuma a folha desta competência: fixo, variável e quem mais recebe.',
    'Como a folha evoluiu nos últimos meses?',
    'Qual o peso da remuneração variável e quem está acima da média?',
  ],
  checkout: [
    'Como estão minhas vendas no checkout este mês?',
    'Quais links ainda estão aguardando pagamento?',
    'Vale mais a pena repassar a taxa ao cliente ou absorver?',
  ],
};

const storageKey = (u: User) => `agente:${u.role}:${u.name}`;

function loadHistory(u: User): Msg[] {
  try {
    return JSON.parse(sessionStorage.getItem(storageKey(u)) ?? '[]') as Msg[];
  } catch {
    return [];
  }
}

export function AgentWidget({ user, context }: { user: User; context: AgentContext | null }) {
  const [open, setOpen] = useState(false);
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [messages, setMessages] = useState<Msg[]>(() => loadHistory(user));
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    fetch('/api/agent/status')
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((s: { enabled: boolean }) => setEnabled(s.enabled))
      .catch(() => setEnabled(false));
  }, []);

  useEffect(() => {
    try {
      sessionStorage.setItem(storageKey(user), JSON.stringify(messages.slice(-40)));
    } catch {
      // sem storage: a conversa só não sobrevive ao recarregar
    }
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight });
  }, [messages, user]);

  useEffect(() => {
    if (!open) return;
    setTimeout(() => inputRef.current?.focus(), 50);
    const esc = (e: globalThis.KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('keydown', esc);
    return () => document.removeEventListener('keydown', esc);
  }, [open]);

  if (enabled === false || enabled === null) return null;

  const send = async (text: string) => {
    const question = text.trim();
    if (!question || busy) return;
    const history: Msg[] = [...messages.filter((m) => !m.error), { role: 'user', text: question }];
    setMessages([...history, { role: 'assistant', text: '' }]);
    setDraft('');
    setBusy(true);
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    const append = (chunk: string) =>
      setMessages((all) => {
        const copy = [...all];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { ...last, text: last.text + chunk };
        return copy;
      });
    const fail = (msg: string) =>
      setMessages((all) => {
        const copy = [...all];
        const last = copy[copy.length - 1];
        copy[copy.length - 1] = { role: 'assistant', text: last.text ? `${last.text}\n\n_${msg}_` : msg, error: !last.text };
        return copy;
      });

    try {
      const res = await fetch('/api/agent/chat', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ messages: history, page: context?.page, context: context?.data }),
        signal: ctrl.signal,
      });
      if (!res.ok || !res.body) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body.error ?? `Erro ${res.status}`);
      }
      // lê o streaming (eventos "delta", "error" e "done")
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        let idx: number;
        while ((idx = buffer.indexOf('\n\n')) >= 0) {
          const raw = buffer.slice(0, idx);
          buffer = buffer.slice(idx + 2);
          const event = /^event: (.*)$/m.exec(raw)?.[1];
          const data = /^data: (.*)$/m.exec(raw)?.[1];
          if (!event || data == null) continue;
          const parsed = JSON.parse(data);
          if (event === 'delta') append(parsed as string);
          else if (event === 'error') fail(String(parsed));
        }
      }
    } catch (err) {
      if ((err as Error).name !== 'AbortError') fail(friendlyError(err));
    } finally {
      setBusy(false);
      abortRef.current = null;
    }
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      void send(draft);
    }
  };

  const suggestions = SUGGESTIONS[context?.page ?? (user.role === 'seller' ? 'checkout' : 'financeiro')];

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className={clsx(
          'fixed bottom-5 right-5 z-40 grid size-14 place-items-center rounded-full bg-accent text-on-accent shadow-lg transition-transform hover:scale-105 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--accent-text)]',
          open && 'max-sm:hidden',
        )}
        aria-label={open ? 'Fechar assistente' : 'Abrir assistente financeiro'}
        aria-expanded={open}
        title="Assistente financeiro"
      >
        {open ? <X size={22} /> : <Bot size={24} />}
      </button>

      {open && (
        <section
          role="dialog"
          aria-label="Assistente financeiro"
          className="fixed inset-0 z-50 flex flex-col bg-surface sm:inset-auto sm:bottom-24 sm:right-5 sm:h-[min(640px,calc(100dvh-8rem))] sm:w-[420px] sm:rounded-2xl sm:border sm:border-line sm:shadow-2xl"
        >
          <header className="flex items-center justify-between gap-2 border-b border-line px-4 py-3">
            <div className="flex items-center gap-2.5">
              <span className="grid size-8 place-items-center rounded-full bg-accent-soft text-accent-text"><Bot size={17} /></span>
              <div>
                <h2 className="text-[14px] font-semibold text-ink">Assistente financeiro</h2>
                <p className="text-[11px] text-muted">{busy ? 'Analisando…' : 'Responde com base no que está na tela'}</p>
              </div>
            </div>
            <div className="flex items-center gap-1">
              {messages.length > 0 && (
                <button type="button" onClick={() => !busy && setMessages([])} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" title="Nova conversa" aria-label="Nova conversa">
                  <Eraser size={15} />
                </button>
              )}
              <button type="button" onClick={() => setOpen(false)} className="grid size-8 place-items-center rounded-lg text-muted hover:bg-surface-2 hover:text-ink" aria-label="Fechar">
                <X size={16} />
              </button>
            </div>
          </header>

          <div ref={listRef} className="flex-1 overflow-y-auto px-4 py-4" aria-live="polite">
            {messages.length === 0 ? (
              <div className="flex flex-col gap-3">
                <div className="rounded-2xl rounded-tl-sm bg-surface-2 px-3.5 py-2.5 text-[13px] leading-relaxed text-ink-2">
                  Olá, {user.name.split(' ')[0]}! Sou o assistente da Scale Company. Posso analisar os números que estão na sua tela agora. Pergunte, por exemplo:
                </div>
                <div className="flex flex-col gap-2">
                  {suggestions.map((s) => (
                    <button key={s} type="button" onClick={() => void send(s)} className="rounded-xl border border-line px-3 py-2 text-left text-[13px] text-ink-2 hover:border-[var(--accent-text)] hover:text-ink">
                      {s}
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <ul className="flex flex-col gap-3">
                {messages.map((m, i) => (
                  <li key={i} className={clsx('flex', m.role === 'user' ? 'justify-end' : 'justify-start')}>
                    <div
                      className={clsx(
                        'max-w-[88%] rounded-2xl px-3.5 py-2.5 text-[13px] leading-relaxed',
                        m.role === 'user' ? 'whitespace-pre-wrap rounded-tr-sm bg-accent text-on-accent' : 'rounded-tl-sm bg-surface-2 text-ink-2',
                        m.error && 'text-critical-ink',
                      )}
                    >
                      {m.role === 'assistant' ? (
                        m.text ? <Markdown text={m.text} /> : <TypingDots />
                      ) : (
                        m.text
                      )}
                    </div>
                  </li>
                ))}
              </ul>
            )}
          </div>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void send(draft);
            }}
            className="border-t border-line p-3"
          >
            <div className="flex items-end gap-2 rounded-xl border border-line bg-surface px-3 py-2 focus-within:border-[var(--accent-text)]">
              <textarea
                ref={inputRef}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={onKey}
                rows={1}
                maxLength={4000}
                placeholder="Pergunte sobre os números da tela…"
                className="max-h-32 min-h-6 flex-1 resize-none bg-transparent text-[14px] text-ink outline-none placeholder:text-muted [field-sizing:content]"
                aria-label="Mensagem"
              />
              {busy ? (
                <button type="button" onClick={() => abortRef.current?.abort()} className="grid size-8 shrink-0 place-items-center rounded-lg bg-surface-2 text-ink" aria-label="Parar resposta" title="Parar">
                  <Square size={13} fill="currentColor" />
                </button>
              ) : (
                <button type="submit" disabled={!draft.trim()} className="grid size-8 shrink-0 place-items-center rounded-lg bg-accent text-on-accent disabled:opacity-40" aria-label="Enviar">
                  <ArrowUp size={16} />
                </button>
              )}
            </div>
            <p className="mt-1.5 text-center text-[11px] text-muted">Respostas geradas por IA a partir dos dados da tela. Confira antes de decidir.</p>
          </form>
        </section>
      )}
    </>
  );
}

function TypingDots() {
  return (
    <span className="inline-flex gap-1 py-1" aria-label="Escrevendo">
      {[0, 1, 2].map((i) => (
        <span key={i} className="size-1.5 animate-bounce rounded-full bg-current opacity-60" style={{ animationDelay: `${i * 150}ms` }} />
      ))}
    </span>
  );
}
