import { NextRequest, NextResponse } from 'next/server'
import { refreshTradability } from '@/lib/tradability-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// The tradability refresher — Vercel cron (vercel.json). Re-measures the
// stalest venue verdicts on the /markets board, oldest first, inside a wall
// clock budget, so every leg comes round well inside the freshness window
// (lib/tradability TRADABILITY_MAX_AGE_MS) and no single pass runs long.
//
// Read-only against every venue: it quotes the cascade from a burn address
// and never signs, sends or touches a user's wallet (lib/venue-preflight).
//
// Same auth doctrine as the other crons: no CRON_SECRET set = disabled,
// never open. A verdict is never guessed here — an unreadable leg keeps its
// last answer and leads the next pass.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  const budgetMs = Math.min(Math.max(Number(req.nextUrl.searchParams.get('budgetMs')) || 20_000, 1_000), 25_000)
  try {
    return NextResponse.json(await refreshTradability({ budgetMs }))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
