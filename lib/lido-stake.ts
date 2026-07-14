// ─────────────────────────────────────────────────────────────────────────
//  Native Lido staking — "stake 0.5 eth on lido" to a SIGNABLE, guarded
//  transaction, and the guided "help me stake on lido" moment.
//
//  Same doctrine as every native layer (lib/cross-chain-swap.ts is the
//  template): WE parse the ask, the lido MCP's `build_stake` constructs the
//  unsigned transaction from live chain state, and the guard re-derives what
//  that transaction MUST be — recipient pinned to the canonical Lido mainnet
//  contracts (hardcoded here, never trusted from the MCP response alone),
//  calldata decoded, value matched to the ask. The model writes nothing.
//
//  Amounts: explicit ("stake 0.5 eth on lido") or max ("stake all my eth on
//  lido" / "stake the swapped eth on lido" — the job-step form, resolved
//  from the LIVE mainnet balance at build time minus a gas buffer). A bare
//  "stake eth on lido" is a problem, not a guess.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, getAddress, parseEther } from 'viem'
import type { EvmTxRequest } from '@/lib/transaction-layer'
import type { McpServer } from '@/lib/store'

export const LIDO_MCP = 'https://lido-mcp.yeetful.com/mcp'

/** Canonical Lido mainnet contracts — the guard's source of truth. A build
 *  whose recipient is anything else dies here, whatever the MCP said. */
export const LIDO_STETH_MAINNET = '0xae7ab96520DE3A18E5e111B5EaAb095312D7fE84'
export const LIDO_WSTETH_MAINNET = '0x7f39C581F595B53c5cb19bD0b3f8dA6c935E2Ca0'

const STETH_SUBMIT_ABI = [
  {
    type: 'function',
    name: 'submit',
    stateMutability: 'payable',
    inputs: [{ name: '_referral', type: 'address' }],
    outputs: [{ type: 'uint256' }],
  },
] as const

/** Keep ~this much ETH unstaked for gas when resolving a max stake. */
export const LIDO_GAS_BUFFER_ETH = '0.002'

const AMOUNT = '\\d+(?:\\.\\d+)?'
const LIDO_RE = /\blido\b/i
const EXPLICIT_RE = new RegExp(`\\bstake\\s+(${AMOUNT})\\s*(?:eth|ether)\\b`, 'i')
// "all my eth" / "everything" / "the swapped|resulting|remaining eth" — the
// compound-job form where the amount only exists after an earlier step.
const MAX_RE = /\bstake\s+(?:all(?:\s+(?:of\s+)?(?:my|the))?|everything|my\s+entire|the\s+(?:swapped|resulting|remaining|bridged))\s*(?:eth|ether)?\b/i
// stake-shaped but amountless → an honest problem, never a guess.
const BARE_RE = /\bstake\b[^.]*\b(?:eth|ether)\b|\bstake\s+(?:on|with|via|at)\s+lido\b/i

export interface LidoStakeParams {
  /** Decimal ETH string, or 'max' (resolved from the live balance at build time). */
  amount: string
  receive: 'stETH' | 'wstETH'
}

const receiveOf = (message: string): 'stETH' | 'wstETH' => (/\bwst\s?eth\b|\bwrapped\b/i.test(message) ? 'wstETH' : 'stETH')

/**
 * Parse an imperative Lido stake. The venue word is DEMANDED (a bare "stake
 * 5 eth" belongs to no one — too many protocols stake). Returns params, a
 * `problem` for a stake-shaped-but-amountless ask, or null.
 */
export function parseLidoStake(message: string): LidoStakeParams | { problem: string } | null {
  if (!LIDO_RE.test(message)) return null
  if (isLidoGuidedAsk(message)) return null // the guided moment owns those
  const explicit = message.match(EXPLICIT_RE)
  if (explicit) return { amount: explicit[1], receive: receiveOf(message) }
  if (MAX_RE.test(message)) return { amount: 'max', receive: receiveOf(message) }
  if (BARE_RE.test(message)) {
    return { problem: 'Tell me how much — e.g. “stake 0.5 ETH on Lido”, or “stake all my ETH on Lido” to use the full balance (minus gas).' }
  }
  return null
}

/**
 * The guided moment: "help me stake on lido" and friends — an intent to
 * stake with no buildable amount. The chat answers with a DETERMINISTIC
 * context check (live balances) and proposes the exact ask as a chip.
 */
export function isLidoGuidedAsk(message: string): boolean {
  if (!LIDO_RE.test(message) || !/\bstak/i.test(message)) return false
  if (EXPLICIT_RE.test(message) || MAX_RE.test(message)) return false
  return (
    /\b(?:help|how\s+(?:do|can|would)|want\s+to|like\s+to|walk\s+me|get\s+started|start|interested)\b/i.test(message) ||
    /^\s*stake\s+(?:on|with)\s+lido[\s?.!]*$/i.test(message)
  )
}

