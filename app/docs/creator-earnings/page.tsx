import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

const PAGE = DOCS_PAGES.find((p) => p.slug === 'creator-earnings')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
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
        carry a 0.50% rate, so a $100 stock buy through your link earns you <strong>$0.25</strong>;
        an audience that moves $100k through your links has earned $250. No token, no points: a cut
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
              <td>Swaps on Base, Ethereum, Arbitrum, Robinhood Chain (v3, v4 fallback) — including every run of a recurring buy</td>
              <td>0.50%</td>
              <td>0.50%</td>
              <td>0.25%</td>
              <td><strong>$0.25</strong></td>
            </tr>
            <tr>
              <td><strong>CoW Protocol</strong></td>
              <td>Swaps and limit orders (the fee rides the signed order&apos;s appData)</td>
              <td>0.50%</td>
              <td>0.50%</td>
              <td>0.25%</td>
              <td><strong>$0.25</strong></td>
            </tr>
            <tr>
              <td><strong>Robinhood Chain</strong></td>
              <td>Tokenized-stock buys and sells (AAPL, TSLA, NVDA…) filled on Uniswap v3/v4 on chain 4663</td>
              <td>0.50%</td>
              <td>0.50%</td>
              <td>0.25%</td>
              <td><strong>$0.25</strong></td>
            </tr>
            <tr>
              <td></td>
              <td>…when a gated stock pool falls back to the LiFi settlement venue</td>
              <td>0.20%</td>
              <td>0.20%</td>
              <td>0.10%</td>
              <td><strong>$0.10</strong></td>
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
              <td>0.20%</td>
              <td>0.10%</td>
              <td>0.05%</td>
              <td><strong>$0.05</strong></td>
            </tr>
            <tr>
              <td><strong>Hyperliquid</strong></td>
              <td>Perp orders (long / short / close). The venue&apos;s builder fee is 0.10% of notional, approved once by the trader, paid from the fill</td>
              <td>0.10% of notional</td>
              <td>0.10%</td>
              <td>0.05%</td>
              <td><strong>$0.05</strong></td>
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
              <th>Pantessa keeps</th>
              <th>You earn</th>
            </tr>
          </thead>
          <tbody>
            <tr>
              <td>Buy $100 of AAPL (Uniswap v3 on Robinhood Chain)</td>
              <td>$0.50</td>
              <td>$0.25</td>
              <td><strong>$0.25</strong></td>
            </tr>
            <tr>
              <td>Swap $100 USDC → ETH on Base (Uniswap or CoW)</td>
              <td>$0.50</td>
              <td>$0.25</td>
              <td><strong>$0.25</strong></td>
            </tr>
            <tr>
              <td>DCA $25 of ETH weekly — four runs signed this month</td>
              <td>$0.50</td>
              <td>$0.25</td>
              <td><strong>$0.25</strong></td>
            </tr>
            <tr>
              <td>Move $100 USDC from Base to Arbitrum (NEAR Intents)</td>
              <td>$0.20 (1Click keeps $0.10)</td>
              <td>$0.05</td>
              <td><strong>$0.05</strong></td>
            </tr>
            <tr>
              <td>Open a $100 long on HYPE (Hyperliquid)</td>
              <td>$0.10</td>
              <td>$0.05</td>
              <td><strong>$0.05</strong></td>
            </tr>
            <tr>
              <td>Bridge $14 to Robinhood Chain, then buy $10 of AAPL</td>
              <td>$0.05 (the buy only)</td>
              <td>$0.025</td>
              <td><strong>$0.025</strong></td>
            </tr>
            <tr>
              <td>Stake $100 of ETH with Lido · supply $100 USDC to Aave · sell an NFT · vote</td>
              <td>$0</td>
              <td>$0</td>
              <td>$0.00</td>
            </tr>
          </tbody>
        </table>
        <p>
          <strong>And it keeps earning.</strong>{' '}Attribution is lifetime, first touch: a wallet
          your link brought in earns you half of Pantessa&apos;s fee on its <em>later</em>{' '}
          conversions too, at whatever tier those turns carry — organic chat swaps price at 0.20%,
          so a returning wallet&apos;s $100 swap earns you $0.10.
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

        <h2>Claims</h2>
        <p>
          Your dashboard shows <strong>earned · claimed · claimable</strong>. Claims open at{' '}
          <strong>$10</strong> and pay out as <strong>USDC on Base</strong>. The claim is a
          server-derived sweep of what you&apos;re owed — you never type an amount.
        </p>

        <h2>Capacity</h2>
        <p>
          Active links mirror the plan tiers: <strong>3</strong> on Builder ($0),{' '}
          <strong>25</strong> on Growth, <strong>unlimited</strong> on Scale — see{' '}
          <Link href="/pricing">pricing</Link>. The cap only gates <em>new</em>{' '}mints: links
          you&apos;ve shared keep working forever, revoking one frees a slot instantly, and a
          revoked link&apos;s funnel and earnings history are never destroyed.
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
