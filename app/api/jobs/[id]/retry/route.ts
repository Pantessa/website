import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { verifyJobToken } from '@/lib/job-token'
import { getJobWithSteps, retryFailedJob } from '@/lib/jobs-runner'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// Re-arm a failed job after the user fixed what refused it (spend policy
// raised, venue allowed, wallet topped up). The failed step rebuilds fresh
// through the same guarded builder — this endpoint never signs anything.
// Auth mirrors the job GET: owner (SIWE/Bearer) or the job's own capability
// token (?t=), so embed visitors can retry the job their turn compiled.
export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tokenOk = verifyJobToken(id, req.nextUrl.searchParams.get('t'))
  const addr = tokenOk ? (await getJobWithSteps(id))?.wallet : await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const res = await retryFailedJob(id, addr)
  if (!res.ok) return NextResponse.json({ error: res.error }, { status: 400 })
  return NextResponse.json({ ok: true })
}
