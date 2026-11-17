// GET /api/x/handles[?handle=][&sym=]  →  { plotted: PlottedRow[] }: the public list of
// plotted records (finished, at least one call, never an internal run), for the
// door's suggestions and for /x. One handle's rows with ?handle=.
import { NextResponse } from 'next/server'
import { listPlotted, type PlottedRow } from '@/lib/called-it/store'
import { normalizeHandle } from '@/lib/called-it/spec'
import { marketFor } from '@/lib/called-it/market'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const raw = q.get('handle')
  const handle = raw === null || raw === '' ? undefined : normalizeHandle(raw)
  if (handle === null) return NextResponse.json({ status: 'refused', reason: 'That is not an X handle.', next: [{ label: 'Plot a handle', href: '/x' }] }, { status: 400 })
  // ?sym= narrows to one market, through the same door every other route uses (review R5).
  const symRaw = q.get('sym')
  let symbol: string | undefined
  if (symRaw !== null && symRaw !== '') {
    const door = await marketFor(symRaw)
    if (!door.ok) return NextResponse.json({ status: 'refused', reason: door.reason, next: door.next }, { status: door.http })
    symbol = door.symbol
  }
  let plotted: PlottedRow[] = []
  try {
    plotted = await listPlotted({ limit: handle ? 50 : 24, handle, symbol })
  } catch {
    plotted = []
  }
  return NextResponse.json({ plotted }, { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } })
}
