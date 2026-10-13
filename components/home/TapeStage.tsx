'use client'

// THE TAPE on the deck (components/home/Deck, 2026-10-13): /live's tape,
// small. The last prints across the venue's busiest books, every row ending
// in the sentence that does the same thing. The feed is lib/tape-feed
// connectTape on /live's own pick (Dune's perp venues through the relay; the
// venue's keyless socket when the relay has no key), the rows lib/tape's, the
// chips lib/tape followAsk gated by canTradeAsk with the measured verdicts,
// the act the connect-to-act door into the ask door's sheet — the LiveFeed
// pattern verbatim. No chart, no tiles, no triggers: the pulse channel draws
// the numbers and /live is the page. The deck hears the feed's state, the
// merged buffer (its ladder lands the prints) and the hot market.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { useAskDoor } from '@/lib/ask-door'
import { askAppSlugs } from '@/lib/ask-apps'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useConnectToAct } from '@/lib/use-connect-to-act'
import { useTradable } from '@/lib/use-tradable'
import { FALLBACK_MARKETS, FOLLOW_USD, flowClassOf, flowTone, fmtAddr, fmtPrice, fmtSize, fmtUsd, followAsk, mergeFills, pickTapeMarkets, tapeMarket, tapeStats, venueTag, type TapeFill, type TapeSource } from '@/lib/tape'
import { connectTape, readTapeUniverse, type FeedStatus, type TapeHandle } from '@/lib/tape-feed'
import { PERP_VENUES } from '@/lib/dune'
import { PULSE_FLUSH_MS, PULSE_UNIVERSE_TIMEOUT_MS } from '@/lib/pulse'
import type { StageReport } from '@/lib/deck'

/** Rows on the stage: eight fit the stage at 1440 with the head and the foot. */
export const TAPE_STAGE_ROWS = 8

