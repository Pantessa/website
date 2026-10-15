import Link from 'next/link'
import SpineLink from '@/components/SpineLink'
import { MilestoneLadder, StatTiles } from '@/components/progress/StatTiles'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { fmtCount, fmtUsd, windowLabel } from '@/lib/progress'
import type { LeaderboardData } from '@/lib/progress-read'

// /leaderboard — who is moving money through the system, three ways: the
// links (the product's own unit of sharing), the creators behind them (their
// claimed page), and the wallets that signed. Every row is a live thing a
// visitor can open or copy; nothing here is a projection.

const fmtDate = (iso?: string) => (iso ? new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '')

function Empty({ children }: { children: React.ReactNode }) {
  return <div className="pg__empty">{children}</div>
}

export function Leaderboard({ data }: { data: LeaderboardData }) {
  const { totals, window: w } = data
  const span = windowLabel(w).toLowerCase()
  return (
    <>
      <StatTiles
        tiles={[
          { k: 'Money moved', v: fmtUsd(totals.movedUsd), note: span },
          { k: 'Signed trades', v: fmtCount(totals.signed), note: `${fmtCount(totals.built)} built` },
          { k: 'Wallets', v: fmtCount(totals.wallets), note: 'that signed' },
          { k: 'Links minted', v: fmtCount(totals.linksMinted), note: `${fmtCount(totals.linkOpens)} opens · ${fmtCount(totals.linkClaims)} signed through` },
        ]}
      />
      <MilestoneLadder allTimeUsd={data.allTimeUsd} />

      <div className="pg__grid pg__grid--2">
        <section className="pg__sec" aria-labelledby="pg-links">
          <div className="pg__sec-head">
            <h2 id="pg-links" className="pg__sec-title">Top links</h2>
            <span className="pg__sec-note">by money moved · {span}</span>
          </div>
          <div className="pg__board" data-board="links">
            {data.links.length === 0 ? (
              <Empty>
                No link has moved money in this window yet. <SpineLink href={LINKS_STUDIO_HREF}>Mint one</SpineLink> — the first signed dollar puts it here.
              </Empty>
            ) : (
              data.links.map((r, i) => (
                <Link key={r.slug} href={`/i/${r.slug}`} className="pg__row pg__row--link" data-slug={r.slug}>
                  <span className="pg__rank">{i + 1}</span>
                  <span className="pg__who">
                    <span className="pg__who-main">{r.ask}</span>
                    <span className="pg__who-sub">/i/{r.slug} · {fmtCount(r.opens)} opens</span>
                  </span>
                  <span className="pg__num">
                    <span className="pg__num-main">{fmtUsd(r.movedUsd)}</span>
                    <span className="pg__num-sub">{r.claims} signed</span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>

        <section className="pg__sec" aria-labelledby="pg-creators">
          <div className="pg__sec-head">
            <h2 id="pg-creators" className="pg__sec-title">Top creators</h2>
            <span className="pg__sec-note">claimed pages · {span}</span>
          </div>
          <div className="pg__board" data-board="creators">
            {data.creators.length === 0 ? (
              <Empty>
                No creator page has moved money in this window. Claim a handle in <SpineLink href={LINKS_STUDIO_HREF}>the link studio</SpineLink> and your page ranks here.
              </Empty>
            ) : (
              data.creators.map((r, i) => (
                <Link key={r.handle} href={`/l/${r.handle}`} className="pg__row pg__row--link" data-handle={r.handle}>
                  <span className="pg__rank">{i + 1}</span>
                  <span className="pg__who">
                    <span className="pg__who-main">@{r.handle}</span>
                    <span className="pg__who-sub">{r.links} live {r.links === 1 ? 'link' : 'links'}</span>
                  </span>
                  <span className="pg__num">
                    <span className="pg__num-main">{fmtUsd(r.movedUsd)}</span>
                    <span className="pg__num-sub">{r.claims} signed</span>
                  </span>
                </Link>
              ))
            )}
          </div>
        </section>
      </div>

      <section className="pg__sec" aria-labelledby="pg-wallets" style={{ marginTop: 16 }}>
        <div className="pg__sec-head">
          <h2 id="pg-wallets" className="pg__sec-title">Top wallets</h2>
          <span className="pg__sec-note">signed notional · {span} · short addresses only</span>
        </div>
        <div className="pg__board" data-board="wallets">
          {data.wallets.length === 0 ? (
            <Empty>No wallet has signed in this window yet.</Empty>
          ) : (
            data.wallets.map((r) => (
              <div key={r.wallet} className="pg__row" data-wallet-short={r.short}>
                <span className="pg__rank">{r.rank}</span>
                <span className="pg__who">
                  <span className="pg__who-main">{r.short}</span>
                  <span className="pg__who-sub">{r.firstAt ? `first signed ${fmtDate(r.firstAt)}` : ''}</span>
                </span>
                <span className="pg__num">
                  <span className="pg__num-main">{fmtUsd(r.usd)}</span>
                  <span className="pg__num-sub">{r.signed} signed</span>
                </span>
              </div>
            ))
          )}
        </div>
      </section>

      <p className="pg__honest">
        Every dollar here is a signed, receipt-verified transaction priced by the guardrails at signing time — never a quote, never a draft. Our own test
        traffic is excluded by construction. Wallets show in short form; creators show as the handle they claimed. Read the whole money story on{' '}
        <Link href="/analytics">Analytics</Link> and <Link href="/activity">Activity</Link>.
      </p>
    </>
  )
}
