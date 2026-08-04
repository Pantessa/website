import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// The native transaction layer — the doctrine (models never write calldata)
// and the venue-by-venue guard table. This page is the moat, written down.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'transactions')!

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

const VENUES = [
  {
    venue: 'CoW Protocol',
    builds: 'Swaps and limit orders as EIP-712 order artifacts; submission relayed after a second policy gate.',
    chains: 'Base · Ethereum · Arbitrum',
    guard: 'Order fields re-derived from the quote; the submit relay re-checks policy — a tampered order dies twice.',
  },
  {
    venue: 'Uniswap v3',
    builds: 'QuoterV2 pool scan → one SwapRouter02 multicall; approve → swap offered as a self-advancing chain.',
    chains: 'Base · Ethereum · Arbitrum · Robinhood',
    guard: 'Swap step re-quoted at sign time; calldata selectors and addresses pinned to the registry, never model-written.',
  },
  {
    venue: 'Uniswap v4',
    builds: 'Fallback when v3 has no pool — tokenized stocks (AAPL, TSLA, …) vs USDG on Robinhood Chain. No-hook pool scan → ONE Universal Router execute with exact-amount Permit2 approvals.',
    chains: 'Robinhood',
    guard: 'The v4 calldata guard decodes the full execute path and fails closed on any unknown command, hook, or amount drift.',
  },
  {
    venue: 'Cross-chain (NEAR Intents)',
    builds: 'Bridge/swap across chains via solver auction: one transfer to a one-time deposit address, solvers deliver on the destination.',
    chains: 'Base ↔ Arbitrum ↔ more',
    guard: 'The transfer must move EXACTLY the quoted amount to the tool-returned deposit address — a fabricated address cannot survive the check.',
  },
  {
    venue: 'Aave',
    builds: 'Supply, withdraw, borrow, repay — anchored to your live reserves and portfolio before building.',
    chains: 'Base · Ethereum · Arbitrum',
    guard: 'Pinned function selectors; reserve ids matched as sets (an asset can list twice); health-factor preview gates every borrow.',
  },
  {
    venue: 'Hyperliquid',
    builds: 'USDC deposits (bridge transfer) and perp opens/closes as signable L1 actions — IOC orders with bounded prices.',
    chains: 'Arbitrum + HL L1',
    guard: 'Deposits pin the canonical Bridge2 and check balances; orders enforce min-notional, collateral, side, and reduce-only-on-close.',
  },
  {
    venue: 'Guardian',
    builds: 'Stop-loss / take-profit closes under a delegated, reduce-only agent key.',
    chains: 'Hyperliquid',
    guard: 'Rebuilt and re-guarded at trigger time — delegation, kill switch, size, side, and the trigger itself all re-checked. See the Guardian page.',
  },
  {
    venue: 'Snapshot',
    builds: 'DAO votes as EIP-712 typed data your wallet signs.',
    chains: 'Off-chain (Snapshot)',
    guard: 'Proposal and choice anchored to the live proposal — the vote you see is the vote you sign.',
  },
]

export default function TransactionsDocsPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> NATIVE VENUES &amp; GUARDS
      </p>
      <h1 className="docs__h1">The transaction layer</h1>
      <p className="docs__lead">
        Pantessa builds transactions with per-venue builders and a shared guard — the model that
        understood your ask <strong>never writes calldata, amounts, or addresses</strong>. It
        picks a builder; the builder derives the artifact from live venue state; the guard
        re-checks it before your wallet ever sees it. When a check fails, you get the reason,
        not a guess.
      </p>

      <div className="docs__prose">
        <h2>The doctrine</h2>
        <ol>
          <li>
            <strong>Parse deterministically.</strong>{' '}Money asks are claimed by native parsers,
            not sampled from a model. &ldquo;Swap 20 USDC for ETH on Base&rdquo; hits the same
            code path every time.
          </li>
          <li>
            <strong>Build from venue truth.</strong>{' '}Quotes, pools, reserves, positions,
            balances — fetched live at build time. Artifacts expire and are rebuilt, never
            reused stale.
          </li>
          <li>
            <strong>Guard fail-closed.</strong>{' '}Every artifact is re-derived or decoded and
            checked against policy as the last step. Any mismatch kills the build.
          </li>
          <li>
            <strong>Your wallet signs.</strong>{' '}Nothing here is custodial — the layer produces
            artifacts; only your signature moves money.
          </li>
          <li>
            <strong>Receipt everything.</strong>{' '}Built, signed, refused — each with its priced
            value (<code>valueUsd</code>) and the layer that built it, on your{' '}
            <Link href="/dashboard">dashboard</Link>.
          </li>
        </ol>

        <h2>Venues</h2>
        <table>
          <thead>
            <tr>
              <th>Venue</th>
              <th>What it builds</th>
              <th>Chains</th>
              <th>The guard</th>
            </tr>
          </thead>
          <tbody>
            {VENUES.map((v) => (
              <tr key={v.venue}>
                <td>
                  <strong>{v.venue}</strong>
                </td>
                <td>{v.builds}</td>
                <td>{v.chains}</td>
                <td>{v.guard}</td>
              </tr>
            ))}
          </tbody>
        </table>

        <h2>Compound intents ride on top</h2>
        <p>
          Chain steps with &ldquo;then&rdquo; and the <Link href="/docs/jobs">jobs compiler</Link>{' '}
          sequences these same builders — each step built and guarded only when it&rsquo;s
          offered, settlement verified between signatures. One venue&rsquo;s guard never has to
          trust another&rsquo;s output.
        </p>

        <h2>See it decide</h2>
        <p>
          Every build traces its decisions — which layer claimed the ask, what it fetched, why
          it refused — to the live <Link href="/activity">activity terminal</Link>. The layer
          argues its case in public.
        </p>
      </div>
    </>
  )
}
