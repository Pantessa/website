'use client'

// THE EXECUTIONS STRIP (2026-11-02): Dune's live executions for the symbol on
// screen, beside the positioning heatmap under the candles. The prints come
// off the chart's ONE relay stream (MarketChart hands every batch to
// `printSink`); the strip opens nothing itself. Every row ends in the same
// follow sentence the live tape offers (lib/tape followAsk, gated by the
// chart's canAsk), sent through the chart's ask door. Words and dashes are
// lib/exec-strip's; pinned in scripts/exec-strip-pins.ts.

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChartPair } from '@/lib/charts'
import type { ChartLiveFeed } from '@/lib/chart-live'
import { STRIP_HEAD, ageWords, effectWords, mergeStripFills, shortHash, stripEmptyWords, stripWords, txHref } from '@/lib/exec-strip'
import { FOLLOW_USD, fmtPrice, fmtSize, fmtUsd, followAsk, venueTag, type TapeFill } from '@/lib/tape'
import type { FeedStatus } from '@/lib/tape-feed'
import './exec-strip.css'

export interface ExecutionsStripProps {
  symbol: string
  pair: ChartPair
  /** The chart's live-feed map for this instrument; null = Dune has no feed for it. */
  feed: ChartLiveFeed | null
  /** The chart's relay stream hands its prints here. */
  printSink: React.MutableRefObject<((fills: readonly TapeFill[]) => void) | null>
  printStatus: FeedStatus | null
  onAsk?: (ask: string) => void
  canAsk: (ask: string) => boolean
}

export default function ExecutionsStrip({ symbol, pair, feed, printSink, printStatus, onAsk, canAsk }: ExecutionsStripProps) {
  const [rows, setRows] = useState<TapeFill[]>([])
  const [now, setNow] = useState(() => Date.now())
  const rowsRef = useRef(rows)
  rowsRef.current = rows

  useEffect(() => {
    setRows([])
    printSink.current = (fills) => {
      setRows((prev) => mergeStripFills(prev, fills))
    }
    return () => {
      printSink.current = null
    }
  }, [printSink, symbol])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [])

  const perp = pair.source === 'hyperliquid'
  const words = useMemo(() => stripWords(feed ? printStatus : null, feed, pair.source), [feed, printStatus, pair.source])
  const live = !!feed && printStatus === 'live'

  return (
    <section className="xs" aria-label={`${symbol} executions`} data-feed={feed ? 'dune' : 'none'} data-status={feed ? (printStatus ?? 'idle') : 'none'} data-rows={rows.length} data-perp={perp ? 'true' : 'false'}>
      <div className="xs__head">
        <span className="xs__k mono">
          {STRIP_HEAD}
          {live && <span className="xs__live"> · live</span>}
        </span>
        <span className="xs__words mono" title={words}>
          {words}
        </span>
      </div>
      <div className="xs__scroll">
        <table className="xs__table mono" aria-label={`${symbol} executions from Dune`}>
          <thead>
            <tr>
              <th>Venue</th>
              <th>Side</th>
              <th className="num xs__col-size">Size</th>
              <th className="num">Price</th>
              <th className="num">Value</th>
              <th className="xs__col-eff">Effect</th>
              <th className="num xs__col-blk">Block</th>
              <th className="xs__col-tx">Tx</th>
              <th className="num">Age</th>
              <th className="xs__col-act" aria-label="Follow" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="xs__empty">
                <td colSpan={10}>{stripEmptyWords(feed ? printStatus : null, feed)}</td>
              </tr>
            ) : (
              rows.map((f) => {
                const chip = onAsk ? followAsk(f, FOLLOW_USD) : null
                const ok = chip ? canAsk(chip.ask) : false
                const href = txHref(f)
                return (
                  <tr key={f.id} className={`xs__row xs__row--${f.side}`} data-venue={f.venue} data-effect={f.effect ?? ''}>
                    <td className="xs__tag" title={f.venue === 'dex' ? 'a spot swap on this chain' : 'a perp fill on this venue'}>
                      {venueTag(f.venue, f.chainId)}
                    </td>
                    <td className={`xs__side xs__${f.side}`}>{f.side}</td>
                    <td className="num xs__col-size">{fmtSize(f.size)}</td>
                    <td className="num">{fmtPrice(f.price)}</td>
                    <td className="num xs__usd">{fmtUsd(f.usd)}</td>
                    <td className={`xs__col-eff${f.effect ? ' xs__eff' : ' xs__dim'}`}>{effectWords(f)}</td>
                    <td className={`num xs__col-blk${f.block == null ? ' xs__dim' : ''}`}>{f.block != null ? f.block.toLocaleString('en-US') : '—'}</td>
                    <td className="xs__col-tx">
                      {href ? (
                        <a href={href} target="_blank" rel="noopener noreferrer nofollow" className="xs__tx" title={f.hash ?? undefined}>
                          {shortHash(f.hash ?? '')}
                        </a>
                      ) : f.hash && !/^0x0+$/.test(f.hash) ? (
                        <span className="xs__dim" title={f.hash}>
                          {shortHash(f.hash)}
                        </span>
                      ) : (
                        <span className="xs__dim">—</span>
                      )}
                    </td>
                    <td className="num xs__age">{ageWords(now, f.at)}</td>
                    <td className="xs__col-act">
                      {chip && ok ? (
                        <button type="button" className={`xs__chip xs__chip--${chip.tone}`} onClick={() => onAsk?.(chip.ask)} title={chip.ask} data-journey="Follow an execution on the symbol page">
                          {chip.label} <span className="xs__chip-usd">${FOLLOW_USD}</span>
                        </button>
                      ) : (
                        <span className="xs__dim xs__noact">{f.side === 'sell' && f.venue === 'dex' ? 'needs a holding' : 'no route here'}</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="xs__foot mono">
        <span>{perp ? 'Effect · what the fill did to the taker’s position · Dune’s stream carries it' : 'Effect · a spot swap has no position · dash by design'}</span>
        <span>{feed ? 'Dune · every venue it streams for this market' : 'Dune · not drawn here'}</span>
      </p>
    </section>
  )
}
