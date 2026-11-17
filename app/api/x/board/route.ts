// GET /api/x/board[?sym=][&handle=][&limit=]  →  { entries: BoardEntry[], failed }
// (squad called-gtm, contract). The public board: every scanned account on a
// market, or every market of one account, each with its tally, its small
// price line and the call it is shown by. Public data only: the list never
// holds an internal run or a hidden handle (lib/called-it/board readBoard).
import { NextResponse } from 'next/server'
import { readBoard } from '@/lib/called-it/board'
import { marketFor } from '@/lib/called-it/market'
import { normalizeHandle } from '@/lib/called-it/spec'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(req: Request) {
  const q = new URL(req.url).searchParams
  const raw = q.get('handle')
  const handle = raw === null || raw === '' ? undefined : normalizeHandle(raw)
  if (handle === null) return NextResponse.json({ status: 'refused', reason: 'That is not an X handle.', next: [{ label: 'Plot a handle', href: '/x' }] }, { status: 400 })
  const symRaw = q.get('sym')
  let symbol: string | undefined
  if (symRaw !== null && symRaw !== '') {
    const door = await marketFor(symRaw.slice(0, 40))
    if (!door.ok) return NextResponse.json({ status: 'refused', reason: door.reason, next: door.next }, { status: door.http })
    symbol = door.symbol
  }
  const limit = Number(q.get('limit') ?? '') || undefined
  const board = await readBoard({ symbol, handle, limit })
  return NextResponse.json(board, { headers: { 'cache-control': 'public, max-age=30, s-maxage=60' } })
}
