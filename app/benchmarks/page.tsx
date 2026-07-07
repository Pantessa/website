import type { Metadata } from 'next'
import Link from 'next/link'
import prisma from '@/lib/db'
import Footer from '@/components/Footer'
import { computeReputation } from '@/lib/reputation'
import { getHealthByService } from '@/lib/health'
import { getYeetfulToolBenchmarks } from '@/lib/tool-benchmarks'
import ToolBenchmarks from '@/components/ToolBenchmarks'
import LeaderboardRow, { type LeaderboardRowData } from '@/components/LeaderboardRow'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Benchmarks · Yeetful',
  description:
    "How Yeetful's own routing-engine tools are performing — transaction building, governance, and the hosted MCPs — graded on real calls, plus the full x402 MCP reputation ranking.",
  openGraph: {
    title: 'Benchmarks — Yeetful',
    description: "Yeetful's native tools benchmarked on real calls, alongside the x402 MCP reputation ranking.",
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

export default async function BenchmarksPage() {
  const [servers, tools] = await Promise.all([getServers(), getYeetfulToolBenchmarks()])
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
          <p className="hero__eyebrow">BENCHMARKS</p>
          <h1 className="hero__h1 hero__h1--sm">
            Are the tools <em className="hero__em">getting the job done?</em>
          </h1>
          <p className="hero__sub">
            Yeetful&apos;s own routing-engine tools — transaction building, governance, and the hosted MCPs — graded on
            real calls: success rate, failures, latency, and live incidents. No fabricated numbers; an untested tool
            reads <strong>Not tested yet</strong>, never a fake green. Below, the full x402 directory ranked by earned
            reputation. For usage, routability, and unresolved failures fused into one score, see{' '}
            <Link href="/health">MCP Health</Link>.
          </p>
        </header>

        {tools.length > 0 ? (
          <>
            <div className="flex items-baseline justify-between gap-3 mb-3">
              <h2 className="text-[15px] font-medium">Yeetful native tools</h2>
              <span className="mono text-[11px] text-[color:var(--muted-2)]">{tools.length} tools · 30-day window</span>
            </div>
            <ToolBenchmarks tools={tools} />
          </>
        ) : null}

        <div className="flex items-baseline justify-between gap-3 mb-3">
          <h2 className="text-[15px] font-medium">MCP reputation</h2>
          <span className="mono text-[11px] text-[color:var(--muted-2)]">graded A–F from real paid calls</span>
        </div>
        <p className="text-[13px] text-[color:var(--muted)] mb-4 max-w-[70ch]">
          Every x402 MCP, graded A–F — reliability, liveness, speed, adoption, value, and user ratings, blended into one
          score. The <strong>Live</strong> column is a separate free x402 liveness probe (reachability per endpoint) —
          expand any row to see each endpoint green or red.
        </p>

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
