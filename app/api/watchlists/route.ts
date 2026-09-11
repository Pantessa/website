import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { isInternalRun } from '@/lib/internal-run'
import { createWatchlist, deleteWatchlist, listWatchlists, updateWatchlist } from '@/lib/watchlists-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/watchlists — the owner's lists (MARKETS/WATCH). Same door as
// /api/dca: SIWE cookie or Bearer yf_ (getAuthAddress); the owner is the
// verified address, never a body field. Guests keep lists in localStorage
// and adopt them on sign-in (POST /api/watchlists/adopt). UNLIMITED: no
// count check anywhere in this file — the value prop.

async function readBody(req: NextRequest): Promise<Record<string, unknown> | null> {
  try {
    const b = (await req.json()) as unknown
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : null
  } catch {
    return null
  }
}

export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  return NextResponse.json({ lists: await listWatchlists(addr) }, { headers: { 'cache-control': 'no-store' } })
}

/** POST { name, symbols?, sections? } → { list } */
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await readBody(req)
  if (!body) return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })
  const list = await createWatchlist({
    owner: addr,
    name: body.name,
    symbols: body.symbols,
    sections: body.sections,
    isInternal: isInternalRun(req.headers, body),
  })
  return NextResponse.json({ list }, { status: 201 })
}

/** PATCH { id, name?, isPublic?, slug?, order?, sections?, position? } → { list } */
export async function PATCH(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await readBody(req)
  if (!body || typeof body.id !== 'string') return NextResponse.json({ error: 'Name the list id.' }, { status: 400 })
  const r = await updateWatchlist(addr, body.id, body)
  if ('problem' in r) return NextResponse.json({ error: r.problem }, { status: r.status })
  return NextResponse.json({ list: r.list })
}

/** DELETE ?id= (or body { id }) */
export async function DELETE(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const id = req.nextUrl.searchParams.get('id') ?? ((await readBody(req))?.id as string | undefined)
  if (!id || typeof id !== 'string') return NextResponse.json({ error: 'Name the list id.' }, { status: 400 })
  const ok = await deleteWatchlist(addr, id)
  if (!ok) return NextResponse.json({ error: 'No such list on this wallet.' }, { status: 404 })
  return NextResponse.json({ ok: true, id })
}
