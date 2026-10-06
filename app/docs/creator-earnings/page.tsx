import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'
import { SITE_CARD } from '@/lib/og-defaults'
import { UNPROVEN_ACTIVE_LINKS } from '@/lib/intent-links'
import {
  CREATOR_FEE_SPLIT,
  CROSS_CHAIN_FEE_BPS,
  CROSS_CHAIN_NET_FEE_BPS,
  HL_BUILDER_FEE_TENTH_BPS,
  LINK_FEE_PCT,
  LINK_SWAP_FEE_BPS,
  SWAP_FEE_BPS,
  SWAP_FEE_PCT,
  feePctLabel,
} from '@/lib/fees'

// Every rate on this page is read from lib/fees.ts (pre-gtm 2026-10-07): the
// table used to be literals, and a fee env flip would have left it lying.
const HL_BUILDER_BPS = HL_BUILDER_FEE_TENTH_BPS / 10
const creatorBps = (keptBps: number) => keptBps * CREATOR_FEE_SPLIT
const per100 = (keptBps: number) => `$${(creatorBps(keptBps) / 100).toFixed(2)}`
const LINK_CREATOR_PCT = feePctLabel(creatorBps(LINK_SWAP_FEE_BPS))
const usd = (n: number) => `$${n.toFixed(n > 0 && n < 0.1 && Math.round(n * 1000) % 10 !== 0 ? 3 : 2)}`
/** One $100 conversion: what the visitor pays, the venue's cut, your half of what's left. */
function worked(ask: string, paidBps: number, keptBps: number, venueNote?: (venueUsd: string) => string) {
  const paid = paidBps, venue = paidBps - keptBps, you = creatorBps(keptBps)
  return {
    ask,
    paid: venue > 0 && venueNote ? `${usd(paid / 100)} ${venueNote(usd(venue / 100))}` : usd(paid / 100),
    you: usd(you / 100),
    kept: usd((keptBps - you) / 100),
  }
}
const WORKED = [
  worked('Buy $100 of AAPL (Uniswap v3 on Robinhood Chain)', LINK_SWAP_FEE_BPS, LINK_SWAP_FEE_BPS),
  worked('Swap $100 USDC → ETH on Base (Uniswap or CoW)', LINK_SWAP_FEE_BPS, LINK_SWAP_FEE_BPS),
  worked('Move $100 USDC from Base to Arbitrum (NEAR Intents)', CROSS_CHAIN_FEE_BPS, CROSS_CHAIN_NET_FEE_BPS, (v) => `(1Click keeps ${v})`),
  worked('Open a $100 long on HYPE (Hyperliquid)', HL_BUILDER_BPS, HL_BUILDER_BPS),
]

const PAGE = DOCS_PAGES.find((p) => p.slug === 'creator-earnings')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { images: SITE_CARD, title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
  twitter: { card: 'summary_large_image', title: PAGE.seoTitle, description: PAGE.description, images: SITE_CARD },
}

