import clsx from 'clsx';
import { LogOut, Moon, RefreshCw, Sun } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import type { LiveState } from '../lib/useDashboard';
import type { User, View } from '../types';

/** O que é comum a todas as telas: navegação, usuário, tema e sair */
export interface Shell {
  user: User;
  view: View;
  onView: (v: View) => void;
  onLogout?: () => void;
}

const SUBTITLE: Record<View, string> = {
  financeiro: 'Scale Company · recebimentos, saídas e projeções',
  checkout: 'Scale Company · cobranças InfinitePay',
  colaboradores: 'Scale Company · remuneração fixa e variável',
  emails: 'Scale Company · cobranças, recebimentos e golpes na caixa de e-mail',
};

const TITLE: Record<View, string> = { financeiro: 'Dashboard Financeiro', checkout: 'Checkout', colaboradores: 'Colaboradores', emails: 'E-mails' };
const TAB: Record<View, string> = { financeiro: 'Financeiro', checkout: 'Checkout', colaboradores: 'Colaboradores', emails: 'E-mails' };

export function Header({ shell, children }: { shell: Shell; children?: ReactNode }) {
  const [dark, setDark] = useState(() => document.documentElement.classList.contains('dark'));
  useEffect(() => {
    document.documentElement.classList.toggle('dark', dark);
    try {
      localStorage.setItem('theme', dark ? 'dark' : 'light');
    } catch {
      // storage indisponível (modo privado) – só não lembra a preferência
    }
  }, [dark]);

  const isAdmin = shell.user.role === 'admin';

  return (
    <header className="flex flex-wrap items-center justify-between gap-3">
      <div className="flex min-w-0 flex-wrap items-center gap-3">
        <div className="grid size-11 shrink-0 place-items-center rounded-2xl bg-accent text-on-accent">
          <svg viewBox="0 0 32 32" className="size-6" aria-hidden>
            <path d="M6 22l6-7 5 4 9-11" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </div>
        <div className="min-w-0 flex-1 basis-40 sm:flex-none sm:basis-auto">
          <h1 className="text-[20px] font-extrabold leading-tight tracking-tight text-ink sm:text-[22px]">{TITLE[shell.view]}</h1>
          <p className="truncate text-[13px] text-muted">{SUBTITLE[shell.view]}</p>
        </div>
        {isAdmin && (
          <nav className="flex h-10 rounded-full border border-line bg-surface p-1 text-[13px] max-sm:order-last max-sm:w-full sm:ml-4" aria-label="Telas">
            {(['financeiro', 'checkout', 'colaboradores', 'emails'] as const).map((v) => (
              <button
                key={v}
                type="button"
                onClick={() => shell.onView(v)}
                aria-current={shell.view === v ? 'page' : undefined}
                className={clsx('whitespace-nowrap rounded-full px-4 font-semibold transition-colors max-sm:flex-1 max-sm:px-1.5 max-sm:text-[12px]', shell.view === v ? 'bg-ink text-page' : 'text-muted hover:text-ink')}
              >
                {TAB[v]}
              </button>
            ))}
          </nav>
        )}
      </div>

      <div className="flex items-center gap-2">
        {children}
        <span className="hidden h-10 items-center gap-2 rounded-full pl-1 pr-2 text-[13px] font-semibold text-ink md:inline-flex" title={`${shell.user.email} · ${isAdmin ? 'Administrador' : 'Vendedor'}`}>
          <span className="grid size-8 place-items-center rounded-full bg-surface-3 text-[12px] font-bold text-ink">{shell.user.name.split(' ').map((p) => p[0]).slice(0, 2).join('').toUpperCase()}</span>
          {shell.user.name}
        </span>
        <button
          type="button"
          onClick={() => setDark((d) => !d)}
          className="grid size-10 place-items-center rounded-full border border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink"
          aria-label={dark ? 'Usar tema claro' : 'Usar tema escuro'}
        >
          {dark ? <Sun size={16} /> : <Moon size={16} />}
        </button>
        {shell.onLogout && (
          <button
            type="button"
            onClick={shell.onLogout}
            className="grid size-10 place-items-center rounded-full border border-line bg-surface text-ink-2 hover:border-line-strong hover:text-ink"
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

/** Indicador "ao vivo" + botão de atualizar do painel financeiro */
export function LiveControls({ generatedAt, loading, live, onRefresh }: { generatedAt?: string; loading: boolean; live: LiveState; onRefresh: () => void }) {
  const liveLabel = { live: 'Ao vivo', connecting: 'Reconectando…', offline: 'Offline' }[live];
  return (
    <>
      <span
        className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] text-ink-2"
        title="Pagamentos chegam por webhook e aparecem sem recarregar a página"
      >
        <span className={clsx('relative inline-block size-2 rounded-full', live === 'live' ? 'live-dot bg-good' : live === 'connecting' ? 'bg-warning' : 'bg-critical')} />
        <span className="hidden sm:inline">{liveLabel}</span>
      </span>
      <RefreshButton onClick={onRefresh} loading={loading} at={generatedAt} />
    </>
  );
}

export function RefreshButton({ onClick, loading, at }: { onClick: () => void; loading: boolean; at?: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex h-10 items-center gap-2 rounded-full border border-line bg-surface px-3 text-[13px] text-ink-2 hover:border-line-strong hover:text-ink"
      title={at ? `Atualizado às ${new Date(at).toLocaleTimeString('pt-BR')}` : 'Atualizar'}
      aria-label="Atualizar"
    >
      <RefreshCw size={15} className={clsx(loading && 'animate-spin')} />
      <span className="hidden sm:inline">{at ? new Date(at).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' }) : 'Atualizar'}</span>
    </button>
  );
}
