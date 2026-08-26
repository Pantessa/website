import { NextRequest, NextResponse } from 'next/server'
import { isInternalRun } from '@/lib/internal-run'
import { bumpAndCheckRosterPost, clientIpFrom, ROSTER_RATE_WALL } from '@/lib/roster-policy'
import { captureReview } from '@/lib/roster-tryouts-exec'
import { PAPER_LABEL } from '@/lib/roster-tryouts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Explicit review capture. EARLY CALLS REFUSE BY NAME — review_at is fixed
// at creation (+7d) and immutable (§1.5-2); the capture is write-once.
// `forceDue` exists ONLY for is_internal tryouts on internal runs (our own
// drills must prove write-once without waiting a week; internal rows never
// surface anywhere public, so nothing gameable rides this door).
export async function POST(req: NextRequest) {
  if (await bumpAndCheckRosterPost(clientIpFrom(req.headers))) {
    return NextResponse.json({ error: ROSTER_RATE_WALL }, { status: 429 })
  }
  let body: { tryoutId?: unknown; forceDue?: unknown; internalRun?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const tryoutId = typeof body.tryoutId === 'string' ? body.tryoutId.trim() : ''
  if (!tryoutId) return NextResponse.json({ error: 'tryoutId is required.' }, { status: 400 })
  const internal = isInternalRun(req.headers, body)
  try {
    const tryout = await captureReview(tryoutId, { forceDueForInternal: internal && body.forceDue === true })
    return NextResponse.json({ paper: PAPER_LABEL, tryout, ...(internal ? { internal: true } : {}) })
  } catch (e) {
    const msg = (e as Error).message
    return NextResponse.json({ error: msg }, { status: /Too early/.test(msg) ? 409 : 400 })
  }
}
