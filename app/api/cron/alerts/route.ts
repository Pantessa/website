import { NextRequest, NextResponse } from 'next/server'
import { isInternalRun } from '@/lib/internal-run'
import { runAlertSweep } from '@/lib/alerts-exec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// The price-alert heartbeat — Vercel cron, every minute (vercel.json). Same
// auth doctrine as the guardian/DCA crons: no CRON_SECRET set = route
// disabled (fail closed), never open. ONE quote read per symbol per pass
// serves every alert on it; the response's `reads` is that number.
//
// Fixture prices (POST { fixture: { AAPL: 1 } }) are honored only on an
// authorized call that ALSO declares itself an internal run, and even then
// only against is_internal alerts (lib/alerts-exec) — a real owner's alert
// never sees a fixture price.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  let fixture: Record<string, number> | undefined
  if (req.method === 'POST') {
    try {
      const body = (await req.json()) as { fixture?: unknown }
      if (isInternalRun(req.headers, body) && body.fixture && typeof body.fixture === 'object') {
        fixture = {}
        for (const [k, v] of Object.entries(body.fixture as Record<string, unknown>)) {
          const n = Number(v)
          if (/^[A-Za-z0-9]{1,12}$/.test(k) && n > 0) fixture[k.toUpperCase()] = n
        }
      }
    } catch {
      /* no body — a plain heartbeat */
    }
  }
  try {
    const summary = await runAlertSweep({ fixture })
    return NextResponse.json(summary)
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
