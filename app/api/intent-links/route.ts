import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { cleanAsk, composeMcps, mintSlug, validateRedirect } from '@/lib/intent-links'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Mint an intent link (POST) / list the creator's links + funnels (GET).
 *
 * POST body: { ask, agent?, redirectUrl? } — the creator is the SIWE wallet.
 * The ask is sanitized and stored as a SENTENCE; the MCP set is composed
 * server-side; redirectUrl is validated https at mint and stored with the
 * link (the runtime never reads a redirect from the query string). The
 * response is the shareable /i/<slug> URL.
 */
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in to mint an intent link.' }, { status: 401 })
  const creator = addr.toLowerCase()

  let body: { ask?: string; agent?: string; redirectUrl?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }

  const ask = cleanAsk(body.ask ?? '')
  if (ask.length < 8) return NextResponse.json({ error: 'The ask must be a plain sentence (at least 8 characters).' }, { status: 400 })

  let redirectUrl: string | null = null
  if (body.redirectUrl) {
    const v = validateRedirect(String(body.redirectUrl))
    if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })
    redirectUrl = v.url
  }

  const agent = body.agent ? cleanAsk(String(body.agent)).slice(0, 40) : null
  const mcps = composeMcps(ask).join(',')

  // Slug collisions at 40 bits are lottery-rare; retry twice anyway.
  for (let attempt = 0; attempt < 3; attempt++) {
    const id = mintSlug()
    try {
      const link = await prisma.intentLink.create({ data: { id, ask, mcps, creator, agent, redirectUrl } })
      return NextResponse.json({
        slug: link.id,
        url: `/i/${link.id}`,
        ask: link.ask,
        mcps: link.mcps,
        redirectUrl: link.redirectUrl,
      })
    } catch (e) {
      const unique = e instanceof Error && 'code' in e && (e as { code?: string }).code === 'P2002'
      if (!unique) throw e
    }
  }
  return NextResponse.json({ error: 'Could not mint a slug — try again.' }, { status: 500 })
}

/** The creator's links, newest first, each with its funnel aggregates. */
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in to list your intent links.' }, { status: 401 })
  const creator = addr.toLowerCase()

  const links = await prisma.intentLink.findMany({
    where: { creator },
    orderBy: { createdAt: 'desc' },
    take: 100,
  })
  if (links.length === 0) return NextResponse.json({ links: [] })

  const events = await prisma.intentLinkEvent.groupBy({
    by: ['slug', 'kind'],
    where: { slug: { in: links.map((l) => l.id) } },
    _count: { _all: true },
    _sum: { valueUsd: true },
  })
  const funnelOf = (slug: string) => {
    const f = { open: 0, connect: 0, built: 0, signed: 0, valueUsd: 0 }
    for (const e of events) {
      if (e.slug !== slug) continue
      if (e.kind === 'open') f.open = e._count._all
      else if (e.kind === 'connect') f.connect = e._count._all
      else if (e.kind === 'built') f.built = e._count._all
      else if (e.kind === 'signed') {
        f.signed = e._count._all
        f.valueUsd = e._sum.valueUsd ?? 0
      }
    }
    return f
  }

  return NextResponse.json({
    links: links.map((l) => ({
      slug: l.id,
      url: `/i/${l.id}`,
      ask: l.ask,
      agent: l.agent,
      redirectUrl: l.redirectUrl,
      revoked: l.revoked,
      createdAt: l.createdAt,
      funnel: funnelOf(l.id),
    })),
  })
}
