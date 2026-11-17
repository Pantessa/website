// lib/job-status.ts — how a job's END reads, and what a stopped step can do next.
//
// Squad lane1 (the jobs audit, 2026-11-17). Two findings from prod's job rows:
//
//   1. 61 of 115 "failed" jobs were only `expired — the job sat untouched for
//      7 days`. Nothing broke: an offer was never signed. They were drawn in
//      red beside real failures. An expired job is its own, neutral state.
//      No schema change: the row stays `status: 'failed'` and the reason
//      starts with "expired" (lib/jobs-runner advanceJobs writes it).
//
//   2. Real failures were mostly a wallet short of what one step spends
//      ("Insufficient USDC on Base", "No free collateral on the Hyperliquid
//      account", "holds only 0 USDC on Arbitrum"). A shortfall the builder
//      can name is not a failure: the runner WITHHOLDS such a step (the job
//      stays live and re-checks), and the card offers the fix as a chip.
//
// PURE and client-safe: no server imports, no I/O. The card, the rail and the
// runner all read the same rules from here.

import { jobStatusWord, statusTone } from '@/lib/step-status'

export interface JobEndLike {
  status: string
  failReason?: string | null
}

/** A job that aged out with an offer nobody signed. Nothing was signed or
 *  spent, and asking again rebuilds it fresh. */
export function jobExpired(job: JobEndLike): boolean {
  return job.status === 'failed' && /^\s*expired\b/i.test(job.failReason ?? '')
}

/** The status a surface should DRAW: `expired` for an aged-out job, the row's
 *  own status otherwise. */
export function jobDisplayStatus(job: JobEndLike): string {
  return jobExpired(job) ? 'expired' : job.status
}

/** The word for the status pill ("expired", "failed", "needs your signature"…). */
export function jobDisplayWord(job: JobEndLike): string {
  return jobExpired(job) ? 'expired' : jobStatusWord(job.status)
}

/** The tone (a CSS color value): an expired job is muted, never the fail red. */
export function jobDisplayTone(job: JobEndLike): string {
  return jobExpired(job) ? 'var(--muted-2)' : statusTone(job.status)
}

/** Does this job's end deserve attention (a badge, a red row, a "needs you"
 *  count)? Only a real failure does. An expired job never nags. */
export function jobFailedForReal(job: JobEndLike): boolean {
  return job.status === 'failed' && !jobExpired(job)
}

/** The one sentence under an expired job. */
export const JOB_EXPIRED_LINE = 'Expired unsigned after 7 days. Nothing was signed or spent. Ask again to rebuild it fresh.'

// ── A shortfall the builder can name ────────────────────────────────────────

export type StepShortKind = 'funds' | 'hl-collateral'

export interface StepShortfall {
  kind: StepShortKind
  /** What the step is short of, when the words say ("USDC"). */
  symbol?: string
  /** Where ("Base", "Arbitrum"). */
  chain?: string
}

/**
 * Read a builder's refusal: is it "the wallet does not hold enough for this
 * step"? Anchored on the exact sentences the builders write (pinned in
 * scripts/jobs-preflight-pins.ts), so a guard refusal, a venue miss or a
 * policy block never reads as a shortfall.
 */
export function shortfallOfRefusal(message: string | null | undefined): StepShortfall | null {
  const text = String(message ?? '')
  if (!text) return null
  // lib/lifi-bridge balance check: "Insufficient USDC on Base: this leg needs $2 …"
  const leg = text.match(/\bInsufficient ([A-Za-z0-9.]+) on ([A-Za-z][A-Za-z ]*?): this leg needs\b/)
  if (leg) return { kind: 'funds', symbol: leg[1], chain: leg[2].trim() }
  // lib/hyperliquid-exec deposit guard: "Wallet holds only 0 USDC on Arbitrum — bridge funds there first"
  const dep = text.match(/\bWallet holds only [\d.,]+ ([A-Za-z0-9.]+) on ([A-Za-z]+)\b/)
  if (dep) return { kind: 'funds', symbol: dep[1], chain: dep[2] === 'mainnet' ? 'Ethereum' : dep[2] }
  // lib/jobs-runner funded buy: "The wallet holds only 1.20 USDG on the chain — not enough to buy $10 of AAPL."
  const buy = text.match(/\bThe wallet holds only [\d.,]+ ([A-Za-z0-9.]+) on the chain\b/)
  if (buy) return { kind: 'funds', symbol: buy[1] }
  // lib/hyperliquid-exec has-collateral guard (and its older wording on prod rows).
  if (/\bNo (?:free|withdrawable) collateral on the Hyperliquid account\b/i.test(text)) return { kind: 'hl-collateral' }
  // lib/affordability's own refusal, when a failed row carries it.
  const gate = text.match(/\bNothing to sign yet: this would spend [\d.,]+ ([A-Za-z0-9.]+) on ([A-Za-z][A-Za-z ]*?) and the wallet holds\b/)
  if (gate) return { kind: 'funds', symbol: gate[1], chain: gate[2].trim() }
  return null
}

