import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { CROSS_SITE_REFUSAL, sameOriginJson } from '@/lib/community/origin'
import { walletKey } from '@/lib/community/spec'
import { removeMember } from '@/lib/community/store'

// POST /api/communities/<slug>/members/remove { ref } (QA-SECURITY S10) —
// an owner or mod removes a seat. `ref` is the opaque handle the members list
// hands an owner / mod (`?manage=1`); a body can never name a member key.
// The owner's seat never goes; a mod removes members only. Wallet session.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ slug: string }> }) {
  if (!sameOriginJson(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const wallet = await getSessionAddress().catch(() => null)
  if (!wallet) return NextResponse.json({ error: 'Sign in with your wallet to manage this room.' }, { status: 401 })
  const { slug } = await ctx.params
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const ref = body && typeof body === 'object' ? (body as { ref?: unknown }).ref : undefined
  const r = await removeMember(slug, walletKey(wallet), ref)
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  return NextResponse.json({ removed: r.removed })
}
