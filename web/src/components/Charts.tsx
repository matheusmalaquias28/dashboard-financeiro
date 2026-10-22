import { useState } from 'react';
import { Area, Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { axisMoney, money, monthLabel, monthShort } from '../lib/format';
import type { CumulativePoint, MonthlyPoint } from '../lib/metrics';
import { shiftMonth } from '../lib/metrics';
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
    <div className="min-w-[180px] rounded-xl border border-line bg-surface px-3 py-2.5 shadow-lg">
      <div className="mb-1.5 text-[12px] text-muted">{title(p)}</div>
      {rows.map((r) =>
        p[r.key] == null ? null : (
          <div key={r.key} className="flex items-center gap-2 py-0.5 text-[13px]">
            <Swatch color={r.color} shape={r.shape ?? 'line'} />
            <span className="tabular font-semibold text-ink">{money(p[r.key] as number)}</span>
            <span className="text-ink-2">{r.label}</span>
          </div>
        ),
      )}
    </div>
  );
}

const axisProps = {
  stroke: 'var(--axis)',
  tick: { fill: 'var(--muted)', fontSize: 12 },
  tickLine: false,
} as const;

export function CumulativeChart({ data, month }: { data: CumulativePoint[]; month: string }) {
  const prev = shiftMonth(month, -1);
  const last = [...data].reverse().find((d) => d.atual != null);
  return (
    <ChartCard
      title="Evolução dos recebimentos no mês"
      subtitle={
        <span className="inline-flex flex-wrap items-center gap-x-4 gap-y-1">
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-in)" shape="line" /> {monthLabel(month)} (acumulado)</span>
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-prev)" shape="line" /> {monthLabel(prev)}</span>
          <span className="inline-flex items-center gap-1.5"><Swatch color="var(--series-in)" /> recebido no dia</span>
        </span>
      }
      table={
        <DataTable
          head={['Dia', 'No dia', 'Acumulado', `Acum. ${monthShort(prev)}`]}
          rows={data.map((d) => [String(d.day).padStart(2, '0'), money(d.diario), d.atual == null ? '—' : money(d.atual), d.anterior == null ? '—' : money(d.anterior)])}
        />
      }
    >
      <div className="relative h-[280px]">
        {last?.atual != null && (
          <div className="pointer-events-none absolute right-2 top-0 z-10 text-right">
            <div className="text-[12px] text-muted">até o dia {last.day}</div>
            <div className="tabular text-[15px] font-semibold text-ink">{money(last.atual)}</div>
          </div>
        )}
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} stroke="var(--grid)" />
            <XAxis dataKey="day" {...axisProps} interval="preserveStartEnd" minTickGap={16} />
            <YAxis {...axisProps} axisLine={false} tickFormatter={axisMoney} width={48} />
            <Tooltip
              cursor={{ stroke: 'var(--axis)', strokeWidth: 1 }}
              content={(props) => (
                <Tip
                  {...(props as object)}
                  title={(p) => `Dia ${p.day}`}
                  rows={[
                    { key: 'atual', label: 'acumulado', color: 'var(--series-in)' },
                    { key: 'anterior', label: `acum. ${monthShort(prev)}`, color: 'var(--series-prev)' },
                    { key: 'diario', label: 'no dia', color: 'var(--series-in)', shape: 'rect' },
                  ]}
                />
              )}
            />
            <Bar dataKey="diario" fill="var(--series-in)" fillOpacity={0.28} radius={[4, 4, 0, 0]} maxBarSize={14} isAnimationActive={false} />
            <Line dataKey="anterior" stroke="var(--series-prev)" strokeWidth={2} dot={false} activeDot={{ r: 4, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} />
            <Area dataKey="atual" stroke="var(--series-in)" strokeWidth={2} fill="var(--series-in)" fillOpacity={0.1} dot={false} activeDot={{ r: 5, stroke: 'var(--surface)', strokeWidth: 2 }} isAnimationActive={false} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </ChartCard>
  );
}

export function MonthlyFlowChart({ data, selected, onSelect }: { data: MonthlyPoint[]; selected: string; onSelect: (ym: string) => void }) {
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
            barGap={2}
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
            <Bar dataKey="entradas" fill="var(--series-in)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}
              shape={(props: unknown) => <FadedBar {...(props as BarShapeProps)} dim={(props as BarShapeProps).payload.ym !== selected && (props as BarShapeProps).payload.ym !== hover} />}
            />
            <Bar dataKey="saidas" fill="var(--series-out)" radius={[4, 4, 0, 0]} maxBarSize={22} isAnimationActive={false}
              shape={(props: unknown) => <FadedBar {...(props as BarShapeProps)} dim={(props as BarShapeProps).payload.ym !== selected && (props as BarShapeProps).payload.ym !== hover} />}
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

/** Coluna com topo arredondado (4px) e base reta; meses fora de foco ficam esmaecidos */
function FadedBar({ x, y, width, height, fill, dim }: BarShapeProps & { dim: boolean }) {
  if (!height || height <= 0) return null;
  const r = Math.min(4, width / 2, height);
  const d = `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`;
  return <path d={d} fill={fill} opacity={dim ? 0.45 : 1} />;
}
