'use client'

// Recharts pieces for the /activity overview — loaded lazily via LazyCharts
// (Recharts is a ~358 KB chunk; see LazyCharts.tsx). Colors come from
// chart-theme so both charts re-skin live on the light/dark toggle.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useChartColors } from '@/components/chart-theme'

export interface FlowPoint {
  day: string
  signedUsd: number
  x402Usd: number
  cumulativeUsd: number
  events: number
}

const fmtUsd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n === 0 ? 0 : 3)}`

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** Money moved, cumulative — the progress curve. One series, one axis. */
export function MoneyCurve({ series }: { series: FlowPoint[] }) {
  const C = useChartColors()
  if (series.length === 0) return null
  return (
    <div className="min-w-0" style={{ height: 280 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 12, right: 12, left: -6, bottom: 0 }}>
          <defs>
            <linearGradient id="curveFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={C.accent} stopOpacity={0.4} />
              <stop offset="100%" stopColor={C.accent} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis
            dataKey="day"
            tickFormatter={dayLabel}
            tick={{ fill: C.muted, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={28}
          />
          <YAxis
            tickFormatter={(v: number) => fmtUsd(v)}
            tick={{ fill: C.muted, fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            width={64}
            domain={[0, 'auto']}
          />
          <Tooltip
            contentStyle={C.tooltip}
            labelFormatter={(l) => new Date(`${l as string}T00:00:00Z`).toUTCString().slice(0, 16)}
            formatter={(value, name) => {
              if (name === 'cumulativeUsd') return [fmtUsd(Number(value)), 'moved, all time']
              return [String(value), String(name)]
            }}
          />
          <Area
            type="monotone"
            dataKey="cumulativeUsd"
            stroke={C.accent}
            strokeWidth={2}
            fill="url(#curveFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Day-by-day flow: transaction notional vs x402 fees, stacked. */
export function DailyFlow({ series }: { series: FlowPoint[] }) {
  const C = useChartColors()
  if (series.length === 0) return null
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-4 mb-1 mono text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--muted-2)' }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-[3px]" style={{ background: C.accent }} /> Transactions signed
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-[3px]" style={{ background: C.blue }} /> x402 fees settled
        </span>
      </div>
      <div style={{ height: 240 }}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 8, right: 12, left: -6, bottom: 0 }} barCategoryGap="24%">
            <CartesianGrid stroke={C.grid} vertical={false} />
            <XAxis
              dataKey="day"
              tickFormatter={dayLabel}
              tick={{ fill: C.muted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              minTickGap={28}
            />
            <YAxis
              tickFormatter={(v: number) => fmtUsd(v)}
              tick={{ fill: C.muted, fontSize: 11 }}
              axisLine={false}
              tickLine={false}
              width={64}
            />
            <Tooltip
              contentStyle={C.tooltip}
              cursor={{ fill: C.grid }}
              labelFormatter={(l) => new Date(`${l as string}T00:00:00Z`).toUTCString().slice(0, 16)}
              formatter={(value, name) => [
                fmtUsd(Number(value)),
                name === 'signedUsd' ? 'transactions signed' : 'x402 fees',
              ]}
            />
            <Bar dataKey="signedUsd" stackId="flow" fill={C.accent} isAnimationActive={false} />
            <Bar dataKey="x402Usd" stackId="flow" fill={C.blue} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
