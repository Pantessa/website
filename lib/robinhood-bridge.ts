// ─────────────────────────────────────────────────────────────────────────
//  Native Robinhood Chain bridge — the deterministic, guardrailed path from
//  "bridge 0.000561 ETH to robinhood from ethereum" to a SIGNABLE canonical-
//  bridge transaction. Before this layer, bridge asks fell to the planner,
//  which invented venue options (Stargate/Across chips, live 2026-07-14) —
//  none of which are integrated. There is exactly ONE bridge we trust for
//  Robinhood Chain: the canonical Arbitrum (Orbit) bridge, and this layer
//  either builds it or answers honestly. No model text near the transaction.
//
//  Routes (ETH only — ERC-20 deposits need retryable-ticket gas that is easy
//  to get wrong, so those go to the official bridge UI):
//    · deposit  — Ethereum → Robinhood: Delayed Inbox `depositEth()`, a
//                 chainId-1 tx whose VALUE is the amount; credits the
//                 SENDER's own address on the L2 (no recipient to get wrong).
//    · withdraw — Robinhood → Ethereum: ArbSys precompile
//                 `withdrawEth(destination)` pinned to the signer, chainId
//                 4663. NOT instant: ~7-day challenge period, then a claim
//                 on Ethereum via the bridge UI.
//
//  GUARD: the built tx is re-decoded independently and refused unless every
//  field verifies (pinned contract, exact wei, right chain, signer-pinned
//  destination) — same fail-closed shape as the v3/v4/Aave/cross-chain guards.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, encodeFunctionData, parseEther, formatEther } from 'viem'
import { publicClientFor } from '@/lib/chains'
import { buildReport, recipientCheck, type GuardrailCheck, type GuardrailReport } from '@/lib/tx-guardrails'
import { usdPerToken } from '@/lib/usd-probe'

export const ROBINHOOD_CHAIN_ID = 4663
/** Robinhood Chain's L1 Delayed Inbox (docs.robinhood.com/chain/protocol-contracts,
 *  the same pin the robinhood free MCP uses). */
export const RH_L1_INBOX = '0x1A07cc4BD17E0118BdB54D70990D2158AbAD7a2D' as const
/** ArbSys precompile — identical address on every Arbitrum/Orbit chain. */
export const ARB_SYS = '0x0000000000000000000000000000000000000064' as const
export const RH_BRIDGE_UI = 'https://portal.arbitrum.io/bridge?destinationChain=robinhood-chain'

