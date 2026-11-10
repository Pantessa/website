'use client'

// THE TOUR · EARN — the ladder (squad landing, 2026-11-10; lane SIDES-A).
// Today's best live rate per asset, highest first: the asset, the venue's
// mark, the chain, the rate as a bar in the venue's ink (the Earn board's own
// colours), and what the picked amount would earn in a year if the rate held.
// Tap a row and its sentence — the board's own, for that amount — is printed
// under the ladder with one button that runs it.
//
// Where the rows come from (./a/ladder):
//   • first frame: the server snapshot (`data.earn`, lane DATA's read);
//   • then GET /api/markets/earn, re-read each minute, only while this panel
//     is on screen and the tab is in view (./a/useLive). It is also the
//     fallback when the snapshot carries no rows. The live rows carry the
//     board's composer, so every amount has its sentence; a snapshot row has
//     one sentence, at the board's default amount.
// Nothing here ranks by hand, writes a sentence or types a rate. A venue
// that did not answer is named; with no rows at all the panel says so and
// shows nothing rather than a stale rate (the board's rule).

import { useState } from 'react'
import { getProtocolMark } from '@/components/protocol-marks'
import { meta } from '@/lib/home-tour/earn'
import { tourJourney } from '@/lib/home-tour'
import { seriesVar } from '@/lib/markets-look'
import { useTour } from '../context'
import { TourPanel } from '../Panel'
import { Seg } from './a/Seg'
import { LADDER_AMOUNTS, LADDER_DEFAULT_USD, LADDER_REFRESH_MS, LADDER_URL, acceptLadder, fmtAsOfUtc, fmtRate, fmtYearly, ladderBarPct, ladderFromLive, ladderFromSeed, yearlyUsd } from './a/ladder'
import { useOnScreen, usePolled } from './a/useLive'
import './a/kit.css'
import './earn.css'

/** The words column without its chip: the ladder's rows are the sentences. */
const COPY = { ...meta, asks: [] }
const J = (what: string) => tourJourney(meta.id, what)

export default function EarnSide() {
  const { data, act, canAct } = useTour()
  const [usd, setUsd] = useState(LADDER_DEFAULT_USD)
  const [picked, setPicked] = useState<string | null>(null)
  const [root, active] = useOnScreen<HTMLDivElement>()
  const live = usePolled(LADDER_URL, LADDER_REFRESH_MS, active, acceptLadder)

  const fromLive = live.data && live.data.ladder.length > 0
  const rows = fromLive && live.data ? ladderFromLive(live.data.ladder, usd) : ladderFromSeed(data.earn, usd)
  const best = rows.reduce((m, r) => Math.max(m, r.apy), 0)
  const row = rows.find((r) => r.id === picked) ?? rows[0] ?? null
  const runnable = !!row?.ask && canAct(row.ask)
  const asOf = fromLive ? fmtAsOfUtc(live.data?.asOf ?? null) : ''
  const silent = live.data?.failed ?? []
  // No rows: still reading, or the venues did not answer.
  const state = rows.length > 0 ? 'rows' : live.data || live.failed ? 'silent' : 'reading'

  return (
    <TourPanel side={COPY} demoLabel="The best live rate per asset">
      <div className="ta te" ref={root} data-tour-mini="earn" data-state={state} data-source={fromLive ? 'live' : 'snapshot'} data-usd={usd}>
        <div className="te__head">
          <p className="ta-eyebrow mono">Best rate per asset · yearly, highest first</p>
          <div className="ta-field">
            <span className="ta-eyebrow mono">Amount</span>
            <Seg label="Amount in dollars" value={usd} onChange={setUsd} options={LADDER_AMOUNTS.map((n) => ({ value: n, label: `$${n}`, say: `${n} dollars` }))} journey={(n) => J(`amount ${n}`)} />
          </div>
        </div>

        {state === 'rows' ? (
          <ul className="te__rows" aria-label="Ways to earn, best rate first">
            {rows.map((r) => {
              const Mark = getProtocolMark(r.venue)
              const on = r.id === row?.id
              return (
                <li key={r.id}>
                  <button type="button" className={`te__row${on ? ' is-on' : ''}`} aria-pressed={on} onClick={() => setPicked(r.id)} data-earn-row={r.id} data-journey={J(`row ${r.asset} ${r.venue}`)}>
                    <span className="te__mark" aria-hidden>
                      {Mark ? <Mark size={18} /> : r.venue.slice(0, 1)}
                    </span>
                    <span className="te__id">
                      <span className="te__asset">{r.asset}</span>
                      <span className="te__where mono">
                        {r.venue} · {r.chain}
                      </span>
                    </span>
                    <span className="te__rate mono">{fmtRate(r.apy)}</span>
                    <span className="te__track" aria-hidden>
                      <span className="te__bar" style={{ width: `${ladderBarPct(r.apy, best)}%`, background: seriesVar(r.venue) }} />
                    </span>
                    <span className="te__year mono">{fmtYearly(yearlyUsd(usd, r.apy))} a year</span>
                  </button>
                </li>
              )
            })}
          </ul>
        ) : (
          <p className="te__empty mono">{state === 'reading' ? 'Reading Lido, Aave and Morpho…' : 'The venues did not answer just now. Nothing is shown rather than a stale rate.'}</p>
        )}

        {row && (
          <div className="te__take" aria-live="polite">
            <p className="ta-eyebrow mono">The sentence your wallet signs</p>
            {row.ask ? (
              <p className="te__sentence" data-earn-ask={row.ask}>
                <q>{row.ask}</q>
              </p>
            ) : (
              <p className="ta-note">Reading the venue to size this one. Its rate stands.</p>
            )}
            <p className="ta-note">
              ${usd} at today&rsquo;s {fmtRate(row.apy)} is about {fmtYearly(yearlyUsd(usd, row.apy))} a year if the rate holds. Rates are variable.
            </p>
            <div className="te__go">
              {runnable && row.ask ? (
                <button type="button" className="ta-run" onClick={() => act(row.ask as string)} title={row.ask} data-ask={row.ask} data-journey={J('take the rate')}>
                  Take this rate <span aria-hidden>→</span>
                </button>
              ) : (
                row.ask && <p className="ta-note">{row.venue} is not taking this one right now.</p>
              )}
            </div>
          </div>
        )}

        <p className="te__foot mono">
          Each venue&rsquo;s own rate, the same for everyone, not your holdings
          {asOf ? ` · as of ${asOf}` : ''}
          {silent.length > 0 ? ` · not answering: ${silent.join(', ')}` : ''}
        </p>
      </div>
    </TourPanel>
  )
}
