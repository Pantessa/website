'use client'

import Link from 'next/link'
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

const tooltipStyle = {
  background: '#101012',
  border: '1px solid rgba(255,255,255,0.12)',
  borderRadius: 10,
  fontSize: 12,
  fontFamily: "'Geist Mono', ui-monospace, monospace",
  color: '#fff',
} as const
// Recharts' default hover cursor is a bright grey rect — brutal on a dark
// theme (it reads as a phantom full-width bar). Whisper-quiet instead.
const barCursor = { fill: 'rgba(255,255,255,0.04)' } as const
const lineCursor = { stroke: 'rgba(255,255,255,0.18)', strokeDasharray: '3 4' } as const

function dayLabel(iso: string): string {
  const d = new Date(iso)
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()}`
}

/** Axis-friendly service name: hostnames keep their first label, anything
 * long gets an ellipsis — the tooltip still carries the full name. Without
 * this, "tripadvisor.x402.paysponge.com" clips to ".x402.paysponge.com"
 * inside the fixed-width category axis. */
function serviceLabel(name: string): string {
  let s = name
  if (s.includes('.') && !s.includes(' ')) {
    const first = s.split('.')[0]
    if (first.length >= 3) s = first
  }
  return s.length > 16 ? `${s.slice(0, 15)}…` : s
}

/** Daily spend over the last 30 days — area chart. */
export function SpendOverTime({ daily }: { daily: { day: string; spent: number; calls: number }[] }) {
  if (daily.length === 0) {
    return <EmptyChart label="No spend yet — payments will chart here." cta={{ href: '/chat', label: 'Run your first call →' }} />
  }
  return (
    <ChartBox height={220}>
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
          cursor={lineCursor}
          contentStyle={tooltipStyle}
          labelFormatter={(l) => new Date(l as string).toUTCString().slice(0, 16)}
          formatter={(value, name) =>
            name === 'spent' ? [`$${Number(value).toFixed(4)}`, 'spent'] : [String(value), 'calls']
          }
        />
        <Area type="monotone" dataKey="spent" stroke={ACCENT} strokeWidth={2} fill="url(#spendFill)" />
      </AreaChart>
    </ChartBox>
  )
}

/** Per-agent spend — horizontal bars, one color per agent. */
export function SpendByAgent({ perAgent }: { perAgent: { service: string; spent: number; calls: number }[] }) {
  if (perAgent.length === 0) {
    return <EmptyChart label="No spend yet — services you pay will show here." cta={{ href: '/chat', label: 'Run your first call →' }} />
  }
  const height = Math.max(160, perAgent.length * 34)
  return (
    <ChartBox height={height}>
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
          tickFormatter={serviceLabel}
          tick={{ fill: MUTED, fontSize: 11.5 }}
          axisLine={false}
          tickLine={false}
        />
        <Tooltip
          cursor={barCursor}
          contentStyle={tooltipStyle}
          formatter={(value, name) =>
            name === 'spent' ? [`$${Number(value).toFixed(4)}`, 'spent'] : [String(value), 'calls']
          }
        />
        <Bar dataKey="spent" radius={[0, 6, 6, 0]} barSize={14}>
          {perAgent.map((row, i) => (
            // Ranked bars: the leader earns the accent, the rest fade down a
            // greyscale ramp — same treatment as the blog charts.
            <Cell
              key={row.service}
              fill={i === 0 ? ACCENT : '#ffffff'}
              fillOpacity={i === 0 ? 0.9 : Math.max(0.24, 0.62 - ((i - 1) / Math.max(1, perAgent.length - 2)) * 0.38)}
            />
          ))}
        </Bar>
      </BarChart>
    </ChartBox>
  )
}

/**
 * Overflow guard for ResponsiveContainer: recharts pins the measured width as
 * inline px on .recharts-wrapper, so a chart measured while the column was
 * transiently wide can hold the layout open on phones. min-width:0 lets the
 * box shrink inside grid/flex parents; overflow-hidden keeps the stale px
 * width from widening the page while the resize observer catches up.
 */
function ChartBox({ height, children }: { height: number; children: React.ReactElement }) {
  return (
    <div className="min-w-0 overflow-hidden">
      <ResponsiveContainer width="100%" height={height}>
        {children}
      </ResponsiveContainer>
    </div>
  )
}

function EmptyChart({ label, cta }: { label: string; cta?: { href: string; label: string } }) {
  return (
    <div className="h-[220px] flex flex-col items-center justify-center gap-2.5 text-center px-4">
      <p className="text-xs text-[color:var(--muted-2)]">{label}</p>
      {cta && (
        <Link
          href={cta.href}
          className="inline-flex items-center text-xs font-medium px-3 py-1.5 rounded-lg border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white transition-colors"
        >
          {cta.label}
        </Link>
      )}
    </div>
  )
}

/** USD price label that keeps sig figs on sub-$1 (memecoin) prices. */
function priceLabel(v: number): string {
  if (!isFinite(v) || v <= 0) return '$0'
  if (v >= 1) return `$${v.toLocaleString(undefined, { maximumFractionDigits: 2 })}`
  return `$${v.toPrecision(2)}`
}
function timeLabel(iso: string): string {
  const d = new Date(iso)
  const p = (n: number) => String(n).padStart(2, '0')
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`
}

/** A launched token's USD price over time — sampled from the v4 pool. */
export function PriceChart({ samples, height = 200 }: { samples: { at: string; priceUsd: number }[]; height?: number }) {
  if (samples.length < 2) {
    return <EmptyChart label="Price history builds as the token trades." />
  }
  return (
    <ChartBox height={height}>
      <AreaChart data={samples} margin={{ top: 8, right: 8, left: -6, bottom: 0 }}>
        <defs>
          <linearGradient id="priceFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="at" tickFormatter={timeLabel} tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={48} />
        <YAxis tickFormatter={priceLabel} tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={72} domain={['auto', 'auto']} />
        <Tooltip cursor={lineCursor} contentStyle={tooltipStyle} labelFormatter={(l) => timeLabel(l as string)} formatter={(v) => [priceLabel(Number(v)), 'price']} />
        <Area type="monotone" dataKey="priceUsd" stroke={ACCENT} strokeWidth={2} fill="url(#priceFill)" />
      </AreaChart>
    </ChartBox>
  )
}

/** Paid calls served per day — an MCP's usage over time. */
export function UsageChart({ data, height = 160 }: { data: { date: string; calls: number }[]; height?: number }) {
  if (!data.some((d) => d.calls > 0)) {
    return <EmptyChart label="Usage fills in as the MCP serves paid calls." />
  }
  return (
    <ChartBox height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="usageFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={ACCENT} stopOpacity={0.35} />
            <stop offset="100%" stopColor={ACCENT} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="date" tickFormatter={dayLabel} tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} minTickGap={40} />
        <YAxis allowDecimals={false} tick={{ fill: MUTED, fontSize: 11 }} axisLine={false} tickLine={false} width={32} />
        <Tooltip cursor={lineCursor} contentStyle={tooltipStyle} labelFormatter={(l) => dayLabel(l as string)} formatter={(v) => [String(v), 'calls']} />
        <Area type="monotone" dataKey="calls" stroke={ACCENT} strokeWidth={2} fill="url(#usageFill)" />
      </AreaChart>
    </ChartBox>
  )
}
