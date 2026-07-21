import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** Revoke a receipt permalink — the public page 404s the moment this lands.
 *  Soft-delete (revoked flag) so a re-share can't resurrect an old slug. */
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Sign in.' }, { status: 401 })
  const { id } = await params
  const receipt = await prisma.shareReceipt.findUnique({ where: { id } })
  if (!receipt || receipt.wallet !== addr.toLowerCase()) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  await prisma.shareReceipt.update({ where: { id }, data: { revoked: true } })
  return NextResponse.json({ ok: true })
}
