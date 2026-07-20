'use client'

// Recharts pieces for /dashboard/treasury — loaded lazily via LazyCharts.
// The stacked daily chart splits inflow by PAYER KIND (tester = Yeetful's own
// wallets, wild = real users), matching the yellow/green wallet badges: green
// bars are the number that matters during the leak phase.

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

import { useChartColors, useSiteTheme } from '@/components/chart-theme'

export interface FeePoint {
  day: string
  /** Inflow from Yeetful's own test wallets (yellow). */
  testerUsd: number
  /** Inflow from wallets in the wild (green). */
  wildUsd: number
  cumulativeUsd: number
  events: number
}

const fmtUsd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString('en-US')}` : n >= 1 ? `$${n.toFixed(2)}` : `$${n.toFixed(n === 0 ? 0 : 3)}`

const dayLabel = (iso: string) => {
  const d = new Date(`${iso}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** Tester yellow, deepened on the light theme so it keeps contrast on paper. */
function useTesterYellow(): string {
  return useSiteTheme() ? '#CA8A04' : '#EAB308'
}

/** Fees accumulated, cumulative — the treasury's progress curve. */
export function FeeCurve({ series }: { series: FeePoint[] }) {
  const C = useChartColors()
  if (series.length === 0) return null
  return (
    <div className="min-w-0" style={{ height: 260 }}>
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={series} margin={{ top: 12, right: 12, left: -6, bottom: 0 }}>
          <defs>
            <linearGradient id="feeCurveFill" x1="0" y1="0" x2="0" y2="1">
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
            formatter={(value) => [fmtUsd(Number(value)), 'collected, all time']}
          />
          <Area
            type="monotone"
            dataKey="cumulativeUsd"
            stroke={C.accent}
            strokeWidth={2}
            fill="url(#feeCurveFill)"
            dot={false}
            activeDot={{ r: 4, strokeWidth: 0 }}
            isAnimationActive={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  )
}

/** Day-by-day inflow, stacked by payer kind: wild (green) over tester (yellow). */
export function FeeDaily({ series }: { series: FeePoint[] }) {
  const C = useChartColors()
  const yellow = useTesterYellow()
  if (series.length === 0) return null
  return (
    <div className="min-w-0">
      <div className="flex items-center gap-4 mb-1 mono text-[10.5px] uppercase tracking-wider" style={{ color: 'var(--muted-2)' }}>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-[3px]" style={{ background: C.accent }} /> Wild · real users
        </span>
        <span className="inline-flex items-center gap-1.5">
          <span className="w-2 h-2 rounded-[3px]" style={{ background: yellow }} /> Tester · our wallets
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
              formatter={(value, name) => [fmtUsd(Number(value)), name === 'wildUsd' ? 'wild · real users' : 'tester · our wallets']}
            />
            <Bar dataKey="testerUsd" stackId="inflow" fill={yellow} isAnimationActive={false} />
            <Bar dataKey="wildUsd" stackId="inflow" fill={C.accent} radius={[3, 3, 0, 0]} isAnimationActive={false} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}
