import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { listDcaSchedules } from '@/lib/dca-exec'
import { dcaContextFor } from '@/lib/job-context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The recurring-buy detail card: the schedule + what it has bought so far and
// where the wallet's holding of that token stands. Owner-only — schedules are
// a signed-in surface (no capability tokens; the rail already requires SIWE).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  // listDcaSchedules is already wallet- and env-fenced — resolving through it
  // (rather than a raw findUnique) keeps the ownership check in one place.
  const schedules = await listDcaSchedules(addr)
  const schedule = schedules.find((s) => s.id === id)
  if (!schedule) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const context = await dcaContextFor(schedule, addr)
  return NextResponse.json({ schedule, context })
}
