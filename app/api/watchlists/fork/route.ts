import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { isInternalRun } from '@/lib/internal-run'
import { forkWatchlist } from '@/lib/watchlists-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/watchlists/fork { slug } — "Follow" on /lists/<slug>: copies the
// public list into the caller's lists with fork_of = slug (the MOSAIC
// lineage idiom). Signed-in only; a guest's Follow button opens the door.
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  let body: { slug?: unknown }
  try {
    body = (await req.json()) as { slug?: unknown }
  } catch {
    return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })
  }
  if (typeof body.slug !== 'string') return NextResponse.json({ error: 'Name the list slug.' }, { status: 400 })
  const r = await forkWatchlist(addr, body.slug, isInternalRun(req.headers, body))
  if ('problem' in r) return NextResponse.json({ error: r.problem }, { status: r.status })
  return NextResponse.json({ list: r.list }, { status: 201 })
}
