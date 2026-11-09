import { NextRequest, NextResponse } from 'next/server'
import { getCommunity, listMembers } from '@/lib/community/store'

// GET /api/communities/<slug>/members?sort=invites|trades|new&limit= — public.
// Labels are a claimed @handle, a short wallet or the provider's display
// name; never a raw Telegram / Discord id. verifiedTrades = the member
// wallet's receipt-verified fills in the last 30 days (real traffic only).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params
  const community = await getCommunity(slug)
  if (!community) return NextResponse.json({ error: 'No such room.' }, { status: 404 })
  const q = req.nextUrl.searchParams
  const s = q.get('sort')
  const sort = s === 'trades' || s === 'new' ? s : 'invites'
  const limit = Number(q.get('limit') ?? 50)
  const members = await listMembers(community.slug, { sort, limit: Number.isFinite(limit) ? limit : 50 })
  return NextResponse.json({ members }, { headers: { 'cache-control': 'public, max-age=15, s-maxage=30' } })
}
