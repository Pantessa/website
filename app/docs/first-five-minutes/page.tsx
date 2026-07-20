import type { Metadata } from 'next'
import Link from 'next/link'
import { DOCS_PAGES, docsJsonLd, docsUrl } from '@/lib/docs'

// The user door's welcome mat: a stranger's literal first five minutes,
// minute by minute, every ask a prefill deep link (?prompt= never
// auto-sends). The deep dives (trust model, venues, jobs) stay their own
// pages — this one just walks the path and hands off.

const PAGE = DOCS_PAGES.find((p) => p.slug === 'first-five-minutes')!

/** Prefill deep link into /chat — the ask arrives in the composer, unsent. */
const ask = (prompt: string, mcps?: string) =>
  `/chat?${mcps ? `mcps=${mcps}&` : ''}prompt=${encodeURIComponent(prompt)}`

export const metadata: Metadata = {
  title: PAGE.seoTitle,
  description: PAGE.description,
  alternates: { canonical: docsUrl(PAGE.slug) },
  openGraph: { title: PAGE.seoTitle, description: PAGE.description, url: docsUrl(PAGE.slug), type: 'article' },
}

export default function FirstFiveMinutesPage() {
  return (
    <>
      <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: docsJsonLd(PAGE) }} />
      <p className="docs__crumbs mono">
        <Link href="/docs">DOCS</Link> <span>/</span> YOUR FIRST FIVE MINUTES
      </p>
      <h1 className="docs__h1">Your first five minutes</h1>
      <p className="docs__lead">
        You don&apos;t need a wallet to start, and nothing here can move money without your
        signature. This is the whole path — free ask, guarded build, signature, standing
        intent — with a link at every step that lands in the chat with the ask already typed.
        Nothing sends until you press enter.
      </p>

      <div className="docs__prose">
        <h2>Minute 1 — ask something free</h2>
        <p>
          Questions cost nothing and need no wallet. Open the chat and ask{' '}
          <Link href={ask('What is the current price and 24h change for ETH?', 'uniswap-free')}>
            &ldquo;What&apos;s the price of ETH?&rdquo;
          </Link>{' '}
          or{' '}
          <Link href={ask('List the recent active proposals in the aave.eth Snapshot space.', 'snapshot-free')}>
            &ldquo;List the active proposals in aave.eth&rdquo;
          </Link>
          . The agent answers from the MCPs in your set — the bar above the chat shows which
          ones are on, and <Link href="/servers">the directory</Link> has the rest.
        </p>

        <h2>Minute 2 — ask for something that moves money</h2>
        <p>
          Try{' '}
          <Link href={ask('Swap $1 worth of ETH to USDC on Base', 'uniswap-free')}>
            &ldquo;Swap $1 of ETH to USDC&rdquo;
          </Link>
          . What comes back is not an execution — it&apos;s a <strong>transaction artifact</strong>:
          quoted at a real venue, built deterministically (the model never writes calldata or
          addresses), re-checked by an independent guard, priced in dollars, and parked behind a
          sign button. If the quote goes stale, it re-quotes; if a guard fails, you get a refusal,
          not a worse trade. The full claim-by-claim version is{' '}
          <Link href="/docs/trust">the trust page</Link>.
        </p>

        <h2>Minute 3 — sign it</h2>
        <p>
          Connect any wallet and sign. Your wallet is the only thing that can sign — there is no
          deposit, no Yeetful balance, no key we hold. Every signed move lands as a receipt in
          the chat and on <Link href="/activity">the public activity feed</Link>, linked to the
          transaction on-chain.
        </p>

        <h2>Minutes 4 and 5 — tell it once</h2>
        <p>
          This is the part that stays working after you close the tab. Say{' '}
          <Link href={ask('Buy $10 of AAPL every week on Robinhood Chain', 'robinhood-free')}>
            &ldquo;Buy $10 of AAPL every week&rdquo;
          </Link>{' '}
          and you get a recurring buy you confirm each period —{' '}
          <Link href="/docs/jobs">a standing intent</Link>. Say{' '}
          <Link href={ask('Set a stop-loss on my ETH position at -8%', 'hyperliquid-free')}>
            &ldquo;Stop-loss my ETH perp at -8%&rdquo;
          </Link>{' '}
          and <Link href="/docs/guardian">Guardian</Link>{' '}watches it every minute with a key that
          can only reduce that position — revocable with one click. The Jobs tab in the chat rail
          shows everything that&apos;s running and flags the moments that need you.
        </p>

        <h2>Where to go from here</h2>
        <ul>
          <li>
            <Link href="/docs/trust">Trust: the guardrails</Link> — why a signature on a Yeetful
            artifact is safe to give.
          </li>
          <li>
            <Link href="/docs/jobs">Jobs: standing intents</Link> — multi-step asks, recurring
            buys, and what &ldquo;tell it once&rdquo; compiles into.
          </li>
          <li>
            <Link href="/docs/embed">Embed the chat</Link> — this whole thing on your own site, in
            five lines, signing with your page&apos;s wallet.
          </li>
        </ul>
      </div>
    </>
  )
}
