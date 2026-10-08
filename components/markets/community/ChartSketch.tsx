'use client'

// A static SVG sketch of a post's chart state — the LINES, not the candles.
// A post is an annotated chart (BUSINESS-MODEL §4), and the lines are the
// idea: levels, zones, notes, each with the action it carries. Drawing them
// on a price axis derived from the lines themselves keeps the card
// self-contained (no candle fetch per card, no feed dependency) and makes a
// fork ("copy these lines") read as exactly what it is. Text is rendered as
// SVG text nodes — never markup.

import type { ChartLine, ChartState } from '@/lib/chart-state'
import { fibLevels } from '@/lib/chart-draw'

const W = 220
const H = 132
const PAD_R = 58
const PAD_Y = 12

function fmt(n: number): string {
  if (n >= 1000) return n.toLocaleString(undefined, { maximumFractionDigits: 0 })
  if (n >= 1) return n.toLocaleString(undefined, { maximumFractionDigits: 2 })
  return n.toPrecision(3)
}

function pricesOf(l: ChartLine): number[] {
  switch (l.kind) {
    case 'h':
      return [l.price]
    case 'trend':
      return [l.p1, l.p2]
    case 'zone':
      return [l.p1, l.p2]
    case 'note':
      return [l.price]
    case 'fib':
      return [l.p1, l.p2]
    case 'vline':
      return []
  }
}

