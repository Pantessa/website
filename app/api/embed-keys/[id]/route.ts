import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Revoke an embed key. Default is SOFT: the key stops resolving (embeds fall
// back to keyless) but its sighting history stays for the adoption surface.
// `?purge=1` hard-deletes the key AND its sites — the test harness uses it
// so throwaway rows never accumulate.
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const { id } = await params
  const purge = req.nextUrl.searchParams.get('purge') === '1'

  if (purge) {
    const { count } = await prisma.embedKey.deleteMany({ where: { id, ownerAddress: addr } })
    if (count === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
    await prisma.embedSite.deleteMany({ where: { embedKeyId: id } })
    await prisma.embedTurn.deleteMany({ where: { embedKeyId: id } })
    return NextResponse.json({ revoked: true, purged: true })
  }

  const { count } = await prisma.embedKey.updateMany({
    where: { id, ownerAddress: addr, revoked: false },
    data: { revoked: true },
  })
  if (count === 0) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({ revoked: true })
}
