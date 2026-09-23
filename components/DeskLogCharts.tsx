'use client'

// The desk's one chart: agent-signed dollars per day. Single series, single axis, single hue
// (dataviz: magnitude is one hue; a second y-scale is never drawn). Colors come from the
// markets look tokens (`--mk-*`, components/markets/look.css — imported by DeskLogSection)
// so the desk reads like the rest of the data surfaces in both themes.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'

import { useChartColors } from '@/components/chart-theme'
import { MK } from '@/lib/markets-look'
import type { GrowthDayPoint } from '@/lib/admin-growth'

function dayLabel(iso: string): string {
  const d = new Date(`${iso.slice(0, 10)}T00:00:00Z`)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

const usdTick = (v: number | string) => {
  const n = Number(v)
  return n >= 1000 ? `$${(n / 1000).toFixed(n >= 10_000 ? 0 : 1)}k` : `$${n}`
}

export function DeskDaily({ series }: { series: GrowthDayPoint[] }) {
  const C = useChartColors()
  if (!series.some((p) => p.totalUsd > 0)) {
    return (
      <div className="grid place-items-center text-xs text-[color:var(--muted-2)]" style={{ height: 200 }}>
        No agent-signed leg in this window yet.
      </div>
    )
  }
  const barSize = series.length > 45 ? 5 : series.length > 14 ? 10 : 22
  return (
    <div className="min-w-0 overflow-hidden" data-desk-chart>
      <ResponsiveContainer width="100%" height={200}>
        <BarChart data={series} margin={{ top: 8, right: 4, left: 2, bottom: 0 }} barCategoryGap={2}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={24} />
          <YAxis tickFormatter={usdTick} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
          <Tooltip
            contentStyle={C.tooltip}
            cursor={{ fill: C.grid }}
            labelFormatter={(l) => new Date(`${String(l).slice(0, 10)}T00:00:00Z`).toUTCString().slice(0, 16)}
            formatter={(value, name) => [name === 'trades' ? String(value) : `$${Number(value).toFixed(2)}`, name === 'trades' ? 'legs signed' : 'agent-signed']}
          />
          <Bar dataKey="totalUsd" fill={`var(${MK.seq[3]})`} fillOpacity={0.9} barSize={barSize} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  )
}
