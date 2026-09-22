// ─────────────────────────────────────────────────────────────────────────
//  Cross-chain settlement — the card tells the truth AFTER the signature.
//
//  Live 2026-09-22 (prod chat /p/vs2fyAlM_3Fl): a single-turn NEAR Intents
//  swap ("Swap 1 USDC · Base → Ethereum") showed Sign → Broadcast →
//  Confirmed, "Confirmed on-chain", and the "✍️ signed & settled" share row
//  the moment the DEPOSIT transaction confirmed on Base. The venue never
//  delivered: 1Click's own status for that deposit address reads REFUNDED,
//  refundReason INTENT_SUBMIT_FAILED, 0.9976 USDC back on Base. Nothing
//  reached Ethereum, and the only way the user found out was noticing that
//  their Ethereum USDC never moved.
//
//  The deposit confirming is the START of a cross-chain swap, not the end.
//  The jobs runner already knew that (lib/jobs-runner.ts, wait predicate
//  `oneclick`) and so did the funding refusals (lib/inflight-funding.ts) —
//  only the lone chat card claimed settlement it had never checked.
//
//  This module is the pure half: read the deposit out of a message's meta,
//  turn one `check_status` payload into an outcome, and compose the words
//  the card and the share page print. Nothing here fetches, and every claim
//  is the venue's — "settled" is only ever said when it says SUCCESS.
//
//  One correction we make on the venue's behalf: on a REFUND the refund
//  transaction arrives in `destinationTransactions` with a DESTINATION-chain
//  explorer link (measured 2026-09-22: Base tx 0x779b… linked to
//  etherscan.io), but refunds return to the refund address on the ORIGIN
//  chain — verified on-chain, that hash exists on Base and not Ethereum. We
//  build the link from the origin chain and never print the venue's.
// ─────────────────────────────────────────────────────────────────────────

import { chainByKey } from '@/lib/chains'
import { prettyChainWord } from '@/lib/chain-lexicon'

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const HASH_RE = /^0x[0-9a-fA-F]{64}$/

/** The cross-chain deposit a message's working context carries (the `xchain`
 *  pending written by lib/cross-chain-swap crossChainPending). */
export interface XchainDeposit {
  depositAddress: string
  amount: string
  originToken: string
  /** Canonical chain words ("base", "ethereum") — registry keys where EVM. */
  originChain: string
  destinationToken: string
  destinationChain: string
}

export type SettlementStatus =
  | 'awaiting-deposit'
  | 'settling'
  | 'success'
  | 'refunded'
  | 'failed'
  | 'unknown'

/** What the venue says happened to one cross-chain swap. Persisted on the
 *  message as `meta.settlement`, so the share page reads the same outcome. */
export interface SettlementOutcome {
  status: SettlementStatus
  /** Terminal = stop polling; the venue will not change its mind. */
  terminal: boolean
  /** The venue's own status word, verbatim ("REFUNDED"). */
  venueStatus?: string
  /** Formatted amount delivered on the destination chain (SUCCESS). */
  delivered?: string
  /** Formatted amount returned to the refund wallet (REFUNDED/FAILED). */
  refunded?: string
  /** The venue's refund code, verbatim ("INTENT_SUBMIT_FAILED"). */
  refundReason?: string
  /** The delivery tx (SUCCESS) or the refund tx (REFUNDED/FAILED). */
  txHash?: string
  /** Registry key of the chain that tx is ON — delivery: destination;
   *  refund: ORIGIN (see the header note). Absent for non-EVM chains. */
  txChain?: string
  /** Explorer link when we can build one ourselves, else the venue's. */
  txUrl?: string
  /** The venue's updatedAt, when it gave one. */
  at?: string
}

// ── Reading a message's meta ────────────────────────────────────────────────

/**
 * The cross-chain deposit this assistant turn built, from the echoed working
 * context. Conservative: a well-formed one-time deposit address and both
 * chain words, or null — a turn with no deposit is an ordinary tx card and
 * nothing on this path applies to it.
 */
