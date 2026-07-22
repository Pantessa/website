import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/db'
import Footer from '@/components/Footer'
import { YeetfulMark } from '@/components/Logo'
import { HOUSE_LINKS } from '@/lib/house-links'

// /links — the public leaderboard: intent links ranked by server-truth
// dollars moved (guardrail-priced signed turns in embed_turns). In-the-open
// energy, same ethos as /activity: the funnel IS the pitch, and every row
// is a live link a visitor can tap. Asks only — never creators' wallets.

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

async function topLinks() {
  try {
    const moved = await prisma.embedTurn.groupBy({
      by: ['intentLinkSlug'],
      where: { intentLinkSlug: { not: null }, outcome: 'signed', valueUsd: { gt: 0 } },
      _sum: { valueUsd: true },
      orderBy: { _sum: { valueUsd: 'desc' } },
      take: 10,
    })
    const slugs = moved.map((m) => m.intentLinkSlug).filter((s): s is string => !!s)
    if (slugs.length === 0) return []
    const [links, opens] = await Promise.all([
      prisma.intentLink.findMany({ where: { id: { in: slugs }, revoked: false }, select: { id: true, ask: true } }),
      prisma.intentLinkEvent.groupBy({ by: ['slug'], where: { slug: { in: slugs }, kind: 'open' }, _count: { _all: true } }),
    ])
    return moved
      .map((m) => {
        const link = links.find((l) => l.id === m.intentLinkSlug)
        if (!link) return null
        return {
          slug: link.id,
          ask: link.ask,
          movedUsd: m._sum.valueUsd ?? 0,
          opens: opens.find((o) => o.slug === link.id)?._count._all ?? 0,
        }
      })
      .filter((r): r is NonNullable<typeof r> => !!r)
  } catch {
    return []
  }
}

/** House links that are live in the DB (seeded) and not already on the
 *  board — the start-here strip, so the page demos real product even when
 *  the board is young. */
async function liveHouseLinks(exclude: Set<string>) {
  try {
    const rows = await prisma.intentLink.findMany({
      where: { id: { in: HOUSE_LINKS.map((h) => h.slug) }, revoked: false },
      select: { id: true, ask: true },
    })
    // Preserve the curated HOUSE_LINKS order, drop board duplicates.
    return HOUSE_LINKS.filter((h) => !exclude.has(h.slug) && rows.some((r) => r.id === h.slug))
  } catch {
    return []
  }
}

export default async function LinksLeaderboardPage() {
  const rows = await topLinks()
  const house = await liveHouseLinks(new Set(rows.map((r) => r.slug)))
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
          <div className="flex items-center gap-3 mb-12">
            <Link href="/dashboard/links" className="btn btn--solid text-[13px]">
              Mint yours
            </Link>
            <Link href="/docs" className="btn btn--ghost text-[13px]">
              How it works
            </Link>
          </div>

          <h2 className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-3">
            Top links by dollars moved
          </h2>
          {rows.length === 0 ? (
            <p className="text-[13px] text-[color:var(--muted-2)]">
              The board is empty — the first link to move a dollar tops it. Mint yours above.
            </p>
          ) : (
            <ol className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
              {rows.map((r, i) => (
                <li key={r.slug}>
                  <Link
                    href={`/i/${r.slug}`}
                    className="flex items-center gap-4 py-3 group hover:bg-white/[0.02] transition-colors"
                  >
                    <span className="mono text-[12px] text-[color:var(--muted-2)] w-6 flex-shrink-0">
                      {i + 1}
                    </span>
                    <span className="text-[14px] text-[color:var(--fg)] truncate flex-1 group-hover:text-[color:var(--accent)] transition-colors">
                      &ldquo;{r.ask}&rdquo;
                    </span>
                    <span className="mono text-[12px] text-[color:var(--muted-2)] flex-shrink-0">
                      {r.opens} opens
                    </span>
                    <span className="mono text-[13px] text-[color:var(--accent)] flex-shrink-0">
                      ${r.movedUsd.toFixed(2)}
                    </span>
                  </Link>
                </li>
              ))}
            </ol>
          )}
          <p className="mono text-[11px] text-[color:var(--muted-2)] mt-4">
            Dollars are guardrail-priced signed notional — the same source as /activity. Asks only;
            creators stay pseudonymous.
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
