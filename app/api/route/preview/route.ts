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

  const [rows, proven, txRows] = await Promise.all([
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
    // The most recent settled, on-chain-witnessed call per service — its txHash
    // is the Basescan proof we surface on each ranked route ("the right one for
    // the line"). distinct + createdAt desc = the latest tx per serviceName.
    prisma.spendLedgerEntry.findMany({
      where: { ok: true, txHash: { not: null } },
      select: { serviceName: true, txHash: true },
      distinct: ['serviceName'],
      orderBy: { createdAt: 'desc' },
    }),
  ])

  const provenByName = new Map<string, number>()
  for (const p of proven) if (p.serviceName) provenByName.set(p.serviceName, p._count)

  const txByName = new Map<string, string>()
  for (const t of txRows) if (t.serviceName && t.txHash) txByName.set(t.serviceName, t.txHash)

  // The exact call we'd construct for this route (what the accordion reveals).
  interface ParamHint {
    name: string
    in: string // 'query' | 'path' | 'body'
    required: boolean
    type?: string
  }
  interface RouteCall {
    method: string
    url: string
    provider: string | null
    description: string | null
    params: ParamHint[]
  }

  // cheapest plannable endpoint per service (carrying its call details)
  const cheapestPerService = new Map<
    string,
    { slug: string; service: string; category: string; price: number; call: RouteCall }
  >()
  for (const r of rows) {
    if (r.scheme === 'upto') continue
    const price = Number(r.priceUsd)
    if (!Number.isFinite(price) || price <= 0 || price > cap) continue
    const rawParams = (r.parameters as { group?: string; name?: string; required?: boolean; type?: string }[] | null) ?? []
    if (rawParams.length === 0) continue
    const cur = cheapestPerService.get(r.server.slug)
    if (!cur || price < cur.price) {
      cheapestPerService.set(r.server.slug, {
        slug: r.server.slug,
        service: r.server.name,
        category: r.server.category,
        price,
        call: {
          method: r.method,
          url: r.url,
          provider: r.provider,
          description: r.description,
          params: rawParams
            .filter((p) => p?.name)
            .slice(0, 8)
            .map((p) => ({ name: p.name!, in: p.group ?? 'query', required: !!p.required, type: p.type })),
        },
      })
    }
  }

  // group services by category
  const byCat = new Map<
    string,
    { slug: string; service: string; price: number; proven: number; txHash: string | null; call: RouteCall }[]
  >()
  for (const s of cheapestPerService.values()) {
    const list = byCat.get(s.category) ?? []
    list.push({
      slug: s.slug,
      service: s.service,
      price: s.price,
      proven: provenByName.get(s.service) ?? 0,
      txHash: txByName.get(s.service) ?? null,
      call: s.call,
    })
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
