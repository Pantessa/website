import { NextRequest, NextResponse } from 'next/server'
import { CROSS_SITE_REFUSAL, sameOrigin, sameOriginJson } from '@/lib/community/origin'
import { isInternalRun } from '@/lib/internal-run'
import { clientIpFrom } from '@/lib/turn-limits'
import { getActor } from '@/lib/community/identity'
import { castVote } from '@/lib/community/store'
import { voteTripped } from '@/lib/community/limits'
import { parseVote } from '@/lib/community/rules'

// POST /api/posts/<id>/vote { value: 1 | 0 | -1 } — any proven actor. One
// vote per actor per post; 0 clears it. The score is recomputed from the
// votes in the same transaction. Per-actor + per-IP hourly fences.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function POST(req: NextRequest, ctx: { params: Promise<{ id: string }> }) {
  // S7: our own page made this request (the identity cookie can be SameSite=None).
  if (!sameOriginJson(req.headers)) return NextResponse.json(CROSS_SITE_REFUSAL, { status: 403 })
  const { id } = await ctx.params
  const actor = await getActor().catch(() => null)
  if (!actor) return NextResponse.json({ error: 'Sign in, or open this from Telegram or Discord, to vote.', needsIdentity: true }, { status: 401 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const value = parseVote(body && typeof body === 'object' ? (body as { value?: unknown }).value : undefined)
  if (value === null) return NextResponse.json({ error: 'value must be 1, 0 or -1.' }, { status: 400 })
  const tripped = await voteTripped(clientIpFrom(req.headers), actor.key)
  if (tripped) return NextResponse.json({ error: 'That is a lot of votes in an hour. It reopens within the hour.', rateGate: tripped }, { status: 429 })
  const r = await castVote(id, actor.key, value, { isInternal: isInternalRun(req.headers, body) })
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  return NextResponse.json({ score: r.score, myVote: r.myVote }, { headers: { 'cache-control': 'no-store' } })
}
