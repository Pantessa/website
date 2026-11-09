import { NextRequest, NextResponse } from 'next/server'
import { CROSS_SITE_REFUSAL, sameOrigin, sameOriginJson } from '@/lib/community/origin'
import { isInternalRun } from '@/lib/internal-run'
import { getActor } from '@/lib/community/identity'
import { joinCommunity, leaveCommunity } from '@/lib/community/store'
import { inviteCreditAllowed, joinTripped } from '@/lib/community/limits'
import { clientIpFrom } from '@/lib/turn-limits'

// POST   /api/communities/<slug>/join  { via? } — any proven actor (a wallet
//        session, or a Telegram / Discord identity the provider signed).
//        Idempotent: `joined` is true only on the call that made the seat.
// DELETE /api/communities/<slug>/join  — leave (the owner cannot).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ slug: string }> }

export async function POST(req: NextRequest, ctx: Ctx) {
  // S7: our own page made this request (the identity cookie can be SameSite=None).
  if (!sameOriginJson(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const { slug } = await ctx.params
  const actor = await getActor().catch(() => null)
  if (!actor) return NextResponse.json({ error: 'Sign in, or open this from Telegram or Discord, to join.', needsIdentity: true }, { status: 401 })
  // S4: joins per machine per hour (wallets and provider ids are free).
  const ip = clientIpFrom(req.headers)
  if (await joinTripped(ip)) return NextResponse.json({ error: 'Too many joins from this network in the last hour. Try again later.', rateGate: 'ip' }, { status: 429 })
  let body: unknown = {}
  try {
    const text = await req.text()
    body = text ? JSON.parse(text) : {}
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const via = body && typeof body === 'object' && typeof (body as { via?: unknown }).via === 'string' ? (body as { via: string }).via : null
  const r = await joinCommunity(slug, actor, { via, isInternal: isInternalRun(req.headers, body), creditAllowed: () => inviteCreditAllowed(ip, slug.toLowerCase()) })
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  return NextResponse.json({ joined: r.joined, community: r.community, me: r.me }, { headers: { 'cache-control': 'no-store' } })
}

export async function DELETE(req: NextRequest, ctx: Ctx) {
  // S7: our own page made this request (the identity cookie can be SameSite=None).
  if (!sameOrigin(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const { slug } = await ctx.params
  const actor = await getActor().catch(() => null)
  if (!actor) return NextResponse.json({ error: 'You are not signed in.', needsIdentity: true }, { status: 401 })
  const r = await leaveCommunity(slug, actor.key)
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  return NextResponse.json({ left: r.left })
}
