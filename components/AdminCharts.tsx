'use client'

// The link-economy chart (/activity). Self-contained (own recharts style
// constants) so it doesn't couple to the per-wallet DashboardCharts. The admin
// Growth page's charts live in GrowthCharts.

import {
  Bar,
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

// Y axes size themselves to their widest rendered tick label (recharts
// `width="auto"`) rather than a fixed px value. The old pairing — width={40}
// with a negative left margin to claw back the dead gutter — drew the axis
// partly OUTSIDE the container, so any label wider than two digits ("200",
// "1400") got its leading digit clipped by Box's overflow-hidden. Auto width
// reclaims the same gutter honestly: no label can outgrow its own axis. The
// 2px side margins are the rounding allowance — auto width measures a hair
// under the painted glyph, which would shave the outermost label's last pixel.
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

/** The link economy per day: links minted + signed conversions (bars, left
 *  axis) with dollars moved through links (line, right axis). */
export function LinksDaily({ daily }: { daily: { day: string; minted: number; convs: number; usd: number }[] }) {
  const C = useChartColors()
  if (daily.length === 0) return <Empty label="No link activity in this window yet." />
  return (
    <Box height={220}>
      <ComposedChart data={daily} margin={{ top: 8, right: 2, left: 2, bottom: 0 }}>
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="day" tickFormatter={dayLabel} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} />
        <YAxis yAxisId="n" allowDecimals={false} tick={{ fill: C.muted, fontSize: 11 }} axisLine={false} tickLine={false} width="auto" />
        <YAxis
          yAxisId="usd"
          orientation="right"
          tickFormatter={(v) => `$${Number(v) >= 1000 ? `${Math.round(Number(v) / 1000)}k` : v}`}
          tick={{ fill: C.muted, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width="auto"
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
