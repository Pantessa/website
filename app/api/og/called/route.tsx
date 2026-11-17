import { loadRecordView } from '@/app/x/_lib/view'
import { normalizeHandle } from '@/lib/called-it/spec'
import { CALL_PARAM, leadCallOf, parseCallParam } from '@/lib/called-it/gtm'
import { renderCalledCard, type CalledCardInput, type CalledCardKind } from './card'

// GET /api/og/called?handle=&sym=&side=&pins=  →  the share image of one
// record, 1200 × 630 PNG (squad called-it, lane RECORD).
// GET /api/og/called?handle=&sym=&call=<postId>  →  the image of ONE call of
// that record (squad called-gtm, lane CALL): the verdict, the post's words,
// the day marked on the price line, and the record's WHOLE tally along the
// foot. It reads the whole record (no side, no pins), so one call is never
// drawn beside half a tally. An id the record does not hold draws the record.
//
// The landing's
// metadata points og:image and twitter:image here with the page's own handle,
// market, toggle and pins, so what unfurls on X is the record the link opens.
//
// It reads through the SAME loader the page does (app/x/_lib/view, over
// lib/called-it/record readRecord), never over HTTP.
//
// Every answer is a picture, never a 500:
//   a ready record            the scoreboard and the pinned posts
//   one call of it (`call=`)  that call leading, the whole tally under it
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
      // One call: read the WHOLE record and lead with the call it holds. Anything else falls through to the record's own picture.
      const callId = parseCallParam(q.get(CALL_PARAM))
      if (callId) {
        const whole = await loadRecordView(handleRaw, symRaw, '', '')
        const call = whole.body.status === 'ready' ? leadCallOf(whole.body.record, callId) : null
        if (call && whole.body.status === 'ready') {
          input = { kind: 'call', handle, symbol: whole.body.record.symbol, record: whole.body.record, closes: whole.closes, avatar: whole.avatar, unit: whole.unit, call }
          address = `pantessa.com/x/${handle}/${whole.body.record.symbol}`
        }
      }
    }
    if (handle && symRaw && input.kind !== 'call') {
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
    return png(await within(renderCalledCard(input, address), RENDER_BUDGET_MS), input.kind === 'record' || input.kind === 'call' || input.kind === 'pasted' || input.kind === 'empty' || input.kind === 'generic' || input.kind === 'handle' ? CACHE_RECORD : CACHE_SHORT, input.kind)
  } catch {
    return generic()
  }
}
