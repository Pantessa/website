'use client'

// The look-only card (2026-11-09) — what a symbol page shows where the order
// ticket would be, when the symbol is an index nothing listed here trades
// (lib/charts isLookOnlyPair: US10Y, VIX, DXY, NDX, DJI, RUT).
//
// It never offers an order on the index. It says whose number this is
// (delayed index data that closes with its exchange), and — the "no dead
// end" rule — names the closest thing that IS listed here and offers THAT
// sentence, exactly as the home's read does beside its chart
// (components/home/TheRead): "Buy $25 of QQQ" for the Nasdaq 100, SHY for
// the 10-year, nothing for the VIX, which is said to be here to read. Every
// chip is one of lib/symbol-venues quickActs' own sentences for a listed
// symbol, shown only when the chip gate lets it through (the measured venue
// verdicts, lib/trade-venue-gate), and it runs through the page's act door
// (connect to act; the wallet signature is the gate). A neighbour with no
// order here (a Hyperliquid builder market) is a chart to open.
//
// Two seats, one component: the right column on a desktop (`rail`), and the
// main column under the tabs on a phone (`page`), where the rail sits a
// screen away. markets.css shows one of them per posture.

import { useMemo, useState, type FormEvent } from 'react'
import Link from 'next/link'
import { CornerDownLeft } from 'lucide-react'
import { chartPairFor, type ChartPair } from '@/lib/charts'
import { LOOK_ONLY_HEAD, LOOK_ONLY_SOURCE_LINE, LOOK_ONLY_SUB, lookOnlyNear, lookOnlyNoActLine, lookOnlySpoken } from '@/lib/macro'
import { quickActs } from '@/lib/symbol-venues'
import { canTradeAsk } from '@/lib/trade-venue-gate'
import { useTradable } from '@/lib/use-tradable'
import './look-only.css'

interface NearChip {
  label: string
  ask: string
}

export default function LookOnlyCard({
  pair,
  seat,
  onAsk,
  onSay,
}: {
  pair: ChartPair
  /** `rail`: the right column (a desktop). `page`: the main column (a phone). */
  seat: 'rail' | 'page'
  /** The page's act door: a neighbour's sentence runs through it (connect to act). */
  onAsk: (ask: string) => void
  /** The ask row: a question for Ask the chart. Omitted → no row. */
  onSay?: (text: string) => void
}) {
  const tradable = useTradable()
  const near = useMemo(() => lookOnlyNear(pair.symbol), [pair.symbol])
  const { chips, charts } = useMemo(() => {
    const outChips: NearChip[] = []
    for (const n of near) {
      const p = chartPairFor(n.symbol)
      // The neighbour's own lead sentence, if a venue here can fill it.
      const act = p ? quickActs(n.symbol, p).filter((a) => canTradeAsk(a.ask, tradable))[0] : undefined
      if (act) outChips.push({ label: `${act.label} of ${n.symbol}`, ask: act.ask })
    }
    return { chips: outChips, charts: near }
  }, [near, tradable])

  const [say, setSay] = useState('')
  const submit = (e: FormEvent) => {
    e.preventDefault()
    const text = say.trim()
    if (!text || !onSay) return
    onSay(text)
    setSay('')
  }

  return (
    <section className={`mk-look mk-look--${seat}`} data-slot="look-only" data-seat={seat} data-symbol={pair.symbol} data-near={near.length} data-acts={chips.length} aria-label={`${pair.symbol} is here to read`}>
      <div className="mk-look__head">
        <span className="mk-look__k mono">{LOOK_ONLY_HEAD}</span>
        <span className="mk-look__sub mono">{LOOK_ONLY_SUB}</span>
      </div>
      <p className="mk-look__line">{lookOnlyNoActLine(pair.symbol)}</p>
      <p className="mk-look__source">{LOOK_ONLY_SOURCE_LINE}</p>
      {chips.length > 0 && (
        <>
          <p className="mk-look__lab mono">The closest thing listed here</p>
          <div className="mk-look__chips">
            {chips.map((c) => (
              <button key={c.ask} type="button" className="mk-look__chip" onClick={() => onAsk(c.ask)} title={c.ask} data-ask={c.ask} data-journey={`Look-only act: ${c.ask}`}>
                {c.label}
              </button>
            ))}
          </div>
          <p className="mk-look__sentence mono">
            The sentence your wallet signs: <q>{chips[0].ask}</q>
          </p>
        </>
      )}
      {charts.length > 0 && (
        <div className="mk-look__doors">
          {charts.map((n) => (
            <Link key={n.symbol} href={`/t/${n.symbol}`} className="mk-look__door" prefetch={false} data-journey={`Look-only open ${n.symbol}`}>
              {n.symbol}, {n.as} <span aria-hidden>→</span>
            </Link>
          ))}
        </div>
      )}
      {onSay && (
        <form className="mk-look__say" onSubmit={submit} data-say="">
          <input
            className="mk-look__in"
            value={say}
            onChange={(e) => setSay(e.target.value)}
            placeholder={`Ask about ${lookOnlySpoken(pair.symbol)}…`}
            aria-label={`Ask about ${pair.symbol}`}
            autoComplete="off"
            spellCheck={false}
          />
          <button type="submit" className="mk-look__go" aria-label="Send to Ask the chart" title="Send" disabled={!say.trim()}>
            <CornerDownLeft className="h-3.5 w-3.5" />
          </button>
        </form>
      )}
    </section>
  )
}