const INBOX_ABI = [
  { name: 'depositEth', type: 'function', stateMutability: 'payable', inputs: [], outputs: [{ name: '', type: 'uint256' }] },
] as const
const ARB_SYS_ABI = [
  { name: 'withdrawEth', type: 'function', stateMutability: 'payable', inputs: [{ name: 'destination', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

// ── Parse ──────────────────────────────────────────────────────────────────

export interface RobinhoodBridgeIntent {
  kind: 'deposit' | 'withdraw'
  /** Human ETH amount ("0.000561"). */
  amount: string
}

const AMOUNT = String.raw`(\d+(?:\.\d+)?)`
const BRIDGE_VERB = String.raw`(?:bridge|move|send|transfer|deposit|withdraw)`
// Chains other than ethereum/robinhood — a named foreign endpoint means the
// canonical bridge can't do it in one hop; answer honestly instead.
const FOREIGN_CHAIN_RE =
  /\bbase\b|\barb(?:itrum|itum|itrium)?\b|\boptimism\b|\bpolygon\b|\bmatic\b|\bbsc\b|\bbnb\b|\bavalanche\b|\bavax\b|\bsolana\b|\bgnosis\b|\bscroll\b|(?:\bon|\bfrom|\bto|\binto)\s+(?:sol|op|btc)\b/i
const ETHEREUM_RE = /\bethereum\b|\beth\s?mainnet\b|\bmainnet\b|\bl1\b/i
// A non-ETH asset named next to the bridge verb ("bridge 100 USDG…").
const TOKEN_AFTER_AMOUNT_RE = new RegExp(String.raw`${BRIDGE_VERB}\s+(?:about\s+|~\s*)?${AMOUNT}\s*\$?([a-zA-Z]{2,10})\b`, 'i')

/**
 * Deterministic read of a Robinhood-Chain bridge ask. Returns the intent, a
 * `problem` string when it's clearly a Robinhood bridge ask this layer must
 * answer (wrong asset / wrong chain / no amount) but can't build, or null
 * when the message isn't a Robinhood bridge ask at all.
 */
export function parseRobinhoodBridge(message: string): RobinhoodBridgeIntent | { problem: string } | null {
  if (!/\brobinhood\b/i.test(message)) return null
  if (!new RegExp(String.raw`\b${BRIDGE_VERB}\b`, 'i').test(message)) return null
  // "bridge" language, or an explicit movement between robinhood and elsewhere.
  const movementish = /\bbridge\b/i.test(message) || /\b(?:from|to|into|onto)\s+robinhood\b/i.test(message) || /\bfrom\s+robinhood\b/i.test(message) || /\bwithdraw\b/i.test(message)
  if (!movementish) return null

  // Which asset? Only ETH rides this layer.
  const tok = message.match(TOKEN_AFTER_AMOUNT_RE)
  if (tok && tok[2].toUpperCase() !== 'ETH') {
    return {
      problem: `The canonical Robinhood Chain bridge is what I build natively, and I only prepare ETH transfers on it — ERC-20 deposits (like ${tok[2].toUpperCase()}) need retryable-ticket gas that's easy to get wrong, so do those at the official bridge UI: ${RH_BRIDGE_UI}`,
    }
  }
  if (!/\beth\b/i.test(message)) {
    return { problem: `I bridge ETH over the canonical Robinhood Chain bridge — say e.g. “bridge 0.01 ETH to robinhood from ethereum”. Other assets go via the official bridge UI: ${RH_BRIDGE_UI}` }
  }

  // Direction: FROM robinhood = withdraw; otherwise robinhood is the destination.
  const kind: RobinhoodBridgeIntent['kind'] = /\bfrom\s+robinhood\b/i.test(message) || (/\bwithdraw\b/i.test(message) && !/\bto\s+robinhood\b/i.test(message)) ? 'withdraw' : 'deposit'

  // The other endpoint must be Ethereum (or unnamed — Ethereum is the only
  // other end of the canonical bridge, so it's the default, not a guess).
  if (FOREIGN_CHAIN_RE.test(message)) {
    const leg = kind === 'deposit' ? 'into' : 'out of'
    return {
      problem:
        `The canonical bridge ${leg} Robinhood Chain connects to **Ethereum** only — there's no one-hop route for that chain. ` +
        (kind === 'deposit'
          ? `Move the ETH to Ethereum first (the NEAR Intents agent can do that leg), then ask me to “bridge it to robinhood from ethereum” and I'll build the deposit.`
          : `I can start the Robinhood → Ethereum withdrawal (~7 days), and you can hop onward from Ethereum after the claim.`),
    }
  }
  if (kind === 'deposit' && ETHEREUM_RE.test(message) === false && /\bfrom\s+\w/i.test(message) && !/\bfrom\s+(?:ethereum|mainnet|eth\s?mainnet|l1|my|the)\b/i.test(message)) {
    // "from <something unrecognized>" — don't silently assume Ethereum.
    return { problem: `The canonical Robinhood Chain bridge connects to Ethereum — I can build “bridge X ETH to robinhood from ethereum”. If the ETH is on another chain, move it to Ethereum first.` }
  }

  const amt = message.match(new RegExp(String.raw`${AMOUNT}\s*eth\b`, 'i')) ?? message.match(new RegExp(AMOUNT))
  if (!amt) {
    return { problem: `How much ETH? e.g. “bridge 0.01 ETH ${kind === 'deposit' ? 'to robinhood from ethereum' : 'from robinhood to ethereum'}”.` }
  }
  return { kind, amount: amt[1] }
}

// ── Guard (pure, fail-closed) ──────────────────────────────────────────────

export interface BridgeTx {
  to: string
  data: string
  value: string
  chainId: number
  action: string
}

/**
 * Verify a built bridge tx independently of the code that built it: pinned
 * contract, right chain, EXACTLY the asked wei, and (withdrawals) the
 * destination pinned to the signer. Any mismatch refuses the artifact.
 */
export function guardRobinhoodBridge(tx: BridgeTx, exp: { kind: 'deposit' | 'withdraw'; wei: bigint; user: string }): { ok: boolean; reasons: string[] } {
  const reasons: string[] = []
  if (BigInt(tx.value || '0') !== exp.wei) reasons.push('The transaction value is not exactly the asked amount.')
  if (exp.kind === 'deposit') {
    if (tx.to.toLowerCase() !== RH_L1_INBOX.toLowerCase()) reasons.push('The deposit is not addressed to the pinned Robinhood Chain Delayed Inbox.')
    if (tx.chainId !== 1) reasons.push(`The deposit targets chain ${tx.chainId}, not Ethereum (1).`)
    try {
      const dec = decodeFunctionData({ abi: INBOX_ABI, data: tx.data as `0x${string}` })
      if (dec.functionName !== 'depositEth') reasons.push(`The deposit calls "${dec.functionName}", not depositEth — refusing.`)
    } catch {
      reasons.push('Could not decode the deposit calldata — refusing to offer an opaque transaction.')
    }
  } else {
    if (tx.to.toLowerCase() !== ARB_SYS.toLowerCase()) reasons.push('The withdrawal is not addressed to the ArbSys precompile.')
    if (tx.chainId !== ROBINHOOD_CHAIN_ID) reasons.push(`The withdrawal targets chain ${tx.chainId}, not Robinhood Chain (${ROBINHOOD_CHAIN_ID}).`)
    try {
      const dec = decodeFunctionData({ abi: ARB_SYS_ABI, data: tx.data as `0x${string}` })
      if (dec.functionName !== 'withdrawEth') {
        reasons.push(`The withdrawal calls "${dec.functionName}", not withdrawEth — refusing.`)
      } else {
        const [destination] = dec.args as [string]
        if (destination.toLowerCase() !== exp.user.toLowerCase()) reasons.push('The withdrawal destination is not the signer — refusing.')
      }
    } catch {
      reasons.push('Could not decode the withdrawal calldata — refusing to offer an opaque transaction.')
    }
  }
  return { ok: reasons.length === 0, reasons }
}

// ── Build ──────────────────────────────────────────────────────────────────

export interface RobinhoodBridgeBuilt {
  summary: string
  guardrails: GuardrailReport
  blocked: boolean
  tx: BridgeTx
  /** Set alongside blocked when the sender simply can't fund it — an honest
   *  refusal string the route surfaces verbatim (no artifact). */
  refusal?: string
  note: string
}

const fmtEth = (wei: bigint) => {
  const n = Number(formatEther(wei))
  return n !== 0 && Math.abs(n) < 1e-6 ? formatEther(wei) : String(Number(n.toFixed(6)))
}

/** Build + guard a canonical-bridge ETH transfer for the USER to sign. */
export async function buildRobinhoodBridge(params: { kind: 'deposit' | 'withdraw'; amount: string; from: string }): Promise<RobinhoodBridgeBuilt> {
  if (!/^0x[0-9a-fA-F]{40}$/.test(params.from)) throw new Error('A valid wallet address is required.')
  if (!/^\d+(\.\d+)?$/.test(params.amount)) throw new Error(`Couldn't read the amount "${params.amount}".`)
  const wei = parseEther(params.amount)
  if (wei <= BigInt(0)) throw new Error('The amount must be positive.')
  const from = params.from as `0x${string}`
  const deposit = params.kind === 'deposit'

  const client = publicClientFor(deposit ? 1 : ROBINHOOD_CHAIN_ID)
  if (!client) throw new Error('No RPC client configured for the origin chain.')
  const balance = await client.getBalance({ address: from })

  const tx: BridgeTx = deposit
    ? { to: RH_L1_INBOX, data: encodeFunctionData({ abi: INBOX_ABI, functionName: 'depositEth', args: [] }), value: wei.toString(), chainId: 1, action: 'bridge-deposit' }
    : { to: ARB_SYS, data: encodeFunctionData({ abi: ARB_SYS_ABI, functionName: 'withdrawEth', args: [from] }), value: wei.toString(), chainId: ROBINHOOD_CHAIN_ID, action: 'bridge-withdraw' }

  // Money-moved pricing: ETH via the venue quoters (v3 ETH/USDC on mainnet,
  // ETH/USDG on Robinhood) — fail-soft, a dead quoter never blocks a bridge.
  const probe = await usdPerToken(deposit ? 1 : ROBINHOOD_CHAIN_ID, 'ETH').catch(() => null)
  const valueUsd = probe ? Number((Number(params.amount) * probe.usd).toFixed(2)) : null

  const originName = deposit ? 'Ethereum' : 'Robinhood Chain'
  const funded = wei <= balance
  const gasFloor = parseEther(deposit ? '0.003' : '0.0005')
  const balanceCheck: GuardrailCheck = {
    id: 'balance',
    level: 'block',
    ok: funded,
    note: funded
      ? balance - wei < gasFloor
        ? `Funded, but this leaves almost no ETH for gas on ${originName} — consider bridging slightly less.`
        : `The wallet holds ${fmtEth(balance)} ETH on ${originName} — covered.`
      : `Insufficient ETH on ${originName}: bridging ${params.amount} ETH but the wallet holds ${fmtEth(balance)}.`,
  }
  const verdict = guardRobinhoodBridge(tx, { kind: params.kind, wei, user: from })
  const guardCheck: GuardrailCheck = {
    id: 'bridge-guard',
    level: 'block',
    ok: verdict.ok,
    note: verdict.ok
      ? deposit
        ? 'Calldata decoded and verified: pinned Delayed Inbox, exact amount; the L2 credits the sender by construction.'
        : 'Calldata decoded and verified: ArbSys withdrawEth, exact amount, destination pinned to your wallet.'
      : verdict.reasons.join(' '),
  }
  const checks: GuardrailCheck[] = [recipientCheck(from, from), balanceCheck, guardCheck]
  const guardrails = buildReport(valueUsd, checks)
  const blocked = !funded || !verdict.ok

  const summary = deposit
    ? `Bridge ${params.amount} ETH → Robinhood Chain via the canonical bridge (Delayed Inbox on Ethereum) — arrives at your own address in a few minutes.`
    : `Withdraw ${params.amount} ETH from Robinhood Chain → Ethereum via the canonical bridge — funds claimable on Ethereum after the ~7-day challenge period.`
  const note = deposit
    ? `This transaction is on ETHEREUM (switch the wallet network to sign). ERC-20s and other routes: ${RH_BRIDGE_UI}`
    : `⚠️ Not instant: after ~7 days the withdrawal must be CLAIMED on Ethereum at the bridge UI (${RH_BRIDGE_UI}, Withdrawals tab).`

  return {
    summary,
    guardrails,
    blocked,
    tx,
    ...(funded ? {} : { refusal: balanceCheck.note }),
    note,
  }
}
