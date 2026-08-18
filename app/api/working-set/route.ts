import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { getWorkingSet, setWorkingSet } from '@/lib/working-set'
import { isInternalRun } from '@/lib/internal-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The signed-in wallet's saved chat working set (ordered McpServer ids; [] if
// none). The cross-device mirror of the client's per-wallet localStorage cache.
export async function GET() {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  return NextResponse.json({ serviceIds: await getWorkingSet(addr) })
}

// Replace the wallet's working set. Body: { serviceIds: string[] } — no size
// cap (unlike the shortlist). Empty clears it. Unknown ids are dropped.
export async function PUT(req: NextRequest) {
  const addr = await getSessionAddress()
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })

  const body = await req.json().catch(() => ({} as Record<string, unknown>))
  if (!Array.isArray(body.serviceIds)) {
    return NextResponse.json({ error: 'serviceIds must be an array.' }, { status: 400 })
  }
  const ids = body.serviceIds.filter((x: unknown): x is string => typeof x === 'string')

  // Our own harness/drill write (lib/internal-run.ts): every gate run
  // upserts working sets for throwaway wallets — never an arrival.
  const internalRun = isInternalRun(req.headers, body)
  return NextResponse.json({ serviceIds: await setWorkingSet(addr, ids, { internal: internalRun }), ...(internalRun ? { internal: true } : {}) })
}