export function xchainDepositOf(meta: unknown): XchainDeposit | null {
  if (!meta || typeof meta !== 'object') return null
  const wc = (meta as { workingContext?: unknown }).workingContext
  if (!wc || typeof wc !== 'object') return null
  const pending = (wc as { pending?: unknown }).pending
  if (!pending || typeof pending !== 'object') return null
  const p = pending as { kind?: unknown; data?: unknown }
  if (p.kind !== 'xchain' || !p.data || typeof p.data !== 'object') return null
  const d = p.data as Record<string, unknown>
  const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')
  const depositAddress = str(d.depositAddress)
  if (!ADDRESS_RE.test(depositAddress)) return null
  const originChain = str(d.originChain).toLowerCase()
  const destinationChain = str(d.destinationChain).toLowerCase()
  if (!originChain || !destinationChain) return null
  return {
    depositAddress,
    amount: str(d.amount),
    originToken: str(d.originToken).toUpperCase(),
    originChain,
    destinationToken: str(d.destinationToken).toUpperCase(),
    destinationChain,
  }
}

/** Narrow a message's persisted `meta.settlement` (user-era JSON). */
export function settlementOf(meta: unknown): SettlementOutcome | null {
  if (!meta || typeof meta !== 'object') return null
  const raw = (meta as { settlement?: unknown }).settlement
  if (!raw || typeof raw !== 'object') return null
  const s = raw as Record<string, unknown>
  if (!isSettlementStatus(s.status)) return null
  const str = (v: unknown, n = 120) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, n) : undefined)
  return {
    status: s.status,
    terminal: s.terminal === true || isTerminal(s.status),
    venueStatus: str(s.venueStatus, 40),
    delivered: str(s.delivered, 60),
    refunded: str(s.refunded, 60),
    refundReason: str(s.refundReason, 60),
    txHash: typeof s.txHash === 'string' && HASH_RE.test(s.txHash) ? s.txHash : undefined,
    txChain: str(s.txChain, 20),
    txUrl: typeof s.txUrl === 'string' && /^https:\/\//.test(s.txUrl) ? s.txUrl.slice(0, 300) : undefined,
    at: str(s.at, 40),
  }
}

export function isSettlementStatus(v: unknown): v is SettlementStatus {
  return (
    v === 'awaiting-deposit' || v === 'settling' || v === 'success' || v === 'refunded' || v === 'failed' || v === 'unknown'
  )
}

/** SUCCESS / REFUNDED / FAILED are the venue's terminal states. */
export function isTerminal(status: SettlementStatus): boolean {
  return status === 'success' || status === 'refunded' || status === 'failed'
}

/**
 * The gate the whole fix hangs on: may this turn claim "signed & settled"?
 * A turn with no cross-chain deposit is unchanged (a same-chain swap settles
 * when its own transaction confirms). A cross-chain turn may claim it only
 * once the VENUE says SUCCESS — not when the deposit confirms, not while the
 * status is unknown, and never on a refund.
 */
export function claimsSettled(meta: unknown): boolean {
  if (!xchainDepositOf(meta)) return true
  return settlementOf(meta)?.status === 'success'
}

// ── Parsing one check_status payload ────────────────────────────────────────

const VENUE_STATUS: Record<string, SettlementStatus> = {
  SUCCESS: 'success',
  REFUNDED: 'refunded',
  FAILED: 'failed',
  PENDING_DEPOSIT: 'awaiting-deposit',
  KNOWN_DEPOSIT_TX: 'settling',
  PROCESSING: 'settling',
  INCOMPLETE_DEPOSIT: 'settling',
}

interface RawTx {
  hash?: unknown
  explorer?: unknown
}

/**
 * Turn the near-intents MCP's `check_status` payload into an outcome.
 * Pure and defensive: an unrecognized shape is 'unknown' (keep watching),
 * never an invented settlement. `signedHashes` are the deposit transactions
 * this browser already signed — they must never be mistaken for a refund.
 */
