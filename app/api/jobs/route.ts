import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The caller's jobs, newest first — the dashboard panel's list. Steps ride
// along (they carry the per-step receipts the expanded row shows).
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const jobs = await prisma.job.findMany({
    where: { wallet: addr },
    orderBy: { createdAt: 'desc' },
    include: { steps: { orderBy: { seq: 'asc' }, select: { seq: true, kind: true, status: true, builder: true, title: true, valueUsd: true, result: true } } },
    take: 20,
  })
  return NextResponse.json({ jobs })
}
