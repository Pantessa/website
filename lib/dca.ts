// ─────────────────────────────────────────────────────────────────────────
//  DCA — recurring buys, the pure half (grammar + period math + chip
//  contract). CONFIRM-MODE by design: a schedule never signs anything. Each
//  due period compiles into a ONE-STEP job (the shared native-swap builder,
//  lib/swap-exec.ts), built fresh at offer time and signed by the user —
//  same guardrails, receipts, and money-moved accounting as any swap.
//
//  Grammar style follows lib/jobs.ts: narrow regexes, deterministic or
//  nothing. The due-period chip's resume string is the contract — it must
//  round-trip through parseDcaRun (harness-checked), exactly like the
//  funding plan's chips round-trip through compileJobAsk.
// ─────────────────────────────────────────────────────────────────────────

import { chainAlt, canonicalChainWord, normalizeChainWords } from './chain-lexicon'

export type DcaCadence = 'day' | 'week' | 'month'

export interface DcaCreateAsk {
  buyUsd: number
  /** Token symbol as typed (upper-cased); resolved per-build from the
   *  chain's official token list, never a local registry. */
  buyToken: string
  cadence: DcaCadence
  /** Chain named in the message (first-class chains only), else null —
   *  the turn resolves it (message > picker > where the token resolves). */
  chainId: number | null
}

export interface DcaManageAsk {
  op: 'pause' | 'resume' | 'cancel' | 'list'
  /** Optional token filter ("pause my AAPL dca"). */
  token: string | null
}

// First-class chain words (mirror of lib/jobs.ts SWAP_SEG_CHAINS — job steps
// and schedules must never guess their chain).
const DCA_CHAINS: Record<string, number> = {
  base: 8453,
  arbitrum: 42161,
  arb: 42161,
  ethereum: 1,
  mainnet: 1,
  robinhood: 4663,
  'robinhood chain': 4663,
}

// Typo-tolerant native-chain words (shared lexicon); the capture
// canonicalizes before the DCA_CHAINS lookup.
const CHAIN_WORD_RE = new RegExp(String.raw`\bon\s+(${chainAlt(['base', 'ethereum', 'arbitrum', 'optimism', 'robinhood'])})\b`, 'i')

const CADENCE_RES: Array<[DcaCadence, RegExp]> = [
  ['day', /\b(?:daily|every\s+day|each\s+day)\b/i],
  ['week', /\b(?:weekly|every\s+week|each\s+week|every\s+(?:mon|tues|wednes|thurs|fri|satur|sun)day)\b/i],
  ['month', /\b(?:monthly|every\s+month|each\s+month)\b/i],
]

export function parseCadence(message: string): DcaCadence | null {
  for (const [cadence, re] of CADENCE_RES) if (re.test(message)) return cadence
  return null
}

// "buy $10 of AAPL every week" / "dca $25 into ETH daily" / "dollar cost
// average $50 into WETH monthly on base". Dollar-denominated ONLY — the
// schedule's contract is "spend $X of the chain's stable per period", so a
// token-unit ask ("buy 10 AAPL every week") gets an honest problem, not a
// guess at a price.
const CREATE_RE =
  /\b(?:buy|dca(?:\s+in(?:to)?)?|dollar[\s-]cost[\s-]average)\s+\$(\d+(?:\.\d+)?)(?:\s+(?:worth|of|into|in))*\s+\$?([A-Za-z]{2,12})\b/i
const CREATE_TOKEN_UNITS_RE =
  /\b(?:buy|dca(?:\s+in(?:to)?)?|dollar[\s-]cost[\s-]average)\s+(\d+(?:\.\d+)?)\s+([A-Za-z]{2,12})\b/i
// The noun form strangers type: "set up a weekly $10 ETH buy", "a $10 ETH
// purchase every week" (squad 2026-08-18 ask inventory — fell to the
// planner). Same contract: dollars + token + cadence, verb trailing.
const CREATE_NOUN_RE = /\$(\d+(?:\.\d+)?)(?:\s+(?:worth|of|in))*\s+\$?([A-Za-z]{2,12})\s+(?:buy|purchase|dca)\b/i

export function parseDcaCreate(message: string): DcaCreateAsk | { problem: string } | null {
  const cadence = parseCadence(message)
  if (!cadence) return null
  const m = message.match(CREATE_RE) ?? message.match(CREATE_NOUN_RE)
  if (!m) {
    // Recurring intent but token-unit sizing — refuse honestly rather than
    // guess a price ("buy 10 AAPL every week" ≠ a fixed dollar spend).
    const units = message.match(CREATE_TOKEN_UNITS_RE)
    if (units && !/\$/.test(units[1])) {
      return {
        problem: `Recurring buys are sized in dollars (a fixed spend per period, like Uniswap's DCA). Say "buy $${units[1]} of ${units[2].toUpperCase()} ${cadenceLabel(cadence)}" and I'll set it up.`,
      }
    }
    return null
  }
  const buyUsd = Number(m[1])
  if (!Number.isFinite(buyUsd) || buyUsd <= 0) return null
  if (buyUsd > 10_000) return { problem: `$${buyUsd} per period is above the $10,000 recurring-buy cap — pick a smaller amount.` }
  const buyToken = m[2].toUpperCase()
  // The stable is what we SPEND — "dca $10 into USDG" is a no-op ask.
  if (/^(USDC|USDG|USDT|DAI)$/i.test(buyToken)) {
    return { problem: `A recurring buy spends the chain's stable — buying ${buyToken} with itself is a no-op. Name the token to accumulate (e.g. "buy $${buyUsd} of ETH weekly").` }
  }
  const cw = normalizeChainWords(message).match(CHAIN_WORD_RE)
  const cwWord = cw ? cw[1].toLowerCase().replace(/\s+/g, ' ') : null
  const chainId = cwWord ? (DCA_CHAINS[canonicalChainWord(cwWord) ?? cwWord] ?? null) : null
  return { buyUsd, buyToken, cadence, chainId }
}