export function parseSwapStatus(
  payload: unknown,
  dep: Pick<XchainDeposit, 'originChain' | 'destinationChain'>,
  signedHashes: string[] = [],
): SettlementOutcome {
  if (!payload || typeof payload !== 'object') return { status: 'unknown', terminal: false }
  const p = payload as Record<string, unknown>
  const venueStatus = typeof p.status === 'string' ? p.status.toUpperCase() : ''
  const status = VENUE_STATUS[venueStatus] ?? 'unknown'
  const swap = (p.swap && typeof p.swap === 'object' ? p.swap : {}) as Record<string, unknown>
  const amount = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim().slice(0, 60) : typeof v === 'number' ? String(v) : undefined)

  const out: SettlementOutcome = {
    status,
    terminal: isTerminal(status),
    ...(venueStatus ? { venueStatus } : {}),
    ...(typeof p.updatedAt === 'string' && p.updatedAt ? { at: p.updatedAt.slice(0, 40) } : {}),
  }

  const known = new Set(signedHashes.filter((h) => typeof h === 'string').map((h) => h.toLowerCase()))
  const list = (v: unknown): RawTx[] => (Array.isArray(v) ? (v as RawTx[]) : [])
  const dest = list(swap.destinationTransactions)
  const origin = list(swap.originTransactions)
  const hashOf = (t: RawTx) => (typeof t?.hash === 'string' && HASH_RE.test(t.hash) ? t.hash.toLowerCase() : null)
  const urlOf = (t: RawTx) => (typeof t?.explorer === 'string' && /^https:\/\//.test(t.explorer) ? t.explorer : null)

  if (status === 'success') {
    out.delivered = amount(swap.delivered)
    const tx = dest.find((t) => hashOf(t))
    if (tx) {
      const hash = hashOf(tx)!
      out.txHash = hash
      // OUR link from the registry where the destination is an app chain;
      // the venue's own link is the fallback (Solana, Bitcoin, NEAR…).
      const chain = chainByKey(dep.destinationChain)
      out.txChain = chain?.key ?? undefined
      out.txUrl = chain ? `${chain.explorerTx}${hash}` : (urlOf(tx) ?? undefined)
    }
    return out
  }

  if (status === 'refunded' || status === 'failed') {
    out.refunded = amount(swap.refunded)
    const reason = typeof swap.refundReason === 'string' ? swap.refundReason.trim().slice(0, 60) : ''
    if (reason) out.refundReason = reason
    // The refund transaction: whichever hash the venue reports that ISN'T a
    // deposit this browser signed. It lands on the ORIGIN chain (the venue's
    // own explanation says so, and its explorer link is wrong), so the link
    // is ours or there is none — a wrong explorer link is worse than a hash.
    const candidate = [...dest, ...origin].map(hashOf).find((h): h is string => !!h && !known.has(h))
    if (candidate) {
      out.txHash = candidate
      const chain = chainByKey(dep.originChain)
      if (chain) {
        out.txChain = chain.key
        out.txUrl = `${chain.explorerTx}${candidate}`
      }
    }
    return out
  }

  return out
}

// ── Words ───────────────────────────────────────────────────────────────────

/** Plain-words gloss for the venue's refund code. The raw code always rides
 *  along, so an unmapped one is still actionable — never invented meaning. */
export function refundReasonWords(code: string | undefined): string | null {
  if (!code) return null
  const c = code.trim().toUpperCase()
  // Only codes we have actually seen the venue return are glossed — the raw
  // code is printed either way, so an unmapped one is still actionable and
  // nothing here invents a meaning for a string we have never read.
  const known: Record<string, string> = {
    INTENT_SUBMIT_FAILED: 'the venue could not submit the swap to its solvers, so nothing was exchanged',
    NO_LIQUIDITY: 'no solver would fill the route at the quoted size',
    PARTIAL_DEPOSIT: 'less than the quoted amount arrived at the deposit address',
    AMOUNT_LESS_THAN_MIN_AMOUNT_OUT: 'the fill would have landed under the quote’s minimum, so the venue returned the deposit instead',
  }
  return known[c] ?? null
}

export interface SettlementCopy {
  tone: 'ok' | 'warn' | 'muted'
  /** The headline line — "Delivered …", "Refunded: …", "Still settling". */
  line: string
  /** The second line: why, or what happens next. Absent when nothing to add. */
  detail?: string
  /** Label for the transaction link, when the outcome carries one. */
  txLabel?: string
}

