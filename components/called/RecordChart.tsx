// The landing's chart (squad called-it, lane RECORD; redrawn by squad
// mobile-sleek, 2026-11-24): the daily closes over the record's window as one
// flat line, a numbered TILE per pinned call on a rail above the line, a small
// square for every other call. Server-rendered, no chart library, no script:
// the line is an SVG in a stretched viewBox inside a box whose height is CSS
// (the way components/home/TheRead draws), and every tile and square is placed
// by percentages. Nothing is measured, so the first frame is the final frame.
//
// A pin is the brand's tile (the stone of the Cut P: a square with its
// top-left and bottom-right corners cut, lit above the diagonal and shaded
// below it; geometry from components/sleek/VerdictTile). It wears the call's
// number (its place in the record, by date) and its verdict's colour; the card
// under the chart wears the same two, and a press on the tile goes to that
// card. Colour is never the only signal: every tile's label says the verdict
// in words, and the key under the plot draws each verdict's tile with its glyph.
//
// No gradient under the line, no glow, no round blob: flat fills, hairlines.
import { ADDED_MARK, VERDICT_WORDS, type CalledCall } from '@/lib/called-it/spec'
import { fmtCallPrice, fmtUtcDate, linePaths, monthTicks, plotScale, railPins, unreadShare, type ClosePoint } from '@/lib/called-it/card-layout'
import VerdictTile, { TILE_OUTLINE } from '@/components/sleek/VerdictTile'
import type { CSSProperties, ReactNode } from 'react'

const BOX = { x: 0, y: 0, w: 1000, h: 300 }
const pct = (f: number) => `${Math.round(f * 10000) / 100}%`
/** The tile's shaded half in the kit's 24 box (the part below the diagonal). */
const TILE_SHADE = 'M 24 0 L 24 18.67 L 18.67 24 L 0 24 Z'
/** Two tiles on one row of the rail never touch on a phone's plot (a 26px tile on about 320px). */
const TILE_MIN_DX = 0.09

/** Unpinned calls posted within this share of the window of each other (about eight days of a year) stand in one column. */
const STACK_DX = 0.022
/** A column's step in px (the sheet's square is 6px on a 1.5px outline) and the plot's least height, to choose which way a column grows. */
const STACK_STEP = 10
const PLOT_MIN_H = 184
const VERDICT_ORDER = { right: 0, wrong: 1, flat: 2, open: 3 } as const

type Placed<P> = { pin: P; x: number; y: number; i: number; dir: 1 | -1; count: number; folded: boolean }

/**
 * WHERE CALLS CLUSTER, THE SQUARES THIN. Unpinned calls that fall within a
 * few days of each other used to pile on one spot of the line. A cluster now
 * shows ONE square per verdict it holds (hits first, then misses), standing
 * in a short column on the line at the cluster's mean day and close, so a
 * miss inside a run of hits is still in sight. A square that stands for
 * several calls is a step larger. Every call keeps its own mark in the page
 * (the folded ones are out of sight, still read aloud), and the key under
 * the plot says how many calls there are and that near ones share a square.
 */
function stackSquares<P extends { x: number; y: number; n: number; verdict: keyof typeof VERDICT_ORDER }>(rest: readonly P[]): Placed<P>[] {
  const out: Placed<P>[] = []
  let bucket: P[] = []
  const flush = () => {
    if (!bucket.length) return
    const x = bucket.reduce((s, p) => s + p.x, 0) / bucket.length
    const y = bucket.reduce((s, p) => s + p.y, 0) / bucket.length
    const kinds = [...new Set(bucket.map((p) => p.verdict))].sort((a, b) => VERDICT_ORDER[a] - VERDICT_ORDER[b])
    const dir: 1 | -1 = y * PLOT_MIN_H >= kinds.length * STACK_STEP ? -1 : 1
    kinds.forEach((kind, i) => {
      const group = bucket.filter((p) => p.verdict === kind).sort((a, b) => a.n - b.n)
      group.forEach((pin, k) => out.push({ pin, x, y, i, dir, count: group.length, folded: k > 0 }))
    })
    bucket = []
  }
  for (const p of [...rest].sort((a, b) => a.x - b.x || a.n - b.n)) {
    if (bucket.length && p.x - bucket[0].x > STACK_DX) flush()
    bucket.push(p)
  }
  flush()
  return out
}

/** The brand's tile with a call's number cut into it: the pin on the chart and the badge on its card. */
export function NumberTile({ n, className }: { n: number; className?: string }) {
  return (
    <span className={`xrc-ntile${className ? ` ${className}` : ''}`}>
      <svg viewBox="0 0 24 24" aria-hidden focusable="false">
        <path d={TILE_OUTLINE} className="xrc-ntile__lit" />
        <path d={TILE_SHADE} className="xrc-ntile__shade" />
      </svg>
      <b>{n}</b>
    </span>
  )
}

export interface RecordChartProps {
  symbol: string
  closes: readonly ClosePoint[]
  calls: readonly CalledCall[]
  unit?: 'usd' | 'level' | 'yield'
  /** A link or a note for the head's right end (the page passes "Live chart"). */
  action?: ReactNode
  /** Shown over the plot when there is nothing pinned (an unscanned handle). */
  emptyNote?: string
  /** Where the scans' coverage starts (ms). A drawn stretch older than this is dimmed and says it was not read. */
  readFrom?: number | null
}

