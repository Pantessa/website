'use client'

// The policy pool's two time charts (recharts; loaded on demand by
// PolicyPoolLive through next/dynamic so the page's first load ships none of
// it). Dataviz rules: thin bars capped at 24px, 4px rounded data-end and
// square at the baseline, a 2px surface gap between stacked segments, a
// recessive hairline grid, one axis, a legend for the two-series chart
// (none for the single-series one — the title names it), hover on every bar,
// text in text tokens. Colors: fills = --mk-series-3 (green), refusals =
// --mk-series-2 (orange) — validated pair (CVD ΔE 8.8 dark / 9.8 light),
// and the legend + tooltip carry identity too, never color alone.

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts'
import type { PolicyPoolBucket } from '@/lib/policy-pool/ledger'
import { fmtUsd } from '@/components/policy-pool/format'

const FILL = 'var(--mk-series-3)'
const REFUSE = 'var(--mk-series-2)'
const MONEY = 'var(--accent)'
const AXIS = { fontSize: 10, fontFamily: 'var(--mk-font-mono)', fill: 'var(--muted-2)' }

const hourLabel = (t: string) => new Date(t).toLocaleTimeString('en-US', { hour: 'numeric', hour12: false }).padStart(2, '0') + 'h'
const dayLabel = (t: string) => new Date(t).toLocaleDateString('en-US', { month: 'short', day: 'numeric' })

/** A bar with a 4px rounded data-end and a square baseline. `rounded` false
 *  = an interior stack segment (square both ends). */
function RoundedTop(props: { x?: number; y?: number; width?: number; height?: number; fill?: string; rounded?: boolean }) {
  const { x = 0, y = 0, width = 0, height = 0, fill, rounded = true } = props
  if (height <= 0 || width <= 0) return null
  const r = rounded ? Math.min(4, width / 2, height) : 0
  const d = `M${x},${y + height} L${x},${y + r} Q${x},${y} ${x + r},${y} L${x + width - r},${y} Q${x + width},${y} ${x + width},${y + r} L${x + width},${y + height} Z`
  return <path d={d} fill={fill} />
}

type TipProps = { active?: boolean; payload?: { payload: PolicyPoolBucket }[] }

function Tip({ active, payload, label, money }: TipProps & { label: (t: string) => string; money?: boolean }) {
  if (!active || !payload?.length) return null
  const b = payload[0].payload
  return (
    <div className="pp-tip">
      <div className="pp-tip__k">{label(b.t)}</div>
      {money ? (
        <div className="pp-tip__row">
          <span>Volume</span>
          <b>{fmtUsd(b.volumeUsd)}</b>
        </div>
      ) : (
        <>
          <div className="pp-tip__row">
            <i style={{ background: FILL }} />
            <span>Fills</span>
            <b>{b.fills}</b>
          </div>
          <div className="pp-tip__row">
            <i style={{ background: REFUSE }} />
            <span>Refusals</span>
            <b>{b.refusals}</b>
          </div>
        </>
      )}
    </div>
  )
}

const intTick = (v: number) => (Number.isInteger(v) ? String(v) : '')
/** Dollar ticks that stay distinct at demo sizes ($0.50 · $1.00 · $1.50), compact from $1K. */
const usdTick = (v: number) => (v >= 1000 ? `$${Math.round(v / 1000)}K` : v >= 10 ? `$${Math.round(v)}` : v === 0 ? '$0' : `$${v.toFixed(2)}`)

export function FillsVsRefusals({ hourly }: { hourly: PolicyPoolBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={hourly} margin={{ top: 8, right: 4, bottom: 0, left: -18 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="t" tickFormatter={hourLabel} tick={AXIS} axisLine={false} tickLine={false} interval="preserveEnd" minTickGap={18} />
        <YAxis allowDecimals={false} tickFormatter={intTick} tick={AXIS} axisLine={false} tickLine={false} width={40} />
        <Tooltip cursor={{ fill: 'color-mix(in srgb, var(--fg) 6%, transparent)' }} content={<Tip label={(t) => `${dayLabel(t)} · ${hourLabel(t)}`} />} />
        <Bar
          dataKey="fills"
          stackId="a"
          fill={FILL}
          maxBarSize={24}
          isAnimationActive={false}
          shape={(p: unknown) => {
            const q = p as { payload: PolicyPoolBucket; x: number; y: number; width: number; height: number }
            return <RoundedTop {...q} fill={FILL} rounded={q.payload.refusals === 0} />
          }}
        />
        <Bar
          dataKey="refusals"
          stackId="a"
          fill={REFUSE}
          maxBarSize={24}
          isAnimationActive={false}
          shape={(p: unknown) => {
            const q = p as { payload: PolicyPoolBucket; x: number; y: number; width: number; height: number }
            // The 2px surface gap: the top segment starts 2px above the one below.
            const lifted = q.payload.fills > 0 ? { ...q, height: q.height - 2 } : q
            return <RoundedTop {...lifted} fill={REFUSE} />
          }}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}

export function VolumeByDay({ daily }: { daily: PolicyPoolBucket[] }) {
  return (
    <ResponsiveContainer width="100%" height={200}>
      <BarChart data={daily} margin={{ top: 8, right: 4, bottom: 0, left: -6 }} barCategoryGap="28%">
        <CartesianGrid vertical={false} stroke="var(--line)" />
        <XAxis dataKey="t" tickFormatter={dayLabel} tick={AXIS} axisLine={false} tickLine={false} interval="preserveEnd" minTickGap={18} />
        <YAxis tickFormatter={usdTick} tick={AXIS} axisLine={false} tickLine={false} width={52} />
        <Tooltip cursor={{ fill: 'color-mix(in srgb, var(--fg) 6%, transparent)' }} content={<Tip label={dayLabel} money />} />
        <Bar
          dataKey="volumeUsd"
          fill={MONEY}
          maxBarSize={24}
          isAnimationActive={false}
          shape={(p: unknown) => <RoundedTop {...(p as { x: number; y: number; width: number; height: number })} fill={MONEY} />}
        />
      </BarChart>
    </ResponsiveContainer>
  )
}
