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
import { LANDING_SYMBOL, LANDING_VENUES, TAPE_FOOTNOTE, VENUE_BAND } from '@/lib/markets-copy'

interface RouteLive { id?: string; venue?: string; kind?: string; quote?: string; stat?: string }

const chatPrefill = (ask: string) => `/chat?prompt=${encodeURIComponent(ask)}`

export default function VenueBand() {
  const [px, setPx] = useState<{ last: number; chg: number | null } | null>(null)
  const [live, setLive] = useState<Record<string, string>>({})

  useEffect(() => {
    let dead = false
    const readQuote = async () => {
      try {
        const r = await fetch(`/api/quotes?symbols=${LANDING_SYMBOL}`)
        const j = await r.json()
        const q = j?.quotes?.[LANDING_SYMBOL]
        if (!dead && q && typeof q.last === 'number') setPx({ last: q.last, chg: typeof q.chgPct === 'number' ? q.chgPct : null })
      } catch { /* the word stays */ }
    }
    const readRoutes = async () => {
      try {
        const r = await fetch(`/api/markets/routes?symbol=${LANDING_SYMBOL}`)
        if (!r.ok) return
        const j = await r.json()
        const rows: RouteLive[] = Array.isArray(j?.routes) ? j.routes : []
        const next: Record<string, string> = {}
        for (const row of rows) {
          const key = String(row.venue ?? row.id ?? '').toLowerCase()
          const v = row.quote ?? row.stat
          if (key && typeof v === 'string' && v) next[key] = v
        }
        if (!dead && Object.keys(next).length) setLive(next)
      } catch { /* EXEC's route isn't here yet — the words stay */ }
    }
    readQuote()
    readRoutes()
    const t = setInterval(readQuote, 30_000)
    return () => { dead = true; clearInterval(t) }
  }, [])

  const liveFor = (key: string) => {
    for (const k of Object.keys(live)) if (k.includes(key)) return live[k]
    return null
  }

  return (
    <section className="lvb" id="every-dapp" data-venue-band>
      <div className="lvb__head">
        <span className="lvb__eyebrow mono">{VENUE_BAND.eyebrow}</span>
        <h2 className="lvb__h2">{VENUE_BAND.h2}</h2>
        <p className="lvb__sub">{VENUE_BAND.sub}</p>
      </div>

      <div className="lvb__orbit">
        <div className="lvb__core" aria-label={`${LANDING_SYMBOL}, the symbol every venue below acts on`}>
          <span className="lvb__coresym">{LANDING_SYMBOL}</span>
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
