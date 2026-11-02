import { NextRequest, NextResponse } from 'next/server'
import { normalizePolicyPoolEvent, recordPolicyPoolEvent, type PolicyPoolEventInput } from '@/lib/policy-pool/ledger'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/policy-pool/record — the demo runner's door into the ledger
// (scripts/policy-pool-demo.ts). Body = recordPolicyPoolEvent's input.
// Bearer CRON_SECRET; no secret set = disabled (fail closed). A malformed
// row is a 400 with the reason, never a silent write.
export async function POST(req: NextRequest) {
  const secret = process.env.CRON_SECRET
  if (!secret || req.headers.get('authorization') !== `Bearer ${secret}`) {
    return NextResponse.json({ error: 'Unauthorized.' }, { status: 401 })
  }
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Body must be JSON.' }, { status: 400 })
  }
  const n = normalizePolicyPoolEvent(body)
  if (!n.ok) return NextResponse.json({ error: n.error }, { status: 400 })
  await recordPolicyPoolEvent(body as PolicyPoolEventInput)
  return NextResponse.json({ ok: true })
}
