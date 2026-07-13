import { NextRequest, NextResponse } from 'next/server'
import { runGuardianSweep } from '@/lib/hl-guardian-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// The guardian heartbeat — Vercel cron hits this every minute (vercel.json).
// Auth: Vercel sends `Authorization: Bearer ${CRON_SECRET}` to cron routes;
// the same header lets a local runner drive the loop in dev. No secret set =
// route disabled (fail closed), never open.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

export async function GET(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  try {
    const summary = await runGuardianSweep()
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const POST = GET
