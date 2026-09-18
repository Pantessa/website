import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const KEY_RE = /^(0x[0-9a-f]{40}|v:[a-z0-9-]{8,40})$/

/**
 * POST /api/admin/flows/mark — "that one is me."
 *
 * Marks a wallet (0x…) or a visitor id (v:…) as the team's, or takes the mark
 * back. lib/admin TEST_WALLETS is a constant and has trailed every new test
 * wallet for months; this is the same fence with a button on it. It changes
 * what the flows screen hides and nothing else: no scoreboard, payout or gate
 * reads team_marks.
 */
export async function POST(req: NextRequest) {
  // Session only, like the read beside it.
  const admin = await getSessionAddress()
  if (!admin) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(admin)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })
  const body = (await req.json().catch(() => null)) as { key?: unknown; on?: unknown; note?: unknown } | null
  const key = typeof body?.key === 'string' ? body.key.trim().toLowerCase() : ''
  if (!KEY_RE.test(key)) return NextResponse.json({ error: 'key must be a wallet address or v:<visitor id>.' }, { status: 400 })
  if (body?.on === false) {
    await prisma.teamMark.deleteMany({ where: { key } })
    return NextResponse.json({ ok: true, key, team: false })
  }
  const note = typeof body?.note === 'string' ? body.note.slice(0, 120) : null
  await prisma.teamMark.upsert({ where: { key }, create: { key, note, markedBy: admin.toLowerCase() }, update: { note, markedBy: admin.toLowerCase() } })
  return NextResponse.json({ ok: true, key, team: true })
}
