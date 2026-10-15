import Link from 'next/link'
import { BarChart } from '@/components/progress/BarChart'
import { MilestoneLadder, StatTiles, type Tile } from '@/components/progress/StatTiles'
import { FUNNEL_STOPS, fmtCount, fmtUsd, windowLabel } from '@/lib/progress'
import type { AnalyticsData } from '@/lib/progress-read'

// /analytics — the whole system's progress, public: the headline numbers
// with their change against the previous window, money and links by day, the
// strangers' funnel (arrived → asked → built → signed → returned, the one
// screen GTM is judged by, lib/gtm-arc), where the money went by venue and
// chain, and where the fees go. Aggregates only; nobody's prompt, nobody's
// full address.

const STOP_WORDS: Record<(typeof FUNNEL_STOPS)[number], string> = {
  arrived: 'Arrived',
  asked: 'Asked',
  built: 'Built',
  signed: 'Signed',
  returned: 'Came back',
}

export function Analytics({ data }: { data: AnalyticsData }) {
  const { totals, previous, window: w } = data
  const span = windowLabel(w).toLowerCase()
  const d = (cur: number, key: keyof typeof totals) => (previous ? { current: cur, previous: previous[key] } : null)
  const tiles: Tile[] = [
    { k: 'Money moved', v: fmtUsd(totals.movedUsd), note: span, delta: d(totals.movedUsd, 'movedUsd') },
    { k: 'Signed trades', v: fmtCount(totals.signed), note: `${fmtCount(totals.built)} built`, delta: d(totals.signed, 'signed') },
    { k: 'Wallets that signed', v: fmtCount(totals.wallets), delta: d(totals.wallets, 'wallets') },
    { k: 'Links minted', v: fmtCount(totals.linksMinted), delta: d(totals.linksMinted, 'linksMinted') },
    { k: 'Link opens', v: fmtCount(totals.linkOpens), note: `${fmtCount(totals.linkClaims)} signed through a link`, delta: d(totals.linkOpens, 'linkOpens') },
    ...(data.visitors
      ? [{ k: 'Visitors', v: fmtCount(data.visitors.people), note: 'people, not bots', delta: data.visitors.previous === null ? null : { current: data.visitors.people, previous: data.visitors.previous } }]
      : []),
  ]
  const days = data.daily.map((p) => p.day)
  const f = data.funnel
  const pct = (n: number) => (f.arrived > 0 ? Math.round((n / f.arrived) * 100) : 0)
  return (
    <>
      <StatTiles tiles={tiles} />
      <MilestoneLadder allTimeUsd={data.allTimeUsd} />

      <div className="pg__grid pg__grid--2">
        <section className="pg__sec" aria-labelledby="pg-money-day">
          <div className="pg__sec-head">
            <h2 id="pg-money-day" className="pg__sec-title">Money moved by day</h2>
            <span className="pg__sec-note">signed notional · last {days.length} days</span>
          </div>
          <BarChart days={days} title="Money moved by day" series={[{ key: 'usd', label: 'Money moved', cls: 'pg__bar-money', values: data.daily.map((p) => p.usd), fmt: fmtUsd }]} />
        </section>
        <section className="pg__sec" aria-labelledby="pg-links-day">
          <div className="pg__sec-head">
            <h2 id="pg-links-day" className="pg__sec-title">Links by day</h2>
            <span className="pg__sec-note">minted · signed through</span>
          </div>
          <BarChart
            days={data.links.map((p) => p.day)}
            title="Links by day"
            series={[
              { key: 'minted', label: 'Links minted', cls: 'pg__bar-s1', values: data.links.map((p) => p.minted), fmt: (v) => fmtCount(v) },
              { key: 'convs', label: 'Signed through a link', cls: 'pg__bar-s2', values: data.links.map((p) => p.convs), fmt: (v) => fmtCount(v) },
            ]}
          />
        </section>
      </div>

      <section className="pg__sec" aria-labelledby="pg-funnel" style={{ marginTop: 16 }}>
        <div className="pg__sec-head">
          <h2 id="pg-funnel" className="pg__sec-title">New wallets, step by step</h2>
          <span className="pg__sec-note">first seen in the window · strangers only</span>
        </div>
        <div className="pg__funnel" data-funnel="">
          {FUNNEL_STOPS.map((stop) => (
            <div className="pg__stop" key={stop} data-stop={stop}>
              <span className="pg__stop-k">{STOP_WORDS[stop]}</span>
              <span className="pg__stop-bar">
                <span style={{ width: `${pct(f[stop])}%` }} />
              </span>
              <span className="pg__stop-v">
                {fmtCount(f[stop])}
                <small>{pct(f[stop])}%</small>
              </span>
            </div>
          ))}
          {data.funnelBySource.length > 1 && (
            <table className="pg__table" style={{ marginTop: 8 }}>
              <thead>
                <tr>
                  <th>First touch</th>
                  {FUNNEL_STOPS.map((s) => (
                    <th key={s} className="pg__td-num">{STOP_WORDS[s]}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {data.funnelBySource.map((r) => (
                  <tr key={r.source}>
                    <td>{r.source}</td>
                    {FUNNEL_STOPS.map((s) => (
                      <td key={s} className="pg__td-num">{fmtCount(r[s])}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </section>

      <div className="pg__grid pg__grid--2" style={{ marginTop: 16 }}>
        <section className="pg__sec" aria-labelledby="pg-venues">
          <div className="pg__sec-head">
            <h2 id="pg-venues" className="pg__sec-title">Where the money went</h2>
            <span className="pg__sec-note">by venue · {span}</span>
          </div>
          <div className="pg__board" data-board="venues">
            {data.venues.length === 0 ? (
              <div className="pg__empty">Nothing signed in this window yet.</div>
            ) : (
              <table className="pg__table">
                <thead>
                  <tr>
                    <th>Venue</th>
                    <th className="pg__td-num">Moved</th>
                    <th className="pg__td-num">Signed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.venues.map((r) => (
                    <tr key={r.venue}>
                      <td>{r.venue}</td>
                      <td className="pg__td-num">{fmtUsd(r.usd)}</td>
                      <td className="pg__td-num">{fmtCount(r.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        <section className="pg__sec" aria-labelledby="pg-chains">
          <div className="pg__sec-head">
            <h2 id="pg-chains" className="pg__sec-title">By chain</h2>
            <span className="pg__sec-note">{span}</span>
          </div>
          <div className="pg__board" data-board="chains">
            {data.chains.length === 0 ? (
              <div className="pg__empty">Nothing signed in this window yet.</div>
            ) : (
              <table className="pg__table">
                <thead>
                  <tr>
                    <th>Chain</th>
                    <th className="pg__td-num">Moved</th>
                    <th className="pg__td-num">Signed</th>
                  </tr>
                </thead>
                <tbody>
                  {data.chains.map((r) => (
                    <tr key={r.venue}>
                      <td>{r.venue}</td>
                      <td className="pg__td-num">{fmtUsd(r.usd)}</td>
                      <td className="pg__td-num">{fmtCount(r.n)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
      </div>

      {data.fees && (
        <section className="pg__sec" aria-labelledby="pg-fees" style={{ marginTop: 16 }}>
          <div className="pg__sec-head">
            <h2 id="pg-fees" className="pg__sec-title">Where the fees go</h2>
            <span className="pg__sec-note">all time, since fees went live · a ledgered estimate</span>
          </div>
          <StatTiles
            tiles={[
              { k: 'Fee-bearing volume', v: fmtUsd(data.fees.feeBearingUsd), note: `${fmtCount(data.fees.conversions)} swaps` },
              { k: 'Earned by link creators', v: fmtUsd(data.fees.creatorUsd), note: 'their share of the fee' },
              { k: 'Earned by Pantessa', v: fmtUsd(data.fees.yeetfulUsd), note: 'the take rate is the business' },
            ]}
          />
        </section>
      )}

      <p className="pg__honest">
        Signed means a receipt the chain confirmed; built means a signable artifact existed. Our own harness and drill traffic is excluded from every
        number by construction, and the funnel counts strangers only — first-touch wallets, never the team&rsquo;s. The fee split is the same read-time
        formula creators&rsquo; claims use; the treasury on-chain is the source of truth. See who is on top on <Link href="/leaderboard">the leaderboard</Link>.
      </p>
    </>
  )
}
