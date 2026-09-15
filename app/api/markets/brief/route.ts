import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// MK2/AI — POST { symbol, tf?, address? } → the streamed symbol brief.
// Skeleton for the first push; the real route lands this round.
export async function POST(_req: NextRequest) {
  return NextResponse.json({ error: 'The brief is not wired yet.' }, { status: 503 })
}
