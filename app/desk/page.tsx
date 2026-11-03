import type { Metadata } from 'next'
import Link from 'next/link'
import { SITE } from '@/lib/docs'
import { DESK_PLATFORM_FEE_USD, DESK_KEY_PREFIX } from '@/lib/tenant/spec'
import Footer from '@/components/Footer'
import PilotForm from '@/components/desk-page/PilotForm'
import {
  BLOTTER_KIND_ROWS,
  FREE_DAYS,
  PRICING_EXAMPLE_NOTIONAL_USD,
  SAMPLE_APPROVERS,
  SAMPLE_APPROVAL_OVER_USD,
  SAMPLE_MAX_ORDER_USD,
  SAMPLE_POLICY,
  deskSeatPlans,
  monthlyDeskCostUsd,
  policyVocabulary,
  samplePolicyJson,
  sampleBlotterRows,
  tierLines,
  usd0,
  usdShort,
  verifySampleChain,
} from '@/components/desk-page/sample'
import { tieredDeskFeeUsd } from '@/lib/tenant/spec'
import '@/components/desk-page/desk.css'

// /desk — THE GOVERNED DESK for institutions (squad five-million, DESKPAGE
// lane, 2026-11-03; plan GTM-PLAN-5M-ARR §4). The reader is the head of
// digital-asset execution and the compliance desk beside them. In order: the
// line · what compliance owns (the policy SHAPE from lib/tenant/spec, with a
// sample) · what the auditor gets (the blotter kinds, the hash chain, a
// sample export whose chain really verifies) · what signs (four lanes, each
// with its honest status) · what cannot happen (the guard layer) · the
// signal (Dune's feeds — "built on", never "in partnership") · pricing from
// the spec constants · honest about today · the pilot door. Every number and
// every vocabulary word is read from the spec, never retyped; the pins
// compare the served page against it. Brochure frame (x-main + the site nav
// + the footer), like /pricing: a prospect arrives from a link, not from
// inside the app.

const TITLE = 'The governed desk — Pantessa'
const DESCRIPTION =
  'The DeFi execution desk that lives inside your controls: your custody signs, your policy decides which venues exist, deterministic builders write every transaction, the chain proves the receipt, and a hash-chained blotter is yours to export. No model ever writes calldata.'
const CANONICAL = `${SITE}/desk`
const OG_IMAGE = [{ url: '/desk/opengraph-image', width: 1200, height: 630, alt: 'Pantessa — the governed desk. Your custody signs.' }]

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  alternates: { canonical: CANONICAL },
  openGraph: { title: TITLE, description: DESCRIPTION, url: CANONICAL, type: 'website', images: OG_IMAGE },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: OG_IMAGE },
}

const JSON_LD = JSON.stringify({
  '@context': 'https://schema.org',
  '@type': 'Service',
  name: 'Pantessa — the governed desk',
  serviceType: 'DeFi execution desk for institutions',
  provider: { '@type': 'Organization', name: 'Pantessa', url: SITE },
  url: CANONICAL,
  description: DESCRIPTION,
  offers: { '@type': 'Offer', name: 'Desk platform fee', price: String(DESK_PLATFORM_FEE_USD), priceCurrency: 'USD', description: 'Per desk, per month, plus tiered execution on receipt-verified notional.' },
})

/** The four signing lanes with the status each one has EARNED. The Safe word
 *  flips to "measured" only when the CUSTODY lane's file records an executed
 *  Safe transaction; until then it is "in drill". */
