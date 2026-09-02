import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { verifyJobToken } from '@/lib/job-token'
import { advanceJob, cancelJob, getJobWithSteps, jobsEnv } from '@/lib/jobs-runner'

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
  let job = await getJobWithSteps(id)
  if (!job || (!tokenOk && job.wallet !== addr)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  // The watcher IS the demand: a poll that finds its job mid-settlement (or
  // stalled mid-run) runs one advance tick inline, so the open card never
  // depends on the cron window to notice arrival — the 2026-09-02 stuck
  // wait sat with funds already on-chain because 32 zombie jobs starved the
  // cron's oldest-first window. Step claims are atomic, so a concurrent
  // cron tick converges; nothing here signs — an advance can only mark a
  // settled wait done and offer the next guarded artifact.
  // Same-env only — the originEnv fence says only the creating env's
  // runner advances a job (a preview poll must never drive a prod job).
  if ((job.status === 'waiting_settlement' || job.status === 'running') && job.originEnv === jobsEnv()) {
    await advanceJob(job).catch(() => {})
    job = (await getJobWithSteps(id)) ?? job
  }
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
