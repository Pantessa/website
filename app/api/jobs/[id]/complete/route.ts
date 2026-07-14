import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { completeSignStep } from '@/lib/jobs-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// The JobCard posts sign-step evidence here (tx hash / HL fill). The runner
// treats it as advancement, not proof — the following wait step (or the next
// build's balance checks) is the actual verification, so lying here only
// fails the job closed one step later.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const { id } = await params
  const body = (await req.json().catch(() => ({}))) as { seq?: number; result?: Record<string, unknown> }
  if (typeof body.seq !== 'number') return NextResponse.json({ error: 'seq is required.' }, { status: 400 })
  const res = await completeSignStep(id, addr, body.seq, body.result ?? {})
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
