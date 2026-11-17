import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { isInternalRun } from '@/lib/internal-run'
import { listMyFills } from '@/lib/community/proof'

// GET /api/me/fills?symbol=&limit= — the signed-in wallet's own
// receipt-verified fills, newest first (the composer's proof picker).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const wallet = await getSessionAddress().catch(() => null)
  if (!wallet) return NextResponse.json({ error: 'Sign in to pick one of your trades.' }, { status: 401 })
  const q = req.nextUrl.searchParams
  const limit = Number(q.get('limit') ?? 25)
  const fills = await listMyFills(wallet, { symbol: q.get('symbol') || undefined, limit: Number.isFinite(limit) ? limit : 25, includeInternal: isInternalRun(req.headers) })
  return NextResponse.json({ fills }, { headers: { 'cache-control': 'no-store' } })
}
