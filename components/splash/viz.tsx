'use client'

// The splash cards' charts — hand-rolled SVG/CSS on the site's tokens (no
// chart library in the chat bundle; both themes for free through --accent /
// --sell / --gold / --fg). Every input is a TileViz (lib/splash/types.ts):
// numbers a source emitted ON PURPOSE for drawing. Formatting here is
// chart-label formatting of those numbers, nothing is re-priced.

import { useId } from 'react'
import TokenIcon from '@/components/TokenIcon'
import type { MoneyBucket, MoneyMap, TileViz } from '@/lib/splash/types'
import { summarizeMoneyMap } from '@/lib/splash/money-map'
import { Sparkline } from './Sparkline'

// ── formatters (chart labels) ────────────────────────────────────────────────

export function fmtUsd(n: number): string {
  if (!Number.isFinite(n)) return '—'
  const abs = Math.abs(n)
  const sign = n < 0 ? '−' : ''
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(abs >= 10_000_000 ? 0 : 1)}M`
  if (abs >= 10_000) return `${sign}$${(abs / 1000).toFixed(abs >= 100_000 ? 0 : 1)}k`
  if (abs >= 1000) return `${sign}$${abs.toLocaleString('en-US', { maximumFractionDigits: 0 })}`
  if (abs >= 1) return `${sign}$${abs.toFixed(2)}`
  return `${sign}$${abs.toFixed(abs < 0.01 ? 4 : 2)}`
}

const pct = (n: number, digits = 0) => `${n.toFixed(digits)}%`

// ── the segmented bar (money map + allocation share one drawing) ─────────────

export interface BarSegment {
  key: string
  label: string
  pct: number
  color: string
  /** Diagonal hatch (the "stuck" bucket — money that exists but can't move). */
  hatch?: boolean
  title?: string
}

export function SegmentBar({ segments, height = 12, className }: { segments: BarSegment[]; height?: number; className?: string }) {
  const hid = useId().replace(/:/g, '')
  const total = segments.reduce((n, s) => n + s.pct, 0) || 1
  let x = 0
  return (
    <svg
      viewBox="0 0 100 10"
      preserveAspectRatio="none"
      width="100%"
      height={height}
      className={`block overflow-hidden rounded-full ${className ?? ''}`}
      role="img"
      aria-label={segments.map((s) => `${s.label} ${pct(s.pct)}`).join(', ')}
    >
      <defs>
        <pattern id={`hatch-${hid}`} width="2" height="2" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
          <rect width="2" height="2" fill="var(--surf-2)" />
          <rect width="0.8" height="2" fill="var(--muted-2)" />
        </pattern>
      </defs>
      <rect x="0" y="0" width="100" height="10" fill="var(--surf-2)" />
      {segments.map((s) => {
        const w = (s.pct / total) * 100
        const el = (
          <rect key={s.key} x={x} y="0" width={Math.max(0, w - 0.35)} height="10" style={{ fill: s.hatch ? `url(#hatch-${hid})` : s.color }}>
            {s.title && <title>{s.title}</title>}
          </rect>
        )
        x += w
        return el
      })}
    </svg>
  )
}

function Swatch({ color, hatch }: { color: string; hatch?: boolean }) {
  return (
    <span
      aria-hidden
      className="inline-block h-2 w-2 shrink-0 rounded-[2px]"
      style={
        hatch
          ? { backgroundImage: `repeating-linear-gradient(45deg, var(--muted-2) 0 1px, var(--surf-2) 1px 3px)` }
          : { background: color }
      }
    />
  )
}

// ── the money map ────────────────────────────────────────────────────────────

const BUCKET_COLOR: Record<MoneyBucket, string> = {
  earning: 'var(--accent)',
  protected: 'color-mix(in srgb, var(--accent) 48%, var(--fg))',
  stocks: 'color-mix(in srgb, var(--fg) 82%, transparent)',
  spot: 'color-mix(in srgb, var(--fg) 42%, transparent)',
  idle: 'var(--gold)',
  risk: 'var(--sell)',
  stuck: 'var(--muted-2)',
}

