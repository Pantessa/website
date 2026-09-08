import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { decideReview, isReviewerAddress, listReviewQueue, type ReviewDecision } from '@/lib/mcp-review'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The MCP review queue — user-requested directory rows awaiting a trusted
 * reviewer (MCP_REVIEWER_WALLETS ∪ admins). GET lists pending (FIFO) + the
 * last 50 decisions; POST {id, decision:'approve'|'reject', note?} records
 * one. Reviewer-gated on both verbs; lib/mcp-review.ts is the rulebook.
 */
async function gate(req: NextRequest): Promise<{ addr: string } | NextResponse> {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isReviewerAddress(addr)) return NextResponse.json({ error: 'Forbidden — reviewer wallets only.' }, { status: 403 })
  return { addr }
}

export async function GET(req: NextRequest) {
  const g = await gate(req)
  if (g instanceof NextResponse) return g
  const queue = await listReviewQueue()
  return NextResponse.json({ reviewer: g.addr.toLowerCase(), ...queue })
}

export async function POST(req: NextRequest) {
  const g = await gate(req)
  if (g instanceof NextResponse) return g
  let body: { id?: unknown; decision?: unknown; note?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  const id = typeof body.id === 'string' ? body.id : ''
  const decision = body.decision === 'approve' || body.decision === 'reject' ? (body.decision as ReviewDecision) : null
  if (!id || !decision) return NextResponse.json({ error: 'id and decision (approve | reject) are required.' }, { status: 400 })
  const note = typeof body.note === 'string' ? body.note : null
  const res = await decideReview({ id, decision, reviewer: g.addr, note })
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: res.status })
  return NextResponse.json({ ok: true, server: res.server, previous: res.previous })
}
