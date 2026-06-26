import type { Metadata } from 'next'
import prisma from '@/lib/db'
import Footer from '@/components/Footer'
import { computeReputation } from '@/lib/reputation'
import { getHealthByService } from '@/lib/health'
import LeaderboardRow, { type LeaderboardRowData } from '@/components/LeaderboardRow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'MCP reputation leaderboard · Yeetful',
  description:
    'The most reputable x402 MCP services on Yeetful — ranked by reliability, liveness, speed, adoption, value, and user ratings from real paid calls.',
  openGraph: {
    title: 'MCP reputation leaderboard — Yeetful',
    description: 'Top x402 MCP services ranked by an aggregate reputation score from real paid calls.',
    type: 'website',
  },
}

async function getServers() {
  try {
    return await prisma.mcpServer.findMany({
      select: { slug: true, name: true, category: true, priceUsd: true, iconSlug: true, color: true, websiteUrl: true, description: true, callable: true },
    })
  } catch {
    return []
  }
}

export default async function LeaderboardPage() {
  const servers = await getServers()
  const [repMap, healthMap] = await Promise.all([
    computeReputation(servers.map((s) => ({ slug: s.slug, name: s.name, category: s.category, priceUsd: s.priceUsd }))),
    getHealthByService(),
  ])
  const ranked = servers
    .map((s) => ({ s, rep: repMap.get(s.slug)! }))
    .filter((x) => x.rep)
    // Qualified services first, then by overall, then by proven volume.
    .sort((a, b) => Number(b.rep.qualified) - Number(a.rep.qualified) || b.rep.overall - a.rep.overall || b.rep.calls - a.rep.calls)

  const rows: LeaderboardRowData[] = ranked.map(({ s, rep }, i) => ({
    rank: i + 1,
    slug: s.slug,
    name: s.name,
    description: s.description,
    category: s.category,
    websiteUrl: s.websiteUrl,
    color: s.color,
    iconSlug: s.iconSlug,
    callable: s.callable,
    rep,
    health: healthMap.get(s.slug) ?? null,
  }))

  return (
    <>
      <main className="x-main x-main--fluid">
        <header className="hero" style={{ paddingBottom: 24 }}>
          <p className="hero__eyebrow">MCP REPUTATION</p>
          <h1 className="hero__h1 hero__h1--sm">
            The most <em className="hero__em">trusted</em> agents.
          </h1>
          <p className="hero__sub">
            Every x402 MCP, graded A–F from real paid calls — reliability, liveness, speed, adoption, value, and
            user ratings, blended into one score. The <strong>Live</strong> column is a separate free x402 liveness
            probe (reachability per endpoint) — expand any row to see each endpoint green or red. Health shows what&apos;s
            up; the grade is earned from real paid calls.
          </p>
        </header>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full border-collapse text-[13px] min-w-[760px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--muted)] mono border-b border-[var(--line)]">
                <th className="py-2 pr-1 w-6" aria-label="expand" />
                <th className="py-2 pr-2 w-8">#</th>
                <th className="py-2 pr-2">Service</th>
                <th className="py-2 px-2 w-20 text-center">Live</th>
                <th className="py-2 px-2 w-16 text-center">Tier</th>
                <th className="py-2 px-2 w-16 text-right">Score</th>
                <th className="py-2 px-2 w-24 text-right hidden sm:table-cell">Reliability</th>
                <th className="py-2 px-2 w-20 text-right hidden md:table-cell">Settle</th>
                <th className="py-2 px-2 w-20 text-right hidden md:table-cell">Calls</th>
                <th className="py-2 pl-2 w-20 text-right hidden lg:table-cell">Ratings</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <LeaderboardRow key={row.slug} row={row} />
              ))}
            </tbody>
          </table>
          {rows.length === 0 && (
            <p className="py-12 text-center text-[color:var(--muted)] text-sm">No services to rank yet.</p>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
