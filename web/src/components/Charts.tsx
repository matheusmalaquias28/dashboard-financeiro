import { useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisMoney, money, monthLabel, monthShort } from '../lib/format';
import type { CumulativePoint, MonthlyPoint } from '../lib/metrics';
import { shortDate, type Period } from '../lib/period';
import { ChartCard, DataTable, Swatch } from './ui';

interface TipRow {
  key: string;
  label: string;
  color: string;
  shape?: 'line' | 'rect';
}

/** Tooltip único: valor em destaque, nome da série depois, chave em traço/quadrado */
function Tip({ active, payload, title, rows }: { active?: boolean; payload?: Array<{ payload: Record<string, unknown> }>; title: (p: Record<string, unknown>) => string; rows: TipRow[] }) {
  if (!active || !payload?.length) return null;
  const p = payload[0].payload;
  return (
    <div className="min-w-[190px] rounded-2xl border border-line-strong bg-surface-2 px-3.5 py-3 shadow-2xl shadow-black/40">
      <div className="mb-2 text-[12px] font-semibold text-muted">{title(p)}</div>
      {rows.map((r) =>
        p[r.key] == null ? null : (
          <div key={r.key} className="flex items-center gap-2 py-0.5 text-[13px]">
            <Swatch color={r.color} shape={r.shape ?? 'line'} />
            <span className="tabular font-bold text-ink">{money(p[r.key] as number)}</span>
            <span className="text-ink-2">{r.label}</span>
          </div>
        ),
      )}
    </div>
  );
}

const axisProps = {
  stroke: 'var(--axis)',
  tick: { fill: 'var(--muted)', fontSize: 12, fontWeight: 500 },
  tickLine: false,
} as const;

export function CumulativeChart({ data, label }: { data: CumulativePoint[]; label: string }) {
  const last = [...data].reverse().find((d) => d.atual != null);
  const single = data.length === 1;
  return (
    <ChartCard
      title="Evolução dos recebimentos"
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-in)" shape="line" /> {label} (acumulado)</span>
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-prev)" shape="line" /> período anterior</span>
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-in)" /> recebido no dia</span>
        </span>
      }
      table={
        <DataTable
          head={['Data', 'No dia', 'Acumulado', 'Acum. anterior']}
          rows={data.map((d) => [shortDate(d.date), money(d.diario), d.atual == null ? '—' : money(d.atual), d.anterior == null ? '—' : money(d.anterior)])}
        />
      }
    >
      <div className="relative h-[280px]">
        {last?.atual != null && (
          <div className="pointer-events-none absolute right-2 top-0 z-10 text-right">
            <div className="text-[12px] text-muted">até {shortDate(last.date)}</div>
            <div className="tabular text-[15px] font-semibold text-ink">{money(last.atual)}</div>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <defs>
              <linearGradient id="grad-in" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="var(--series-in)" stopOpacity={0.28} />
                <stop offset="100%" stopColor="var(--series-in)" stopOpacity={0} />
              </linearGradient>
            </defs>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} interval="preserveStartEnd" minTickGap={24} />
            <YAxis {...axisProps} axisLine={false} tickFormatter={axisMoney} width={48} />
            <Tooltip
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
              content={(props) => (
                <Tip
                  {...(props as object)}
                  title={(p) => `${shortDate(p.date as string)} · anterior: ${shortDate(p.prevDate as string)}`}
                  rows={[
                    { key: 'atual', label: 'acumulado', color: 'var(--series-in)' },
                    { key: 'anterior', label: 'acum. anterior', color: 'var(--series-prev)' },
                    { key: 'diario', label: 'no dia', color: 'var(--series-in)', shape: 'rect' },
                  ]}
                />
              )}
            />
            <Bar dataKey="diario" fill="var(--series-in)" fillOpacity={single ? 1 : 0.3} radius={[99, 99, 99, 99]} maxBarSize={single ? 28 : 10} isAnimationActive={false} />
            <Line dataKey="anterior" stroke="var(--series-prev)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
            <Area dataKey="atual" stroke="var(--series-in)" strokeWidth={2.5} fill="url(#grad-in)" dot={false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function MonthlyFlowChart({ data, period, onSelect }: { data: MonthlyPoint[]; period: Period; onSelect: (ym: string) => void }) {
  const inSelection = (ym: string) => ym >= period.from.slice(0, 7) && ym <= period.to.slice(0, 7);
  const [hover, setHover] = useState<string | null>(null);
  const totalIn = data.reduce((a, d) => a + d.entradas, 0);
  return (
    <ChartCard
      title="Entradas x saídas por mês"
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-in)" /> Entradas</span>
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-out)" /> Saídas</span>
          <span>Média de entradas: {money(totalIn / Math.max(1, data.length))}/mês · clique numa coluna para abrir o mês</span>
        </span>
      }
      table={
        <DataTable
          head={['Mês', 'Entradas', 'Saídas', 'Resultado']}
          rows={data.map((d) => [monthLabel(d.ym), money(d.entradas), money(d.saidas), money(d.saldo)])}
        />
      }
    >
      <div className="h-[280px]">
        <ResponsiveContainer width="100%" height="100%">
          <BarChart
            data={data}
            margin={{ top: 8, right: 8, bottom: 0, left: 0 }}
            barGap={4}
            barCategoryGap="22%"
            onClick={(s) => {
              const ym = (s as { activeLabel?: string })?.activeLabel;
              if (ym) onSelect(ym);
            }}
            onMouseMove={(s) => setHover(((s as { activeLabel?: string })?.activeLabel as string) ?? null)}
            onMouseLeave={() => setHover(null)}
            className="cursor-pointer"
          >
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="ym" {...axisProps} tickFormatter={monthShort} interval="preserveStartEnd" minTickGap={8} />
            <YAxis {...axisProps} axisLine={false} tickFormatter={axisMoney} width={48} />
            <Tooltip
              cursor={{ fill: 'var(--surface-2)' }}
              content={(props) => (
                <Tip
                  {...(props as object)}
                  title={(p) => monthLabel(p.ym as string)}
                  rows={[
                    { key: 'entradas', label: 'entradas', color: 'var(--series-in)', shape: 'rect' },
                    { key: 'saidas', label: 'saídas', color: 'var(--series-out)', shape: 'rect' },
                    { key: 'saldo', label: 'resultado', color: 'var(--axis)' },
                  ]}
                />
              )}
            />
            <Bar dataKey="entradas" fill="var(--series-in)" radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false}
              shape={(props: unknown) => <FadedBar {...(props as BarShapeProps)} dim={!inSelection((props as BarShapeProps).payload.ym) && (props as BarShapeProps).payload.ym !== hover} />}
            />
            <Bar dataKey="saidas" fill="var(--series-out)" radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false}
              shape={(props: unknown) => <FadedBar {...(props as BarShapeProps)} dim={!inSelection((props as BarShapeProps).payload.ym) && (props as BarShapeProps).payload.ym !== hover} />}
            />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

interface BarShapeProps {
  x: number;
  y: number;
  width: number;
  height: number;
  fill: string;
  payload: MonthlyPoint;
}

/** Coluna em pílula (cantos totalmente arredondados); meses fora de foco ficam esmaecidos */
function FadedBar({ x, y, width, height, fill, dim }: BarShapeProps & { dim: boolean }) {
  if (!height || height <= 0) return null;
  const h = Math.max(height, width);
  return <rect x={x} y={y + height - h} width={width} height={h} rx={width / 2} fill={fill} opacity={dim ? 0.55 : 1} />;
}
