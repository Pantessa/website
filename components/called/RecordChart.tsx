// The landing's chart (squad called-it, lane RECORD): the daily closes over
// the record's window, a numbered flag per pinned call on a rail above the
// line, a small dot for every other call. Server-rendered, no chart library,
// no script: the line is an SVG in a stretched viewBox inside a box whose
// height is CSS (the way components/home/TheRead draws), and every flag and
// dot is a plain link to its card, placed by percentages. Nothing is measured,
// so the first frame is the final frame.
//
// A flag wears the call's number (its place in the record, by date) and its
// verdict's colour; the card under the chart wears the same two. Colour is
// never the only signal: every flag's label says the verdict in words.
import { VERDICT_WORDS, type CalledCall } from '@/lib/called-it/spec'
import { fmtCallPrice, fmtUtcDate, linePaths, monthTicks, plotScale, railPins, type ClosePoint } from '@/lib/called-it/card-layout'
import type { CSSProperties, ReactNode } from 'react'

const BOX = { x: 0, y: 0, w: 1000, h: 300 }
const pct = (f: number) => `${Math.round(f * 10000) / 100}%`

export interface RecordChartProps {
  symbol: string
  closes: readonly ClosePoint[]
  calls: readonly CalledCall[]
  unit?: 'usd' | 'level' | 'yield'
  /** A link or a note for the head's right end (the page passes "Open the live chart"). */
  action?: ReactNode
  /** Shown over the plot when there is nothing pinned (an unscanned handle). */
  emptyNote?: string
}

export default function RecordChart({ symbol, closes, calls, unit = 'usd', action, emptyNote }: RecordChartProps) {
  const scale = plotScale(closes, calls.map((c) => c.priceAt))
  if (!scale) {
    return (
      <section className="xrc-chart xrc-chart--none" id="chart" aria-label={`${symbol} daily closes`}>
        <p className="xrc-chart__none">The {symbol} chart did not answer just now. The calls below are still judged on its daily closes.</p>
      </section>
    )
  }
  const { line, area } = linePaths(closes, scale, BOX)
  const { pins, levels } = railPins(calls, scale)
  const ticks = monthTicks(scale.t0, scale.t1)
  const last = closes[closes.length - 1]
  const pinned = pins.filter((p) => p.picked).length
  const gradId = `xrc-grad-${symbol.replace(/[^A-Za-z0-9]/g, '')}`

  return (
    <section className="xrc-chart" id="chart" aria-label={`${symbol} daily closes${calls.length ? `, ${pinned} pinned of ${calls.length} calls` : ''}`}>
      <header className="xrc-chart__head">
        <span className="xrc-chart__name">
          <b>{symbol}</b> daily close
        </span>
        <span className="xrc-chart__last">{fmtCallPrice(last.c, unit)}</span>
        {action && <span className="xrc-chart__action">{action}</span>}
      </header>

      <div className="xrc-plot" style={{ '--xrc-levels': Math.max(levels, calls.length ? 1 : 0) } as CSSProperties}>
        <div className="xrc-plot__area">
          <svg className="xrc-plot__svg" viewBox="0 0 1000 300" preserveAspectRatio="none" aria-hidden focusable="false">
            <defs>
              <linearGradient id={gradId} x1="0" y1="0" x2="0" y2="1">
                <stop offset="0" className="xrc-plot__stop" stopOpacity="0.16" />
                <stop offset="1" className="xrc-plot__stop" stopOpacity="0" />
              </linearGradient>
            </defs>
            <path d={area} fill={`url(#${gradId})`} />
            <path d={line} className="xrc-plot__line" vectorEffect="non-scaling-stroke" />
          </svg>
          <span className="xrc-plot__axis xrc-plot__axis--max">{fmtCallPrice(scale.hi, unit)}</span>
          <span className="xrc-plot__axis xrc-plot__axis--min">{fmtCallPrice(scale.lo, unit)}</span>

          {/* Dots first, flags over them. */}
          {pins
            .filter((p) => !p.picked)
            .map((p) => (
              <i key={p.postId} className={`xrc-dot is-${p.verdict}`} style={{ left: pct(p.x), '--xrc-y': p.y } as CSSProperties} role="img" aria-label={`Call ${p.n}, ${VERDICT_WORDS[p.verdict]}, ${fmtUtcDate(calls[p.n - 1].postedAt)}`} title={`Call ${p.n}: ${VERDICT_WORDS[p.verdict]}`} />
            ))}
          {pins
            .filter((p) => p.picked)
            .map((p) => (
              <a
                key={p.postId}
                className={`xrc-pin is-${p.verdict}`}
                href={`#call-${p.n}`}
                style={{ left: pct(p.x), '--xrc-y': p.y, '--xrc-lvl': p.level } as CSSProperties}
                aria-label={`Call ${p.n}, ${VERDICT_WORDS[p.verdict]}, ${fmtUtcDate(calls[p.n - 1].postedAt)}`}
                data-journey="called_pin"
              >
                <i className="xrc-pin__stem" aria-hidden />
                <i className="xrc-pin__point" aria-hidden />
                <span className="xrc-pin__flag">{p.n}</span>
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
        <p className="xrc-chart__key">
          <span className="xrc-key is-right">{VERDICT_WORDS.right}</span>
          <span className="xrc-key is-wrong">{VERDICT_WORDS.wrong}</span>
          <span className="xrc-key is-flat">{VERDICT_WORDS.flat}</span>
          <span className="xrc-key is-open">{VERDICT_WORDS.open}</span>
          {pinned < calls.length && <span className="xrc-chart__keynote">A number is a pinned call. A dot is one of the rest. Every call counts.</span>}
        </p>
      )}
    </section>
  )
}