export default function ChartSketch({ state, caption }: { state: ChartState; caption?: string }) {
  const prices = state.lines.flatMap(pricesOf)
  if (prices.length === 0) {
    return (
      <div className="mkp__sketch" aria-label="Empty chart">
        <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label="No lines on this chart">
          <text x={W / 2} y={H / 2} textAnchor="middle" fontSize="10" fill="var(--muted-2)" fontFamily="ui-monospace, monospace">
            no lines
          </text>
        </svg>
        {caption && <span className="mkp__sketchcap">{caption}</span>}
      </div>
    )
  }
  let lo = Math.min(...prices)
  let hi = Math.max(...prices)
  if (hi === lo) {
    lo *= 0.97
    hi *= 1.03
  } else {
    const pad = (hi - lo) * 0.18
    lo -= pad
    hi += pad
  }
  const y = (p: number) => PAD_Y + ((hi - p) / (hi - lo)) * (H - PAD_Y * 2)
  const times = state.lines.flatMap((l) => (l.kind === 'trend' || l.kind === 'fib' ? [l.t1, l.t2] : l.kind === 'note' || l.kind === 'vline' ? [l.t] : []))
  const t0 = times.length ? Math.min(...times) : 0
  const t1 = times.length ? Math.max(...times) : 1
  const x = (t: number) => (t1 === t0 ? (W - PAD_R) / 2 : 8 + ((t - t0) / (t1 - t0)) * (W - PAD_R - 16))

  return (
    <div className="mkp__sketch">
      <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${state.lines.length} lines on ${state.symbol} ${state.tf}`}>
        {/* faint grid */}
        {[0.25, 0.5, 0.75].map((f) => (
          <line key={f} x1={0} x2={W - PAD_R} y1={PAD_Y + f * (H - PAD_Y * 2)} y2={PAD_Y + f * (H - PAD_Y * 2)} stroke="var(--line)" strokeWidth="0.5" strokeDasharray="2 3" />
        ))}
        {state.lines.map((l) => {
          if (l.kind === 'zone') {
            const top = y(Math.max(l.p1, l.p2))
            const bot = y(Math.min(l.p1, l.p2))
            const color = l.action?.kind === 'sell' || l.action?.kind === 'stop' || l.action?.kind === 'protect' ? 'var(--sell)' : 'var(--accent)'
            return (
              <g key={l.id}>
                <rect x={0} y={top} width={W - PAD_R} height={Math.max(2, bot - top)} fill={color} opacity="0.16" />
                <text x={W - PAD_R + 4} y={top + 4} fontSize="8.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                  {fmt(Math.max(l.p1, l.p2))}
                </text>
                <text x={W - PAD_R + 4} y={bot + 3} fontSize="8.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                  {fmt(Math.min(l.p1, l.p2))}
                </text>
                {l.label && (
                  <text x={4} y={top + 10} fontSize="8.5" fill={color} fontFamily="ui-monospace, monospace">
                    {l.label.slice(0, 22)}
                  </text>
                )}
              </g>
            )
          }
          if (l.kind === 'h') {
            const yy = y(l.price)
            const color = l.action?.kind === 'sell' || l.action?.kind === 'stop' || l.action?.kind === 'protect' ? 'var(--sell)' : 'var(--accent)'
            return (
              <g key={l.id}>
                <line x1={0} x2={W - PAD_R} y1={yy} y2={yy} stroke={color} strokeWidth="1.2" strokeDasharray={l.action ? undefined : '4 3'} />
                <text x={W - PAD_R + 4} y={yy + 3} fontSize="9" fill="var(--fg)" fontFamily="ui-monospace, monospace">
                  {fmt(l.price)}
                </text>
                {(l.label || l.action) && (
                  <text x={4} y={yy - 3} fontSize="8.5" fill={color} fontFamily="ui-monospace, monospace">
                    {(l.label ?? l.action?.kind ?? '').slice(0, 22)}
                  </text>
                )}
              </g>
            )
          }
          if (l.kind === 'vline') {
            return (
              <g key={l.id}>
                <line x1={x(l.t)} x2={x(l.t)} y1={PAD_Y} y2={H - PAD_Y} stroke="var(--muted)" strokeWidth="1" strokeDasharray="3 3" />
                {l.label && (
                  <text x={x(l.t) + 3} y={PAD_Y + 8} fontSize="8.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                    {l.label.slice(0, 18)}
                  </text>
                )}
              </g>
            )
          }
          if (l.kind === 'fib') {
            const left = Math.min(x(l.t1), x(l.t2))
            return (
              <g key={l.id}>
                {fibLevels(l.p1, l.p2).map((lv) =>
                  lv.price < lo || lv.price > hi ? null : (
                    <g key={lv.ratio}>
                      <line x1={left} x2={W - PAD_R} y1={y(lv.price)} y2={y(lv.price)} stroke={lv.ratio === 0 || lv.ratio === 1 ? 'var(--fg)' : 'var(--accent)'} strokeWidth="0.8" strokeDasharray={lv.ratio > 1 ? '2 2' : undefined} opacity="0.7" />
                      <text x={W - PAD_R + 4} y={y(lv.price) + 3} fontSize="7.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                        {lv.label}
                      </text>
                    </g>
                  ),
                )}
              </g>
            )
          }
          if (l.kind === 'trend') {
            return (
              <g key={l.id}>
                <line x1={x(l.t1)} y1={y(l.p1)} x2={x(l.t2)} y2={y(l.p2)} stroke="var(--fg)" strokeWidth="1.2" opacity="0.8" />
                {l.label && (
                  <text x={x(l.t2) - 2} y={y(l.p2) - 4} fontSize="8.5" fill="var(--muted)" textAnchor="end" fontFamily="ui-monospace, monospace">
                    {l.label.slice(0, 22)}
                  </text>
                )}
              </g>
            )
          }
          return (
            <g key={l.id}>
              <circle cx={x(l.t)} cy={y(l.price)} r="3" fill="var(--fg)" />
              <text x={Math.min(x(l.t) + 6, W - PAD_R - 40)} y={y(l.price) + 3} fontSize="8.5" fill="var(--muted)" fontFamily="ui-monospace, monospace">
                {l.text.slice(0, 18)}
              </text>
            </g>
          )
        })}
      </svg>
      <span className="mkp__sketchcap">{caption ?? `${state.symbol} · ${state.tf} · ${state.lines.length} line${state.lines.length === 1 ? '' : 's'}`}</span>
    </div>
  )
}