const SIGNING_LANES = [
  {
    t: 'Wallet',
    status: 'live',
    tone: 'live',
    b: "A trader's own wallet in the cockpit: MetaMask, Rabby, Coinbase, Phantom, Rainbow. The same path every retail trade on this site takes today.",
  },
  {
    t: 'WalletConnect custody',
    status: 'signs in the cockpit',
    tone: 'live',
    b: 'Fireblocks, Copper, Fordefi and Safe each connect to a dapp over WalletConnect, and the cockpit signs over WalletConnect today. Your custody’s own approval policy runs before any signature lands; ours runs before the build. The first pilot afternoon is exactly this connection, on a testnet, with the log kept.',
  },
  {
    t: 'Headless (viem)',
    status: 'proven · driveJob',
    tone: 'live',
    b: 'Your service holds the key. driveJob from the pantessa SDK fetches each guarded leg, signs it with viem, posts completion, and the runner re-verifies on-chain before the next leg is built. Proven against a running deployment.',
  },
  {
    t: 'Safe',
    status: 'in drill',
    tone: 'drill',
    b: 'Propose to the Safe transaction service with an owner signature, poll until your signers execute, return the hash. Transaction legs first; CoW orders through a Safe (presign) come in the next version, and a Safe owns a desk job only through its tenant: register its address as a signer and the desk key is the consent, no EOA signature asked (a Safe outside a tenant still waits on EIP-1271). Named, not hidden.',
  },
] as const

const GUARD_LINES = [
  {
    t: 'Deterministic builders write every transaction.',
    b: (
      <>
        A model plans in sentences. It never writes calldata, an address, or a deposit target; the builder for the venue does, from pinned constants. The{' '}
        <Link href="/docs/trust">trust model</Link> is the mechanical version.
      </>
    ),
  },
  {
    t: 'Fail-closed guards re-check every build.',
    b: 'A leg the guard cannot price, bound or verify is refused by name. For a tenant signer the gate blocks; it never warns a trade through.',
  },
  {
    t: 'Every contract and selector is pinned and published.',
    b: (
      <>
        <Link href="/docs/venues">The venue manifest</Link>: per venue and chain, every address and selector a build may emit, read from the builders’ own
        constants, with an integrity hash your desk can re-derive.
      </>
    ),
  },
  {
    t: 'The policy can live on-chain.',
    b: (
      <>
        <Link href="/policy-pool">The policy pool</Link>: a Uniswap v4 pool whose hook refuses any swap without the desk’s signed attestation, every verdict and
        fill on a public ledger.
      </>
    ),
  },
]

const REFUSALS = ['VENUE_DENIED', 'CHAIN_DENIED', 'TOKEN_DENIED', 'OP_DENIED', 'SIDE_DENIED', 'OVER_ORDER', 'OVER_DAY', 'OUTSIDE_HOURS', 'UNPRICED']

const shortHash = (h: string) => `${h.slice(0, 10)}…${h.slice(-4)}`
const sampleChains = new Set(SAMPLE_POLICY.venues.flatMap((v) => v.chains ?? []))
const sampleVenues = new Set<string>(SAMPLE_POLICY.venues.map((v) => v.venue))
const sampleOps = new Set<string>(SAMPLE_POLICY.venues.flatMap((v) => v.ops ?? []))
const sampleSides = new Set<string>(SAMPLE_POLICY.venues.flatMap((v) => v.sides ?? []))

function chipOn(k: string, item: string): boolean {
  if (k === 'venues') return sampleVenues.has(item)
  if (k === 'ops') return sampleOps.has(item)
  if (k === 'sides') return sampleSides.has(item)
  if (k === 'chains') {
    const id = Number(item.split(' · ').pop())
    return sampleChains.has(id)
  }
  return false
}

