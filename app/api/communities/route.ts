import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { isInternalRun } from '@/lib/internal-run'
import { clientIpFrom } from '@/lib/turn-limits'
import { createCommunity, listCommunities } from '@/lib/community/store'
import { ROOMS_WALLET_DAILY_CAP, roomCreateTripped } from '@/lib/community/limits'

// /api/communities — the room directory and the door that opens a room.
// GET  ?sort=members|new|active&symbol=&limit=   public; internal rooms never listed
// POST { slug, name, about?, symbols? }          a wallet session; 3 rooms a wallet a day

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams
  const s = q.get('sort')
  const sort = s === 'new' || s === 'active' ? s : 'members'
  const limit = Number(q.get('limit') ?? 30)
  const communities = await listCommunities({ sort, limit: Number.isFinite(limit) ? limit : 30, symbol: q.get('symbol') || undefined })
  return NextResponse.json({ communities }, { headers: { 'cache-control': 'public, max-age=15, s-maxage=30' } })
}

export async function POST(req: NextRequest) {
  const owner = await getSessionAddress().catch(() => null)
  if (!owner) return NextResponse.json({ error: 'Sign in to start a room. One free signature.' }, { status: 401 })
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof body !== 'object' || body === null || Array.isArray(body)) return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  const b = body as Record<string, unknown>
  if (await roomCreateTripped(clientIpFrom(req.headers), owner)) {
    return NextResponse.json({ error: `One wallet can start ${ROOMS_WALLET_DAILY_CAP} rooms a day. Try again tomorrow.` }, { status: 429 })
  }
  const r = await createCommunity(
    owner,
    { slug: b.slug as string, name: b.name as string, about: b.about as string | undefined, symbols: b.symbols as string[] | undefined },
    isInternalRun(req.headers, body),
  )
  if (!r.ok) return NextResponse.json({ error: r.reason }, { status: r.status })
  return NextResponse.json({ community: r.community }, { status: 201 })
}
