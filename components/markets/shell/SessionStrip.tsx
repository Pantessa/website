'use client'

// The session strip at the top of /markets (MK2 R2): the three clocks a
// multi-venue terminal needs and a single-venue chart never shows — the
// NYSE bell with a live countdown (the tape the stock tokens track), the
// token side ("trades 24/7"), and Hyperliquid's hourly funding tick. Pure
// arithmetic from lib/markets (sessionStripFor); ticks every 30s. No
// rates are claimed — only clocks (a number we can't read is not printed).
// The countdown text is time-dependent BY DESIGN: the server's minute and
// the client's can differ at hydration, so those two text nodes carry
// suppressHydrationWarning (React's timestamp idiom) — the first tick
// re-renders them from the client clock. Everything else in the strip is
// deterministic across the boundary.

import { useEffect, useState } from 'react'
import { fmtCountdown, sessionStripFor } from '@/lib/markets'

export default function SessionStrip() {
  const [now, setNow] = useState<Date>(() => new Date())
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 30_000)
    return () => clearInterval(id)
  }, [])
  const s = sessionStripFor(now)
  return (
    <div className="mk-session" role="status" aria-label="Market sessions" data-nyse={s.nyse.open ? 'open' : 'closed'}>
      <span className="mk-session__item">
        <span className={`mk-dot ${s.nyse.open ? 'mk-dot--open' : 'mk-dot--closed'}`} aria-hidden />
        <span className="mk-session__k mono">{s.nyse.label}</span>
        <span className="mk-session__v mono" data-countdown={s.nyse.bell} suppressHydrationWarning>
          {s.nyse.bell === 'closes' ? 'closes in' : 'opens in'} {fmtCountdown(s.nyse.minsToBell)}
          {s.nyse.reopens ? ` · ${s.nyse.reopens}` : ''}
        </span>
      </span>
      <span className="mk-session__sep" aria-hidden />
      <span className="mk-session__item">
        <span className="mk-dot mk-dot--always" aria-hidden />
        <span className="mk-session__k mono">TOKENS 24/7</span>
        <span className="mk-session__v mono">stocks on Robinhood Chain · spot · perps — the token never closes</span>
      </span>
      <span className="mk-session__sep" aria-hidden />
      <span className="mk-session__item">
        <span className="mk-dot mk-dot--tick" aria-hidden />
        <span className="mk-session__k mono">HL FUNDING</span>
        <span className="mk-session__v mono" data-countdown="funding" suppressHydrationWarning>
          next tick in {fmtCountdown(s.hlFundingMins)} · hourly
        </span>
      </span>
    </div>
  )
}