/** The hero's bar: every dollar the cards can see, by what it's doing. */
export function MoneyMapPanel({ map }: { map: MoneyMap }) {
  const sum = summarizeMoneyMap(map)
  if (sum.segments.length === 0) return null
  const segments: BarSegment[] = sum.segments.map((s) => ({
    key: s.bucket,
    label: s.label,
    pct: s.pct,
    color: BUCKET_COLOR[s.bucket],
    hatch: s.bucket === 'stuck',
    title: `${s.label} · ${fmtUsd(s.usd)} · ${s.facts.map((f) => `${fmtUsd(f.usd)} ${f.label}`).join(', ')}`,
  }))
  const exposed = sum.segments.filter((s) => s.bucket === 'risk' || s.bucket === 'idle' || s.bucket === 'stuck').reduce((n, s) => n + s.usd, 0)
  return (
    <div data-splash-moneymap className="flex flex-col gap-3">
      <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-1">
        <div className="flex items-baseline gap-2">
          <span className="text-2xl font-semibold tracking-tight text-white tabular-nums" style={{ fontFamily: 'var(--font-chat-display)' }}>
            {fmtUsd(sum.totalUsd)}
          </span>
          <span className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">on the map</span>
        </div>
        <span className="mono text-[11px] tabular-nums text-[color:var(--muted)]">
          <span style={{ color: 'var(--accent)' }}>{sum.workingPct}%</span> working or watched
          {exposed > 0 && (
            <>
              {' · '}
              <span style={{ color: 'var(--gold)' }}>{fmtUsd(exposed)}</span> sitting or exposed
            </>
          )}
        </span>
      </div>
      <SegmentBar segments={segments} height={14} />
      <ul className="grid grid-cols-1 gap-x-5 gap-y-1.5 min-[420px]:grid-cols-2" aria-label="money map legend">
        {sum.segments.map((s) => (
          <li key={s.bucket} className="flex min-w-0 items-center gap-2 text-[11px]" title={`${s.blurb} — ${s.facts.map((f) => `${fmtUsd(f.usd)} ${f.label}`).join(', ')}`}>
            <Swatch color={BUCKET_COLOR[s.bucket]} hatch={s.bucket === 'stuck'} />
            <span className="truncate text-[color:var(--muted)]">{s.label}</span>
            <span className="ml-auto shrink-0 tabular-nums text-white">{fmtUsd(s.usd)}</span>
            <span className="mono w-7 shrink-0 text-right text-[10px] tabular-nums text-[color:var(--muted-2)]">{pct(s.pct)}</span>
          </li>
        ))}
      </ul>
      <p className="mono text-[10px] text-[color:var(--muted-2)]">
        {map.readChains.length > 0 ? `read: ${map.readChains.join(' · ')}` : 'from the cards below'}
        {map.readChains.length > 0 ? ' + the cards below' : ''}
        {map.failedChains.length > 0 && <span style={{ color: 'var(--gold)' }}> · unread: {map.failedChains.join(', ')}</span>}
      </p>
    </div>
  )
}

// ── allocation (holdings cards) ──────────────────────────────────────────────

/** A monochrome ramp off the accent — parts of ONE whole read as one system;
 *  the token marks in the legend carry identity. */
const rampColor = (i: number, n: number, other: boolean) =>
  other ? 'var(--muted-2)' : `color-mix(in srgb, var(--accent) ${Math.max(18, 100 - (i * 78) / Math.max(1, n - 1))}%, var(--fg))`

export function AllocationViz({ viz, chain }: { viz: Extract<TileViz, { kind: 'allocation' }>; chain?: string }) {
  if (viz.totalUsd <= 0 || viz.slices.length === 0) return null
  const named = viz.slices.filter((s) => s.symbol).length
  const segments: BarSegment[] = viz.slices.map((s, i) => ({
    key: s.label,
    label: s.label,
    pct: (s.usd / viz.totalUsd) * 100,
    color: rampColor(i, named, !s.symbol),
    title: `${s.label} · ${fmtUsd(s.usd)} · ${pct((s.usd / viz.totalUsd) * 100)}`,
  }))
  return (
    <div data-splash-viz="allocation" className="flex flex-col gap-2">
      <SegmentBar segments={segments} height={10} />
      <ul className="flex flex-wrap gap-x-3 gap-y-1" aria-label="allocation legend">
        {viz.slices.map((s, i) => (
          <li key={s.label} className="flex items-center gap-1.5 text-[11px]" title={`${s.label} · ${fmtUsd(s.usd)}`}>
            {s.symbol ? <TokenIcon symbol={s.symbol} size={14} chain={chain} /> : <Swatch color={rampColor(i, named, true)} />}
            <span className="text-[color:var(--muted)]">{s.label}</span>
            <span className="mono text-[10px] tabular-nums text-[color:var(--muted-2)]">{pct((s.usd / viz.totalUsd) * 100)}</span>
          </li>
        ))}
      </ul>
    </div>
  )
}

// ── lending (Aave / Morpho) ──────────────────────────────────────────────────

function hfTone(hf: number): string {
  return hf < 1.2 ? 'var(--sell)' : hf < 1.5 ? 'var(--gold)' : 'var(--accent)'
}

