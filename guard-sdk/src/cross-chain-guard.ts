// Cross-chain deposit guard — adapted excerpt of lib/cross-chain-swap.ts
// (the guard half only; parse/turn plumbing stays in the app).
//
// Born from a live near-miss (2026-07-10, website#374): a planner-composed
// turn nearly offered a transfer to a FABRICATED deposit address. The rule
// this module enforces: the transaction a user signs must move EXACTLY the
// quoted amount to the venue's one-time deposit address, on the origin
// chain — decoded from the calldata itself, never trusted from a model or
// an MCP's prose. Fee entries must pay only the pinned recipient
// (website#578: the venue never validates fee recipients — we do).

import { decodeFunctionData, erc20Abi, getAddress, isAddress } from 'viem'

export interface EvmTxRequest {
  to: string
  data?: string
  value?: string
  chainId?: number
  action?: string
}

interface BuiltStep {
  action?: string
  label?: string
  summary?: string
  tx?: { to?: string; data?: string; value?: string; chainId?: number }
}

/** The app-fee echo a venue passes through from its quote response. */
export interface BuiltAppFee {
  requested?: Array<{ recipient?: string; fee?: number }>
  applied?: Array<{ recipient?: string; fee?: number }> | null
  note?: string
}

/** The build_swap result shape the guard verifies (1Click-style venues). */
export interface BuiltSwap {
  kind?: string
  appFee?: BuiltAppFee
  quote?: { sell?: { amountAtoms?: string; token?: string; chain?: string; usd?: string }; receive?: { token?: string; chain?: string }; summary?: string }
  deposit?: { address?: string; addressExpires?: string | null; deliveredTo?: string }
  balanceCheck?: { ok?: boolean | null; note?: string }
  steps?: BuiltStep[]
  warnings?: string[]
}

export interface GuardResult {
  ok: boolean
  /** Block reasons — when non-empty the tx must NOT be offered for signing. */
  reasons: string[]
  /** Advisory notes (e.g. low balance) — shown but not blocking. */
  warnings: string[]
  /** Operator-only notes about the venue fee — traced, never user-facing. */
  feeNotes?: string[]
  /** Net bps of the venue fee this build actually carries (0 when none). */
  feeBps?: number
  tx?: EvmTxRequest
  depositAddress?: string
  summary?: string
  addressExpires?: string | null
}

const eqAddr = (a?: string, b?: string): boolean => {
  if (!a || !b) return false
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return a.toLowerCase() === b.toLowerCase()
  }
}

/**
 * Verify the venue fee on a build we asked to carry one. The user's funds are
 * never at risk from the fee itself — it comes out of the OUTPUT — but an
 * EVM recipient we did NOT pin means someone redirected value out of the
 * user's swap, and that is a refusal.
 */
export function checkCrossChainFee(
  built: BuiltSwap,
  expected: { recipient: string; bps: number } | null,
): { reasons: string[]; notes: string[] } {
  const reasons: string[] = []
  const notes: string[] = []
  const applied = built.appFee?.applied
  if (!expected) {
    if (applied?.length) reasons.push('The quote carries an app fee we did not request — refusing.')
    return { reasons, notes }
  }
  if (!applied?.length) {
    notes.push('fee not applied by the venue (older MCP build) — the swap is unaffected')
    return { reasons, notes }
  }
  const evmEntries = applied.filter((f) => typeof f.recipient === 'string' && /^0x[0-9a-fA-F]{40}$/.test(f.recipient))
  const ours = evmEntries.filter((f) => eqAddr(f.recipient, expected.recipient))
  const foreign = evmEntries.filter((f) => !eqAddr(f.recipient, expected.recipient))
  if (foreign.length > 0) {
    reasons.push(`The quote pays an app fee to an address we did not pin (${foreign[0].recipient}) — refusing.`)
  }
  if (ours.length === 0) {
    notes.push('fee not applied by the venue — the swap is unaffected')
  }
  const totalBps = applied.reduce((s, f) => s + (typeof f.fee === 'number' ? f.fee : 0), 0)
  if (totalBps > expected.bps) {
    reasons.push(`The quote's app fee (${totalBps} bps) exceeds the ${expected.bps} bps we requested — refusing.`)
  }
  return { reasons, notes }
}

/**
 * Verify a `build_swap` result before it can be signed: exactly the quoted
 * amount, exactly the one-time deposit address, on the origin chain —
 * nothing a model wrote, only what the tool built and we decoded.
 */
export function guardCrossChainBuild(
  built: BuiltSwap,
  expected: { chainId: number | null; fee?: { recipient: string; bps: number } | null },
): GuardResult {
  const reasons: string[] = []
  const warnings: string[] = []

  const step = built.steps?.[0]
  const tx = step?.tx
  const depositAddress = built.deposit?.address
  const amountAtoms = built.quote?.sell?.amountAtoms

  if (built.kind !== 'swap_ready' || !step || step.action !== 'send_transaction' || !tx?.to) {
    reasons.push('The swap did not build into a signable transaction.')
    return { ok: false, reasons, warnings }
  }
  if (!depositAddress || !isAddress(depositAddress)) {
    reasons.push('No valid one-time deposit address was returned — refusing to build a transfer to an unknown address.')
    return { ok: false, reasons, warnings }
  }
  if (!amountAtoms) {
    reasons.push('The quoted amount is missing — cannot verify the transfer amount.')
    return { ok: false, reasons, warnings }
  }
  if (expected.chainId !== null && tx.chainId !== expected.chainId) {
    reasons.push(`The built transaction targets chain ${tx.chainId ?? '?'}, not the origin chain (${expected.chainId}).`)
  }

  const data = tx.data ?? '0x'
  const value = tx.value ?? '0'
  if (data === '0x') {
    if (!eqAddr(tx.to, depositAddress)) {
      reasons.push('The native transfer is not addressed to the quoted deposit address.')
    }
    if (BigInt(value) !== BigInt(amountAtoms)) {
      reasons.push('The native transfer amount does not match the quote.')
    }
  } else {
    if (value !== '0') reasons.push('An ERC-20 transfer must carry zero native value.')
    try {
      const decoded = decodeFunctionData({ abi: erc20Abi, data: data as `0x${string}` })
      if (decoded.functionName !== 'transfer') {
        reasons.push(`The transaction calls "${decoded.functionName}", not transfer — refusing.`)
      } else {
        const [to, amt] = decoded.args as [string, bigint]
        if (!eqAddr(to, depositAddress)) reasons.push('The transfer recipient is not the quoted deposit address.')
        if (amt !== BigInt(amountAtoms)) reasons.push('The transfer amount does not match the quote.')
      }
    } catch {
      reasons.push('Could not decode the transfer calldata — refusing to sign an opaque transaction.')
    }
  }

  if (built.balanceCheck?.ok === false && built.balanceCheck.note) {
    warnings.push(built.balanceCheck.note)
  }

  const fee = checkCrossChainFee(built, expected.fee ?? null)
  reasons.push(...fee.reasons)

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    feeNotes: fee.notes,
    feeBps: fee.notes.length === 0 && expected.fee ? expected.fee.bps : 0,
    tx: reasons.length === 0 ? { to: tx.to, data, value, chainId: tx.chainId, action: 'deposit' } : undefined,
    depositAddress,
    summary: step.summary ?? built.quote?.summary,
    addressExpires: built.deposit?.addressExpires ?? null,
  }
}
