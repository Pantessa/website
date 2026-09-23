import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { isAdminAddress } from '@/lib/admin'
import { DESK_STAGES, DESK_WINDOWS, countedDeskRows, deskGrowthSummary, filterDeskRows, type DeskStage } from '@/lib/desk-activity'
import { deskSince, readDeskRows } from './read'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/admin/desk — the agent desk's log, admin SESSION only (it carries every ask's
 * text and the agents' wallets; a bearer key is a thing that leaks — the Flows rule).
 *
 *   ?days=7|30|90      window by the intent's open time (default 30)
 *   ?stage=<DeskStage> one stage only
 *   ?agent=<text>      handle or name substring
 *   ?external=1        strangers only: internal AND team rows dropped (also from the summary)
 *
 * Internal rows (our own harness / drill intents, `is_internal`) are returned FLAGGED and
 * never counted in `summary`; the page greys them. Never a 500: every table is read
 * fail-soft and the ones that failed are named in `failed`.
 */
export async function GET(req: NextRequest) {
  const admin = await getSessionAddress()
  if (!admin) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(admin)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const p = req.nextUrl.searchParams
  const daysRaw = Number(p.get('days'))
  const days = (DESK_WINDOWS as readonly number[]).includes(daysRaw) ? daysRaw : 30
  const stageRaw = p.get('stage')
  const stage = stageRaw && (DESK_STAGES as readonly string[]).includes(stageRaw) ? (stageRaw as DeskStage) : null
  const agent = (p.get('agent') ?? '').slice(0, 64) || null
  const external = p.get('external') === '1'
  const now = Date.now()

  const read = await readDeskRows(deskSince(days, now))
  const counted = countedDeskRows(read.rows, external)
  const rows = filterDeskRows(read.rows, { stage, agent, external })
  return NextResponse.json({
    windowDays: days,
    generatedAt: new Date(now).toISOString(),
    external,
    filters: { stage, agent },
    total: read.rows.length,
    truncated: read.truncated,
    hidden: {
      internal: read.rows.filter((r) => r.isInternal).length,
      team: read.rows.filter((r) => r.team && !r.isInternal).length,
    },
    summary: deskGrowthSummary(counted, days, now),
    rows,
    failed: read.failed,
  })
}
