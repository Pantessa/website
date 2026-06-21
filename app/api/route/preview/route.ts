import { NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { SMART_MAX_PER_CALL_USD } from '@/lib/endpoint-planner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * D3 (safe slice) — read-only route PREVIEW for the /switchboard "try a route"
 * demo. NO payment, NO inference: this shows the deterministic price-ranking
 * lever the planner actually uses (#153 price-aware, #160 proven-aware), over
 * the REAL catalog. The live semantic English→endpoint match is the planner's
 * job (a house-paid inference call) and is deliberately NOT exposed here — a
 * public unpaid endpoint must never fire house inference (cost/abuse).
 *
 * Returns, per category that has ≥1 plannable service: the cheapest plannable
 * endpoint per service, ranked by price, with each service's settled count
 * ("proven"), the route Switchboard would pick (cheapest under the cap), and
 * the saving vs the priciest candidate.
 */
export async function GET() {
  const cap = SMART_MAX_PER_CALL_USD

  const [rows, proven] = await Promise.all([
    prisma.mcpEndpoint.findMany({
      where: {
        NOT: { parameters: { equals: Prisma.DbNull } },
        method: { in: ['GET', 'POST'] },
      },
      include: { server: { select: { slug: true, name: true, category: true } } },
      orderBy: { position: 'asc' },
    }),
    prisma.spendLedgerEntry.groupBy({
      by: ['serviceName'],
      where: { ok: true },
      _count: true,
    }),
  ])

  const provenByName = new Map<string, number>()
  for (const p of proven) if (p.serviceName) provenByName.set(p.serviceName, p._count)

  // cheapest plannable endpoint per service
  const cheapestPerService = new Map<
    string,
    { slug: string; service: string; category: string; price: number }
  >()
  for (const r of rows) {
    if (r.scheme === 'upto') continue
    const price = Number(r.priceUsd)
    if (!Number.isFinite(price) || price <= 0 || price > cap) continue
    const params = (r.parameters as unknown[] | null) ?? []
    if (params.length === 0) continue
    const cur = cheapestPerService.get(r.server.slug)
    if (!cur || price < cur.price) {
      cheapestPerService.set(r.server.slug, {
        slug: r.server.slug,
        service: r.server.name,
        category: r.server.category,
        price,
      })
    }
  }

  // group services by category
  const byCat = new Map<
    string,
    { slug: string; service: string; price: number; proven: number }[]
  >()
  for (const s of cheapestPerService.values()) {
    const list = byCat.get(s.category) ?? []
    list.push({ slug: s.slug, service: s.service, price: s.price, proven: provenByName.get(s.service) ?? 0 })
    byCat.set(s.category, list)
  }

  const categories = [...byCat.entries()]
    .map(([category, cands]) => {
      // rank by price asc, then proven desc — the planner's lever
      cands.sort((a, b) => a.price - b.price || b.proven - a.proven)
      // Switchboard picks the cheapest route that has actually SETTLED before
      // (proven>0); only with no proven route in the category does it fall back
      // to cheapest. This is #160's proven-aware selection — and it keeps the
      // demo from "picking" a probe-dead route just because it's $0.0001 cheaper.
      const provenCands = cands.filter((c) => c.proven > 0)
      const pick = (provenCands.length ? provenCands : cands)[0]
      const dearest = cands[cands.length - 1]
      return {
        category,
        candidates: cands,
        pick: pick.slug,
        pickProven: pick.proven > 0,
        saved: Math.max(0, dearest.price - pick.price),
      }
    })
    .filter((c) => c.candidates.length > 0)
    .sort((a, b) => b.candidates.length - a.candidates.length)

  return NextResponse.json(
    { cap, categories },
    { headers: { 'Cache-Control': 's-maxage=300, stale-while-revalidate=600' } },
  )
}