/**
 * What the card (and the share page) prints for an outcome. The venue's
 * verdict in our words: delivered, refunded (with the reason), or still
 * settling. Never claims delivery it hasn't been told about.
 */
export function settlementCopy(outcome: SettlementOutcome, dep: XchainDeposit): SettlementCopy {
  const destWord = prettyChainWord(dep.destinationChain)
  const originWord = prettyChainWord(dep.originChain)
  switch (outcome.status) {
    case 'success': {
      const what = outcome.delivered
        ? `${outcome.delivered} ${dep.destinationToken}`.trim()
        : dep.destinationToken || 'your swap'
      return { tone: 'ok', line: `Delivered ${what} on ${destWord}`, txLabel: 'delivery' }
    }
    case 'refunded': {
      const what = outcome.refunded ? `${outcome.refunded} ${dep.originToken}`.trim() : `your ${dep.originToken || 'deposit'}`
      const why = refundReasonWords(outcome.refundReason)
      const code = outcome.refundReason
      return {
        tone: 'warn',
        line: `Refunded: ${what} came back to your wallet on ${originWord}`,
        detail: why
          ? `The swap never happened — ${why}${code ? ` (${code})` : ''}. Nothing reached ${destWord}. Ask again to build a fresh quote.`
          : `The swap never happened${code ? `, and the venue gave the reason as ${code}` : ''}. Nothing reached ${destWord}. Ask again to build a fresh quote.`,
      }
    }
    case 'failed': {
      const why = refundReasonWords(outcome.refundReason)
      return {
        tone: 'warn',
        line: outcome.refunded
          ? `Refunded: ${outcome.refunded} ${dep.originToken} came back to your wallet on ${originWord}`.trim()
          : `The swap failed — nothing was delivered on ${destWord}`,
        detail: outcome.refunded
          ? `The venue reported FAILED${why ? ` — ${why}` : ''}. Ask again to build a fresh quote.`
          : `The venue reported FAILED${outcome.refundReason ? ` (${outcome.refundReason})` : ''}. Your deposit returns to this wallet on ${originWord}; if it hasn't in a few minutes, the venue's correlation id for ${dep.depositAddress.slice(0, 10)}… is what support needs.`,
      }
    }
    case 'awaiting-deposit':
      return {
        tone: 'muted',
        line: 'Still settling',
        detail: `The venue hasn't seen the deposit yet. It usually spots a confirmed transfer within a minute; nothing is delivered on ${destWord} until it does.`,
      }
    case 'settling':
      return {
        tone: 'muted',
        line: 'Still settling',
        detail: `Deposit seen — solvers are filling the swap. Delivery on ${destWord} usually lands within a couple of minutes, and this line updates itself.`,
      }
    case 'unknown':
      return {
        tone: 'muted',
        line: 'Still settling',
        detail: `Waiting on the venue for this swap's outcome — nothing is delivered on ${destWord} until it says so.`,
      }
  }
}

/** One-line summary for the failures queue / a beacon detail field. */
export function settlementDetailLine(outcome: SettlementOutcome, dep: XchainDeposit): string {
  const copy = settlementCopy(outcome, dep)
  return [`${outcome.venueStatus ?? outcome.status}: ${copy.line}`, copy.detail].filter(Boolean).join(' — ').slice(0, 400)
}

// ── Poll schedule ───────────────────────────────────────────────────────────

/** First polls are 10s apart, then 20s — the venue usually settles inside two
 *  minutes, and a slow one doesn't deserve a tight loop. */
export const SETTLEMENT_FIRST_POLL_MS = 10_000
export const SETTLEMENT_SLOW_POLL_MS = 20_000
/** Polls at 10s before backing off. */
export const SETTLEMENT_FAST_POLLS = 6
/** Give up watching after ~45 minutes; the outcome is still readable later. */
export const SETTLEMENT_WATCH_MS = 45 * 60 * 1000

export function nextPollDelayMs(attempt: number): number {
  return attempt < SETTLEMENT_FAST_POLLS ? SETTLEMENT_FIRST_POLL_MS : SETTLEMENT_SLOW_POLL_MS
}
