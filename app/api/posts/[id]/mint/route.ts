import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { parseChartState } from '@/lib/chart-state'
import { primaryAsk } from '@/lib/chart-posts'
import { mintPostLink } from '../../mint-link'

// POST /api/posts/<id>/mint — the AUTHOR mints the post's primary action as
// an intent link (through /api/intent-links, in-process) and the post
// carries the slug. Idempotent: an already-minted post returns its link.
// Anyone else gets 403 — a link's creator IS who the kickback follows, so
// only the author may make their idea executable.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  const caller = await getSessionAddress().catch(() => null)
  if (!caller) return NextResponse.json({ error: 'Sign in to mint this idea as a link.' }, { status: 401 })
  const { id } = await ctx.params
  const post = await prisma.chartPost.findUnique({ where: { id } })
  if (!post) return NextResponse.json({ error: 'No such post.' }, { status: 404 })
  if (post.author !== caller.toLowerCase()) return NextResponse.json({ error: 'Only the author can mint this idea.' }, { status: 403 })
  if (post.linkSlug) return NextResponse.json({ slug: post.linkSlug, url: `/i/${post.linkSlug}`, existing: true })
  const ask = primaryAsk(parseChartState(post.chartState))
  if (!ask) return NextResponse.json({ error: 'This chart has no action to mint — add a line with a Buy/Sell/Stop/DCA action first.' }, { status: 400 })
  const r = await mintPostLink(req, post.id, ask)
  if (!r.ok) return NextResponse.json({ error: r.error }, { status: r.status })
  return NextResponse.json({ slug: r.slug, url: r.url, ask })
}