export default function CreatorEarningsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> CREATOR EARNINGS
      </p>
      <h1 className="docs__h1">Creator earnings</h1>
      <p className="docs__lead">
        When someone signs a conversion through your <Link href="/docs/links">intent link</Link>,
        you earn <strong>half of Pantessa&apos;s fee</strong> on it. Swaps that come through a link
        carry a {LINK_FEE_PCT} rate, so a $100 stock buy through your link earns you{' '}
        <strong>{per100(LINK_SWAP_FEE_BPS)}</strong>; an audience that moves $100k through your links has
        earned ${(creatorBps(LINK_SWAP_FEE_BPS) * 10).toLocaleString('en-US')}. No token, no points: a cut
        of real fees on real conversions — and only where a fee exists, which is the table below.
      </p>

      <div className="docs__prose">
        <h2>What each free MCP earns you</h2>
        <p>
          Every free MCP in the <Link href="/servers">directory</Link>, and what a link creator
          earns when a visitor signs <strong>$100</strong>{' '}through their link. The visitor&apos;s
          rate is what the venue&apos;s artifact carries; your share is half of what Pantessa keeps.
          Anything that isn&apos;t a swap is fee-free — for the visitor and for you.
        </p>
        <table>
          <thead>
            <tr>
              <th>Free MCP</th>
              <th>Action the link produces</th>
              <th>Visitor pays</th>
              <th>Pantessa keeps</th>
              <th>You earn</th>
              <th>Per $100</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td><strong>Uniswap</strong></td>
              <td>Swaps on Base, Ethereum, Arbitrum, Optimism, Arc, Robinhood Chain (v3, v4 fallback) — including every run of a recurring buy</td>
              <td>{LINK_FEE_PCT}</td>
              <td>{LINK_FEE_PCT}</td>
              <td>{LINK_CREATOR_PCT}</td>
              <td><strong>{per100(LINK_SWAP_FEE_BPS)}</strong></td>
            </tr>
            <tr>
              <td><strong>CoW Protocol</strong></td>
              <td>Swaps and limit orders on Base, Ethereum, Arbitrum (the fee rides the signed order&apos;s appData)</td>
              <td>{LINK_FEE_PCT}</td>
              <td>{LINK_FEE_PCT}</td>
              <td>{LINK_CREATOR_PCT}</td>
              <td><strong>{per100(LINK_SWAP_FEE_BPS)}</strong></td>
            </tr>
            <tr>
              <td><strong>Robinhood Chain</strong></td>
              <td>Tokenized-stock buys and sells (AAPL, TSLA, NVDA…) filled on Uniswap v3/v4 on chain 4663</td>
              <td>{LINK_FEE_PCT}</td>
              <td>{LINK_FEE_PCT}</td>
              <td>{LINK_CREATOR_PCT}</td>
              <td><strong>{per100(LINK_SWAP_FEE_BPS)}</strong></td>
            </tr>
            <tr>
              <td></td>
              <td>…when a gated stock pool falls back to the LiFi settlement venue</td>
              <td>{SWAP_FEE_PCT}</td>
              <td>{SWAP_FEE_PCT}</td>
              <td>{feePctLabel(creatorBps(SWAP_FEE_BPS))}</td>
              <td><strong>{per100(SWAP_FEE_BPS)}</strong></td>
            </tr>
            <tr>
              <td></td>
              <td>Morpho lending, the canonical bridge, brokerage crypto orders</td>
              <td>free</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
            </tr>
            <tr>
              <td><strong>NEAR Intents</strong></td>
              <td>Cross-chain swaps (Base ⇄ Ethereum ⇄ Arbitrum). The 1Click venue keeps half of every app fee, so Pantessa nets half of what the visitor pays</td>
              <td>{feePctLabel(CROSS_CHAIN_FEE_BPS)}</td>
              <td>{feePctLabel(CROSS_CHAIN_NET_FEE_BPS)}</td>
              <td>{feePctLabel(creatorBps(CROSS_CHAIN_NET_FEE_BPS))}</td>
              <td><strong>{per100(CROSS_CHAIN_NET_FEE_BPS)}</strong></td>
            </tr>
            <tr>
              <td><strong>Hyperliquid</strong></td>
              <td>Perp orders (long / short / close). The venue&apos;s builder fee is {feePctLabel(HL_BUILDER_BPS)} of notional, approved once by the trader, paid from the fill</td>
              <td>{feePctLabel(HL_BUILDER_BPS)} of notional</td>
              <td>{feePctLabel(HL_BUILDER_BPS)}</td>
              <td>{feePctLabel(creatorBps(HL_BUILDER_BPS))}</td>
              <td><strong>{per100(HL_BUILDER_BPS)}</strong></td>
            </tr>
            <tr>
              <td></td>
              <td>Deposits, leverage changes, Guardian stop-loss / take-profit closes</td>
              <td>free</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
            </tr>
            <tr>
              <td><strong>Aave</strong></td>
              <td>Supply, withdraw, borrow, repay</td>
              <td>free</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
            </tr>
            <tr>
              <td><strong>Lido</strong></td>
              <td>Stake, wrap, request and claim withdrawals</td>
              <td>free</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
            </tr>
            <tr>
              <td><strong>Morpho</strong></td>
              <td>Lend and withdraw</td>
              <td>free</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
            </tr>
            <tr>
              <td><strong>OpenSea NFTs</strong></td>
              <td>Sell, buy, cancel, transfer (a sale is an inflow — never spend-gated, never fee-bearing)</td>
              <td>free</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
            </tr>
            <tr>
              <td><strong>Snapshot DAO</strong></td>
              <td>Votes (EIP-712 signatures, nothing on-chain)</td>
              <td>free</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
            </tr>
            <tr>
              <td><strong>Pantessa Wallet</strong></td>
              <td>Portfolio and balance reads, plain token sends</td>
              <td>free</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
            </tr>
            <tr>
              <td><strong>Pantessa Finance</strong></td>
              <td>Funding plans, bridge legs, gas top-ups, the card / bank on-ramp</td>
              <td>free</td>
              <td>—</td>
              <td>—</td>
              <td>$0.00</td>
            </tr>
          </tbody>
        </table>
        <p>
          Zero-priced data servers from the paid catalog (Messari, QuickNode and friends) are
          reads: they earn nothing. Two more notes on the rates: the fee tier is read from the
          signed artifact itself, never from a parallel field, so the number your dashboard
          settles on is the number the visitor actually paid; and when a swap&apos;s fee rounds to
          zero (a dust amount), no fee step is attached and nothing accrues.
        </p>

        <h3>Worked examples</h3>
        <table>
          <thead>
            <tr>
              <th>What the visitor signs through your link</th>
              <th>Fee paid</th>
              <th>You earn</th>
              <th>Pantessa keeps (after your half)</th>
            </tr>
          </thead>
          <tbody>
            {WORKED.map((w) => (
              <tr key={w.ask}>
                <td>{w.ask}</td>
                <td>{w.paid}</td>
                <td><strong>{w.you}</strong></td>
                <td>{w.kept}</td>
              </tr>
            ))}
            <tr>
              <td>Stake $100 of ETH with Lido · supply $100 USDC to Aave · sell an NFT · vote</td>
              <td>$0</td>
              <td>$0.00</td>
              <td>$0</td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>And it keeps earning.</strong>{' '}Attribution is lifetime, first touch: a wallet
          your link brought in earns you half of Pantessa&apos;s fee on its <em>later</em>{' '}
          conversions too, at whatever tier those turns carry — organic chat swaps price at{' '}
          {SWAP_FEE_PCT}, so a returning wallet&apos;s $100 swap earns you {per100(SWAP_FEE_BPS)}.
        </p>

        <h2>What earns — and what never does</h2>
        <p>
          The rule is <strong>conversions, not movements</strong>. The fee exists only where
          Pantessa&apos;s routing chose a price for the signer — one asset becoming another
          through the guarded venue cascade:
        </p>
        <ul>
          <li>
            <strong>Earns:</strong> swaps and tokenized-stock buys/sells (CoW, Uniswap v3/v4,
            the LiFi stock venue) — including every run of a recurring buy.
          </li>
          <li>
            <strong>Never earns (and is never charged):</strong> NFT sales and transfers (a
            sale is an inflow), plain sends, bridges and funding legs, votes, staking, reads.
            These still show as dollars <em>moved</em> in your funnel — they just carry no fee
            for anyone.
          </li>
        </ul>
        <p>
          Sybil-proof by construction: earnings are a fraction of fees actually paid, so
          self-referral is just a self-discount — there is nothing to farm.
        </p>

        <h2>Server-truth accounting</h2>
        <p>
          Earnings compute from transactions that actually signed, priced by the guardrails at
          signing time and attributed to your link server-side. Client-side counters (opens,
          taps) affect nothing — the number on your dashboard is the number the system settles
          on, and the same source feeds <Link href="/activity">/activity</Link>.
        </p>

        <h2>Paid inside the swap</h2>
        <p>
          On a Uniswap swap with a dollar side, your half never waits for a claim. The router
          pays it to your wallet in the same transaction, in the stablecoin being traded, on
          the chain it traded on. A buy with USDC pays you USDC out of the input; a sale into
          USDC or USDG pays you out of the proceeds. You can read the payment in the
          transaction itself, and your dashboard lists it as{' '}
          <strong>paid in the swap</strong>.
        </p>
        <p>
          Everything else still accrues to the ledger below: CoW orders, cross-chain swaps,
          Hyperliquid perps, the LiFi stock fallback, and pairs with no stablecoin on either
          side.
        </p>

        <h2>Claims</h2>
        <p>
          Whatever wasn&apos;t paid inside the swap waits in the ledger. Your dashboard shows{' '}
          <strong>earned · claimed · claimable</strong>; claims open at <strong>$10</strong>{' '}and pay
          out as <strong>USDC on Base</strong>. The claim is a
          server-derived sweep of what you&apos;re owed — you never type an amount.
        </p>

        <h2>Capacity</h2>
        <p>
          A wallet that hasn&apos;t traded yet keeps <strong>{UNPROVEN_ACTIVE_LINKS}</strong>{' '}links live at
          once; sign any trade through Pantessa (or hold a paid plan — see{' '}
          <Link href="/pricing">pricing</Link>) and the limit is gone for good. The cap only gates{' '}
          <em>new</em>{' '}mints: links
          you&apos;ve shared keep working forever, and revoking one frees a slot instantly.
          Revoking takes the link down everywhere — it 404s, and the row leaves your table and
          the public board — but what it already earned stays in your balance.
        </p>

        <h2>Disclosure</h2>
        <p>
          Every creator-minted link page tells the visitor plainly: <em>&ldquo;The creator of
          this call earns half of Pantessa&apos;s fee on the trades it produces, and on later
          trades from wallets it brings. Sales, transfers, and bridges are always fee-free.&rdquo;</em>{' '}
          Your cut comes out of Pantessa&apos;s fee, not on top of it, and the rate the visitor
          pays is shown in the artifact before they sign — see{' '}
          <Link href="/docs/terms">the terms</Link> for the full fee disclosure.
        </p>
      </div>
    </>
  )
}
