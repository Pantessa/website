'use client'

// PositionRivers — the longs and the shorts as two rivers under the candles
// (Nate picked it 2026-10-06). Left to right is the last 180 days, the same
// clock as the heatmap below it. The long river runs ABOVE the centre line
// when the crowd is longer than its usual day, the short river below, and
// they cross on the days the crowd flips. A river's width is its side's share
// of that day's open interest. Whitewater is a day's liquidation cascade
// (ESTIMATED, the daily map's hits), sized by the dollars set off. Right of
// today both rivers run on as a dotted channel with the clusters standing
// ahead of the price as rapids, nearest first.
//
// SVG, so every eddy and rapid is an element with a title; the hover guide
// and the day's report are DOM.

import { useEffect, useMemo, useRef, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import type { ChartPair } from '@/lib/charts'
import { fieldDate } from '@/lib/battlefield'
import { fmtUsdShort, liqBuckets, liquidationMap, riverLanes, riverSeries, strataFor, type OiPoint, type RiverDay } from '@/lib/derivs'
import { useHeatYear } from './PositionHeat'
import { fmtPrice } from '@/components/CandleChart'
import './battlefield.css'

const OPEN_KEY = 'pantessa.rivers.open.v1'
const H = 132
/** The forecast channel's share of the width. */
const AHEAD = 0.16

export interface PositionRiversProps {
  symbol: string
  pair: ChartPair
  mark: number | null
}

export default function PositionRivers({ symbol, pair, mark }: PositionRiversProps) {
  const [open, setOpen] = useState(true)
  useEffect(() => {
    try {
      const v = localStorage.getItem(OPEN_KEY)
      if (v === '0' || v === '1') setOpen(v === '1')
    } catch {
      /* default open */
    }
  }, [])
  const toggle = () =>
    setOpen((o) => {
      try {
        localStorage.setItem(OPEN_KEY, o ? '0' : '1')
      } catch {
        /* this visit only */
      }
      return !o
    })
  const noMarket = pair.source === 'robinhood'
  const { derivs, cells, bars } = useHeatYear(symbol, open && !noMarket)
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(0)
  useEffect(() => {
    const el = wrapRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setWidth(el.clientWidth))
    ro.observe(el)
    setWidth(el.clientWidth)
    return () => ro.disconnect()
  }, [open])
  const series = useMemo(() => (derivs && cells.length ? riverSeries(cells, bars, derivs.oiUnit) : null), [derivs, cells, bars])
  // The rapids ahead: the live daily liquidation map's clusters nearest the price.
  const rapids = useMemo(() => {
    if (!derivs || !mark || bars.length < 2 || derivs.oi.length < 2) return []
    const daily = [...bars].sort((a, b) => a.t - b.t)
    const map = liquidationMap(daily, derivs.oi as OiPoint[], derivs.oiUnit)
    return strataFor(liqBuckets(map.alive, mark), mark, 25, 8)
  }, [derivs, mark, bars])
  const [hover, setHover] = useState<{ d: RiverDay; x: number } | null>(null)
  if (noMarket) return null

  const histW = width * (1 - AHEAD)
  const X = (x: number) => 8 + x * (histW - 16)
  const Y = (y: number) => y * H
  const lanes = series ? series.days.map((d) => ({ d, ...riverLanes(d, series.median) })) : []
  const ribbon = (side: 'long' | 'short') => {
    if (lanes.length < 2) return ''
    const top = lanes.map((l) => `${X(l.d.x).toFixed(1)},${Y(l[side].y - l[side].w / 2).toFixed(1)}`)
    const bottom = [...lanes].reverse().map((l) => `${X(l.d.x).toFixed(1)},${Y(l[side].y + l[side].w / 2).toFixed(1)}`)
    return `M${top.join('L')}L${bottom.join('L')}Z`
  }
  const last = lanes[lanes.length - 1]
  const flips = lanes.filter((l, i) => i > 0 && Math.sign(l.long.y - 0.5) !== Math.sign(lanes[i - 1].long.y - 0.5) && Math.abs(l.long.y - 0.5) > 0.01)
  const wipedMax = lanes.reduce((m, l) => Math.max(m, l.d.wipedLong, l.d.wipedShort), 0)
  const headline = !series
    ? open
      ? derivs
        ? 'No daily positioning for this coin'
        : 'Reading the rivers…'
      : 'Longs and shorts as two rivers: width is open interest, they cross when the crowd flips'
    : last
      ? `${last.long.y < 0.5 ? 'The long river runs high' : last.long.y > 0.5 ? 'The short river runs high' : 'The rivers run level'}${flips.length ? ` · the crowd flipped ${flips.length}× in ${lanes.length} days` : ''}`
      : ''

  return (
    <section className={`rivers${open ? ' is-open' : ''}`} aria-label="Positioning as two rivers">
      <button type="button" className="poshet__head" onClick={toggle} aria-expanded={open}>
        <span className="poshet__k mono">The rivers · {derivs?.source ?? 'perps'} · 180 days</span>
        <span className="poshet__v">{headline}</span>
        <span className="poshet__key mono">
          <i className="bf__sw bf__sw--up" /> longs <i className="bf__sw bf__sw--down" /> shorts · width = open interest · whitewater = liquidations (est.)
        </span>
        <ChevronDown className={`poshet__chev h-3.5 w-3.5${open ? ' is-open' : ''}`} aria-hidden="true" />
      </button>
      {open && (
        <div
          ref={wrapRef}
          className="rivers__body"
          onPointerMove={(e) => {
            if (!series || !width) return
            const r = (e.currentTarget as HTMLElement).getBoundingClientRect()
            const x = e.clientX - r.left
            if (x > histW) return setHover(null)
            const t = Math.max(0, Math.min(1, (x - 8) / (histW - 16)))
            const i = Math.round(t * (series.days.length - 1))
            setHover({ d: series.days[i], x: X(series.days[i].x) })
          }}
          onPointerLeave={() => setHover(null)}
        >
          {width > 0 && series && lanes.length > 1 && (
            <svg className="rivers__svg" width={width} height={H} viewBox={`0 0 ${width} ${H}`} role="img" aria-label={headline}>
              {/* The centre line: the crowd's usual day. */}
              <line x1={8} x2={width - 8} y1={Y(0.5)} y2={Y(0.5)} className="rivers__mid" />
              <path d={ribbon('short')} className="rivers__ribbon rivers__ribbon--short" />
              <path d={ribbon('long')} className="rivers__ribbon rivers__ribbon--long" />
              {/* Whitewater: the day's cascades, per side. */}
              {lanes.map((l) =>
                (['long', 'short'] as const).map((side) => {
                  const usd = side === 'long' ? l.d.wipedLong : l.d.wipedShort
                  if (!(usd > 0) || wipedMax <= 0) return null
                  const r = 2.5 + 7 * Math.sqrt(usd / wipedMax)
                  return (
                    <g key={`${l.d.day}-${side}`} className={`rivers__eddy rivers__eddy--${side}`} transform={`translate(${X(l.d.x).toFixed(1)} ${Y(l[side].y).toFixed(1)})`}>
                      <circle r={r} />
                      <circle r={r * 0.45} />
                      <title>{`${fieldDate(l.d.day, '1d').month} ${fieldDate(l.d.day, '1d').day}: ~${fmtUsdShort(usd)} of ${side}s liquidated (est.)`}</title>
                    </g>
                  )
                }),
              )}
              {/* The channel ahead: the rivers run on, the rapids stand where the clusters are. */}
              {last && (
                <g className="rivers__ahead">
                  <line x1={histW} x2={width - 8} y1={Y(last.long.y)} y2={Y(last.long.y)} className="rivers__channel rivers__channel--long" />
                  <line x1={histW} x2={width - 8} y1={Y(last.short.y)} y2={Y(last.short.y)} className="rivers__channel rivers__channel--short" />
                  <line x1={histW} x2={histW} y1={0} y2={H} className="rivers__today" />
                  <text x={histW + 4} y={10} className="rivers__label mono">AHEAD</text>
                  {(['long', 'short'] as const).map((side) => {
                    const mine = rapids.filter((s) => s.side === side).sort((a, b) => Math.abs(a.price - (mark ?? 0)) - Math.abs(b.price - (mark ?? 0))).slice(0, 4)
                    return mine.map((s, i) => {
                      const x = histW + 14 + i * ((width - 8 - histW - 20) / 4)
                      const y = Y(last[side].y)
                      const size = 3 + 6 * s.weight
                      const pct = `${s.price >= (mark ?? 0) ? '+' : '−'}${Math.abs((s.price / (mark ?? 1) - 1) * 100).toFixed(0)}%`
                      return (
                        <g key={`${side}-${s.price}`} className={`rivers__rapid rivers__rapid--${side}`} transform={`translate(${x} ${y})`}>
                          <path d={`M${-size},${size * 0.7} L0,${-size * 0.7} L${size},${size * 0.7}`} />
                          <path d={`M${-size * 0.6},${size * 1.3} L0,${0} L${size * 0.6},${size * 1.3}`} />
                          {i < 2 ? (
                            <text y={side === 'long' ? -size - 4 : size * 1.3 + 9} className="rivers__label mono" textAnchor="middle">
                              {fmtUsdShort(s.usd)} · {pct}
                            </text>
                          ) : null}
                          <title>{`~${fmtUsdShort(s.usd)} of ${side}s break near ${fmtPrice(s.price)} (${pct}), est.`}</title>
                        </g>
                      )
                    })
                  })}
                </g>
              )}
              {hover && <line x1={hover.x} x2={hover.x} y1={0} y2={H} className="rivers__guide" />}
            </svg>
          )}
          {!series && <p className="bf__empty mono rivers__empty">{headline}</p>}
          {hover && series && (
            <div className={`bf__tip bf__tip--${hover.d.long >= series.median ? 'bulls' : 'bears'}`} style={{ left: Math.max(8, Math.min(width - 268, hover.x + 14)), top: 8 }} role="status">
              <span className="bf__tip-k mono">
                {fieldDate(hover.d.day, '1d').month} {fieldDate(hover.d.day, '1d').day}, {fieldDate(hover.d.day, '1d').year}
              </span>
              <strong>
                {Math.round(hover.d.long * 100)}% long · {100 - Math.round(hover.d.long * 100)}% short · {hover.d.long - series.median >= 0 ? '+' : '−'}
                {Math.abs((hover.d.long - series.median) * 100).toFixed(0)} pts vs usual
              </strong>
              {hover.d.oiUsd !== null ? <span>open interest {fmtUsdShort(hover.d.oiUsd)}</span> : null}
              {hover.d.wipedLong > 0 || hover.d.wipedShort > 0 ? (
                <span>
                  liquidated (est.): {hover.d.wipedLong > 0 ? `${fmtUsdShort(hover.d.wipedLong)} longs` : ''}
                  {hover.d.wipedLong > 0 && hover.d.wipedShort > 0 ? ' · ' : ''}
                  {hover.d.wipedShort > 0 ? `${fmtUsdShort(hover.d.wipedShort)} shorts` : ''}
                </span>
              ) : null}
            </div>
          )}
        </div>
      )}
    </section>
  )
}
