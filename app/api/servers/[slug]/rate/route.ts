import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

/**
 * Rate an MCP service (the human signal in its reputation score). SIWE-gated:
 * one rating per wallet per service, upserted so a wallet can change its vote.
 *
 *   GET  → { yourRating, average, count } for the signed-in wallet (yourRating
 *          null if not signed in / not yet rated)
 *   POST { rating: 1..5, review? } → upsert
 */
export async function GET(_req: NextRequest, { params }: Params) {
  const { slug } = await params
  const [agg, address] = await Promise.all([
    prisma.mcpRating.aggregate({ where: { serviceSlug: slug }, _avg: { rating: true }, _count: true }),
    getSessionAddress(),
  ])
  let yourRating: number | null = null
  if (address) {
    const mine = await prisma.mcpRating.findUnique({
      where: { serviceSlug_ownerAddress: { serviceSlug: slug, ownerAddress: address.toLowerCase() } },
      select: { rating: true },
    })
    yourRating = mine?.rating ?? null
  }
  return NextResponse.json(
    { average: agg._avg.rating, count: agg._count, yourRating },
    { headers: { 'cache-control': 'no-store' } },
  )
}

export async function POST(req: NextRequest, { params }: Params) {
  const { slug } = await params
  const address = await getSessionAddress()
  if (!address) return NextResponse.json({ error: 'Sign in to rate a service.' }, { status: 401 })

  const body = await req.json().catch(() => ({}))
  const rating = Number(body?.rating)
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) {
    return NextResponse.json({ error: 'rating must be an integer 1–5' }, { status: 400 })
  }
  const review = typeof body?.review === 'string' ? body.review.trim().slice(0, 400) || null : null

  // Service must exist (don't accept ratings for unknown slugs).
  const exists = await prisma.mcpServer.findUnique({ where: { slug }, select: { id: true } })
  if (!exists) return NextResponse.json({ error: 'Unknown service.' }, { status: 404 })

  const owner = address.toLowerCase()
  await prisma.mcpRating.upsert({
    where: { serviceSlug_ownerAddress: { serviceSlug: slug, ownerAddress: owner } },
    update: { rating, review },
    create: { serviceSlug: slug, ownerAddress: owner, rating, review },
  })
  const agg = await prisma.mcpRating.aggregate({ where: { serviceSlug: slug }, _avg: { rating: true }, _count: true })
  return NextResponse.json({ ok: true, average: agg._avg.rating, count: agg._count, yourRating: rating })
}
