'use client'

// Charts for the admin Growth page. Same recharts idiom as AdminCharts; the
// series colors are fixed per SOURCE so a color means the same thing in the
// chart, the legend and the mix bar.

import { Bar, BarChart, CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useChartColors, useSiteTheme } from '@/components/chart-theme'
import { GROWTH_SOURCES } from '@/lib/admin-growth'

export const SOURCE_LABEL: Record<string, string> = {
  link: 'Links',
  chat: 'App chat',
  embed: 'Embeds',
  auto: 'Schedules & agents',
}

/** Source inks, tuned per theme for contrast on the card surface. */
export function useSourceColors(): Record<string, string> {
  const light = useSiteTheme()
  return light
    ? { link: '#0e8f62', chat: '#3b6fd4', embed: '#8a5bd6', auto: '#b7791f' }
    : { link: '#34E0A1', chat: '#6AA8FF', embed: '#B69CFF', auto: '#F5C46B' }
}

function dayLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

const usdTick = (v: number | string) => {
  const n = Number(v)
  return n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `$${n}`
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

function Empty({ label, height = 260 }: { label: string; height?: number }) {
  return (
    <div className="grid place-items-center text-xs text-[color:var(--muted-2)]" style={{ height }}>
      {label}
    </div>
  )
}

export interface GrowthPoint {
  day: string
  link: number
  chat: number
  embed: number
  auto: number
  totalUsd: number
  cumulativeUsd: number
  pantessaUsd: number
  creatorUsd: number
  cumulativeFeeUsd: number
  signups: number
}

/** Money moved per day, stacked by where it came from, with the all-time line. */
export function MoneyBySource({ series }: { series: GrowthPoint[] }) {
  const C = useChartColors()
  const S = useSourceColors()
  if (!series.some((p) => p.totalUsd > 0 || p.cumulativeUsd > 0)) return <Empty label="No signed money in this window yet." />
  const barSize = series.length > 45 ? 5 : series.length > 14 ? 10 : 22
  return (
    <Box height={260}>
      <ComposedChart data={series} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis yAxisId="d" tickFormatter={usdTick} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
        <YAxis yAxisId="c" orientation="right" tickFormatter={usdTick} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
        <Tooltip
          contentStyle={C.tooltip}
          cursor={{ fill: C.grid }}
          labelFormatter={(l) => new Date(`${String(l).slice(0, 10)}T00:00:00Z`).toUTCString().slice(0, 16)}
          formatter={(value, name) => [`$${Number(value).toFixed(2)}`, name === 'cumulativeUsd' ? 'All-time total' : SOURCE_LABEL[String(name)] ?? String(name)]}
        />
        {GROWTH_SOURCES.map((k, i, a) => (
          <Bar key={k} yAxisId="d" dataKey={k} stackId="usd" fill={S[k]} fillOpacity={0.85} barSize={barSize} radius={i === a.length - 1 ? [3, 3, 0, 0] : 0} />
        ))}
        <Line yAxisId="c" type="monotone" dataKey="cumulativeUsd" stroke={C.ink} strokeOpacity={0.65} strokeWidth={2} dot={false} />
      </ComposedChart>
    </Box>
  )
}

/** The fee per day: Pantessa's share stacked under the creators' share. */
export function FeeSplitDaily({ series }: { series: GrowthPoint[] }) {
  const C = useChartColors()
  if (!series.some((p) => p.pantessaUsd > 0 || p.creatorUsd > 0 || p.cumulativeFeeUsd > 0)) {
    return <Empty label="No fee-bearing trades in this window yet." height={220} />
  }
  const barSize = series.length > 45 ? 5 : series.length > 14 ? 10 : 22
  return (
    <Box height={220}>
      <ComposedChart data={series} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
        <YAxis yAxisId="d" tickFormatter={(v) => `$${Number(v).toFixed(2)}`} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
        <YAxis yAxisId="c" orientation="right" tickFormatter={(v) => `$${Number(v).toFixed(2)}`} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
        <Tooltip
          contentStyle={C.tooltip}
          cursor={{ fill: C.grid }}
          labelFormatter={(l) => new Date(`${String(l).slice(0, 10)}T00:00:00Z`).toUTCString().slice(0, 16)}
          formatter={(value, name) => [
            `$${Number(value).toFixed(4)}`,
            name === 'pantessaUsd' ? 'Pantessa keeps' : name === 'creatorUsd' ? 'Creators earn' : 'All-time fees',
          ]}
        />
        <Bar yAxisId="d" dataKey="pantessaUsd" stackId="fee" fill={C.accent} fillOpacity={0.85} barSize={barSize} />
        <Bar yAxisId="d" dataKey="creatorUsd" stackId="fee" fill={C.blue} fillOpacity={0.85} barSize={barSize} radius={[3, 3, 0, 0]} />
        <Line yAxisId="c" type="monotone" dataKey="cumulativeFeeUsd" stroke={C.ink} strokeOpacity={0.65} strokeWidth={2} dot={false} />
      </ComposedChart>
    </Box>
  )
}

/** Traders per week: first-time vs back again. Retention you can see. */
export function TradersWeekly({ weekly }: { weekly: { week: string; newTraders: number; returningTraders: number }[] }) {
  const C = useChartColors()
  if (weekly.length === 0) return <Empty label="No traders yet." height={220} />
  return (
    <Box height={220}>
      <BarChart data={weekly} margin={{ top: 8, right: 8, left: 2, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="week" tickFormatter={dayLabel} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis allowDecimals={false} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
        <Tooltip
          contentStyle={C.tooltip}
          cursor={{ fill: C.grid }}
          labelFormatter={(l) => `Week of ${dayLabel(String(l))}`}
          formatter={(value, name) => [String(value), name === 'newTraders' ? 'first trade' : 'came back']}
        />
        <Bar dataKey="returningTraders" stackId="t" fill={C.accent} fillOpacity={0.85} barSize={22} />
        <Bar dataKey="newTraders" stackId="t" fill={C.blue} fillOpacity={0.85} barSize={22} radius={[3, 3, 0, 0]} />
      </BarChart>
    </Box>
  )
}