/** Health-factor gauge: a half ring over [1, 3] (1 = liquidation) with the
 *  three zones painted and a needle at the value. Above 3 pins to the end. */
export function HealthGauge({ hf }: { hf: number }) {
  const W = 96
  const H = 56
  const cx = W / 2
  const cy = H - 6
  const r = 40
  const arc = (from: number, to: number) => {
    // 0 → left (180°), 1 → right (0°)
    const a0 = Math.PI - from * Math.PI
    const a1 = Math.PI - to * Math.PI
    const x0 = cx + r * Math.cos(a0)
    const y0 = cy - r * Math.sin(a0)
    const x1 = cx + r * Math.cos(a1)
    const y1 = cy - r * Math.sin(a1)
    return `M${x0.toFixed(2)},${y0.toFixed(2)} A${r},${r} 0 0 1 ${x1.toFixed(2)},${y1.toFixed(2)}`
  }
  const t = (v: number) => Math.max(0, Math.min(1, (v - 1) / 2))
  const v = t(hf)
  const a = Math.PI - v * Math.PI
  const nx = cx + (r - 9) * Math.cos(a)
  const ny = cy - (r - 9) * Math.sin(a)
  return (
    <div className="flex flex-col items-center" data-splash-gauge={hf.toFixed(2)}>
      <svg width={W} height={H} viewBox={`0 0 ${W} ${H}`} aria-label={`health factor ${hf.toFixed(2)}`} role="img">
        <path d={arc(0, 1)} fill="none" stroke="var(--surf-2)" strokeWidth={7} strokeLinecap="round" />
        <path d={arc(0, t(1.2))} fill="none" stroke="var(--sell)" strokeWidth={7} strokeOpacity={0.55} />
        <path d={arc(t(1.2), t(1.5))} fill="none" stroke="var(--gold)" strokeWidth={7} strokeOpacity={0.55} />
        <path d={arc(t(1.5), 1)} fill="none" stroke="var(--accent)" strokeWidth={7} strokeOpacity={0.45} strokeLinecap="round" />
        <line x1={cx} y1={cy} x2={nx} y2={ny} stroke={hfTone(hf)} strokeWidth={2} strokeLinecap="round" />
        <circle cx={cx} cy={cy} r={3} fill={hfTone(hf)} />
        <text x={cx} y={cy - 12} textAnchor="middle" fontSize="13" fontWeight={600} fill="var(--fg)" className="tabular-nums">
          {hf >= 100 ? '∞' : hf.toFixed(2)}
        </text>
      </svg>
      <span className="mono -mt-1 text-[9px] uppercase tracking-wider text-[color:var(--muted-2)]">health factor</span>
    </div>
  )
}

export function LendingViz({ viz }: { viz: Extract<TileViz, { kind: 'lending' }> }) {
  const hasBars = viz.suppliedUsd != null || (viz.borrowedUsd != null && viz.borrowedUsd > 0)
  const hasGauge = viz.healthFactor != null
  if (!hasBars && !hasGauge) return null
  const max = Math.max(viz.suppliedUsd ?? 0, viz.borrowedUsd ?? 0) || 1
  const yearly = viz.suppliedUsd != null && viz.netApyPct != null ? (viz.suppliedUsd * viz.netApyPct) / 100 : null
  const Bar = ({ label, usd, color }: { label: string; usd: number; color: string }) => (
    <div className="flex items-center gap-2 text-[11px]">
      <span className="w-14 shrink-0 text-[color:var(--muted)]">{label}</span>
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-[var(--surf-2)]">
        <div className="h-full rounded-full" style={{ width: `${Math.max(2, (usd / max) * 100)}%`, background: color }} />
      </div>
      <span className="w-16 shrink-0 text-right tabular-nums text-white">{fmtUsd(usd)}</span>
    </div>
  )
  return (
    <div data-splash-viz="lending" className="flex items-center gap-4">
      {hasBars && (
        <div className="flex min-w-0 flex-1 flex-col gap-1.5">
          {viz.suppliedUsd != null && <Bar label="supplied" usd={viz.suppliedUsd} color="var(--accent)" />}
          {viz.borrowedUsd != null && viz.borrowedUsd > 0 && <Bar label="borrowed" usd={viz.borrowedUsd} color="var(--sell)" />}
          {yearly != null && (
            <p className="mono mt-0.5 text-[10px] text-[color:var(--muted-2)]">
              ≈ <span style={{ color: 'var(--accent)' }}>{fmtUsd(yearly)}</span>/yr at {viz.netApyPct!.toFixed(2)}% net
            </p>
          )}
        </div>
      )}
      {hasGauge && <HealthGauge hf={viz.healthFactor!} />}
    </div>
  )
}

