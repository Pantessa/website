// GET /api/x/me  →  { identity: XIdentity | null, available: boolean }
// `available` = "Verify with X" can complete on the host this page is on.
import { NextResponse } from 'next/server'
import { getXIdentity, xAuthAvailable } from '@/lib/called-it/x-auth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const identity = await getXIdentity()
  return NextResponse.json({ identity, available: xAuthAvailable(new URL(req.url).origin) }, { headers: { 'cache-control': 'no-store, private' } })
}
