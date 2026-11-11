// GET /api/x/handles[?handle=]  →  { plotted: PlottedRow[] }: the public list of
// plotted records (finished, at least one call, never an internal run), for the
// door's suggestions and for /x. One handle's rows with ?handle=.
import { NextResponse } from 'next/server'
import { listPlotted, type PlottedRow } from '@/lib/called-it/store'
import { normalizeHandle } from '@/lib/called-it/spec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const raw = new URL(req.url).searchParams.get('handle')
  const handle = raw === null || raw === '' ? undefined : normalizeHandle(raw)
  if (handle === null) return NextResponse.json({ status: 'refused', reason: 'That is not an X handle.', next: [{ label: 'Plot a handle', href: '/x' }] }, { status: 400 })
  let plotted: PlottedRow[] = []
  try {
    plotted = await listPlotted({ limit: handle ? 50 : 24, handle })
  } catch {
    plotted = []
  }
  return NextResponse.json({ plotted }, { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } })
}