// ── yield projection (Lido) ──────────────────────────────────────────────────

export function YieldViz({ viz }: { viz: Extract<TileViz, { kind: 'yield' }> }) {
  const gid = useId().replace(/:/g, '')
  if (!(viz.principalUsd > 0) || !Number.isFinite(viz.aprPct)) return null
  const W = 200
  const H = 44
  const months = 12
  const end = viz.principalUsd * (1 + viz.aprPct / 100)
  const gain = end - viz.principalUsd
  const lo = viz.principalUsd
  const hi = end > lo ? end : lo * 1.001
  const pts: [number, number][] = []
  for (let m = 0; m <= months; m++) {
    const v = viz.principalUsd * Math.pow(1 + viz.aprPct / 100, m / 12)
    pts.push([(m / months) * W, 3 + (1 - (v - lo) / (hi - lo || 1)) * (H - 6)])
  }
  const line = pts.map(([x, y], i) => `${i ? 'L' : 'M'}${x.toFixed(1)},${y.toFixed(1)}`).join(' ')
  const area = `${line} L${W},${H} L0,${H} Z`
  return (
    <div data-splash-viz="yield" className="flex flex-col gap-1.5">
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" width="100%" height={H} className="block" aria-hidden>
          <defs>
            <linearGradient id={`yg-${gid}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0" stopColor="var(--accent)" stopOpacity={0.3} />
              <stop offset="1" stopColor="var(--accent)" stopOpacity={0} />
            </linearGradient>
          </defs>
          {[3, 6, 9].map((m) => (
            <line key={m} x1={(m / 12) * W} y1={0} x2={(m / 12) * W} y2={H} stroke="var(--line)" strokeDasharray="2 3" strokeWidth={0.6} />
          ))}
          <path d={area} fill={`url(#yg-${gid})`} />
          <path d={line} fill="none" stroke="var(--accent)" strokeWidth={1.5} vectorEffect="non-scaling-stroke" />
        </svg>
        <span className="mono absolute right-0 top-0 text-[10px] tabular-nums" style={{ color: 'var(--accent)' }}>
          +{fmtUsd(gain)}
        </span>
        <span className="mono absolute bottom-0 left-0 text-[9px] text-[color:var(--muted-2)]">now</span>
        <span className="mono absolute bottom-0 right-0 text-[9px] text-[color:var(--muted-2)]">12 mo</span>
      </div>
      <p className="mono text-[10px] text-[color:var(--muted-2)]">
        ≈ <span className="text-white">{fmtUsd(gain)}</span> a year at {viz.aprPct.toFixed(2)}% · {viz.caption} · a projection, not a promise
      </p>
    </div>
  )
}

// ── perp positions (Hyperliquid) ─────────────────────────────────────────────

export function PositionsViz({ viz }: { viz: Extract<TileViz, { kind: 'positions' }> }) {
  if (viz.items.length === 0) return null
  const maxAbs = Math.max(...viz.items.map((p) => Math.abs(p.pnlUsd)), 1)
  return (
    <div data-splash-viz="positions" className="flex flex-col gap-2.5">
      {viz.items.map((p) => {
        const up = p.pnlUsd >= 0
        const w = (Math.abs(p.pnlUsd) / maxAbs) * 50
        const liq = p.liqDistancePct
        const liqTone = liq == null ? 'var(--muted-2)' : liq < 10 ? 'var(--sell)' : liq < 25 ? 'var(--gold)' : 'var(--accent)'
        return (
          <div key={`${p.coin}-${p.side}`} className="flex items-center gap-3">
            <div className="flex w-[7.5rem] shrink-0 items-center gap-1.5 text-[11px]">
              <TokenIcon symbol={p.coin} size={16} />
              <span className="font-medium text-white">{p.coin}</span>
              <span className="mono text-[9px] uppercase text-[color:var(--muted-2)]">
                {p.side}
                {p.leverage ? ` ${p.leverage}x` : ''}
              </span>
            </div>
            <div className="relative h-2.5 min-w-0 flex-1 overflow-hidden rounded-full bg-[var(--surf-2)]" title={`unrealized PnL ${fmtUsd(p.pnlUsd)} on ${fmtUsd(p.valueUsd)}`}>
              <div className="absolute inset-y-0 left-1/2 w-px bg-[var(--line-2)]" />
              <div
                className="absolute inset-y-0 rounded-full"
                style={up ? { left: '50%', width: `${w}%`, background: 'var(--accent)' } : { right: '50%', width: `${w}%`, background: 'var(--sell)' }}
              />
            </div>
            <span className="w-16 shrink-0 text-right text-[11px] tabular-nums" style={{ color: up ? 'var(--accent)' : 'var(--sell)' }}>
              {up ? '+' : '−'}
              {fmtUsd(Math.abs(p.pnlUsd))}
            </span>
            <span className="mono hidden w-24 shrink-0 text-right text-[10px] tabular-nums sm:inline" style={{ color: liqTone }} title="distance from mark to liquidation price">
              {liq == null ? 'no liq px' : `liq ${liq.toFixed(1)}% away`}
            </span>
            <Sparkline symbol={p.coin} width={64} height={22} className="hidden md:block" />
          </div>
        )
      })}
    </div>
  )
}

// ── recurring buys (DCA) ─────────────────────────────────────────────────────

const STATE_LABEL: Record<Extract<TileViz, { kind: 'cadence' }>['items'][number]['state'], { label: string; color: string }> = {
  due: { label: 'due now', color: 'var(--accent)' },
  live: { label: 'awaiting signature', color: 'var(--gold)' },
  bought: { label: 'bought this period', color: 'var(--accent)' },
  paused: { label: 'paused', color: 'var(--muted-2)' },
  auto: { label: 'autopilot', color: 'var(--accent)' },
  'auto-error': { label: 'autopilot · needs you', color: 'var(--sell)' },
}

export function CadenceViz({ viz }: { viz: Extract<TileViz, { kind: 'cadence' }> }) {
  if (viz.items.length === 0) return null
  const perMonth: Record<string, number> = { daily: 30, weekly: 4.33, monthly: 1 }
  const active = viz.items.filter((i) => i.state !== 'paused')
  const monthly = active.map((i) => i.buyUsd * (perMonth[i.cadence] ?? 1))
  const total = monthly.reduce((n, x) => n + x, 0)
  const segments: BarSegment[] = active.map((i, idx) => ({
    key: `${i.token}-${idx}`,
    label: i.token,
    pct: total > 0 ? (monthly[idx] / total) * 100 : 0,
    color: rampColor(idx, active.length, false),
    title: `${i.token} · ${fmtUsd(monthly[idx])}/mo`,
  }))
  return (
    <div data-splash-viz="cadence" className="flex flex-col gap-2">
      <div className="flex items-baseline gap-2">
        <span className="text-xl font-semibold tracking-tight text-white tabular-nums">{fmtUsd(viz.monthlyUsd)}</span>
        <span className="text-[11px] text-[color:var(--muted-2)]">a month on the calendar · {active.length} active</span>
      </div>
      {segments.length > 0 && <SegmentBar segments={segments} height={8} />}
      <ul className="flex flex-col gap-1">
        {viz.items.map((i, idx) => {
          const st = STATE_LABEL[i.state]
          return (
            <li key={`${i.token}-${idx}`} className="flex items-center gap-2 text-[11px]">
              <span aria-hidden className="inline-block h-1.5 w-1.5 shrink-0 rounded-full" style={{ background: st.color, boxShadow: i.state === 'due' ? `0 0 0 3px color-mix(in srgb, ${st.color} 25%, transparent)` : undefined }} />
              <TokenIcon symbol={i.token} size={14} />
              <span className="text-white">
                {fmtUsd(i.buyUsd)} → {i.token}
              </span>
              <span className="text-[color:var(--muted-2)]">{i.cadence}</span>
              <span className="mono ml-auto text-[10px]" style={{ color: st.color }}>
                {st.label}
              </span>
            </li>
          )
        })}
      </ul>
    </div>
  )
}

// ── thin progress under a row ────────────────────────────────────────────────

export function RowProgress({ pct: p, color = 'var(--accent)' }: { pct: number; color?: string }) {
  const v = Math.max(0, Math.min(100, p))
  return (
    <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-[var(--surf-2)]" role="progressbar" aria-valuenow={Math.round(v)} aria-valuemin={0} aria-valuemax={100}>
      <div className="h-full rounded-full" style={{ width: `${v}%`, background: color }} />
    </div>
  )
}

// ── router ───────────────────────────────────────────────────────────────────

export function TileVizBlock({ viz, chain }: { viz?: TileViz; chain?: string }) {
  if (!viz) return null
  switch (viz.kind) {
    case 'allocation':
      return <AllocationViz viz={viz} chain={chain} />
    case 'lending':
      return <LendingViz viz={viz} />
    case 'yield':
      return <YieldViz viz={viz} />
    case 'positions':
      return <PositionsViz viz={viz} />
    case 'cadence':
      return <CadenceViz viz={viz} />
    default:
      return null
  }
}