export default function TapeStage({ onReport, onFills, onBookMarket }: { onReport?: (r: StageReport) => void; onFills?: (buffer: readonly TapeFill[]) => void; onBookMarket?: (market: string | null) => void }) {
  const tradable = useTradable()
  const [markets, setMarkets] = useState<readonly string[]>(FALLBACK_MARKETS)
  const [fills, setFills] = useState<TapeFill[]>([])
  const [status, setStatus] = useState<FeedStatus>('connecting')
  const [detail, setDetail] = useState<string | undefined>(undefined)
  const [source, setSource] = useState<TapeSource>('dune')
  const [now, setNow] = useState(() => Date.now())
  const bufRef = useRef<TapeFill[]>([])
  const flushRef = useRef<number | null>(null)
  const handleRef = useRef<TapeHandle | null>(null)
  const onReportRef = useRef(onReport)
  onReportRef.current = onReport
  const onFillsRef = useRef(onFills)
  onFillsRef.current = onFills
  const onBookMarketRef = useRef(onBookMarket)
  onBookMarketRef.current = onBookMarket

  // /live's own pick, read once; the fallback list until it answers.
  useEffect(() => {
    const ac = new AbortController()
    const timer = window.setTimeout(() => ac.abort(), PULSE_UNIVERSE_TIMEOUT_MS)
    let gone = false
    readTapeUniverse(ac.signal).then(({ main, xyz }) => {
      window.clearTimeout(timer)
      if (gone) return
      const picked = pickTapeMarkets(main, xyz)
      if (picked.length) setMarkets(picked)
    })
    return () => {
      gone = true
      window.clearTimeout(timer)
      ac.abort()
    }
  }, [])

  // The stream: opened once on the fallback list, re-aimed on the same
  // socket when the venue's pick lands (the pulse's idiom).
  useEffect(() => {
    const flush = () => {
      flushRef.current = null
      setFills(bufRef.current)
      onFillsRef.current?.(bufRef.current)
    }
    const handle = connectTape(markets, {
      onSource: setSource,
      onRetract: (venue, block) => {
        bufRef.current = bufRef.current.filter((f) => !(f.venue === venue && f.block === block))
      },
      onFills: (batch) => {
        const wasEmpty = bufRef.current.length === 0
        bufRef.current = mergeFills(bufRef.current, batch, Date.now())
        if (wasEmpty) {
          if (flushRef.current !== null) window.clearTimeout(flushRef.current)
          flush()
        } else if (flushRef.current === null) {
          flushRef.current = window.setTimeout(flush, PULSE_FLUSH_MS)
        }
      },
      onStatus: (s, d) => {
        setStatus(s)
        setDetail(d)
      },
    }, { venues: PERP_VENUES, filter: true })
    handleRef.current = handle
    return () => {
      handleRef.current = null
      handle.close()
      if (flushRef.current !== null) window.clearTimeout(flushRef.current)
      flushRef.current = null
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  useEffect(() => {
    handleRef.current?.setMarkets(markets)
  }, [markets])

  // The clock: once a second, pruning the buffer on the same beat.
  useEffect(() => {
    const id = window.setInterval(() => {
      const t = Date.now()
      setNow(t)
      const buf = bufRef.current
      if (buf.length && buf[buf.length - 1].at < t - 180_000) {
        bufRef.current = mergeFills(buf, [], t)
        setFills(bufRef.current)
        onFillsRef.current?.(bufRef.current)
      }
    }, 1000)
    return () => window.clearInterval(id)
  }, [])

  useEffect(() => {
    onReportRef.current?.({ status, detail, source, markets: markets.length, hidden: false })
  }, [status, detail, source, markets.length])

  const stats = useMemo(() => tapeStats(fills, now), [fills, now])
  const hot = stats.hotMarket?.market ?? null
  useEffect(() => {
    onBookMarketRef.current?.(hot)
  }, [hot])

  // The act door — the LiveFeed pattern.
  const openDoor = useAskDoor((s) => s.openDoor)
  const run = useCallback((ask: string) => openDoor(ask, { send: true, mcps: askAppSlugs(ask) }), [openDoor])
  const promptHref = useCallback((ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`, [])
  const { act, door } = useConnectToAct({ run, redirectFor: promptHref })

  const rows = fills.slice(0, TAPE_STAGE_ROWS)
  return (
    <div className="deck__tapestage" data-status={status} data-source={source} data-rows={rows.length}>
      {rows.length === 0 ? (
        <div className="deck__tapeempty mono">{status === 'live' ? 'waiting for the first print' : status === 'connecting' ? 'reaching the feed…' : status}</div>
      ) : (
        <table className="deck__tape" aria-label="The last prints">
          <thead>
            <tr>
              <th>Market</th>
              <th>Side</th>
              <th className="num">Size</th>
              <th className="num">Price</th>
              <th className="num">Notional $</th>
              <th>Effect</th>
              <th>Taker</th>
              <th>Do the same</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((f) => {
              const chip = followAsk(f)
              const ok = chip && canTradeAsk(chip.ask, tradable) ? chip : null
              const cls = flowClassOf(f)
              const tone = flowTone(cls)
              const m = tapeMarket(f.market)
              return (
                <tr key={f.id} className={`deck-row deck-row--${tone.dir}${tone.strong ? ' is-strong' : ''}`} data-class={cls} data-venue={f.venue}>
                  <td>
                    {m.href ? (
                      <Link href={m.href} className="deck__mlink" prefetch={false}>
                        {m.dex && <span className="deck__dex mono">{m.dex}</span>}
                        {m.ticker}
                      </Link>
                    ) : (
                      <span className="deck__mlink deck__mlink--plain">
                        {m.dex && <span className="deck__dex mono">{m.dex}</span>}
                        {m.ticker}
                      </span>
                    )}
                    {f.venue !== 'hyperliquid' && <span className="deck__venue mono">{venueTag(f.venue, f.chainId)}</span>}
                  </td>
                  <td className={`mono deck__side--${f.side}`}>{f.side}</td>
                  <td className="mono num">{fmtSize(f.size)}</td>
                  <td className="mono num">{fmtPrice(f.price)}</td>
                  <td className="mono num deck__usd">{fmtUsd(f.usd)}</td>
                  <td className="mono deck__effect">{f.effect ?? '—'}</td>
                  <td className="mono deck__taker">{f.taker ? fmtAddr(f.taker) : '—'}</td>
                  <td className="deck__act">
                    {ok ? (
                      <button type="button" className={`deck__chip deck__chip--${ok.tone}`} onClick={() => act(ok.ask)} title={ok.ask}>
                        {ok.label} <span className="deck__chip-usd">${FOLLOW_USD}</span>
                      </button>
                    ) : (
                      <span className="deck__noact mono">{(m.kind === 'stock' || f.venue === 'dex') && f.side === 'sell' ? 'needs a position' : 'no route here'}</span>
                    )}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      )}
      <div className="deck__tapefoot mono">
        <span>{stats.tradesPerSec > 0 ? `${stats.tradesPerSec} trades/s · ${fmtUsd(stats.notionalPerMin)} / min` : 'waiting for the first fill'}{hot ? ` · hot: ${tapeMarket(hot).ticker}` : ''}</span>
        <span>${FOLLOW_USD} a tap · the signature is the gate</span>
      </div>
      {door}
    </div>
  )
}
