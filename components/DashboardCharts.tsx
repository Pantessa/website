'use client'

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts'

const ACCENT = '#34E0A1'
const GRID = 'rgba(255,255,255,0.06)'
const MUTED = 'rgba(255,255,255,0.45)'
const PALETTE = ['#34E0A1', '#6AA8FF', '#D97757', '#F59E0B', '#E84142', '#8DC63F', '#0BA5EC', '#3861FB']

const tooltipStyle = {
  background: '#101012',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  fontSize: 12,
  color: '#fff',
} as const

function dayLabel(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** Daily spend over the last 30 days — area chart. */
export function SpendOverTime({ daily }: { daily: { day: string; spent: number; calls: number }[] }) {
  if (daily.length === 0) {
    return <EmptyChart label="No spend yet — payments will chart here." />
  }
  return (
    <ResponsiveContainer width="100%" height={220}>
      <AreaChart data={daily} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="spendFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis
          dataKey="day"
          tickFormatter={dayLabel}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          tickFormatter={(v: number) => `$${v}`}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
          width={64}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          labelFormatter={(l) => new Date(l as string).toUTCString().slice(0, 16)}
          formatter={(value, name) =>
            name === 'spent' ? [`$${Number(value).toFixed(4)}`, 'spent'] : [String(value), 'calls']
          }
        />
        <Area type="monotone" dataKey="spent" stroke={ACCENT} strokeWidth={2} fill="url(#spendFill)" />
      </AreaChart>
    </ResponsiveContainer>
  )
}

/** Per-agent spend — horizontal bars, one color per agent. */
export function SpendByAgent({ perAgent }: { perAgent: { service: string; spent: number; calls: number }[] }) {
  if (perAgent.length === 0) {
    return <EmptyChart label="No per-agent data yet." />
  }
  const height = Math.max(160, perAgent.length * 34)
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={perAgent} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis
          type="number"
          tickFormatter={(v: number) => `$${v}`}
          tick={{ fill: MUTED, fontSize: 11 }}
          axisLine={false}
          tickLine={false}
        />
        <YAxis
          type="category"
          dataKey="service"
          width={120}
          tick={{ fill: '#fff', fontSize: 12 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(value, name) =>
            name === 'spent' ? [`$${Number(value).toFixed(4)}`, 'spent'] : [String(value), 'calls']
          }
        />
        <Bar dataKey="spent" radius={[0, 6, 6, 0]} barSize={16}>
          {perAgent.map((row, i) => (
            <Cell key={row.service} fill={PALETTE[i % PALETTE.length]} fillOpacity={0.85} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  )
}

function EmptyChart({ label }: { label: string }) {
  return (
    <div className="h-[220px] grid place-items-center text-xs text-[color:var(--muted-2)]">
      {label}
    </div>
  )
}
