import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { isInternalRun } from '@/lib/internal-run'
import { adoptGuestLists } from '@/lib/watchlists-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/watchlists/adopt { lists: [{ name, symbols, sections? }], auto?,
// dismissed? } — the guest → account promotion (the adoptLocalChat idiom):
// the rail POSTs its localStorage lists the moment the session hydrates
// authed, then clears the key. A guest list merges into the account list of
// the same name; `auto` (symbols the holdings autofill placed) and
// `dismissed` (the guest's removals) keep a removed holding removed across
// the sign-in — see adoptGuestLists. There is no cap to police.
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  let body: { lists?: unknown; auto?: unknown; dismissed?: unknown }
  try {
    body = (await req.json()) as { lists?: unknown; auto?: unknown; dismissed?: unknown }
  } catch {
    return NextResponse.json({ error: 'Malformed body.' }, { status: 400 })
  }
  const lists = await adoptGuestLists(addr, body.lists, isInternalRun(req.headers, body), { auto: body.auto, dismissed: body.dismissed })
  return NextResponse.json({ lists }, { status: 201 })
}
