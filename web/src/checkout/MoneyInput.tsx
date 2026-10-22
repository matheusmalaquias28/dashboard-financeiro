import clsx from 'clsx';

const fmt = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });

/** Campo de valor em reais que guarda centavos: digitar "149700" mostra "1.497,00" */
export function MoneyInput({ value, onChange, className, id, ariaLabel }: {
  value: number;
  onChange: (cents: number) => void;
  className?: string;
  id?: string;
  ariaLabel?: string;
}) {
  return (
    <div className={clsx('relative', className)}>
      <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-[13px] text-muted">R$</span>
      <input
        id={id}
        aria-label={ariaLabel}
        inputMode="numeric"
        value={value ? fmt.format(value / 100) : ''}
        placeholder="0,00"
        onChange={(e) => {
          const digits = e.target.value.replace(/\D/g, '').slice(0, 11);
          onChange(Number(digits || '0'));
        }}
        className="tabular h-10 w-full rounded-lg border border-line bg-surface pl-9 pr-3 text-right text-[14px] text-ink outline-none focus:border-[var(--accent-text)]"
      />
    </div>
  );
}
