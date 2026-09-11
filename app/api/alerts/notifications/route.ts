import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { listNotifications, markNotificationsSeen } from '@/lib/watchlists-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/alerts/notifications — the in-app record a fired alert writes; the
// rail's needs-you strip reads it (GET, unseen by default; ?all=1 for the
// history) and dismisses it (PATCH { ids } | { all: true }).
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const all = req.nextUrl.searchParams.get('all') === '1'
  return NextResponse.json({ notifications: await listNotifications(addr, !all) }, { headers: { 'cache-control': 'no-store' } })
}

export async function PATCH(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  let body: { ids?: unknown; all?: unknown }
  try {
    body = (await req.json()) as { ids?: unknown; all?: unknown }
  } catch {
    return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })
  }
  const ids = body.all === true ? 'all' : Array.isArray(body.ids) ? (body.ids as unknown[]).filter((x): x is string => typeof x === 'string') : []
  if (ids !== 'all' && ids.length === 0) return NextResponse.json({ error: 'Name ids or all:true.' }, { status: 400 })
  return NextResponse.json({ seen: await markNotificationsSeen(addr, ids) })
}
