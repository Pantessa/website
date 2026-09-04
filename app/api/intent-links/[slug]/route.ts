import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { INTENT_SLUG_RE } from '@/lib/intent-links'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Revoke an intent link (DELETE) — creator-owned only. Revoking TAKES THE
 * LINK DOWN: from the next load the /i page 404s, its events/allowed routes
 * refuse, and the row disappears from every list it was on — the creator's
 * own studio table and rail (GET /api/intent-links returns live links only),
 * the public leaderboard, /l/<handle>, the mosaic gallery, and any inbox it
 * was addressed to. It also releases plan capacity (the cap counts active
 * links).
 *
 * What it does NOT do is unmake money. The row is kept as a soft delete so
 * the conversions it already produced stay attributed: accrued creator
 * earnings, claims, and the money-moved history are read from it and must
 * survive the link coming down.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })
  const { slug } = await params
  if (!INTENT_SLUG_RE.test(slug)) return NextResponse.json({ error: 'Bad slug.' }, { status: 400 })

  const link = await prisma.intentLink.findUnique({ where: { id: slug }, select: { creator: true, revoked: true } })
  if (!link || link.creator !== addr.toLowerCase()) return NextResponse.json({ error: 'Not your link.' }, { status: 404 })
  if (!link.revoked) await prisma.intentLink.update({ where: { id: slug }, data: { revoked: true } })
  return NextResponse.json({ ok: true })
}
