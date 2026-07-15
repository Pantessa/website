// Read-only job execution log for the public /p/[slug] share page. Jobs
// persist every step server-side (jobs + job_steps), so a shared chat can
// show the FULL settlement story — what was signed, what each guardrail
// checked, and where every transaction landed on-chain — long after the
// live JobCard's polling session is gone. Server-renderable: no hooks,
// native <details> for the guard reports.

import { CheckCircle2, XCircle, Circle, ShieldCheck, ExternalLink, Timer } from 'lucide-react'
import { chainById } from '@/lib/chains'

export interface SharedJobStep {
  seq: number
  kind: string
  status: string
  title: string
  valueUsd: number | null
  artifact: unknown
  guardReport: unknown
  result: unknown
  updatedAt: Date
}

export interface SharedJob {
  id: string
  title: string
  status: string
  valueUsd: number | null
  failReason: string | null
  createdAt: Date
  updatedAt: Date
  steps: SharedJobStep[]
}

interface StepTx {
  hash: string
  chainId: number
  title?: string
}

interface GuardCheck {
  id?: string
  ok?: boolean
  note?: string
  /** 'block' checks fail the build; 'warn' checks are disclosures. */
  level?: string
}

/** Every on-chain transaction a step settled with. Prefers the full set the
 * card records per sub-step (result.txs); falls back to the single final
 * confirmation hash older steps stored, with the chain read off the built
 * artifact. */
function txsOf(step: SharedJobStep): StepTx[] {
  const result = (step.result ?? {}) as { txs?: unknown; txHash?: unknown }
  if (Array.isArray(result.txs)) {
    const txs = result.txs.filter(
      (t): t is StepTx =>
        !!t && typeof t === 'object' && typeof (t as StepTx).hash === 'string' && typeof (t as StepTx).chainId === 'number',
    )
    if (txs.length > 0) return txs
  }
  if (typeof result.txHash !== 'string' || !result.txHash) return []
  const chainSteps = (step.artifact as { txChain?: { steps?: Array<{ tx?: { chainId?: number }; title?: string }> } } | null)
    ?.txChain?.steps
  const last = Array.isArray(chainSteps) && chainSteps.length > 0 ? chainSteps[chainSteps.length - 1] : undefined
  const single = (step.artifact as { txRequest?: { chainId?: number } } | null)?.txRequest
  return [
    {
      hash: result.txHash,
      chainId: last?.tx?.chainId ?? single?.chainId ?? 8453,
      title: last?.title,
    },
  ]
}

function guardChecksOf(step: SharedJobStep): GuardCheck[] {
  const checks = (step.guardReport as { checks?: unknown } | null)?.checks
  if (!Array.isArray(checks)) return []
  return checks.filter((c): c is GuardCheck => !!c && typeof c === 'object')
}

function waitNoteOf(step: SharedJobStep): string {
  const r = step.result as { status?: unknown; detail?: unknown; positionNote?: unknown; error?: unknown } | null
  if (!r || typeof r !== 'object') return ''
  const note = r.positionNote ?? r.status ?? r.detail ?? (step.status === 'failed' ? r.error : undefined)
  return typeof note === 'string' ? note : ''
}

function explorerUrlOf(step: SharedJobStep): string | null {
  const u = (step.result as { explorerUrl?: unknown } | null)?.explorerUrl
  return typeof u === 'string' && u.startsWith('https://') ? u : null
}

function shortHash(hash: string): string {
  return `${hash.slice(0, 10)}…${hash.slice(-6)}`
}

function fmtDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return ''
  const s = Math.round(ms / 1000)
  if (s < 60) return `${s}s`
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, '0')}s`
}

function fmtTime(d: Date): string {
  return `${d.toISOString().slice(11, 19)} UTC`
}

function StatusIcon({ status, kind }: { status: string; kind: string }) {
  if (status === 'done') return <CheckCircle2 className="w-4 h-4 text-emerald-400 flex-shrink-0" aria-hidden />
  if (status === 'failed') return <XCircle className="w-4 h-4 text-red-400 flex-shrink-0" aria-hidden />
  if (status === 'skipped') return <Circle className="w-3.5 h-3.5 text-[color:var(--line-2)] flex-shrink-0" aria-hidden />
  return <Circle className={`w-3.5 h-3.5 flex-shrink-0 ${kind === 'wait' ? 'text-[color:var(--muted)]' : 'text-[color:var(--line-2)]'}`} aria-hidden />
}

/** Renders a completed (or in-flight) job's step-by-step settlement log with
 * per-transaction explorer links. Rendered under the assistant message that
 * compiled the job. */
export default function SharedJobLog({ job }: { job: SharedJob }) {
  const steps = [...job.steps].sort((a, b) => a.seq - b.seq)
  const signed = steps.filter((s) => s.kind === 'sign' && s.status === 'done')
  const txCount = steps.reduce((n, s) => n + txsOf(s).length, 0)
  const chains = new Set(steps.flatMap((s) => txsOf(s).map((t) => t.chainId)))
  const duration = fmtDuration(job.updatedAt.getTime() - job.createdAt.getTime())

  const headline =
    job.status === 'done'
      ? '✓ complete'
      : job.status === 'failed'
        ? 'failed'
        : job.status === 'canceled'
          ? 'canceled'
          : 'in progress'

  return (
    <div className="mt-2.5 rounded-xl border border-[var(--line)] overflow-hidden text-left">
      {/* header */}
      <div className="flex items-center justify-between gap-2 px-3 py-2 border-b border-[var(--line)] bg-[color:color-mix(in_srgb,var(--fg)_3%,transparent)]">
        <span className="flex items-center gap-2 min-w-0">
          <ShieldCheck className="w-4 h-4 flex-shrink-0 text-[color:var(--muted)]" aria-hidden />
          <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] flex-shrink-0">
            Execution log
          </span>
          <span className="text-[12.5px] truncate text-[color:var(--fg)]">{job.title}</span>
        </span>
        <span
          className={`text-[11px] mono flex-shrink-0 ${
            job.status === 'done' ? 'text-emerald-400' : job.status === 'failed' ? 'text-red-400' : 'text-[color:var(--muted)]'
          }`}
        >
          {headline}
        </span>
      </div>

      <div className="px-3 py-2 space-y-1.5">
        {steps.map((step) => {
          const txs = txsOf(step)
          const checks = guardChecksOf(step)
          const passed = checks.filter((c) => c.ok !== false).length
          // A warn-level miss is a disclosure the guard chose to allow (e.g.
          // "one exact-amount approval attached") — not a failed check.
          // Summarize it as an advisory so "7/8 passed" never reads as a
          // failure on a build every gate actually cleared.
          const advisories = checks.filter((c) => c.ok === false && c.level === 'warn').length
          const failed = checks.length - passed - advisories
          const guardSummary =
            failed > 0
              ? `${passed}/${checks.length} guardrail checks passed`
              : advisories > 0
                ? `${passed + advisories} guardrail checks · ${advisories} advisory`
                : `${passed} guardrail checks passed`
          const note = txs.length === 0 ? waitNoteOf(step) : ''
          const external = txs.length === 0 ? explorerUrlOf(step) : null
          return (
            <div key={step.seq} className="text-[12.5px]">
              <div className="flex items-center gap-2">
                <StatusIcon status={step.status} kind={step.kind} />
                <span className={step.status === 'pending' ? 'text-[color:var(--muted-2)]' : 'text-[color:var(--fg)]'}>
                  {step.title}
                </span>
                {step.valueUsd != null && (
                  <span className="mono text-[11px] text-[color:var(--muted)]">${step.valueUsd.toFixed(2)}</span>
                )}
                {step.kind !== 'sign' && (
                  <span className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">{step.kind}</span>
                )}
                {step.status === 'done' && (
                  <span className="mono text-[10px] text-[color:var(--muted-2)] ml-auto flex-shrink-0 hidden sm:inline">
                    {fmtTime(step.updatedAt)}
                  </span>
                )}
              </div>

              {/* every settled transaction, linked to its chain's explorer */}
              {txs.length > 0 && (
                <ul className="ml-6 mt-0.5 space-y-0.5">
                  {txs.map((tx) => {
                    const chain = chainById(tx.chainId)
                    return (
                      <li key={tx.hash} className="flex items-center gap-1.5 text-[11px] mono text-[color:var(--muted)] min-w-0">
                        <span className="text-[color:var(--muted-2)] flex-shrink-0">↳</span>
                        {tx.title && <span className="truncate">{tx.title}</span>}
                        <a
                          href={`${chain?.explorerTx ?? 'https://basescan.org/tx/'}${tx.hash}`}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="flex-shrink-0 inline-flex items-center gap-1 underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)] transition-colors"
                          title={`View on ${chain?.name ?? 'the block explorer'}`}
                        >
                          {shortHash(tx.hash)}
                          <ExternalLink className="w-3 h-3" aria-hidden />
                        </a>
                        {chain && <span className="text-[color:var(--muted-2)] flex-shrink-0">{chain.name}</span>}
                      </li>
                    )
                  })}
                </ul>
              )}

              {/* wait/auto outcomes (settlement checks, HL fills) */}
              {note && (
                <div className={`ml-6 mt-0.5 text-[11px] ${step.status === 'failed' ? 'text-red-400' : 'text-[color:var(--muted-2)]'}`}>
                  {external ? (
                    <a href={external} target="_blank" rel="noopener noreferrer" className="underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)]">
                      {note.slice(0, 180)}
                    </a>
                  ) : (
                    note.slice(0, 180)
                  )}
                </div>
              )}

              {/* the guardrail story — every check the build passed before it was offered */}
              {checks.length > 0 && (
                <details className="ml-6 mt-0.5 text-[11px] mono">
                  <summary className="cursor-pointer text-[color:var(--muted-2)] hover:text-[color:var(--fg)] select-none list-none inline-flex items-center gap-1">
                    <ShieldCheck className="w-3 h-3" aria-hidden />
                    {guardSummary}
                  </summary>
                  <ul className="mt-1 pl-4 space-y-0.5 text-[color:var(--muted-2)] [overflow-wrap:anywhere]">
                    {checks.map((c, i) => (
                      <li key={c.id ?? i}>
                        <span className={c.ok !== false ? 'text-emerald-400' : 'text-amber-400'}>{c.ok !== false ? '✓' : '⚠'}</span>{' '}
                        {c.note ?? c.id}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
            </div>
          )
        })}

        {/* footer: the money-moved line marketing screenshots */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 pt-1.5 border-t border-[var(--line)] text-[11px] mono text-[color:var(--muted-2)]">
          {job.status === 'failed' && job.failReason ? (
            <span className="text-red-400">{job.failReason.slice(0, 160)}</span>
          ) : (
            <>
              {job.valueUsd != null && job.valueUsd > 0 && (
                <span className="text-[color:var(--fg)]">Money moved: ${job.valueUsd.toFixed(2)}</span>
              )}
              {signed.length > 0 && <span>{signed.length} signed step{signed.length === 1 ? '' : 's'}</span>}
              {txCount > 0 && <span>{txCount} transaction{txCount === 1 ? '' : 's'} on-chain</span>}
              {chains.size > 1 && <span>{chains.size} chains</span>}
              {duration && job.status === 'done' && (
                <span className="inline-flex items-center gap-1">
                  <Timer className="w-3 h-3" aria-hidden />
                  {duration}
                </span>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
