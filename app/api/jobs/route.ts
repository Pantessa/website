import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { compileJobAsk } from '@/lib/jobs'
import { advanceJob, buildSignArtifact, createJob } from '@/lib/jobs-runner'
import { isInternalRun } from '@/lib/internal-run'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 30

// The caller's jobs, newest first — the dashboard panel's list. Steps ride
// along (they carry the per-step receipts the expanded row shows).
export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const jobs = await prisma.job.findMany({
    where: { wallet: addr },
    orderBy: { createdAt: 'desc' },
    include: { steps: { orderBy: { seq: 'asc' }, select: { seq: true, kind: true, status: true, builder: true, title: true, valueUsd: true, result: true } } },
    take: 20,
  })
  return NextResponse.json({ jobs })
}

// Create a job from one compound intent — the EXTERNAL-AGENT door to the
// same rails chat uses. Auth: SIWE cookie or `Authorization: Bearer yf_…`.
//
// { ask: string, dryRun?: boolean }
//
// dryRun=true is the FREE test mode (and the docs playground): the ask is
// compiled and step 1 is built + guard-checked against LIVE venues, but
// nothing is persisted, nothing can be signed, and nothing costs anything —
// the response is the full plan preview with step 1's real artifact and
// guard report. dryRun=false creates the job and offers step 1 for real
// (signatures still come from the wallet; this endpoint never widens
// authority).
export async function POST(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  const body = (await req.json().catch(() => ({}))) as { ask?: string; dryRun?: boolean }
  const ask = typeof body.ask === 'string' ? body.ask.trim() : ''
  if (!ask) return NextResponse.json({ error: 'ask is required.' }, { status: 400 })

  const compiled = compileJobAsk(ask)
  if (!compiled) {
    return NextResponse.json(
      { error: 'Not a compound ask. Chain 2+ steps with "then" — e.g. "deposit 12 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop".' },
      { status: 400 },
    )
  }
  if ('problem' in compiled) return NextResponse.json({ error: compiled.problem }, { status: 400 })
  // Suspected stock-ticker miss (lib/stock-pairing.ts) — the compiler won't
  // guess on a money surface. Surface the candidates; the caller re-POSTs
  // one of the resume strings as the ask. Nothing was compiled or created.
  if ('clarify' in compiled) {
    return NextResponse.json(
      { error: compiled.clarify.question, clarify: compiled.clarify, note: 'Ambiguous ticker — re-POST with one of the clarify options\' resume strings as the ask.' },
      { status: 400 },
    )
  }

  if (body.dryRun) {
    const first = compiled.steps.findIndex((s) => s.kind === 'sign')
    let preview: Record<string, unknown> = {}
    if (first >= 0) {
      try {
        const built = await buildSignArtifact(addr, compiled.steps[first].builder, compiled.steps[first].params)
        preview = { step: first, artifact: built.artifact, guardReport: built.guardReport ?? null, valueUsd: built.valueUsd }
      } catch (e) {
        preview = { step: first, refused: (e as Error).message }
      }
    }
    return NextResponse.json({
      dryRun: true,
      title: compiled.title,
      steps: compiled.steps.map((s, i) => ({ seq: i, kind: s.kind, builder: s.builder, title: s.title, waitPredicate: s.waitPredicate ?? null })),
      firstSignPreview: preview,
      note: 'Nothing was created or signed — re-POST without dryRun to run it.',
    })
  }

  // Our own harness/drill run (lib/internal-run.ts) — the arc never counts it.
  const job = await createJob(addr, compiled, 'api', { internal: isInternalRun(req.headers, body) })
  await advanceJob(job).catch(() => {})
  const fresh = await prisma.job.findUnique({ where: { id: job.id }, include: { steps: { orderBy: { seq: 'asc' } } } })
  const internalRun = isInternalRun(req.headers, body)
  return NextResponse.json({ job: fresh, ...(internalRun ? { internal: true } : {}) }, { status: 201 })
}
