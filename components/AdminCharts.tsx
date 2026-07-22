'use client'

// Charts for the admin adoption view. Self-contained (own recharts style
// constants) so it doesn't couple to the per-wallet DashboardCharts. The
// funnel is pure CSS — no chart lib needed for four stacked bars.

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Line,
  ComposedChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

import { useChartColors } from '@/components/chart-theme'

function dayLabel(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

function Box({ height, children }: { height: number; children: React.ReactElement }) {
  return (
    <div className="min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function Empty({ label }: { label: string }) {
  return (
    <div className="h-[220px] grid place-items-center text-xs text-[color:var(--muted-2)]">{label}</div>
  )
}

/** Onboarding funnel — four stacked bars, width ∝ count, with step conversion. */
export function Funnel({ steps }: { steps: { key: string; label: string; value: number }[] }) {
  const C = useChartColors()
  const top = steps[0]?.value ?? 0
  if (top === 0) return <Empty label="No signed-in wallets yet — the funnel fills as users arrive." />
  return (
    <div className="space-y-2.5">
      {steps.map((s, i) => {
        const pctOfTop = top > 0 ? (s.value / top) * 100 : 0
        const prev = steps[i - 1]?.value
        const stepConv = prev && prev > 0 ? Math.round((s.value / prev) * 100) : null
        return (
          <div key={s.key} className="min-w-0">
            <div className="flex items-baseline justify-between gap-3 mb-1">
              <span className="text-xs text-[color:var(--muted)] truncate">{s.label}</span>
              <span className="text-sm text-white font-semibold tabular-nums">
                {s.value}
                {stepConv != null && (
                  <span className="text-[11px] text-[color:var(--muted-2)] font-normal ml-1.5">{stepConv}%</span>
                )}
              </span>
            </div>
            <div className="h-2.5 rounded-full bg-[var(--surf-2,rgba(255,255,255,0.04))] overflow-hidden">
              <div
                className="h-full rounded-full"
                style={{
                  width: `${Math.max(pctOfTop, s.value > 0 ? 4 : 0)}%`,
                  background: `linear-gradient(90deg, ${C.accent}, ${C.blue})`,
                  opacity: 0.85,
                }}
              />
            </div>
          </div>
        )
      })}
    </div>
  )
}

/** New wallets per day (bars) with a cumulative line. */
export function WalletsOverTime({ daily }: { daily: { day: string; n: number }[] }) {
  const C = useChartColors()
  if (daily.length === 0) return <Empty label="No new wallets in this window." />
  let run = 0
  const data = daily.map((d) => ({ day: d.day, n: d.n, cum: (run += d.n) }))
  return (
    <Box height={220}>
      <ComposedChart data={data} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          contentStyle={C.tooltip}
          labelFormatter={(l) => new Date(l as string).toUTCString().slice(0, 16)}
          formatter={(value, name) => [String(value), name === 'cum' ? 'cumulative' : 'new']}
        />
        <Bar dataKey="n" fill={C.accent} fillOpacity={0.7} radius={[3, 3, 0, 0]} barSize={14} />
        <Line type="monotone" dataKey="cum" stroke={C.blue} strokeWidth={2} dot={false} />
      </ComposedChart>
    </Box>
  )
}

/** The link economy per day: links minted + signed conversions (bars, left
 *  axis) with dollars moved through links (line, right axis). */
export function LinksDaily({ daily }: { daily: { day: string; minted: number; convs: number; usd: number }[] }) {
  const C = useChartColors()
  if (daily.length === 0) return <Empty label="No link activity in this window yet." />
  return (
    <Box height={220}>
      <ComposedChart data={daily} margin={{ top: 8, right: 0, left: -22, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="n" allowDecimals={false} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
        <YAxis
          yAxisId="usd"
          orientation="right"
          tickFormatter={(v) => `$${Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : v}`}
          tick={{ fill: C.muted, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={52}
        />
        <Tooltip
          contentStyle={C.tooltip}
          labelFormatter={(l) => new Date(l as string).toUTCString().slice(0, 16)}
          formatter={(value, name) =>
            name === 'usd'
              ? [`$${Number(value).toFixed(2)}`, 'moved via links']
              : [String(value), name === 'minted' ? 'links minted' : 'signed conversions']
          }
        />
        <Bar yAxisId="n" dataKey="minted" fill={C.accent} fillOpacity={0.75} radius={[3, 3, 0, 0]} barSize={10} />
        <Bar yAxisId="n" dataKey="convs" fill={C.blue} fillOpacity={0.75} radius={[3, 3, 0, 0]} barSize={10} />
        <Line yAxisId="usd" type="monotone" dataKey="usd" stroke={C.ink} strokeOpacity={0.7} strokeWidth={2} dot={false} />
      </ComposedChart>
    </Box>
  )
}

/** Active wallets per day — area. */
export function ActiveWallets({ daily }: { daily: { day: string; n: number }[] }) {
  const C = useChartColors()
  if (daily.length === 0) return <Empty label="No activity in this window." />
  return (
    <Box height={220}>
      <AreaChart data={daily} margin={{ top: 8, right: 8, left: -22, bottom: 0 }}>
        <defs>
          <linearGradient id="activeFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.blue} stopOpacity={0.35} />
            <stop offset="100%" stopColor={C.blue} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width={40} />
        <Tooltip
          contentStyle={C.tooltip}
          labelFormatter={(l) => new Date(l as string).toUTCString().slice(0, 16)}
          formatter={(value) => [String(value), 'active wallets']}
        />
        <Area type="monotone" dataKey="n" stroke={C.blue} strokeWidth={2} fill="url(#activeFill)" />
      </AreaChart>
    </Box>
  )
}
