// HOW A SENTENCE BECOMES A SIGNED TRANSACTION — the landing's trust section
// (squad landing, 2026-11-10; lane CLOSE owns this file and how.css). It
// takes the seat the small "How a chart executes" card held at the bottom
// of the boards (components/markets/shell/MarketsIndex `how`).
//
// Six stations in the order the runtime walks them, each with WHOSE hand is
// on it (you · the venue · Pantessa's code · the guard · your wallet · the
// chain), so a reader sees at a glance that the model stops at station one.
// Every sentence is checked against the docs that enforce it — the line
// behind each one is in squad-landing-2026-11-10/CLOSE.md:
//   GUARDRAILS.md §1–§3, §6, §7 · THREAT-MODEL.md (money follows the
//   receipt) · app/docs/trust · app/docs/transactions · lib/fees.
// A guard that only some venues run says "where", never "always".
//
// NO NUMBER IS TYPED HERE. The fee lines read `data.fees` (lib/fees through
// lib/home-tour-server tourFees), the venue line reads `data.counts`; a
// value that is missing drops its line, never leaves a hole. The station
// numbers are a CSS counter (how.css), so the source carries no digit.
//
// A server component: nothing here moves. LandingLink is the door (rule 6; lib/home-doors).

import LandingLink from '@/components/home/LandingLink'
import { EMPTY_TOUR, type TourSnapshot } from '@/lib/home-tour'
import './how.css'

/** The six stations, in order. `who` is whose hand is on the station. */
export const HOW_STATIONS = [
  {
    id: 'say',
    who: 'You',
    name: 'You say it',
    text: 'Tap a chip or type a sentence. A parser claims a money ask, so the same sentence takes the same path every time.',
  },
  {
    id: 'quote',
    who: 'The venue',
    name: 'It is quoted',
    text: 'Fetched live from the venue at build time: the pool, the quote, your balance. A quote has a deadline.',
  },
  {
    id: 'build',
    who: 'Pantessa’s code',
    name: 'A builder writes it',
    text: 'Deterministic code for each venue writes the transaction. The model only reads what you meant; it never writes calldata, an amount or an address.',
  },
  {
    id: 'guard',
    who: 'The guard',
    name: 'Guards check it',
    text: 'Pinned contracts and selectors, exact amounts, the proceeds back to you, a price bound, and a dry run where the venue allows one. Anything off, it refuses and says why.',
  },
  {
    id: 'sign',
    who: 'Your wallet',
    name: 'You sign',
    text: 'Your wallet, your keys. Nothing moves until you sign, and a quote past its deadline is rebuilt, never offered again.',
  },
  {
    id: 'receipt',
    who: 'The chain',
    name: 'The receipt',
    text: 'Built, signed or refused, each is recorded with its dollar value. A transaction’s dollars count only once its receipt is read back from the chain.',
  },
] as const

/** The cost lines. A line with a fee in it exists only when the snapshot has the fees. */
function costLines(data: TourSnapshot): { what: string; cost: string; note?: string }[] {
  const f = data.fees
  const lines: { what: string; cost: string; note?: string }[] = [
    { what: 'Looking: charts, the boards, watchlists, alerts', cost: 'Free' },
  ]
  if (f) {
    lines.push({ what: 'A swap you ask for, on one chain or across chains', cost: f.swapPct })
    lines.push({ what: 'A swap through a shared link', cost: f.linkPct, note: `${f.creatorPct} of the fill goes to the link’s creator` })
    lines.push({ what: 'A Hyperliquid perp', cost: f.hlPct, note: 'the builder fee, taken from the fill' })
  }
  // A cross-chain move is a swap and carries the swap fee (lib/fees CROSS_CHAIN_FEE_BPS), so "bridges" is not on the fee-free line (QA, 2026-11-10).
  lines.push({ what: 'Staking, lending, transfers, votes', cost: 'No fee' })
  return lines
}

/** The venue manifest's line, or null when either count is missing. */
function manifestLine(data: TourSnapshot): string | null {
  const { venues, pinnedAddresses } = data.counts
  if (venues == null || pinnedAddresses == null) return null
  return `${venues.toLocaleString('en-US')} venues · ${pinnedAddresses.toLocaleString('en-US')} pinned contract addresses`
}

export default function HowItWorks({ data }: { data?: TourSnapshot }) {
  const snap = data ?? EMPTY_TOUR
  const costs = costLines(snap)
  const manifest = manifestLine(snap)
  return (
    <section className="how" aria-labelledby="how-title" data-how>
      <header className="how__head">
        <p className="how__eyebrow mono">Under every button</p>
        <h2 id="how-title" className="how__title">
          How a sentence becomes a signed transaction
        </h2>
        <p className="how__lede">
          Six stations, in the order they run. Past the first, no model touches it: code builds it, a guard checks it, your wallet decides.
        </p>
      </header>

      <ol className="how__rail" aria-label="The six stations">
        {HOW_STATIONS.map((s) => (
          <li key={s.id} className="how__station" data-station={s.id}>
            <span className="how__mark" aria-hidden="true" />
            <div className="how__body">
              <p className="how__who mono">{s.who}</p>
              <h3 className="how__name">{s.name}</h3>
              <p className="how__text">{s.text}</p>
            </div>
          </li>
        ))}
      </ol>

      <div className="how__cols">
        <section className="how__col" aria-labelledby="how-costs">
          <h3 id="how-costs" className="how__coltitle">
            What it costs
          </h3>
          <dl className="how__costs" data-how-costs>
            {costs.map((c) => (
              <div key={c.what} className="how__cost">
                <dt className="how__costwhat">
                  {c.what}
                  {c.note && <span className="how__costnote">{c.note}</span>}
                </dt>
                <dd className="how__costval mono">{c.cost}</dd>
              </div>
            ))}
          </dl>
          <p className="how__colnote">A fee is named on the card before you sign and carried in the signed transaction, never hidden inside slippage.</p>
        </section>

        <section className="how__col" aria-labelledby="how-never">
          <h3 id="how-never" className="how__coltitle">
            What Pantessa never does
          </h3>
          <ul className="how__never">
            <li>
              <strong>Hold your money or your keys.</strong>{' '}
              There is no balance to fund; what you own stays in your wallet until a transaction you signed moves it.
            </li>
            <li>
              <strong>Let a model write a transaction.</strong>{' '}
              Not the calldata, not an amount, not an address.
            </li>
            <li>
              <strong>Ask you to sign in to look.</strong>{' '}
              Charts and boards are open to anyone; a wallet is asked for only when you act.
            </li>
          </ul>
          <p className="how__colnote">
            The one exception is yours to choose: a Hyperliquid stop runs under a key you authorize with one signature. It can only reduce the position it guards, cannot withdraw, and can be revoked at any time.
          </p>
        </section>
      </div>

      <nav className="how__doors" aria-label="Read more about trust">
        <LandingLink href="/docs/trust" className="how__door how__door--primary" prefetch={false} data-journey="How: the trust model">
          <span className="how__doorlabel">Read the trust model</span>
        </LandingLink>
        <LandingLink href="/docs/venues" className="how__door" prefetch={false} data-journey="How: the venue manifest">
          <span className="how__doorlabel">The venue manifest</span>
          {manifest && <span className="how__doorcount mono">{manifest}</span>}
        </LandingLink>
        <LandingLink href="/pricing" className="how__door" prefetch={false} data-journey="How: pricing">
          <span className="how__doorlabel">Pricing</span>
        </LandingLink>
      </nav>
    </section>
  )
}
