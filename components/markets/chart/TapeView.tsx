'use client'

// The Tape view (2026-10-20, `?view=tape`): this instrument's prints as rows
// beside Depth on the chart's view switch. The rows are lib/chart-tape's:
// the venue's recent trades open it full, Dune's prints off the chart's one
// relay stream take the live edge where the instrument has them. Every row
// carries the sentence that does what the print did (lib/tape followAsk),
// gated by canTradeAsk, sent through the chart's onAsk. Sits where Depth
// sits (absolute, over the engine's canvas).

import { useEffect, useMemo, useRef, useState } from 'react'
import type { ChartPair } from '@/lib/charts'
import type { Print } from '@/lib/chart-live'
import { CHART_TAPE_MAX, CHART_TAPE_POLL_MS, CHART_TAPE_WINDOW_MS, followRow, mergeTapeRows, rowFromFill, rowsFromVenue, tapeSourceWords, tapeSummary, venueBefore, type ChartTapeRow } from '@/lib/chart-tape'
import { FOLLOW_USD, fmtClock, fmtPrice, fmtSize, fmtUsd, type TapeFill } from '@/lib/tape'
import type { FeedStatus } from '@/lib/tape-feed'
import './tape-view.css'

export interface TapeViewProps {
  symbol: string
  pair: ChartPair
  /** The chart's relay stream hands its prints here (null = no stream). */
  printSink: React.MutableRefObject<((fills: readonly TapeFill[]) => void) | null>
  printStatus: FeedStatus | null
  printLabel: string | null
  onAsk?: (ask: string) => void
  canAsk: (ask: string) => boolean
}

const VENUE_LABEL: Record<string, string> = { coinbase: 'Coinbase', hyperliquid: 'Hyperliquid' }

