import { NextRequest, NextResponse } from 'next/server'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// MK2/AI — POST { symbol, question, tf?, chartState?, visible?, address? } →
// one typed answer: chart | act | answer. Skeleton for the first push.
export async function POST(_req: NextRequest) {
  return NextResponse.json({ error: 'The ask box is not wired yet.' }, { status: 503 })
}
