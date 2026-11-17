import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { compileJobAsk, type CompiledJob } from '@/lib/jobs'
import { advanceJob, buildSignArtifact, createJob } from '@/lib/jobs-runner'
import { isInternalRun } from '@/lib/internal-run'
import { unfillableFundedBuyReason } from '@/lib/venue-preflight'
import { preflightJob } from '@/lib/job-preflight'

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

  // A funding plan's buy, checked before the bridge legs can move anything
  // (lib/venue-preflight.ts): the buy step sits at the END of the job, so a
  // listing no venue can fill only refuses once the stable is already on
  // the destination chain. Read-only and fail-open — only a definite venue
  // miss refuses. A dry run reports it too, so an agent that validates a
  // plan before committing doesn't get a green light and then a 400.
  const unfillable = await unfillableFundedBuyReason(compiled)

  if (body.dryRun) return dryRunAnswer(addr, compiled, ask, unfillable)

  if (unfillable) return NextResponse.json({ error: unfillable }, { status: 400 })

  // THE JOB PRE-FLIGHT (lib/job-preflight, squad lane1 2026-11-17): a first
  // step the wallet provably cannot fund never becomes a job row. The answer
  // names the shortfall and carries the asks that work for this wallet (the
  // caller re-POSTs one of the resume strings, like the ticker clarify above).
  // An unreadable balance creates the job as before; the runner withholds.
  const pre = await preflightJob({ wallet: addr, compiled, ask })
  if (pre.kind === 'short') {
    return NextResponse.json(
      {
        error: pre.reply,
        short: pre.short,
        ...(pre.clarify ? { clarify: pre.clarify } : {}),
        created: false,
        note: 'No job was created: the wallet cannot fund the first step. Fund it, or re-POST one of the clarify options\' resume strings as the ask.',
      },
      { status: 400 },
    )
  }

  // Our own harness/drill run (lib/internal-run.ts) — the arc never counts it.
  const job = await createJob(addr, compiled, 'api', { internal: isInternalRun(req.headers, body) })
  await advanceJob(job).catch(() => {})
  const fresh = await prisma.job.findUnique({ where: { id: job.id }, include: { steps: { orderBy: { seq: 'asc' } } } })
  const internalRun = isInternalRun(req.headers, body)
  return NextResponse.json({ job: fresh, ...(internalRun ? { internal: true } : {}) }, { status: 201 })
}

// dryRun=true: the plan preview. Step 1 is built + guard-checked against LIVE
// venues; nothing is persisted and nothing can be signed.
async function dryRunAnswer(addr: string, compiled: CompiledJob, ask: string, unfillable: string | null): Promise<NextResponse> {
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
  // The same pre-flight a real POST runs (lib/job-preflight), reported so an
  // agent that validates first is not told "re-POST to run it" about a job
  // the wallet cannot start.
  const pre = unfillable ? null : await preflightJob({ wallet: addr, compiled, ask })
  const short = pre?.kind === 'short' ? pre : null
  // The preview tells the truth: a step the wallet cannot fund is `refused`
  // with the shortfall, even when the venue would quote it for any address
  // (a swap or a bridge builds for an empty wallet; the offer gate withholds).
  if (short && !preview.refused) preview = { step: first, refused: short.reply.replace(/^[^\w]+/, '') }
  return NextResponse.json({
    dryRun: true,
    title: compiled.title,
    steps: compiled.steps.map((s, i) => ({ seq: i, kind: s.kind, builder: s.builder, title: s.title, waitPredicate: s.waitPredicate ?? null })),
    firstSignPreview: preview,
    ...(unfillable ? { unfillable } : {}),
    ...(short ? { preflight: { short: short.short, reply: short.reply, ...(short.clarify ? { clarify: short.clarify } : {}) } } : {}),
    note: unfillable
      ? `This plan would move money and then fail: ${unfillable} A real POST is refused.`
      : short
        ? 'The wallet cannot fund the first step, so a real POST is refused and no job is created. See preflight for the shortfall and the asks that work for this wallet.'
        : 'Nothing was created or signed — re-POST without dryRun to run it.',
  })
}
