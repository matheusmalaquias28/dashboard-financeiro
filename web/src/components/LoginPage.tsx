import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { User } from '../types';

export function LoginPage({ onSuccess }: { onSuccess: (user: User) => void }) {
  const [email, setEmail] = useState(() => {
    try {
      return localStorage.getItem('ultimo-email') ?? '';
    } catch {
      return '';
    }
  });
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!email || !password || busy) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch('/api/login', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      const body = (await res.json().catch(() => ({}))) as { user?: User; error?: string };
      if (res.ok && body.user) {
        try {
          localStorage.setItem('ultimo-email', email);
        } catch {
          // sem storage: só não lembra o e-mail
        }
        onSuccess(body.user);
      } else setError(body.error ?? `Erro ${res.status}. Tente novamente.`);
    } catch {
      setError('Sem conexão com o servidor do painel. Tente de novo.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid min-h-dvh place-items-center px-4">
      <form onSubmit={submit} className="card w-full max-w-sm p-6 sm:p-8">
        <div className="mb-6 flex flex-col items-center gap-3 text-center">
          <div className="grid size-12 place-items-center rounded-2xl bg-accent text-on-accent shadow-sm">
            <svg viewBox="0 0 32 32" className="size-7" aria-hidden>
              <path d="M6 22l6-7 5 4 9-11" stroke="currentColor" strokeWidth="3" fill="none" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </div>
          <div>
            <h1 className="text-lg font-semibold text-ink">Dashboard Financeiro</h1>
            <p className="text-[13px] text-muted">Scale Company · entre com sua conta</p>
          </div>
        </div>

        <label htmlFor="email" className="mb-1.5 block text-[13px] font-medium text-ink-2">E-mail</label>
        <div className="relative mb-4">
          <Mail size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoFocus={!email}
            autoComplete="username"
            inputMode="email"
            placeholder="voce@scalecompany.com.br"
            className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-3 text-[15px] text-ink outline-none placeholder:text-muted focus:border-[var(--accent-text)]"
          />
        </div>

        <label htmlFor="password" className="mb-1.5 block text-[13px] font-medium text-ink-2">Senha</label>
        <div className="relative">
          <Lock size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted" />
          <input
            id="password"
            type={show ? 'text' : 'password'}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoFocus={!!email}
            autoComplete="current-password"
            className="h-11 w-full rounded-xl border border-line bg-surface pl-9 pr-10 text-[15px] text-ink outline-none focus:border-[var(--accent-text)]"
            aria-invalid={!!error}
            aria-describedby={error ? 'login-error' : undefined}
          />
          <button
            type="button"
            onClick={() => setShow((s) => !s)}
            className="absolute right-1 top-1/2 grid size-9 -translate-y-1/2 place-items-center rounded-md text-muted hover:text-ink"
            aria-label={show ? 'Ocultar senha' : 'Mostrar senha'}
          >
            {show ? <EyeOff size={16} /> : <Eye size={16} />}
          </button>
        </div>

        {error && <p id="login-error" role="alert" className="mt-2 text-[13px] text-critical-ink">{error}</p>}

        <button
          type="submit"
          disabled={!email || !password || busy}
          className="mt-5 h-11 w-full rounded-lg bg-accent text-[14px] font-semibold text-on-accent transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Entrando…' : 'Entrar'}
        </button>
      </form>
    </div>
  );
}