export default function TapeView({ symbol, pair, printSink, printStatus, printLabel, onAsk, canAsk }: TapeViewProps) {
  const [rows, setRows] = useState<ChartTapeRow[]>([])
  const [venueState, setVenueState] = useState<'loading' | 'ok' | 'none'>('loading')
  const [now, setNow] = useState(() => Date.now())
  const [held, setHeld] = useState(false)
  // While held, new rows wait here and land on release.
  const heldRef = useRef(false)
  const pendingRef = useRef<ChartTapeRow[]>([])
  // Dune's first print: on a perp the venue's rows hand the live edge over
  // at it (HyperCore and Hyperliquid's recentTrades are the SAME trades).
  // A Coinbase coin's Dune prints are DEX swaps — other trades — so both run.
  const sameTrades = pair.source === 'hyperliquid'
  const firstDuneRef = useRef<number | null>(null)
  heldRef.current = held

  const push = (incomingRaw: ChartTapeRow[]) => {
    if (sameTrades && firstDuneRef.current == null) {
      const firstDune = incomingRaw.reduce<number | null>((m, r) => (r.from === 'dune' && (m == null || r.at < m) ? r.at : m), null)
      if (firstDune != null) {
        firstDuneRef.current = firstDune
        setRows((prev) => venueBefore(prev, firstDune))
        pendingRef.current = venueBefore(pendingRef.current, firstDune)
      }
    }
    const incoming = venueBefore(incomingRaw, firstDuneRef.current)
    if (!incoming.length) return
    if (heldRef.current) {
      pendingRef.current.push(...incoming)
      return
    }
    setRows((prev) => mergeTapeRows(prev, incoming))
  }
  const pushRef = useRef(push)
  pushRef.current = push

  useEffect(() => {
    if (held) return
    const pending = pendingRef.current
    pendingRef.current = []
    if (pending.length) setRows((prev) => mergeTapeRows(prev, pending))
  }, [held])

  // ── Dune's prints, off the chart's stream ──
  useEffect(() => {
    setRows([])
    pendingRef.current = []
    firstDuneRef.current = null
    printSink.current = (fills) => {
      const next: ChartTapeRow[] = []
      for (const f of fills) {
        const r = rowFromFill(f)
        if (r) next.push(r)
      }
      pushRef.current(next)
    }
    return () => {
      printSink.current = null
    }
  }, [printSink, symbol])

  // ── The venue's recent trades: open full, keep moving where Dune is quiet ──
  useEffect(() => {
    let dead = false
    setVenueState('loading')
    const pull = async () => {
      // Dune holds the live edge once it has printed; the history is already here.
      if (sameTrades && firstDuneRef.current != null) return
      try {
        const res = await fetch(`/api/charts/trades?symbol=${encodeURIComponent(symbol)}`, { cache: 'no-store' })
        const d = (await res.json()) as { prints?: Print[] }
        if (dead) return
        const prints = Array.isArray(d.prints) ? d.prints : []
        setVenueState((s) => (prints.length ? 'ok' : s === 'ok' ? 'ok' : 'none'))
        pushRef.current(rowsFromVenue(prints.slice(-CHART_TAPE_MAX), pair))
      } catch {
        if (!dead) setVenueState((s) => (s === 'ok' ? 'ok' : 'none'))
      }
    }
    void pull()
    const poll = setInterval(() => {
      if (typeof document !== 'undefined' && document.hidden) return
      void pull()
    }, CHART_TAPE_POLL_MS)
    return () => {
      dead = true
      clearInterval(poll)
    }
  }, [symbol, pair, sameTrades])

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(t)
  }, [])

  const sum = useMemo(() => tapeSummary(rows, now), [rows, now])
  const venueLabel = VENUE_LABEL[pair.source] ?? pair.source
  const source = tapeSourceWords(rows, printLabel, venueLabel)
  const streamWords = printLabel ? (printStatus === 'live' ? `${printLabel} live` : printStatus ? `${printLabel} ${printStatus}` : printLabel) : 'no Dune stream for this instrument'
  const buyPct = sum.buyShare == null ? null : Math.round(sum.buyShare * 100)
  const windowMin = Math.round(CHART_TAPE_WINDOW_MS / 60_000)

  return (
    <div className="tp" data-rows={rows.length} data-source={rows[0]?.from ?? 'none'}>
      <div className="tp__bar mono">
        <div className="tp__stat">
          <span className="tp__k">Prints · {windowMin}m</span>
          <b>{sum.count.toLocaleString('en-US')}</b>
        </div>
        <div className="tp__stat tp__stat--split">
          <span className="tp__k">Taker split · {windowMin}m</span>
          {buyPct == null ? (
            <b className="tp__dim">—</b>
          ) : (
            <>
              <span className="tp__split" aria-label={`${buyPct}% of the dollars bought`}>
                <span className="tp__split-buy" style={{ width: `${buyPct}%` }} />
              </span>
              <span className="tp__splitnum">
                <span className="tp__buy">{fmtUsd(sum.buyUsd)} buy</span> · <span className="tp__sell">{fmtUsd(sum.sellUsd)} sell</span>
              </span>
            </>
          )}
        </div>
        <div className="tp__stat">
          <span className="tp__k">Largest · {windowMin}m</span>
          {sum.largest ? (
            <b className={sum.largest.side ? `tp__${sum.largest.side}` : undefined}>{fmtUsd(sum.largest.usd)}</b>
          ) : (
            <b className="tp__dim">—</b>
          )}
        </div>
        <button type="button" className={`tp__hold${held ? ' is-on' : ''}`} aria-pressed={held} onClick={() => setHeld((h) => !h)} title={held ? 'Let the new prints land' : 'Hold the rows still (new prints wait)'}>
          {held ? `Resume${pendingRef.current.length ? ` · ${pendingRef.current.length}` : ''}` : 'Hold'}
        </button>
      </div>
      <div className="tp__scroll">
        <table className="tp__table mono" aria-label={`${symbol} prints`}>
          <thead>
            <tr>
              <th>Time</th>
              <th>Side</th>
              <th className="num">Price</th>
              <th className="num tp__col-size">Size</th>
              <th className="num">Value</th>
              <th className="tp__col-src">Source</th>
              <th className="tp__col-act" aria-label="Follow" />
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr className="tp__empty">
                <td colSpan={7}>{venueState === 'loading' ? 'reading the venue’s recent trades' : printLabel && printStatus !== 'unconfigured' && printStatus !== 'closed' ? 'waiting for the first print' : 'no prints for this instrument'}</td>
              </tr>
            ) : (
              rows.map((r) => {
                const chip = onAsk ? followRow(r) : null
                const ok = chip ? canAsk(chip.ask) : false
                return (
                  <tr key={r.id} className={`tp__row${r.side ? ` tp__row--${r.side}` : ''}`}>
                    <td className="tp__time">
                      {fmtClock(r.at).slice(0, 8)}
                      <span className="tp__ms">{fmtClock(r.at).slice(8)}</span>
                    </td>
                    <td className={`tp__side${r.side ? ` tp__${r.side}` : ''}`}>{r.side ?? '—'}</td>
                    <td className="num">{fmtPrice(r.price)}</td>
                    <td className="num tp__col-size">
                      {fmtSize(r.size)} <span className="tp__dim">{symbol}</span>
                    </td>
                    <td className="num tp__usd">{fmtUsd(r.usd)}</td>
                    <td className="tp__col-src tp__tag">{r.tag}</td>
                    <td className="tp__col-act">
                      {chip && ok ? (
                        <button type="button" className={`tp__chip tp__chip--${chip.tone}`} onClick={() => onAsk?.(chip.ask)} title={chip.ask} data-journey="Follow a print on the symbol tape">
                          {chip.label} <span className="tp__chip-usd">${FOLLOW_USD}</span>
                        </button>
                      ) : (
                        <span className="tp__dim tp__noact">{r.side === 'sell' && r.venue !== 'hyperliquid' ? 'needs a holding' : r.side ? 'no route here' : ''}</span>
                      )}
                    </td>
                  </tr>
                )
              })
            )}
          </tbody>
        </table>
      </div>
      <p className="tp__foot mono">
        <span>Rows · {source}</span>
        <span>{streamWords}</span>
      </p>
    </div>
  )
}