// ── The fix, as a chip ──────────────────────────────────────────────────────

export interface JobStepLike {
  seq: number
  kind: string
  status: string
  builder: string
  params?: unknown
  result?: unknown
}

export interface JobFixChip {
  label: string
  /** An ask the chat builds on its own (it scans the wallet and plans the
   *  money from where it is, or opens the card door). Prefilled, never sent. */
  resume: string
}

export interface StepFix {
  seq: number
  shortfall: StepShortfall
  /** The step can be tried again on this job (a top-up happened outside it). */
  retry: boolean
  chips: JobFixChip[]
}

const dollars = (n: number): string => (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(/0+$/, '').replace(/\.$/, ''))

/** The smallest Hyperliquid deposit the bridge credits (lib/hyperliquid-exec
 *  HL_MIN_DEPOSIT_USDC; kept as a literal so this file stays client-safe —
 *  the pins hold the two together). */
export const JOB_FIX_HL_MIN_DEPOSIT_USDC = 5

function hlDepositFor(step: JobStepLike): number {
  const p = (step.params ?? {}) as { kind?: unknown; amountUsdc?: unknown; notionalUsd?: unknown; leverage?: unknown }
  if (p.kind === 'deposit' && Number(p.amountUsdc) > 0) return Number(p.amountUsdc)
  const notional = Number(p.notionalUsd)
  const lev = Number(p.leverage) > 0 ? Number(p.leverage) : 3
  const target = notional > 0 ? Math.ceil((notional / lev) * 100) / 100 : 0
  return Math.max(JOB_FIX_HL_MIN_DEPOSIT_USDC, target)
}

/**
 * The fix for the step a job stopped on, when the stop is a shortfall.
 *
 * Every chip is a LONE ask the chat already answers from the wallet in front
 * of it: "Buy $10 of AAPL" scans every funding chain and plans the move (or
 * opens the card door); "deposit 6 USDC to Hyperliquid" does the same for
 * collateral. So a chip is never the sentence that just failed, and never a
 * guess about where this wallet's money is.
 *
 * Returns null when the job did not stop on a shortfall.
 */
export function stepFixFor(job: JobEndLike & { steps: JobStepLike[] }): StepFix | null {
  if (jobExpired(job)) return null
  const step =
    job.steps.find((s) => s.status === 'failed') ??
    job.steps.find((s) => s.status === 'pending' && (s.result as { withheld?: unknown; withheldKind?: unknown } | null)?.withheld === true && (s.result as { withheldKind?: unknown }).withheldKind !== 'rpc')
  if (!step) return null
  const shortfall = shortfallOfRefusal((step.result as { error?: unknown } | null)?.error as string | undefined) ?? (job.status === 'failed' ? shortfallOfRefusal(job.failReason) : null)
  if (!shortfall) return null
  const chips: JobFixChip[] = []
  const push = (label: string, resume: string) => {
    if (!chips.some((c) => c.resume.toLowerCase() === resume.toLowerCase())) chips.push({ label, resume })
  }
  if (step.builder === 'native-hl-exec') {
    const usdc = dollars(hlDepositFor(step))
    push(`Deposit ${usdc} USDC to Hyperliquid`, `deposit ${usdc} USDC to Hyperliquid`)
  } else if (step.builder === 'native-lifi-fund' || step.builder === 'native-lifi-swap') {
    // The buy the funding legs exist for: asked alone, the chat plans it from
    // wherever this wallet actually holds money.
    const buy = job.steps.find((s) => s.builder === 'native-lifi-swap')
    const p = (buy?.params ?? {}) as { buyUsd?: unknown; buyToken?: unknown }
    if (Number(p.buyUsd) > 0 && typeof p.buyToken === 'string' && /^[A-Za-z0-9.]{1,12}$/.test(p.buyToken)) {
      const what = `$${dollars(Number(p.buyUsd))} of ${p.buyToken.toUpperCase()}`
      push(`Buy ${what} from what this wallet holds`, `Buy ${what}`)
    }
  }
  return { seq: step.seq, shortfall, retry: job.status === 'failed', chips: chips.slice(0, 2) }
}
