import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { listDcaSchedules } from '@/lib/dca-exec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The caller's recurring buys with each one's current-period state — the
// Jobs rail's "what's armed on this wallet" answer. Read-only: managing a
// schedule stays a chat verb (pause/resume/cancel), where every change is
// spoken back. Auth: SIWE cookie or Bearer yf_ (same door as /api/jobs).
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  return NextResponse.json({ schedules: await listDcaSchedules(addr) })
}
