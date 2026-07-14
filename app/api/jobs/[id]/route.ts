import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { verifyJobToken } from '@/lib/job-token'
import { cancelJob, getJobWithSteps } from '@/lib/jobs-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The JobCard's poll: the job + its steps (artifacts included — they carry
// the sign payloads the card's buttons need). Owner (SIWE/Bearer) — or the
// job's own capability token (?t=), which is how embed visitors watch the
// job their turn compiled without a session.
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tokenOk = verifyJobToken(id, req.nextUrl.searchParams.get('t'))
  const addr = tokenOk ? null : await getAuthAddress(req)
  if (!tokenOk && !addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const job = await getJobWithSteps(id)
  if (!job || (!tokenOk && job.wallet !== addr)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  return NextResponse.json({ job })
}

// Cancel (the only mutation; pause/resume can ride later).
export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tokenOk = verifyJobToken(id, req.nextUrl.searchParams.get('t'))
  const addr = tokenOk ? (await getJobWithSteps(id))?.wallet : await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const ok = await cancelJob(id, addr)
  if (!ok) return NextResponse.json({ error: 'Not found (or already finished).' }, { status: 404 })
  return NextResponse.json({ ok: true })
}
