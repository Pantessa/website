import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/db'
import BrandIcon from '@/components/BrandIcon'
import Footer from '@/components/Footer'
import { TierBadge, tierColor } from '@/components/ReputationPanel'
import { computeReputation } from '@/lib/reputation'

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
  const repMap = await computeReputation(servers.map((s) => ({ slug: s.slug, name: s.name, category: s.category, priceUsd: s.priceUsd })))
  const ranked = servers
    .map((s) => ({ s, rep: repMap.get(s.slug)! }))
    .filter((x) => x.rep)
    // Qualified services first, then by overall, then by proven volume.
    .sort((a, b) => Number(b.rep.qualified) - Number(a.rep.qualified) || b.rep.overall - a.rep.overall || b.rep.calls - a.rep.calls)

  return (
    <>
      <main className="x-main x-main--fluid">
        <header className="hero" style={{ paddingBottom: 24 }}>
          <p className="hero__eyebrow">MCP REPUTATION</p>
          <h1 className="hero__h1 hero__h1--sm">
            The most <em className="hero__em">trusted</em> agents.
          </h1>
          <p className="hero__sub">
            Every x402 MCP, scored from real paid calls — reliability, liveness, speed, adoption, value, and
            user ratings, blended into one reputation score. Services need ≥5 calls or ≥3 ratings to earn a tier.
          </p>
        </header>

        <div className="overflow-x-auto -mx-1 px-1">
          <table className="w-full border-collapse text-[13px] min-w-[680px]">
            <thead>
              <tr className="text-left text-[11px] uppercase tracking-wide text-[color:var(--muted)] mono border-b border-[var(--line)]">
                <th className="py-2 pr-2 w-8">#</th>
                <th className="py-2 pr-2">Service</th>
                <th className="py-2 px-2 w-16 text-center">Tier</th>
                <th className="py-2 px-2 w-16 text-right">Score</th>
                <th className="py-2 px-2 w-24 text-right hidden sm:table-cell">Reliability</th>
                <th className="py-2 px-2 w-20 text-right hidden md:table-cell">Settle</th>
                <th className="py-2 px-2 w-20 text-right hidden md:table-cell">Calls</th>
                <th className="py-2 pl-2 w-20 text-right hidden lg:table-cell">Ratings</th>
              </tr>
            </thead>
            <tbody>
              {ranked.map(({ s, rep }, i) => (
                <tr key={s.slug} className="border-b border-[var(--line)] hover:bg-white/[0.02]">
                  <td className="py-2 pr-2 mono text-[color:var(--muted-2)]">{rep.qualified ? i + 1 : '—'}</td>
                  <td className="py-2 pr-2">
                    <Link href={`/servers/${s.slug}`} className="flex items-center gap-2 group min-w-0">
                      <BrandIcon
                        server={{ id: s.slug, slug: s.slug, name: s.name, description: s.description, category: s.category, websiteUrl: s.websiteUrl, color: s.color, iconSlug: s.iconSlug }}
                        size={20}
                      />
                      <span className="truncate group-hover:underline">{s.name}</span>
                      {s.callable ? <span className="w-1.5 h-1.5 rounded-full flex-shrink-0" style={{ background: 'var(--accent)' }} title="Callable in chat" /> : null}
                    </Link>
                  </td>
                  <td className="py-2 px-2 text-center"><TierBadge tier={rep.tier} /></td>
                  <td className="py-2 px-2 text-right mono font-medium" style={{ color: tierColor(rep.tier) }}>
                    {rep.qualified ? rep.overall : '—'}
                  </td>
                  <td className="py-2 px-2 text-right mono text-[color:var(--muted)] hidden sm:table-cell">{rep.scores.reliability}</td>
                  <td className="py-2 px-2 text-right mono text-[color:var(--muted)] hidden md:table-cell">{Math.round(rep.settleRate * 100)}%</td>
                  <td className="py-2 px-2 text-right mono text-[color:var(--muted)] hidden md:table-cell">{rep.calls}</td>
                  <td className="py-2 pl-2 text-right mono text-[color:var(--muted-2)] hidden lg:table-cell">
                    {rep.ratingCount > 0 ? `${rep.ratingAvg?.toFixed(1)}★ (${rep.ratingCount})` : '—'}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {ranked.length === 0 && (
            <p className="py-12 text-center text-[color:var(--muted)] text-sm">No services to rank yet.</p>
          )}
        </div>
      </main>
      <Footer />
    </>
  )
}
