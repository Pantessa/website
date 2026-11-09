import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { getActor } from '@/lib/community/identity'
import { getCommunity, inviterLabel, membershipOf, updateCommunity } from '@/lib/community/store'
import { walletKey } from '@/lib/community/spec'

// GET   /api/communities/<slug>  public — the room + the caller's own seat (or null);
//       ?via=<code> adds `invitedBy` (the inviter's label) when the code is a real invite of this room
// PATCH /api/communities/<slug>  { name?, about?, symbols? } — the owner (wallet session)

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

export async function GET(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params
  const community = await getCommunity(slug)
  if (!community) return NextResponse.json({ error: 'No such room.' }, { status: 404 })
  const actor = await getActor().catch(() => null)
  const me = actor ? await membershipOf(community.slug, actor.key) : null
  const via = req.nextUrl.searchParams.get('via')
  const invitedBy = via ? await inviterLabel(community.slug, via) : null
  return NextResponse.json({ community, me, ...(via ? { invitedBy } : {}) }, { headers: { 'cache-control': 'no-store' } })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  const { slug } = await ctx.params
  const wallet = await getSessionAddress().catch(() => null)
  if (!wallet) return NextResponse.json({ error: 'Sign in to edit this room.' }, { status: 401 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  const b = body as Record<string, unknown>
  const r = await updateCommunity(slug, walletKey(wallet), { name: b.name, about: b.about, symbols: b.symbols })
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  return NextResponse.json({ community: r.community })
}
