import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Revoke an intent link (DELETE) — creator-owned only. Revocation is the
 * capacity release (the plan cap counts active links): the /i page 404s from
 * the next load, but the row and its funnel/earnings history stay — accrued
 * creator earnings are never destroyed by revoking.
 */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ slug: string }> }) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })
  const { slug } = await params
  if (!/^[a-z0-9]{4,16}$/.test(slug)) return NextResponse.json({ error: 'Bad slug.' }, { status: 400 })

  const link = await prisma.intentLink.findUnique({ where: { id: slug }, select: { creator: true, revoked: true } })
  if (!link || link.creator !== addr.toLowerCase()) return NextResponse.json({ error: 'Not your link.' }, { status: 404 })
  if (!link.revoked) await prisma.intentLink.update({ where: { id: slug }, data: { revoked: true } })
  return NextResponse.json({ ok: true })
}
