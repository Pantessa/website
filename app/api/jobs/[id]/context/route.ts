import { NextRequest, NextResponse } from 'next/server'
import { getAuthAddress } from '@/lib/api-key'
import { verifyJobToken } from '@/lib/job-token'
import { getJobWithSteps } from '@/lib/jobs-runner'
import { jobContextFor } from '@/lib/job-context'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The job detail card's position/PnL block: what this job's venues say about
// the wallet RIGHT NOW (open HL positions + PnL, the Lido stake, the Aave
// health factor, the bought token's balance…). Same auth as the job poll:
// owner, or the job's own capability token (?t=).
export async function GET(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params
  const tokenOk = verifyJobToken(id, req.nextUrl.searchParams.get('t'))
  const addr = tokenOk ? null : await getAuthAddress(req)
  if (!tokenOk && !addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const job = await getJobWithSteps(id)
  if (!job || (!tokenOk && job.wallet !== addr)) return NextResponse.json({ error: 'Not found.' }, { status: 404 })
  const context = await jobContextFor({
    wallet: job.wallet,
    status: job.status,
    currentStep: job.currentStep,
    valueUsd: job.valueUsd,
    failReason: job.failReason,
    steps: job.steps.map((s) => ({ builder: s.builder, params: s.params })),
  })
  return NextResponse.json({ context })
}
