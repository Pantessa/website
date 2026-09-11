import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { addItems, removeItem, setItemSection } from '@/lib/watchlists-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// /api/watchlists/[id]/items — add ticker(s), remove one, move one to a
// section. Owner-gated (getAuthAddress); a list that isn't yours is a 404,
// not a 403 (no enumeration). No per-list cap — unlimited tickers.

type Ctx = { params: Promise<{ id: string }> }

async function readBody(req: NextRequest): Promise<Record<string, unknown>> {
  try {
    const b = (await req.json()) as unknown
    return b && typeof b === 'object' ? (b as Record<string, unknown>) : {}
  } catch {
    return {}
  }
}

/** POST { symbols: string[] | symbol: string, section? } → { list } */
export async function POST(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await readBody(req)
  const r = await addItems(addr, id, body.symbols ?? body.symbol, body.section)
  if ('problem' in r) return NextResponse.json({ error: r.problem }, { status: r.status })
  return NextResponse.json({ list: r.list })
}

/** PATCH { symbol, section: string | null } → { list } */
export async function PATCH(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = await readBody(req)
  const r = await setItemSection(addr, id, body.symbol, body.section ?? null)
  if ('problem' in r) return NextResponse.json({ error: r.problem }, { status: r.status })
  return NextResponse.json({ list: r.list })
}

/** DELETE ?symbol= (or body { symbol }) → { list } */
export async function DELETE(req: NextRequest, { params }: Ctx) {
  const { id } = await params
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const symbol = req.nextUrl.searchParams.get('symbol') ?? (await readBody(req)).symbol
  const r = await removeItem(addr, id, symbol)
  if ('problem' in r) return NextResponse.json({ error: r.problem }, { status: r.status })
  return NextResponse.json({ list: r.list })
}
