import clsx from 'clsx';
import { LogOut, Moon, RefreshCw, Sun } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { LiveState } from '../lib/useDashboard';

export function Header({ generatedAt, loading, live, onRefresh, onLogout }: {
  generatedAt?: string;
  loading: boolean;
  live: LiveState;
  onRefresh: () => void;
  onLogout?: () => void;
}) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // storage indisponível (modo privado) – só não lembra a preferência
    }
  }, [dark]);

  const liveLabel = { live: 'Ao vivo', connecting: 'Reconectando…', offline: 'Offline' }[live];

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="grid size-10 place-items-center rounded-xl bg-accent text-white shadow-sm">
          <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
            <path d="M6 22l6-7 5 4 9-11" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div>
          <h1 className="text-lg font-semibold leading-tight text-ink sm:text-xl">Dashboard Financeiro</h1>
          <p className="text-[13px] text-muted">Scale Company · recebimentos, saídas e projeções</p>
        </div>
      </div>

      <div className="flex items-center gap-2">
        <span
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink-2"
          title="Pagamentos chegam por webhook e aparecem sem recarregar a página"
        >
          <span className={clsx('relative inline-block size-2 rounded-full', live === 'live' ? 'live-dot bg-good' : live === 'connecting' ? 'bg-warning' : 'bg-critical')} />
          {liveLabel}
        </span>
        <button
          type="button"
          onClick={onRefresh}
          className="inline-flex h-9 items-center gap-2 rounded-lg border border-line bg-surface px-3 text-[13px] text-ink-2 hover:bg-surface-2"
          title={generatedAt ? `Atualizado às ${new Date(generatedAt).toLocaleTimeString('pt-BR')}` : undefined}
        >
          <RefreshCw size={15} className={clsx(loading && 'animate-spin')} />
          <span className="hidden sm:inline">{generatedAt ? new Date(generatedAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Atualizar'}</span>
        </button>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-2"
          aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {onLogout && (
          <button
            type="button"
            onClick={onLogout}
            className="grid size-9 place-items-center rounded-lg border border-line bg-surface text-ink-2 hover:bg-surface-2"
            aria-label="Sair"
            title="Sair"
          >
            <LogOut size={16} />
          </button>
        )}
      </div>
    </header>
  );
}
