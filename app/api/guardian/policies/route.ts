import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import type { GuardianArmAsk } from '@/lib/hl-guardian'
import { armGuardianPolicy } from '@/lib/hl-guardian-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KINDS = new Set(['stop_loss', 'take_profit'])
const MODES = new Set(['price_move_pct', 'price'])

// Arm a policy. One rulebook for every surface (chat arms through the same
// armGuardianPolicy): active delegation, live position on the coin, a
// trigger that doesn't fire the instant it's armed, no duplicates.
export async function POST(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as Partial<GuardianArmAsk>

  const coin = typeof body.coin === 'string' ? body.coin.toUpperCase().trim() : ''
  const { kind, triggerMode } = body
  const triggerValue = Number(body.triggerValue)
  if (!coin || !kind || !KINDS.has(kind) || !triggerMode || !MODES.has(triggerMode)) {
    return NextResponse.json({ error: 'coin, kind (stop_loss|take_profit) and triggerMode (price_move_pct|price) are required.' }, { status: 400 })
  }

  const result = await armGuardianPolicy(addr, { coin, kind, triggerMode, triggerValue })
  if (!result.ok) return NextResponse.json({ error: result.error }, { status: result.status })
  return NextResponse.json({ policy: result.policy })
}
