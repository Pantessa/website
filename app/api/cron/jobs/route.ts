import { NextRequest, NextResponse } from 'next/server'
import { advanceJobs } from '@/lib/jobs-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// The jobs heartbeat — same contract as /api/cron/hl-guardian: Vercel cron
// with `Authorization: Bearer ${CRON_SECRET}`; unset secret = disabled.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  try {
    return NextResponse.json(await advanceJobs())
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const POST = GET
