import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getSessionAddress } from '@/lib/auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ id: string }> }

// Revoke (delete) an API key. Owner only; revocation is immediate since every
// Bearer request re-resolves the hash against this table.
export async function DELETE(_req: NextRequest, { params }: Params) {
  const { id } = await params
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const key = await prisma.apiKey.findUnique({ where: { id } })
  if (!key || key.ownerAddress !== addr) {
    return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  }
  await prisma.apiKey.delete({ where: { id } })
  return NextResponse.json({ ok: true })
}
