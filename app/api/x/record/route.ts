// GET /api/x/record?handle=&sym=&side=&pins=  →  RecordResponse (lib/called-it/spec).
// The read itself is lib/called-it/record readRecord, shared with the pages.
import { NextResponse } from 'next/server'
import { readRecord } from '@/lib/called-it/record'
import { requesterOf } from '@/lib/called-it/scan'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const requester = await requesterOf(req)
  const { http, body } = await readRecord({ handle: q.get('handle'), symbol: q.get('sym'), side: q.get('side'), pins: q.get('pins'), requester })
  return NextResponse.json(body, { status: http, headers: { 'cache-control': 'no-store' } })
}