export default function RecordChart({ symbol, closes, calls, unit = 'usd', action, emptyNote, readFrom }: RecordChartProps) {
  const scale = plotScale(closes, calls.map((c) => c.priceAt))
  if (!scale) {
    return (
      <section className="xrc-chart xrc-chart--none" id="chart" aria-label={`${symbol} daily closes`}>
        <p className="xrc-chart__none">The {symbol} chart did not answer just now. The calls below are still judged on its daily closes.</p>
      </section>
    )
  }
  const { line } = linePaths(closes, scale, BOX)
  const { pins, levels } = railPins(calls, scale, TILE_MIN_DX)
  // Five month marks at most: on a phone's plot six run into each other.
  const ticks = monthTicks(scale.t0, scale.t1, 5)
  const last = closes[closes.length - 1]
  const pinned = pins.filter((p) => p.picked).length
  const unread = unreadShare(scale, readFrom)
  const anyAdded = pins.some((p) => p.added)
  const label = (p: (typeof pins)[number]) => `Call ${p.n}, ${VERDICT_WORDS[p.verdict]}, ${fmtUtcDate(calls[p.n - 1].postedAt)}${p.added ? `, ${ADDED_MARK}` : ''}`
  const mid = (scale.hi + scale.lo) / 2
  const squares = stackSquares(pins.filter((p) => !p.picked))
  const shared = squares.some((q) => q.folded)

  return (
    <section className="xrc-chart sk-card" id="chart" aria-label={`${symbol} daily closes${calls.length ? `, ${pinned} pinned of ${calls.length} calls` : ''}`}>
      <header className="xrc-chart__head">
        <span className="xrc-chart__name">
          <b>{symbol}</b> daily close
        </span>
        <span className="xrc-chart__last">{fmtCallPrice(last.c, unit)}</span>
        {action && <span className="xrc-chart__action">{action}</span>}
      </header>

      <div className="xrc-plot" style={{ '--xrc-levels': Math.max(levels, calls.length ? 1 : 0) } as CSSProperties}>
        <div className="xrc-plot__area">
          {/* Three hairlines, each with its price: the top of the window, the middle, the bottom. */}
          <i className="xrc-plot__rule xrc-plot__rule--max" aria-hidden />
          <i className="xrc-plot__rule xrc-plot__rule--mid" aria-hidden />
          <i className="xrc-plot__rule xrc-plot__rule--min" aria-hidden />
          {unread > 0 && (
            <span className="xrc-plot__unread" style={{ width: pct(unread) }}>
              <span>not read</span>
            </span>
          )}
          <svg className="xrc-plot__svg" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden focusable="false">
            <path d={line} className="xrc-plot__line" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="xrc-plot__axis xrc-plot__axis--max">{fmtCallPrice(scale.hi, unit)}</span>
          <span className="xrc-plot__axis xrc-plot__axis--mid">{fmtCallPrice(mid, unit)}</span>
          <span className="xrc-plot__axis xrc-plot__axis--min">{fmtCallPrice(scale.lo, unit)}</span>

          {/* Squares first, tiles over them. */}
          {squares.map(({ pin: p, x, y, i, dir, count, folded }) => (
            <i key={p.postId} className={`xrc-dot is-${p.verdict}${p.added ? ' is-added' : ''}${folded ? ' xrc-dot--folded' : ''}`} data-count={!folded && count > 1 ? count : undefined} style={folded ? undefined : ({ left: pct(x), '--xrc-y': Math.round(y * 10000) / 10000, '--xrc-stack': i * dir } as CSSProperties)} role="img" aria-label={label(p)} title={`Call ${p.n}: ${VERDICT_WORDS[p.verdict]}${p.added ? ` (${ADDED_MARK})` : ''}`} />
          ))}
          {pins
            .filter((p) => p.picked)
            .map((p) => (
              <a
                key={p.postId}
                className={`xrc-pin is-${p.verdict}${p.added ? ' is-added' : ''}`}
                href={`#call-${p.n}`}
                style={{ left: pct(p.x), '--xrc-y': p.y, '--xrc-lvl': p.level } as CSSProperties}
                aria-label={label(p)}
                data-journey="called_pin"
                data-edge={p.x < 0.04 ? 'start' : p.x > 0.96 ? 'end' : undefined}
              >
                <i className="xrc-pin__stem" aria-hidden />
                <i className="xrc-pin__point" aria-hidden />
                <NumberTile n={p.n} className="xrc-pin__flag" />
              </a>
            ))}
          {emptyNote && calls.length === 0 && (
            <p className="xrc-plot__empty">
              <span>{emptyNote}</span>
            </p>
          )}
        </div>
        <div className="xrc-plot__ticks" aria-hidden>
          {ticks.map((t) => (
            <span key={t.label + t.x} style={{ left: pct(t.x) }} data-edge={t.x < 0.08 ? 'start' : t.x > 0.92 ? 'end' : undefined}>
              {t.label}
            </span>
          ))}
        </div>
      </div>

      {calls.length > 0 && (
        <div className="xrc-chart__key">
          <ul className="xrc-keys">
            {(['right', 'wrong', 'flat', 'open'] as const).map((v) => (
              <li key={v} className={`xrc-key is-${v}`}>
                <VerdictTile verdict={v} size={16} />
                {VERDICT_WORDS[v]}
              </li>
            ))}
            {anyAdded && (
              <li className="xrc-key xrc-key--added">
                <i aria-hidden />
                {ADDED_MARK}
              </li>
            )}
          </ul>
          {pinned < calls.length && <p className="xrc-chart__keynote">A numbered tile is a pinned call: press it for the post. A small square is one of the other {calls.length - pinned}{shared ? '; calls posted within days of each other share one square per verdict' : ''}.{anyAdded ? ' A hollow mark is a post a viewer added: shown, not counted.' : ' Every call the scan found counts.'}</p>}
        </div>
      )}
    </section>
  )
}