// The due-period chip's resume string — THE contract. Emitted by
// dcaRunChip(), parsed back here; narrow on purpose.
const RUN_RE = /\brun\s+my\b.*\bdca\b.*\(schedule\s+([a-z0-9]{8,40})\)/i

export function parseDcaRun(message: string): { scheduleId: string } | null {
  const m = message.match(RUN_RE)
  return m ? { scheduleId: m[1] } : null
}

// "pause my dca" / "cancel my AAPL dca" / "list my recurring buys".
const MANAGE_RE = /\b(pause|resume|unpause|cancel|stop|delete)\s+(?:my\s+)?(?:([A-Za-z]{2,12})\s+)?(?:dca|recurring\s+buys?)\b/i
const LIST_RE = /\b(?:show|list|view|what(?:'s| is| are))\s+(?:me\s+)?(?:my\s+)?(?:dcas?|recurring\s+buys?)\b/i

export function parseDcaManage(message: string): DcaManageAsk | null {
  if (LIST_RE.test(message) || /\bmy\s+dcas\b/i.test(message)) return { op: 'list', token: null }
  const m = message.match(MANAGE_RE)
  if (!m) return null
  const verb = m[1].toLowerCase()
  const op: DcaManageAsk['op'] = verb === 'pause' ? 'pause' : verb === 'resume' || verb === 'unpause' ? 'resume' : 'cancel'
  const token = m[2] && !/^(my|the|a)$/i.test(m[2]) ? m[2].toUpperCase() : null
  return { op, token }
}

// ── Period math (UTC calendar periods — missed periods lapse, no catch-up) ──

export function periodKeyFor(cadence: DcaCadence, at: Date = new Date()): string {
  if (cadence === 'day') return at.toISOString().slice(0, 10)
  if (cadence === 'month') return at.toISOString().slice(0, 7)
  // ISO-8601 week (UTC): Thursday of the current week decides the year.
  const d = new Date(Date.UTC(at.getUTCFullYear(), at.getUTCMonth(), at.getUTCDate()))
  const dayNum = d.getUTCDay() || 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum)
  const yearStart = Date.UTC(d.getUTCFullYear(), 0, 1)
  const week = Math.ceil(((d.getTime() - yearStart) / 86_400_000 + 1) / 7)
  return `${d.getUTCFullYear()}-W${String(week).padStart(2, '0')}`
}

export function cadenceLabel(cadence: DcaCadence): string {
  return cadence === 'day' ? 'daily' : cadence === 'week' ? 'weekly' : 'monthly'
}

/** "today's" / "this week's" / "this month's" — the chip label's period word. */
export function periodPhrase(cadence: DcaCadence): string {
  return cadence === 'day' ? "today's" : cadence === 'week' ? "this week's" : "this month's"
}

// ── The one-step buy job ────────────────────────────────────────────────────

import type { CompiledJob } from '@/lib/jobs'
import { chainById } from '@/lib/chains'

/** The one-step compiled job a due period produces — the SAME native-swap
 *  builder + venue cascade (v3 → v4 → LiFi) chat and the panel use, so the
 *  buy is built fresh at offer time with full guardrails. Spend is the
 *  chain's primary stable, so amountHuman ≈ dollars by construction. */
export function compileDcaBuy(s: {
  buyUsd: number
  buyToken: string
  sellToken: string
  chainId: number
  cadence: DcaCadence
}): CompiledJob {
  const chainName = chainById(s.chainId)?.name ?? `chain ${s.chainId}`
  return {
    title: `DCA: buy $${s.buyUsd} of ${s.buyToken} on ${chainName} (${cadenceLabel(s.cadence)})`,
    steps: [
      {
        kind: 'sign',
        builder: 'native-swap',
        title: `Buy ${periodPhrase(s.cadence)} $${s.buyUsd} of ${s.buyToken}`,
        params: { sellToken: s.sellToken, buyToken: s.buyToken, amountHuman: s.buyUsd.toFixed(2), chainId: s.chainId },
      },
    ],
  }
}

// ── The chip contract ───────────────────────────────────────────────────────

export interface DcaChipSchedule {
  id: string
  buyUsd: number
  buyToken: string
  cadence: DcaCadence
}

/** The due-period one-tap chip. `resume` MUST parse back via parseDcaRun —
 *  the chip is the contract (harness-checked round-trip). */
export function dcaRunChip(s: DcaChipSchedule): { label: string; prompt: string } {
  return {
    label: `Buy ${periodPhrase(s.cadence)} $${s.buyUsd} of ${s.buyToken}`,
    prompt: `Run my $${s.buyUsd} ${s.buyToken} dca (schedule ${s.id})`,
  }
}
