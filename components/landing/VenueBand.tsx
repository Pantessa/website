'use client'

// EVERY DAPP, ONE CHART — the section a charting subscription can't ship.
// One symbol in the middle (live price from /api/quotes), the venues your
// wallet can act on it through arranged around it, each with its live
// number (EXEC's GET /api/markets/routes?symbol= once it lands; until then
// the honest fallback WORD from lib/markets-copy — never a fabricated
// figure) and one chip whose ask PREFILLS /t/<symbol> (a link never fires
// a turn). The compound ask under it is the moat in one sentence.

import { useEffect, useState } from 'react'
import { ArrowRight } from 'lucide-react'
import SpineLink from '@/components/SpineLink'
import { getProtocolMark } from '@/components/protocol-marks'
import { fmtPrice } from '@/components/CandleChart'
import { LANDING_VENUES, TAPE_FOOTNOTE, VENUE_BAND } from '@/lib/markets-copy'

/** EXEC's RouteQuote (lib/symbol-venues): the fields the band reads. */
interface RouteLive { venue?: string; kind?: string; side?: string; quote?: { label?: string; sub?: string; value?: number | null } | null }

const chatPrefill = (ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`

/** The symbol at the center of the orbit (lib/markets-copy VENUE_BAND). */
const BAND_SYMBOL = VENUE_BAND.symbol

export default function VenueBand() {
  const [px, setPx] = useState<{ last: number; chg: number | null } | null>(null)
  const [live, setLive] = useState<Record<string, string>>({})

  useEffect(() => {
    let dead = false
    const readQuote = async () => {
      try {
        const r = await fetch(`/api/quotes?symbols=${BAND_SYMBOL}`)
        const j = await r.json()
        const q = j?.quotes?.[BAND_SYMBOL]
        if (!dead && q && typeof q.last === 'number') setPx({ last: q.last, chg: typeof q.chgPct === 'number' ? q.chgPct : null })
      } catch { /* the word stays */ }
    }
    // One routes read per distinct symbol the cards name (ETH, plus AAPL for
    // the stock card — Robinhood Chain has no ETH row).
    const readRoutes = async (symbol: string, keys: Set<string>) => {
      try {
        const r = await fetch(`/api/markets/routes?symbol=${encodeURIComponent(symbol)}`)
        if (!r.ok) return
        const j = await r.json()
        const rows: RouteLive[] = Array.isArray(j?.routes) ? j.routes : []
        // One number per band card: the venue's BUY-side row (or its only
        // row). A protect row feeds the Guardian card, never its venue's
        // card: the Hyperliquid stop has no side, so it used to overwrite
        // the perp's mark · funding with "watches every minute".
        const next: Record<string, string> = {}
        for (const row of rows) {
          const label = row.quote && typeof row.quote === 'object' && typeof row.quote.label === 'string' ? row.quote.label : null
          if (!label) continue
          const key = row.kind === 'protect' ? (row.venue === 'hyperliquid' ? 'guardian' : '') : String(row.venue ?? '').toLowerCase()
          if (!key || !keys.has(key)) continue
          if (next[key] && row.side === 'sell') continue
          next[key] = row.quote?.sub ? `${label} · ${row.quote.sub}` : label
        }
        if (!dead && Object.keys(next).length) setLive((prev) => ({ ...prev, ...next }))
      } catch { /* the route didn't answer — the words stay */ }
    }
    const bySymbol = new Map<string, Set<string>>()
    for (const v of LANDING_VENUES) {
      const sym = v.symbol ?? BAND_SYMBOL
      if (!bySymbol.has(sym)) bySymbol.set(sym, new Set())
      bySymbol.get(sym)!.add(v.key)
    }
    readQuote()
    for (const [sym, keys] of bySymbol) readRoutes(sym, keys)
    const t = setInterval(readQuote, 30_000)
    return () => { dead = true; clearInterval(t) }
  }, [])

  const liveFor = (key: string) => live[key] ?? null

  return (
    <section className="lvb" id="every-dapp" data-venue-band>
      <div className="lvb__head">
        <span className="lvb__eyebrow mono">{VENUE_BAND.eyebrow}</span>
        <h2 className="lvb__h2">{VENUE_BAND.h2}</h2>
        <p className="lvb__sub">{VENUE_BAND.sub}</p>
      </div>

      <div className="lvb__orbit">
        <div className="lvb__core" aria-label={`${BAND_SYMBOL}, the symbol every venue below acts on`}>
          <span className="lvb__coresym">{BAND_SYMBOL}</span>
          <span className="lvb__corepx mono">
            {px ? (
              <>
                ${fmtPrice(px.last)}
                {px.chg != null && <span className={px.chg >= 0 ? ' is-up' : ' is-down'}> {px.chg >= 0 ? '▲' : '▼'} {Math.abs(px.chg).toFixed(2)}%</span>}
              </>
            ) : (
              'live price'
            )}
          </span>
          <span className="lvb__corenote">one symbol · {LANDING_VENUES.length} ways to act</span>
        </div>
        {LANDING_VENUES.map((v) => {
          const Mark = getProtocolMark(v.name, v.key)
          const n = liveFor(v.key)
          return (
            <SpineLink key={v.key} href={chatPrefill(v.ask)} className="lvb__v" data-venue={v.key}>
              <span className="lvb__vhead">
                <span className="lvb__vmark">{Mark ? <Mark size={16} /> : <b>{v.name[0]}</b>}</span>
                <span className="lvb__vname">{v.name}</span>
                <span className="lvb__vkind mono">{v.kind}</span>
              </span>
              <span className={`lvb__vstat mono${n ? '' : ' is-word'}`}>{n ?? v.stat}</span>
              <span className="lvb__vchain mono">{v.chain}</span>
              <span className="lvb__vask">{v.ask} <ArrowRight className="w-3 h-3" /></span>
            </SpineLink>
          )
        })}
      </div>

      <div className="lvb__compound">
        <span className="lvb__compoundk mono">COMPOUND · ONE SIGNED JOB</span>
        <span className="lvb__compoundask">&ldquo;{VENUE_BAND.compound}&rdquo;</span>
        <SpineLink href={chatPrefill(VENUE_BAND.compound)} className="btn btn--sm lvb__compoundbtn">
          Open it as one job
        </SpineLink>
      </div>
      <p className="lvb__foot mono">A chip prefills; the signature is the gate · {TAPE_FOOTNOTE}</p>
    </section>
  )
}
