import { NextRequest, NextResponse } from 'next/server'
import { isInternalRun } from '@/lib/internal-run'
import { PRINT_CRON_BUDGET_MS, PRINT_CRON_MAX_BUDGET_MS, fixtureFills } from '@/lib/print-alerts'
import { runPrintSweep } from '@/lib/print-alerts-exec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
// A literal: an imported constant fails the build ("Invalid segment
// configuration export"). lib/print-alerts PRINT_CRON_MAX_DURATION_S pins
// it to this number.
export const maxDuration = 60

// The print-alert heartbeat — Vercel cron, every minute (vercel.json). Same
// auth doctrine as the other crons: no CRON_SECRET set = route disabled
// (fail closed), never open. Each pass reopens Dune's feed from the stored
// per-venue cursor, consumes the minute it missed (or ~40s of a longer
// backlog), runs the /live trigger rules over the fills and writes a
// firing through the price alerts' own notification path. A refused cursor
// is recorded as a gap before the pass rejoins at the tip.
//
// Fixture fills (POST { fixture: { fills } }) are honored only on an
// authorized call that ALSO declares itself an internal run, and even then
// only against is_internal rules (lib/print-alerts-exec).
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const budgetMs = Math.min(Math.max(Number(req.nextUrl.searchParams.get('budgetMs')) || PRINT_CRON_BUDGET_MS, 3_000), PRINT_CRON_MAX_BUDGET_MS)
  let fixture: ReturnType<typeof fixtureFills> | undefined
  if (req.method === 'POST') {
    try {
      const body = (await req.json()) as { fixture?: { fills?: unknown } }
      if (isInternalRun(req.headers, body) && body.fixture && typeof body.fixture === 'object') fixture = fixtureFills(body.fixture.fills)
    } catch {
      /* no body — a plain heartbeat */
    }
  }
  try {
    const summary = await runPrintSweep({ budgetMs, fixture })
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
