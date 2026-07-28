// THE SPREAD — intent links as a distribution channel, drawn as one picture:
// a link leaves you, lands wherever you put it, and every conversion sends a
// receipt (and half the fee) back. Replaces LinkLane's chip row alone; the
// chips stay, because they're the only part of the section that's real and
// tappable — every one opens a seeded /i/<slug> that runs for real.
//
// The traffic is pure CSS: each wire carries a short dash whose offset
// animates, so a packet appears to travel it. No rAF, no JS, no layout work
// per frame — and the global reduced-motion guard stills every wire at once.
// The section is a server component: nothing here needs a client bundle.

import Link from 'next/link'
import HouseLinkChip from '@/components/HouseLinkChip'
import { HOUSE_LINKS } from '@/lib/house-links'

/** Where a link ends up. The wire to each is drawn from the same origin, so
 *  the fan reads as one link reaching four places at once. */
const SURFACES: { y: number; label: string; sub: string }[] = [
  { y: 26, label: 'a post', sub: 'the ask is the hook' },
  { y: 92, label: 'your docs', sub: '“try it” that actually runs' },
  { y: 158, label: 'a DM', sub: 'one person, one intent' },
  { y: 224, label: 'your site', sub: 'onboarding without a form' },
]

const ORIGIN = { x: 146, y: 125 }
const SX = 300

/** A gentle S-curve from the link to a surface. */
function wire(y: number) {
  const dx = SX - ORIGIN.x
  return `M ${ORIGIN.x} ${ORIGIN.y} C ${ORIGIN.x + dx * 0.45} ${ORIGIN.y}, ${SX - dx * 0.45} ${y}, ${SX} ${y}`
}

export default function LinkEconomy() {
  return (
    <section className="spread" id="links">
      <div className="spread__grid">
        <div className="spread__copy">
          <span className="spread__eyebrow mono">INTENT LINKS</span>
          <h2 className="spread__h2">A link that moves money.</h2>
          <p className="spread__sub">
            Mint a short link that carries an ask. Whoever opens it connects their own wallet and
            the path builds itself — guarded, signed only by them, receipted — then they&rsquo;re
            handed back to wherever the link lives. Creators earn half of Yeetful&rsquo;s 0.20% fee
            on the conversions their links produce.
          </p>

          {/* The house set — real, seeded, tappable. Each chip wears the marks
              of the apps its ask actually runs through. */}
          <div className="spread__chips">
            {HOUSE_LINKS.map((h) => (
              <HouseLinkChip key={h.slug} link={h} />
            ))}
          </div>

          <div className="spread__ctas">
            <Link href="/dashboard/links" className="btn btn--solid text-[13px]">
              Mint yours
            </Link>
            <Link href="/links" className="btn btn--ghost text-[13px]">
              The leaderboard
            </Link>
            <span className="mono spread__note">
              Every link opens with an explicit Connect &amp; build step — nothing auto-runs.
            </span>
          </div>
        </div>

        {/* the spread: one link, four surfaces, receipts coming back */}
        <div className="spread__stage" aria-hidden>
          <svg className="spread__svg" viewBox="0 0 520 250" preserveAspectRatio="xMidYMid meet">
            {SURFACES.map((s, i) => (
              <g key={s.label} style={{ ['--i' as string]: i }}>
                <path className="spread__wire" d={wire(s.y)} />
                <path className="spread__out" d={wire(s.y)} />
                <path className="spread__back" d={wire(s.y)} />
              </g>
            ))}
            {SURFACES.map((s) => (
              <g key={`n-${s.label}`}>
                <rect className="spread__node" x={SX - 8} y={s.y - 9} width="18" height="18" rx="5" />
                <text className="spread__nlabel mono" x={SX + 18} y={s.y - 1}>
                  {s.label}
                </text>
                <text className="spread__nsub mono" x={SX + 18} y={s.y + 10}>
                  {s.sub}
                </text>
              </g>
            ))}
            <g>
              <rect className="spread__link" x="8" y={ORIGIN.y - 17} width="132" height="34" rx="17" />
              <text className="spread__linktext mono" x="26" y={ORIGIN.y + 4}>
                /i/buy-aapl
              </text>
              <circle className="spread__linkdot" cx={ORIGIN.x} cy={ORIGIN.y} r="3.5" />
            </g>
          </svg>

          <div className="spread__legend mono">
            <span className="spread__key spread__key--out">
              <i /> the ask goes out
            </span>
            <span className="spread__key spread__key--back">
              <i /> the receipt — and half the fee — comes back
            </span>
          </div>

          {/* What a conversion actually pays. Fee-free routes are named
              rather than buried: a bridge dollar earns nothing, and saying so
              is cheaper than a creator finding out from their own dashboard. */}
          <dl className="spread__econ">
            <div>
              <dt className="mono">0.20%</dt>
              <dd>Yeetful&rsquo;s fee on a fee-bearing conversion</dd>
            </div>
            <div>
              <dt className="mono">½</dt>
              <dd>of that goes to the link&rsquo;s creator, claimable in USDC</dd>
            </div>
            <div>
              <dt className="mono">$0</dt>
              <dd>on bridges, funding legs and NFT sales — fee-free routes stay free</dd>
            </div>
          </dl>
        </div>
      </div>
    </section>
  )
}
