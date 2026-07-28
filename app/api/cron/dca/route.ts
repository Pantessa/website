import { NextRequest, NextResponse } from 'next/server'
import { executeAutoDcaSweep } from '@/lib/dca-auto-exec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// Each execution is ~2–4 Base txs with receipt waits; the sweep caps
// executions per pass and the hourly cadence drains any backlog.
export const maxDuration = 60

// The DCA autopilot heartbeat — Vercel cron, hourly (vercel.json). Same
// auth doctrine as the guardian cron: no CRON_SECRET set = route disabled
// (fail closed), never open.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  try {
    const summary = await executeAutoDcaSweep()
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const POST = GET
