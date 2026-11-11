import { loadRecordView } from '@/app/x/_lib/view'
import { normalizeHandle } from '@/lib/called-it/spec'
import { renderCalledCard, type CalledCardInput, type CalledCardKind } from './card'

// GET /api/og/called?handle=&sym=&side=&pins=  →  the share image of one
// record, 1200 × 630 PNG (squad called-it, lane RECORD). The landing's
// metadata points og:image and twitter:image here with the page's own handle,
// market, toggle and pins, so what unfurls on X is the record the link opens.
//
// It reads through the SAME loader the page does (app/x/_lib/view, over
// lib/called-it/record readRecord), never over HTTP.
//
// Every answer is a picture, never a 500:
//   a ready record            the scoreboard and the pinned posts
//   posts a viewer pasted,    the posts, each marked "added by a viewer", and
//     with no scan behind them  no tally: never drawn as a record
//   a record with no calls    the line and "no calls found in this window"
//   a handle nobody plotted   "Not plotted yet", the market's line, no pins
//   a scan in flight          the same, saying a scan is reading
//   a refusal                 the refusal's own words
//   no handle, or garbage     the feature's own card ("Whose calls?")
// A render that throws, or runs past its budget (a post's emoji or script the
// renderer has to fetch a glyph for), falls back to the feature's card; if
// even that throws, the site's own card.
//
// `x-pantessa-card` names the composition served, for the pins and for anyone
// debugging an unfurl.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** A drawn record holds five minutes at the edge; anything that may change in a moment holds fifteen seconds. */
const CACHE_RECORD = 'public, max-age=60, s-maxage=300, stale-while-revalidate=600'
const CACHE_SHORT = 'public, max-age=15, s-maxage=15'
const RENDER_BUDGET_MS = 9_000

function png(body: ArrayBuffer, cache: string, card: CalledCardKind | 'fallback'): Response {
  return new Response(body, { status: 200, headers: { 'content-type': 'image/png', 'cache-control': cache, 'x-pantessa-card': card } })
}

function within<T>(p: Promise<T>, ms: number): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    const t = setTimeout(() => reject(new Error('render budget')), ms)
    p.then(
      (v) => {
        clearTimeout(t)
        resolve(v)
      },
      (e) => {
        clearTimeout(t)
        reject(e)
      },
    )
  })
}

const GENERIC: CalledCardInput = { kind: 'generic', handle: null, symbol: null, record: null, closes: [], avatar: null }

async function generic(): Promise<Response> {
  try {
    return png(await within(renderCalledCard(GENERIC, 'pantessa.com/x'), RENDER_BUDGET_MS), CACHE_SHORT, 'fallback')
  } catch {
    return new Response(null, { status: 307, headers: { location: '/opengraph-image', 'cache-control': CACHE_SHORT } })
  }
}

export async function GET(req: Request): Promise<Response> {
  let input: CalledCardInput = GENERIC
  let address = 'pantessa.com/x'
  try {
    const q = new URL(req.url).searchParams
    const handleRaw = (q.get('handle') ?? '').slice(0, 200)
    const symRaw = (q.get('sym') ?? '').slice(0, 40)
    const handle = normalizeHandle(handleRaw)
    if (handle && !symRaw) {
      input = { kind: 'handle', handle, symbol: null, record: null, closes: [], avatar: null }
      address = `pantessa.com/x/${handle}`
    } else if (handle) {
      const view = await loadRecordView(handleRaw, symRaw, q.get('side') ?? '', (q.get('pins') ?? '').slice(0, 400))
      const body = view.body
      if (view.symbol) address = `pantessa.com/x/${handle}/${view.symbol}`
      if (body.status === 'ready') input = { kind: !body.record.calls.length ? 'empty' : body.record.scanned ? 'record' : 'pasted', handle, symbol: body.record.symbol, record: body.record, closes: view.closes, avatar: view.avatar, unit: view.unit }
      else if (body.status === 'refused') input = { kind: 'refused', handle, symbol: view.symbol, record: null, closes: [], avatar: null, reason: body.reason }
      else input = { kind: body.status, handle, symbol: view.symbol, record: null, closes: view.closes, avatar: null }
    }
  } catch {
    input = GENERIC
    address = 'pantessa.com/x'
  }
  try {
    return png(await within(renderCalledCard(input, address), RENDER_BUDGET_MS), input.kind === 'record' || input.kind === 'pasted' || input.kind === 'empty' || input.kind === 'generic' || input.kind === 'handle' ? CACHE_RECORD : CACHE_SHORT, input.kind)
  } catch {
    return generic()
  }
}
