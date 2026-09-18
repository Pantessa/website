import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { MAX_BODY_BYTES, sanitizeBatch } from '@/lib/journey-events'
import { writeJourneyBatch } from '@/lib/journey-server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/journey — the browser half of the journey log (lib/journey.ts).
 *
 * Public and unauthenticated on purpose: its subject is people who have not
 * signed in. So it trusts nothing. The body is size-capped, run through
 * lib/journey-events sanitizeBatch (closed set of kinds, short scrubbed
 * strings, pathnames only), fenced per IP per hour, and dropped whole for a
 * browser that sent Global Privacy Control or Do Not Track.
 *
 * Always answers 204 with no body: a beacon has no reader, and the answer
 * must not tell a prober which of its events were kept.
 */
export async function POST(req: NextRequest) {
  const done = () => new NextResponse(null, { status: 204 })
  try {
    const raw = await req.text()
    if (!raw || raw.length > MAX_BODY_BYTES) return raw ? new NextResponse(null, { status: 413 }) : done()
    let body: unknown
    try {
      body = JSON.parse(raw)
    } catch {
      return done()
    }
    const clean = sanitizeBatch(body)
    if (clean.events.length === 0) return done()
    // A signed-in admin's browser is the team's, whatever wallet it shows.
    const sessionAddress = await getSessionAddress().catch(() => null)
    const verdict = await writeJourneyBatch(req.headers, clean, { body, sessionAddress })
    if (verdict === 'limited') return new NextResponse(null, { status: 429 })
  } catch (e) {
    console.warn('[journey] batch failed:', e instanceof Error ? e.message.split('\n')[0] : e)
  }
  return done()
}