/** Find the Lido MCP in the working set (venue gate — no agent, no build). */
export function lidoAgentOf(servers: McpServer[]): { agent?: McpServer; usable: boolean } {
  const agent = servers.find((s) => /lido/i.test(`${s.slug} ${s.name}`))
  return { agent, usable: !!agent?.endpoint }
}

// ── The slice of `build_stake`'s response we verify ──────────────────────────
export interface LidoBuiltStake {
  operation?: string
  amountEth?: string
  receive?: string
  steps?: { action?: string; label?: string; summary?: string; tx?: { to?: string; data?: string; value?: string; chainId?: number } }[]
  note?: string
}

export interface LidoGuardResult {
  ok: boolean
  reasons: string[]
  warnings: string[]
  tx?: EvmTxRequest
  summary?: string
}

const eqAddr = (a?: string, b?: string): boolean => {
  if (!a || !b) return false
  try {
    return getAddress(a) === getAddress(b)
  } catch {
    return false
  }
}

/**
 * Verify a `build_stake` result before it can be signed. What must be true:
 * ONE send_transaction step on mainnet, moving exactly the asked ETH, to the
 * canonical Lido contract for the asked receive token — stETH via a decoded
 * submit() call, wstETH via a plain transfer (its receive() stakes+wraps).
 */
export function guardLidoStakeBuild(
  built: LidoBuiltStake,
  expected: { amountEth: string; receive: 'stETH' | 'wstETH' },
): LidoGuardResult {
  const reasons: string[] = []
  const warnings: string[] = []

  const step = built.steps?.[0]
  const tx = step?.tx
  if (built.operation !== 'stake' || !built.steps || built.steps.length !== 1 || step?.action !== 'send_transaction' || !tx?.to) {
    reasons.push('The stake did not build into a single signable transaction.')
    return { ok: false, reasons, warnings }
  }
  if (tx.chainId !== 1) {
    reasons.push(`The built transaction targets chain ${tx.chainId ?? '?'}, not Ethereum mainnet (Lido lives there).`)
  }

  let expectedWei: bigint | null = null
  try {
    expectedWei = parseEther(expected.amountEth)
  } catch {
    reasons.push(`Unparseable stake amount "${expected.amountEth}".`)
  }
  const value = BigInt(tx.value ?? '0')
  if (expectedWei !== null && value !== expectedWei) {
    reasons.push('The transaction value does not match the asked stake amount.')
  }
  if (value <= BigInt(0)) reasons.push('The stake transaction carries no ETH.')

  const data = tx.data ?? '0x'
  if (expected.receive === 'wstETH') {
    if (!eqAddr(tx.to, LIDO_WSTETH_MAINNET)) {
      reasons.push('The recipient is not the canonical Lido wstETH contract — refusing.')
    }
    if (data !== '0x') reasons.push('A wstETH stake must be a plain ETH transfer (its receive() stakes and wraps).')
  } else {
    if (!eqAddr(tx.to, LIDO_STETH_MAINNET)) {
      reasons.push('The recipient is not the canonical Lido stETH contract — refusing.')
    }
    try {
      const decoded = decodeFunctionData({ abi: STETH_SUBMIT_ABI, data: data as `0x${string}` })
      if (decoded.functionName !== 'submit') reasons.push('The calldata is not a Lido submit() call — refusing.')
    } catch {
      reasons.push('Could not decode the stake calldata as Lido submit() — refusing to sign an opaque transaction.')
    }
  }

  if (/⚠️/.test(step?.summary ?? '')) warnings.push('This stake leaves very little ETH for gas.')

  return {
    ok: reasons.length === 0,
    reasons,
    warnings,
    tx: reasons.length === 0 ? { to: tx.to, data, value: tx.value ?? '0', chainId: 1, action: 'stake' } : undefined,
    summary: step?.summary,
  }
}

// ── The `position` slice the guided moment + splash read ─────────────────────
export interface LidoPositionPayload {
  hasPosition?: boolean
  eth?: { balance?: string; usd?: string | null }
  stEth?: { balance?: string; usd?: string | null }
  wstEth?: { balance?: string; asStEth?: string; usd?: string | null }
  totalStaked?: { stEth?: string; usd?: string | null }
  currentAprPct?: number | null
  withdrawals?: { pendingRequests?: number; claimableRequests?: number; claimableEth?: string }
}

/** A safe stake suggestion from a live ETH balance: the balance minus the gas
 *  buffer, floored to 4 decimals. Null when there's nothing worth staking. */
export function suggestedStakeEth(balanceEth: string | undefined): string | null {
  const bal = Number(balanceEth)
  if (!Number.isFinite(bal)) return null
  const stakeable = bal - Number(LIDO_GAS_BUFFER_ETH)
  if (stakeable < 0.003) return null
  return String(Math.floor(stakeable * 10_000) / 10_000)
}
