import { NextRequest, NextResponse } from 'next/server'
import { CROSS_SITE_REFUSAL, sameOrigin, sameOriginJson } from '@/lib/community/origin'
import { getSessionAddress } from '@/lib/auth'
import { getActor } from '@/lib/community/identity'
import { getCommunity, inviterLabel, membershipOf, roomAnnounceFrom, updateCommunity } from '@/lib/community/store'
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
  const seat = actor ? await membershipOf(community.slug, actor.key) : null
  // S10: the announce setting is the owner's to read and change; nobody else sees it.
  const announceFrom = seat?.role === 'owner' ? await roomAnnounceFrom(community.slug) : null
  const me = seat && announceFrom ? { ...seat, announceFrom } : seat
  const via = req.nextUrl.searchParams.get('via')
  const invitedBy = via ? await inviterLabel(community.slug, via) : null
  return NextResponse.json({ community, me, ...(via ? { invitedBy } : {}) }, { headers: { 'cache-control': 'no-store' } })
}

export async function PATCH(req: NextRequest, ctx: Ctx) {
  // S7: our own page made this request (the identity cookie can be SameSite=None).
  if (!sameOriginJson(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
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
  const r = await updateCommunity(slug, walletKey(wallet), { name: b.name, about: b.about, symbols: b.symbols, announceFrom: b.announceFrom })
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  const announceFrom = await roomAnnounceFrom(slug)
  return NextResponse.json({ community: r.community, ...(announceFrom ? { announceFrom } : {}) })
}
