import type { Metadata } from 'next'
import prisma from '@/lib/db'
import Footer from '@/components/Footer'
import { Card } from '@/lib/dashboard-ui'
import { SectionHead } from '@/components/board-ui'
import { computeReputation } from '@/lib/reputation'
import { getHealthByService } from '@/lib/health'
import ReputationBoard, { type ReputationRowData } from '@/components/ReputationBoard'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export const metadata: Metadata = {
  title: 'Benchmarks · Yeetful',
  description:
    'Every x402 MCP on the network, graded A–F from real paid calls — reliability, liveness, speed, adoption, value and user ratings, blended into one earned score.',
  openGraph: {
    title: 'Benchmarks — Yeetful',
    description: 'The x402 MCP reputation ranking, graded on real calls.',
    type: 'website',
  },
}

async function getServers() {
  try {
    return await prisma.mcpServer.findMany({
      select: {
        slug: true,
        name: true,
        category: true,
        priceUsd: true,
        iconSlug: true,
        logoUrl: true,
        callable: true,
      },
    })
  } catch {
    return []
  }
}

export default async function BenchmarksPage() {
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

  const rows: ReputationRowData[] = ranked.map(({ s, rep }, i) => ({
    rank: i + 1,
    slug: s.slug,
    name: s.name,
    category: s.category,
    priceUsd: s.priceUsd,
    iconSlug: s.iconSlug,
    logoUrl: s.logoUrl,
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
            Every MCP the router can reach, graded on real calls — success, liveness, latency and
            settled volume. No fabricated numbers: an untested service reads <strong>new</strong>,
            never a fake green.
          </p>
        </header>

        <section className="mb-10">
          <SectionHead
            eyebrow="WHO EARNS THE CALL"
            title="MCP reputation"
            sub="Every x402 MCP, graded A–F — reliability, liveness, speed, adoption, value and user ratings blended into one score. The ring is a separate free liveness probe; expand any row to see each endpoint green or red."
          />
          <Card>
            <ReputationBoard rows={rows} />
          </Card>
        </section>
      </main>
      <Footer />
    </>
  )
}
