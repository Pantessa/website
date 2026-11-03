import { NextRequest, NextResponse } from 'next/server'
import { policyPoolConfig } from '@/lib/policy-pool/config'
import { indexPolicyPool } from '@/lib/policy-pool/indexer'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The policy-pool indexer heartbeat — Vercel cron every 2 minutes
// (vercel.json). Same auth doctrine as the other crons: no CRON_SECRET set =
// route disabled (fail closed), never open. Each pass reads the hook's
// DeskFill logs from the stored cursor in ≤2,000-block windows and writes
// fill (+ mined) rows to the ledger (lib/policy-pool/indexer). With no hook
// deployed (POLICY_POOL_HOOK unset) it does nothing and says so.
function authorized(req: NextRequest): boolean {
  const secret = process.env.CRON_SECRET
  if (!secret) return false
  return req.headers.get('authorization') === `Bearer ${secret}`
}

async function handle(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  try {
    // policyPoolConfig throws by name on a half-configured pool — reported, never read as "off".
    const pool = policyPoolConfig()
    if (!pool) return NextResponse.json({ skipped: 'not deployed' })
    return NextResponse.json(await indexPolicyPool(pool))
  } catch (e) {
    return NextResponse.json({ error: (e as Error).message?.split('\n')[0] ?? 'index failed' }, { status: 500 })
  }
}

export const GET = handle
export const POST = handle
