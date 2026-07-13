import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { evaluatePolicy, type GuardianPolicyParams } from '@/lib/hl-guardian'
import { fetchPositions, getDelegation } from '@/lib/hl-guardian-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set(['stop_loss', 'take_profit'])
const MODES = new Set(['price_move_pct', 'price'])

// Arm a policy. Validated against the LIVE position at creation: the coin
// must be held on the stated side, and the trigger must sit on the un-fired
// side of the current mark — a policy that would fire the instant it's armed
// is a mis-entry, not a protection.
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as Partial<GuardianPolicyParams>

  const coin = typeof body.coin === 'string' ? body.coin.toUpperCase().trim() : ''
  const kind = body.kind
  const triggerMode = body.triggerMode
  const triggerValue = Number(body.triggerValue)
  if (!coin || !kind || !KINDS.has(kind) || !triggerMode || !MODES.has(triggerMode)) {
    return NextResponse.json({ error: 'coin, kind (stop_loss|take_profit) and triggerMode (price_move_pct|price) are required.' }, { status: 400 })
  }
  if (!Number.isFinite(triggerValue) || triggerValue <= 0 || (triggerMode === 'price_move_pct' && triggerValue >= 100)) {
    return NextResponse.json({ error: 'triggerValue must be a positive number (a percent below 100, or an absolute price).' }, { status: 400 })
  }

  const delegation = await getDelegation(addr)
  if (!delegation || delegation.status !== 'active' || delegation.expiresAt <= new Date()) {
    return NextResponse.json({ error: 'No active delegation — approve the guardian agent first.' }, { status: 409 })
  }

  let positions
  try {
    positions = await fetchPositions(addr)
  } catch (e) {
    return NextResponse.json({ error: `Hyperliquid read failed: ${(e as Error).message}` }, { status: 502 })
  }
  const pos = positions.find((p) => p.coin === coin)
  if (!pos) return NextResponse.json({ error: `No open ${coin} perp position on this account.` }, { status: 400 })

  const params: GuardianPolicyParams = { coin, side: pos.side, kind, triggerMode, triggerValue }
  if (pos.markPx != null) {
    const verdict = evaluatePolicy(params, pos, pos.markPx)
    if (verdict.fired) {
      return NextResponse.json({ error: `That trigger would fire immediately (${verdict.reason}). Set it past the current mark.` }, { status: 400 })
    }
  }

  const dupe = await prisma.hlGuardianPolicy.findFirst({ where: { wallet: addr, coin, kind, status: { in: ['active', 'paused', 'triggered'] } } })
  if (dupe) return NextResponse.json({ error: `A ${kind} on ${coin} is already armed — pause or retire it first.` }, { status: 409 })

  const row = await prisma.hlGuardianPolicy.create({
    data: { delegationId: delegation.id, wallet: addr, coin, side: pos.side, kind, triggerMode, triggerValue },
  })
  return NextResponse.json({ policy: row })
}
