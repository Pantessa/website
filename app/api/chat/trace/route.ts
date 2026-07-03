import { NextRequest, NextResponse } from 'next/server'
import { getTurnTrace } from '@/lib/route-trace'

/**
 * Poll one turn's routing trace — feeds the in-chat engine terminal while a
 * manual (non-SSE) turn is in flight. The client generates the turnId, sends
 * it on POST /api/chat, and polls here until the reply lands.
 * Trace lines are the PUBLIC event types only (lib/route-trace PUBLIC_TYPES).
 */
export async function GET(req: NextRequest) {
  const turn = req.nextUrl.searchParams.get('turn') ?? ''
  if (!/^[A-Za-z0-9-]{8,64}$/.test(turn)) {
    return NextResponse.json({ events: [] })
  }
  const events = await getTurnTrace(turn)
  return NextResponse.json({ events })
}
