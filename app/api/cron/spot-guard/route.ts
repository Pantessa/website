import { NextRequest, NextResponse } from 'next/server'
import { executeSpotGuardSweep } from '@/lib/spot-guard-exec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A fired policy is ~4-5 Base txs with receipt waits; the sweep caps fires
// per pass and the per-minute cadence retries the tail.
export const maxDuration = 60

// The spot-guard heartbeat — per-minute Vercel cron (a stop-loss is only as
// good as its watch cadence; same as the HL guardian). Same auth doctrine:
// no CRON_SECRET set = route disabled (fail closed), never open.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  try {
    const summary = await executeSpotGuardSweep()
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const POST = GET
