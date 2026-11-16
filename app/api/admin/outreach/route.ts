// GET /api/admin/outreach — the outreach desk's rows (squad called-gtm, lane OUTREACH). Admin-gated.
//
// Every scanned account on every market (lib/called-it/board readBoard, ranked), each with its kit
// (lib/called-it/outreach): the link to the call it got right, the card's address and three drafts.
// Nothing here sends anything. Same gate as every admin API: a session wallet in the allowlist.
import { NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'
import { readBoard } from '@/lib/called-it/board'
import { OUTREACH_DESK_MAX, noKitReason, outreachKit, type OutreachResponse, type OutreachRow } from '@/lib/called-it/outreach'
import { SITE_URL } from '@/lib/site-url'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const json = (body: unknown, status: number) => NextResponse.json(body, { status, headers: { 'cache-control': 'no-store' } })

export async function GET() {
  const admin = await getSessionAddress()
  if (!admin) return json({ error: 'Not signed in.' }, 401)
  if (!isAdminAddress(admin)) return json({ error: 'Forbidden.' }, 403)
  const board = await readBoard({ limit: OUTREACH_DESK_MAX, max: OUTREACH_DESK_MAX })
  const rows: OutreachRow[] = board.entries.map((entry) => ({ entry, kit: outreachKit(entry, SITE_URL), reason: noKitReason(entry) }))
  const handles = new Set(rows.map((r) => r.entry.handle))
  const withHit = new Set(rows.filter((r) => r.kit).map((r) => r.entry.handle))
  const verified = new Set(rows.filter((r) => r.entry.verified).map((r) => r.entry.handle))
  const body: OutreachResponse = { rows, failed: board.failed, counts: { accounts: handles.size, records: rows.length, withHit: withHit.size, verified: verified.size }, origin: SITE_URL }
  return json(body, 200)
}
