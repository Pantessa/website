import type { Metadata } from 'next'
import Link from 'next/link'
import Footer from '@/components/Footer'
import { YeetfulMark } from '@/components/Logo'
import IntentLinksBoard from '@/components/IntentLinksBoard'
import SignInFlowLink from '@/components/SignInFlowLink'
import { linksBoard, liveHouseLinks } from '@/lib/links-board'

// /links — the public leaderboard: intent links ranked by FINISHED flows
// (signed turns in embed_turns — most claimed by default, dollars moved as
// the second tab; never mint-time amounts). In-the-open energy, same ethos
// as /activity: the funnel IS the pitch, and every row is a live link a
// visitor can tap. Asks only — never creators' wallets.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const TITLE = 'Intent links — money, moved by links'
const DESCRIPTION =
  'A link that carries an ask. Whoever opens it connects a wallet and the path builds itself — guarded, signed by their own wallet, receipted. The board below is live: real links, real dollars.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Yeetful', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default async function LinksLeaderboardPage() {
  const board = await linksBoard()
  const onBoard = new Set([...board.byClaims, ...board.byMoved].map((r) => r.slug))
  const house = await liveHouseLinks(onBoard)
  return (
    <>
      <main className="x-main">
        <section className="max-w-2xl mx-auto px-4 py-16">
          <div className="flex items-center gap-2 mb-6">
            <YeetfulMark size={18} />
            <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
              Intent links · in the open
            </span>
          </div>
          <h1 className="text-3xl font-semibold text-[color:var(--fg)] mb-3">
            A link that moves money.
          </h1>
          <p className="text-[15px] leading-relaxed text-[color:var(--muted)] max-w-xl mb-4">
            Mint a link that carries an ask — &ldquo;Buy $12 of AAPL&rdquo;, &ldquo;DCA $25 into ETH
            weekly&rdquo;. Whoever opens it connects a wallet and the path builds itself: guarded,
            signed only by their own wallet, receipted. Creators earn half of Yeetful&apos;s 0.20%
            fee on the conversions their link produces.
          </p>
          <div className="flex items-center gap-3 mb-12 flex-wrap">
            <SignInFlowLink href="/dashboard/links" className="btn btn--solid text-[13px]">
              Mint yours
            </SignInFlowLink>
            <Link href="/links/embed" className="btn btn--ghost text-[13px]">
              Put a button on your site
            </Link>
            <Link href="/docs/links" className="btn btn--ghost text-[13px]">
              How it works
            </Link>
          </div>

          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-3">
            The board
          </h2>
          {board.byClaims.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted-2)]">
              The board is empty — the first link to move a dollar tops it. Mint yours above.
            </p>
          ) : (
            <IntentLinksBoard board={board} />
          )}
          <p className="mono text-[11px] text-[color:var(--muted-2)] mt-4">
            A claim is a finished flow — the visitor signed with their own wallet. Dollars moved are
            guardrail-priced signed notional, the same source as /activity. Asks only; creators stay
            pseudonymous.
          </p>

          {house.length > 0 && (
            <>
              <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-12 mb-3">
                Start here — the house links
              </h2>
              <div className="flex flex-wrap gap-2.5">
                {house.map((h) => (
                  <Link
                    key={h.slug}
                    href={`/i/${h.slug}`}
                    className="group rounded-full border border-[var(--line)] bg-[var(--surf-1)] px-4 py-2 hover:border-[var(--accent)] transition-colors"
                    title={h.label}
                  >
                    <span className="text-[13px] text-[color:var(--fg)] group-hover:text-[color:var(--accent)] transition-colors">
                      &ldquo;{h.ask}&rdquo;
                    </span>
                  </Link>
                ))}
              </div>
            </>
          )}
        </section>
      </main>
      <Footer />
    </>
  )
}
