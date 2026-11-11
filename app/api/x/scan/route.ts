// POST /api/x/scan { handle, sym }  →  the record after the scan (RecordResponse).
// GET  /api/x/scan?id=               →  one scan's status and note (a second viewer polls this).
// Same-origin JSON only. The scan runs inside the request (lib/called-it/scan runScan).
import { NextResponse } from 'next/server'
import { readRecord, SYMBOL_RE } from '@/lib/called-it/record'
import { CROSS_SITE, SCAN_TIME_BUDGET_MS, isInternalRun, readWriteBody, requesterOf, runScan } from '@/lib/called-it/scan'
import { getScan } from '@/lib/called-it/store'
import { FIXTURE_HANDLE } from '@/lib/called-it/fixture'
import { resolveChartPair } from '@/lib/charts'
import { normalizeHandle } from '@/lib/called-it/spec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })

export async function POST(req: Request) {
  // The time budget runs from the start of the request: the function is killed at maxDuration and nothing after that runs.
  const startedAt = Date.now()
  const body = await readWriteBody(req)
  if (body === 'cross-site') return json(CROSS_SITE, 403)
  if (!body) return json({ status: 'refused', reason: 'Send the handle and the market as JSON.', next: [{ label: 'Plot a handle', href: '/x' }] }, 400)
  const handle = normalizeHandle(body.handle)
  const sym = typeof body.sym === 'string' ? body.sym.trim() : ''
  if (!handle) return json({ status: 'refused', reason: 'That is not an X handle. A handle is 1 to 15 letters, numbers or underscores.', next: [{ label: 'Plot a handle', href: '/x' }] }, 400)
  if (!SYMBOL_RE.test(sym)) return json({ status: 'refused', reason: 'Name a market to scan the handle on.', next: [{ label: 'Markets', href: '/' }] }, 400)

  const requester = await requesterOf(req)
  // The fixture needs no scan; a market with no chart is refused before anything is read from X.
  if (handle === FIXTURE_HANDLE) {
    const { http, body: rec } = await readRecord({ handle, symbol: sym, side: body.side, requester })
    return json(rec, http)
  }
  if (!(await resolveChartPair(sym))) return json({ status: 'refused', reason: `${sym.toUpperCase()} has no chart here, so there is nothing to pin a post to.`, next: [{ label: 'Markets', href: '/' }] }, 404)

  let outcome
  try {
    outcome = await runScan({ handle, symbol: sym.toUpperCase(), requester, internal: isInternalRun(req), deadlineMs: startedAt + SCAN_TIME_BUDGET_MS })
  } catch {
    return json({ status: 'refused', reason: 'The scan did not start. Try again in a moment.', next: [{ label: 'See handles already plotted', href: '/x' }] }, 503)
  }
  if (outcome.kind === 'refused') return json(outcome.body, outcome.http)
  if (outcome.kind === 'joined') return json({ status: 'scanning', handle, symbol: sym.toUpperCase(), scanId: outcome.scan.id, progress: outcome.scan.note ?? `Reading @${handle}'s posts` }, 202)
  const { http, body: rec } = await readRecord({ handle, symbol: sym, side: body.side, requester })
  return json(rec, http)
}

export async function GET(req: Request) {
  const id = new URL(req.url).searchParams.get('id') ?? ''
  if (!/^[A-Za-z0-9_-]{6,64}$/.test(id)) return json({ status: 'refused', reason: 'That is not a scan id.', next: [{ label: 'Plot a handle', href: '/x' }] }, 400)
  let row
  try {
    row = await getScan(id)
  } catch {
    row = null
  }
  if (!row) return json({ status: 'refused', reason: 'No scan by that id.', next: [{ label: 'Plot a handle', href: '/x' }] }, 404)
  // Public fields only: never who asked.
  const { handle, symbol, status, postsRead, callsFound, note, startedAt, finishedAt } = row
  return json({ id: row.id, handle, symbol, status, postsRead, callsFound, note, startedAt, finishedAt }, 200)
}