export default function DeskPage() {
  const rows = sampleBlotterRows()
  const verify = verifySampleChain(rows)
  const vocab = policyVocabulary()
  const seats = deskSeatPlans()
  const exampleTotal = monthlyDeskCostUsd(PRICING_EXAMPLE_NOTIONAL_USD)
  const exampleExec = tieredDeskFeeUsd(PRICING_EXAMPLE_NOTIONAL_USD)
  const desk = SAMPLE_POLICY.desks[0]

  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON_LD }} />
      <main className="x-main">
        <article className="dk" data-desk-page>
          {/* ── The line ── */}
          <header className="dk__hero" id="line">
            <span className="dk__eyebrow">The governed desk</span>
            <h1 className="dk__h1">
              The DeFi execution desk that lives <em>inside your controls.</em>
            </h1>
            <p className="dk__lead">
              <strong>Your custody signs.</strong> Your policy decides which venues exist. Our builders write the transaction. The chain proves the receipt.{' '}
              <strong>No model ever writes calldata.</strong>
            </p>
            <p className="dk__who">For the head of digital-asset execution, and the compliance desk beside them.</p>
            <div className="dk__ctas">
              <a className="dk__btn dk__btn--solid" href="#pilot">
                Request a pilot
              </a>
              <Link className="dk__btn dk__btn--ghost" href="/docs/venues">
                Read the venue manifest
              </Link>
            </div>
          </header>

          {/* ── 01 What your compliance owns ── */}
          <section className="dk__sec" id="policy" aria-labelledby="dk-policy">
            <div className="dk__sechead">
              <span className="dk__n">01 · What your compliance owns</span>
              <h2 className="dk__h2" id="dk-policy">
                A policy document. Versioned. Default deny.
              </h2>
              <p className="dk__sub">
                An order no rule admits is refused, by name. Per venue: the chains, the tokens, the operations, the sides, a size cap, an impact cap, a leverage cap. Per
                desk: a per-order cap, a per-day cap, <strong>approvals over a threshold</strong>, trading hours. A pre-trade hook your systems answer. Two admins to change
                any of it (maker-checker), and a desk key can never widen the policy it was minted under.
              </p>
            </div>
            <div className="dk__split">
              <div className="dk__panel">
                <div className="dk__panel-k">
                  <span>The shape</span>
                  <span className="dk__badge">your compliance writes the values</span>
                </div>
                <p className="dk__panel-p">
                  A sample: CoW and Uniswap v3 on Ethereum and Base, Aave v4 supply and withdraw, three tokens, {usdShort(SAMPLE_MAX_ORDER_USD)} an order, one desk{' '}
                  <code>{desk.id}</code> with {SAMPLE_APPROVERS} approvers over {usdShort(SAMPLE_APPROVAL_OVER_USD)}, New York hours, a pre-trade hook.
                </p>
                <pre className="dk__code" data-policy-sample>
                  {samplePolicyJson()}
                </pre>
              </div>
              <div className="dk__panel">
                <div className="dk__panel-k">
                  <span>The vocabulary</span>
                  <span>from the gate’s own constants</span>
                </div>
                <p className="dk__panel-p">
                  A rule is written in the words the builders already speak. A venue is a guarded builder family; an op is one of its operations; a chain is one the
                  venue runs on, or the rule is refused at proposal. Highlighted: the words the sample uses.
                </p>
                <div className="dk__vocab" data-vocab>
                  {vocab.map((row) => (
                    <div className="dk__vocabrow" key={row.k}>
                      <span className="dk__vocab-k">{row.k}</span>
                      <div className="dk__chips">
                        {row.items.map((item) => (
                          <span className={`dk__chip${chipOn(row.k, item) ? ' dk__chip--on' : ''}`} key={item} data-vocab-item={row.k}>
                            {item}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                </div>
                <p className="dk__panel-p" style={{ marginTop: 16 }}>
                  <strong>A refusal names its reason.</strong> {REFUSALS.map((r, i) => (
                    <span key={r}>
                      <code>{r}</code>
                      {i < REFUSALS.length - 1 ? ' ' : ''}
                    </span>
                  ))}{' '}
                  An order the desk cannot price is refused, never warned through. Over the desk’s threshold it is allowed and waits for {SAMPLE_APPROVERS} distinct
                  approvals before a leg is offered.
                </p>
              </div>
            </div>
          </section>

          {/* ── 02 What the auditor gets ── */}
          <section className="dk__sec" id="blotter" aria-labelledby="dk-blotter">
            <div className="dk__sechead">
              <span className="dk__n">02 · What the auditor gets</span>
              <h2 className="dk__h2" id="dk-blotter">
                Every step is a row. Every row carries the hash of the one before.
              </h2>
              <p className="dk__sub">
                The blotter is append-only and per tenant: the order reaching the desk, the gate’s verdict, the quotes considered and the route chosen, the offer to the
                signer, the signature, the settlement with its verification state, every approval, every policy edit, every key event, the monthly statement. It is yours
                to export as JSON or CSV, by date range and kind.
              </p>
            </div>
            <div className="dk__split">
              <div className="dk__panel">
                <div className="dk__panel-k">
                  <span>The kinds</span>
                  <span>{BLOTTER_KIND_ROWS.length} of them</span>
                </div>
                <div className="dk__tablewrap">
                  <table className="dk__table" data-blotter-kinds>
                    <thead>
                      <tr>
                        <th>kind</th>
                        <th>what it records</th>
                      </tr>
                    </thead>
                    <tbody>
                      {BLOTTER_KIND_ROWS.map((r) => (
                        <tr key={r.kind}>
                          <td className="dk__mono">{r.kind}</td>
                          <td>{r.words}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
              <div className="dk__panel">
                <div className="dk__panel-k">
                  <span>The chain</span>
                  <span>sha256, replayable by anyone</span>
                </div>
                <p className="dk__chain">
                  Each row’s <code>hash</code> is sha256 over the previous row’s hash, its sequence number, its kind, its timestamp and its payload in one
                  canonical encoding (sorted keys, no whitespace). The first row chains from a genesis of sixty-four zeros. Change one byte of one row, or remove one, and
                  every hash after it stops matching. <code>GET /api/tenants/:id/blotter/verify</code> replays the whole chain and answers <code>{'{ ok, rows, brokenAt? }'}</code>
                  ; your auditor can replay it from the CSV with twenty lines of their own.
                </p>
                <div className="dk__panel-k" style={{ marginTop: 18 }}>
                  <span>A sample export</span>
                  <span className="dk__badge dk__badge--warn">sample · fake values</span>
                </div>
                <div className="dk__tablewrap">
                  <table className="dk__table" data-blotter-sample>
                    <thead>
                      <tr>
                        <th>seq</th>
                        <th>kind</th>
                        <th>at (UTC)</th>
                        <th>value</th>
                        <th>verif.</th>
                        <th>prev</th>
                        <th>hash</th>
                      </tr>
                    </thead>
                    <tbody>
                      {rows.map((r) => (
                        <tr key={r.seq}>
                          <td className="dk__mono">{r.seq}</td>
                          <td className="dk__mono">{r.kind}</td>
                          <td className="dk__mono">{r.createdAtIso.slice(11, 19)}</td>
                          <td className="dk__mono">{r.valueUsd !== null ? usd0(r.valueUsd) : '—'}</td>
                          <td className="dk__mono">{r.verification ?? '—'}</td>
                          <td className="dk__hash" title={r.prevHash}>
                            {shortHash(r.prevHash)}
                          </td>
                          <td className="dk__hash" title={r.hash}>
                            {shortHash(r.hash)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
                <p className="dk__fine" data-verify={verify.ok ? 'ok' : 'broken'}>
                  The values are a sample; the hashes are not: they are sha256 over these rows, replayed from genesis at render. <code>verify</code> on this table answers{' '}
                  <code>{JSON.stringify(verify)}</code>.
                </p>
              </div>
            </div>
          </section>

          {/* ── 03 What signs ── */}
          <section className="dk__sec" id="signing" aria-labelledby="dk-signing">
            <div className="dk__sechead">
              <span className="dk__n">03 · What signs</span>
              <h2 className="dk__h2" id="dk-signing">
                Your custody. Never us.
              </h2>
              <p className="dk__sub">
                Pantessa is non-custodial for a firm the way it is for a person: the desk builds an unsigned leg and offers it; the signer your policy names signs it, or
                does not. Four lanes, each with the status it has earned.
              </p>
            </div>
            <div className="dk__cards" data-signing-lanes>
              {SIGNING_LANES.map((l) => (
                <div className="dk__card" key={l.t} data-lane={l.t}>
                  <span className={`dk__status dk__status--${l.tone}`}>
                    <i aria-hidden="true" />
                    {l.status}
                  </span>
                  <div className="dk__card-t">{l.t}</div>
                  <p className="dk__card-b">{l.b}</p>
                </div>
              ))}
            </div>
          </section>

          {/* ── 04 What cannot happen ── */}
          <section className="dk__sec" id="guard" aria-labelledby="dk-guard">
            <div className="dk__sechead">
              <span className="dk__n">04 · What cannot happen</span>
              <h2 className="dk__h2" id="dk-guard">
                The guard layer, in four lines.
              </h2>
              <p className="dk__sub">The part a compliance desk can read instead of trusting.</p>
            </div>
            <ol className="dk__lines" data-guard-lines>
              {GUARD_LINES.map((g, i) => (
                <li className="dk__line" key={g.t}>
                  <span className="dk__line-n">0{i + 1}</span>
                  <div>
                    <div className="dk__line-t">{g.t}</div>
                    <p className="dk__line-b">{g.b}</p>
                  </div>
                </li>
              ))}
            </ol>
          </section>

          {/* ── 05 The signal ── */}
          <section className="dk__sec" id="signal" aria-labelledby="dk-signal">
            <div className="dk__sechead">
              <span className="dk__n">05 · The signal</span>
              <h2 className="dk__h2" id="dk-signal">
                Built on Dune’s real-time feeds.
              </h2>
            </div>
            <div className="dk__signal">
              <div>
                <div className="dk__signal-t">The feed reads. The desk signs.</div>
                <p className="dk__signal-b">
                  Every print on the live tape and the live edge of every chart streams from Dune’s real-time chain feeds: HyperCore, Lighter, DEX spot. A print is a
                  sentence; a sentence is a guarded build; a tenant’s policy gates it exactly as it gates an order from your OMS. The same desk, fed by the same
                  stream your analysts already read.
                </p>
              </div>
              <Link className="dk__btn dk__btn--ghost" href="/live">
                See the tape live
              </Link>
            </div>
          </section>

          {/* ── 06 Pricing ── */}
          <section className="dk__sec" id="pricing" aria-labelledby="dk-pricing">
            <div className="dk__sechead">
              <span className="dk__n">06 · Pricing</span>
              <h2 className="dk__h2" id="dk-pricing">
                A platform fee, and basis points on what the chain proved.
              </h2>
              <p className="dk__sub">Invoiced monthly from the blotter. Nothing is billed on a leg the chain did not verify.</p>
            </div>
            <div className="dk__price" data-pricing>
              <div className="dk__panel">
                <div className="dk__panel-k">
                  <span>Per desk</span>
                  <span>the statement’s three lines</span>
                </div>
                <div className="dk__bignum">
                  {usd0(DESK_PLATFORM_FEE_USD)}
                  <small>platform fee · a month</small>
                </div>
                <ul className="dk__tiers" data-tiers>
                  {tierLines().map((t) => {
                    const [bps, ...rest] = t.split(' ')
                    return (
                      <li key={t}>
                        <span>{rest.join(' ')}</span>
                        <span>{bps} bps</span>
                      </li>
                    )
                  })}
                </ul>
                <p className="dk__example" data-pricing-example>
                  A {usdShort(PRICING_EXAMPLE_NOTIONAL_USD)} month: <strong>{usd0(exampleTotal)}</strong> — {usd0(DESK_PLATFORM_FEE_USD)} platform, {usd0(exampleExec)} execution,
                  marginal tiers on receipt-verified notional.
                </p>
                <p className="dk__fine">
                  Fees already collected inside a transaction on those rows are credited against the statement. Design partners run <strong>{FREE_DAYS} days free</strong>.
                  Hyperliquid perps through custody are not priced here: that lane is unmeasured, so it is not sold.
                </p>
              </div>
              <div className="dk__panel">
                <div className="dk__panel-k">
                  <span>Self-serve seats</span>
                  <span>the same policy, keys and blotter</span>
                </div>
                {seats.agent || seats.desk ? (
                  <div className="dk__seats" data-seats="plans">
                    {seats.agent && (
                      <div className="dk__seat">
                        <span>{seats.agent.name}</span>
                        <span>${seats.agent.priceUsd} / month</span>
                      </div>
                    )}
                    {seats.desk && (
                      <div className="dk__seat">
                        <span>{seats.desk.name}</span>
                        <span>${seats.desk.priceUsd} / month</span>
                      </div>
                    )}
                    <div className="dk__seat">
                      <span>Enterprise</span>
                      <span>this page</span>
                    </div>
                  </div>
                ) : (
                  <div className="dk__seats" data-seats="pricing-page">
                    <div className="dk__seat">
                      <span>Free</span>
                      <span>sandbox only</span>
                    </div>
                    <div className="dk__seat">
                      <span>Agent · Desk</span>
                      <span>
                        <Link href="/pricing">on /pricing</Link>
                      </span>
                    </div>
                    <div className="dk__seat">
                      <span>Enterprise</span>
                      <span>this page</span>
                    </div>
                  </div>
                )}
                <p className="dk__fine">
                  A seat is for an operator running agents on real wallets under a policy: fewer keys, no maker-checker, no statement. The desk above is for a firm.{' '}
                  <Link href="/pricing">Every plan, side by side.</Link>
                </p>
              </div>
            </div>
          </section>

          {/* ── 07 Honest about today ── */}
          <section className="dk__sec" id="honest" aria-labelledby="dk-honest">
            <div className="dk__sechead">
              <span className="dk__n">07 · Honest about today</span>
              <h2 className="dk__h2" id="dk-honest">
                What we will tell you before you find it.
              </h2>
            </div>
            <div className="dk__honest" data-honest>
              <ul>
                <li>
                  <strong>One database, fenced by tenant id.</strong> Every row carries your tenant id and every read is scoped by it. It is not separate infrastructure
                  per tenant; say so in your questionnaire, because we do.
                </li>
                <li>
                  <strong>No SOC 2 yet.</strong> Type I is scheduled at tenant two. Until then: the venue manifest, the threat model and the guardrails document are public on
                  GitHub, and your pen-test is welcome.
                </li>
                <li>
                  <strong>Your pre-trade hook is your screen.</strong> We run no counterparty screening of our own. The policy’s <code>hooks.preTrade</code> URL is asked
                  before a build and anything but a 200 refuses it.
                </li>
                <li>
                  <strong>Crypto venues only.</strong> CoW, Uniswap, Aave, Lido, Morpho, NEAR Intents, LiFi, Hyperliquid. Tokenized equities stay a retail surface until an
                  institution-grade data source exists for them.
                </li>
              </ul>
            </div>
          </section>

          {/* ── 08 The pilot ── */}
          <section className="dk__sec" id="pilot" aria-labelledby="dk-pilot">
            <div className="dk__sechead">
              <span className="dk__n">08 · The pilot</span>
              <h2 className="dk__h2" id="dk-pilot">
                {FREE_DAYS} days. Your custody. A testnet first.
              </h2>
              <p className="dk__sub">
                One named desk. CoW, Uniswap v3 and Aave v4 on Ethereum and Base. Your custody over WalletConnect for the trader lane and viem or a Safe for the headless
                lane. A default-deny policy you write, a capped notional, a <code>{DESK_KEY_PREFIX}…</code> key your OMS calls. The first proof costs an afternoon: your signer
                against the desk on Base Sepolia, log kept. Then the mainnet policy, then the statement.
              </p>
            </div>
            <PilotForm />
          </section>
        </article>
      </main>
      <Footer />
    </>
  )
}
