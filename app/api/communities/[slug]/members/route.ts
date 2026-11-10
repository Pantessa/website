import { NextRequest, NextResponse } from 'next/server'
import { getCommunity, listMembers, roleOf } from '@/lib/community/store'
import { getSessionAddress } from '@/lib/auth'
import { walletKey } from '@/lib/community/spec'
import { canManage } from '@/lib/community/rules'

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
  // S10: `?manage=1` from an owner / mod (wallet session) adds an opaque `ref`
  // per seat for POST …/members/remove. That read is never cached.
  if (q.get('manage') === '1') {
    const wallet = await getSessionAddress().catch(() => null)
    const role = wallet ? await roleOf(community.slug, walletKey(wallet)) : null
    if (!canManage(role)) return NextResponse.json({ error: 'Only the owner or a mod can manage members.' }, { status: wallet ? 403 : 401, headers: { 'cache-control': 'no-store' } })
    const members = await listMembers(community.slug, { sort, limit: Number.isFinite(limit) ? limit : 50, refs: true })
    return NextResponse.json({ members }, { headers: { 'cache-control': 'private, no-store' } })
  }
  const members = await listMembers(community.slug, { sort, limit: Number.isFinite(limit) ? limit : 50 })
  return NextResponse.json({ members }, { headers: { 'cache-control': 'public, max-age=15, s-maxage=30' } })
}
