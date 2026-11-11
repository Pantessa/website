// POST /api/x/add { handle, sym, url }  →  the record with the pasted post (RecordResponse).
// Same-origin JSON only. Read from X by id (keyless); must be by this handle.
import { NextResponse } from 'next/server'
import { readRecord, SYMBOL_RE } from '@/lib/called-it/record'
import { CROSS_SITE, addPost, readWriteBody, requesterOf } from '@/lib/called-it/scan'
import { normalizeHandle } from '@/lib/called-it/spec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })

export async function POST(req: Request) {
  const body = await readWriteBody(req)
  if (body === 'cross-site') return json(CROSS_SITE, 403)
  if (!body) return json({ status: 'refused', reason: 'Send the handle, the market and the post link as JSON.', next: [{ label: 'Plot a handle', href: '/x' }] }, 400)
  const handle = normalizeHandle(body.handle)
  const sym = typeof body.sym === 'string' ? body.sym.trim() : ''
  if (!handle) return json({ status: 'refused', reason: 'That is not an X handle. A handle is 1 to 15 letters, numbers or underscores.', next: [{ label: 'Plot a handle', href: '/x' }] }, 400)
  if (!SYMBOL_RE.test(sym)) return json({ status: 'refused', reason: 'Name a market to add the post to.', next: [{ label: 'Markets', href: '/' }] }, 400)
  const requester = await requesterOf(req)
  let out
  try {
    out = await addPost({ handle, symbol: sym, url: body.url, requester })
  } catch {
    return json({ status: 'refused', reason: 'The post could not be added on this server right now.', next: [{ label: 'See handles already plotted', href: '/x' }] }, 503)
  }
  if (out.kind === 'refused') return json(out.body, out.http)
  const { http, body: rec } = await readRecord({ handle, symbol: sym, side: body.side, requester })
  return json(rec, http)
}
