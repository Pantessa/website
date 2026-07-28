// ─────────────────────────────────────────────────────────────────────────
//  DCA AUTOPILOT — the pure half of the autonomous tier (Spend Permissions).
//
//  The trust model, in one breath: the user's SMART wallet signs ONE
//  SpendPermission whose allowance is EXACTLY the schedule's per-period
//  dollar amount — the on-chain SpendPermissionManager (Coinbase's audited
//  contract, the same address on every supported chain) caps what our
//  spender can ever pull, regardless of anything in this codebase. Each due
//  period the sweep pulls that exact amount, swaps it through the SAME
//  guarded venue builder as every other Yeetful swap with the output pinned
//  to the OWNER's wallet, and records a receipt. Disarm = we stop pulling;
//  on-chain revoke is always the user's nuclear option.
//
//  This module is PURE (no prisma, no CDP, no RPC): permission construction,
//  EIP-712 payloads, the arm/disarm grammar, and guardAutoBuy — the
//  independent calldata re-decode that must pass before the sweep sends
//  ANYTHING. Fail-closed throughout: an unknown shape is a refusal.
// ─────────────────────────────────────────────────────────────────────────

import { decodeFunctionData, erc20Abi } from 'viem'
import type { DcaCadence } from '@/lib/dca'
import { usdcAtomic, SPEND_PERMISSION_MANAGER } from '@/lib/spend-permission'
import { ADDRESS_THIS, SWAP_ROUTER_02_ABI } from '@/lib/uniswap-venue'
import type { GuardrailCheck } from '@/lib/tx-guardrails'

export { SPEND_PERMISSION_MANAGER }

/** The on-chain rolling-window length per cadence. The sweep's calendar
 *  periodKey (UTC day/ISO-week/month) is the ONE-BUY-PER-PERIOD rule; this
 *  window is the independent HARD cap the contract enforces. Month uses 30
 *  days — a 31-day calendar gap still fits, and if a calendar boundary ever
 *  lands two buys in one rolling window the contract refuses the second
 *  (an honest, visible failure — never an overspend). */
export const PERIOD_SECONDS: Record<DcaCadence, number> = {
  day: 86_400,
  week: 604_800,
  month: 2_592_000,
}

/** Permissions are minted with a bounded life — re-arm once a year, never a
 *  signable-forever artifact (the tx-guardrails validity doctrine). */
export const PERMISSION_LIFE_SECONDS = 366 * 86_400
/** Clock-skew grace on `start` so a just-signed permission is instantly valid. */
export const PERMISSION_START_GRACE_SECONDS = 300

/** The SpendPermission struct as signed + stored (bigints live). Field set
 *  mirrors Coinbase's SpendPermissionManager exactly. */
export interface DcaSpendPermission {
  account: `0x${string}`
  spender: `0x${string}`
  token: `0x${string}`
  allowance: bigint
  period: number
  start: number
  end: number
  salt: bigint
  extraData: `0x${string}`
}

/** EIP-712 field order — MUST match the contract's SPEND_PERMISSION_TYPEHASH:
 *  SpendPermission(address account,address spender,address token,
 *  uint160 allowance,uint48 period,uint48 start,uint48 end,uint256 salt,
 *  bytes extraData). The arm route additionally SIMULATES
 *  approveWithSignature on-chain before storing anything, so a drift here
 *  fails closed at arm time — it can never produce a stored-but-invalid arm. */
export const SPEND_PERMISSION_712_TYPES = {
  SpendPermission: [
    { name: 'account', type: 'address' },
    { name: 'spender', type: 'address' },
    { name: 'token', type: 'address' },
    { name: 'allowance', type: 'uint160' },
    { name: 'period', type: 'uint48' },
    { name: 'start', type: 'uint48' },
    { name: 'end', type: 'uint48' },
    { name: 'salt', type: 'uint256' },
    { name: 'extraData', type: 'bytes' },
  ],
} as const

const HEX_ADDR = /^0x[0-9a-fA-F]{40}$/

export interface BuildPermissionInput {
  /** The schedule owner's wallet — must BE a smart wallet (the grantor). */
  account: string
  /** Yeetful's CDP-managed spender. */
  spender: string
  /** The chain's canonical USDC. */
  token: string
  buyUsd: number
  cadence: DcaCadence
  /** Unix seconds "now" — passed in so this stays deterministic/testable. */
  nowSec: number
  /** Random uint256 salt — passed in (crypto lives with the caller). */
  salt: bigint
}

export function buildDcaSpendPermission(input: BuildPermissionInput): DcaSpendPermission {
  for (const [label, v] of [['account', input.account], ['spender', input.spender], ['token', input.token]] as const) {
    if (!HEX_ADDR.test(v)) throw new Error(`dca-auto: ${label} is not an address`)
  }
  if (input.account.toLowerCase() === input.spender.toLowerCase()) {
    throw new Error('dca-auto: account and spender must differ')
  }
  return {
    account: input.account as `0x${string}`,
    spender: input.spender as `0x${string}`,
    token: input.token as `0x${string}`,
    allowance: usdcAtomic(input.buyUsd),
    period: PERIOD_SECONDS[input.cadence],
    start: input.nowSec - PERMISSION_START_GRACE_SECONDS,
    end: input.nowSec + PERMISSION_LIFE_SECONDS,
    salt: input.salt,
    extraData: '0x',
  }
}

/** The exact EIP-712 payload the user's wallet signs. The domain's
 *  name/version are READ FROM THE CONTRACT (ERC-5267 eip712Domain) by the
 *  arm turn — never guessed here. */
export function spendPermissionTypedData(
  permission: DcaSpendPermission,
  chainId: number,
  domain: { name: string; version: string },
) {
  return {
    domain: {
      name: domain.name,
      version: domain.version,
      chainId,
      verifyingContract: SPEND_PERMISSION_MANAGER as `0x${string}`,
    },
    types: SPEND_PERMISSION_712_TYPES,
    primaryType: 'SpendPermission' as const,
    message: {
      account: permission.account,
      spender: permission.spender,
      token: permission.token,
      allowance: permission.allowance,
      period: permission.period,
      start: permission.start,
      end: permission.end,
      salt: permission.salt,
      extraData: permission.extraData,
    },
  }
}

// ── Storage round-trip (bigints as strings; strict parse — the arm route
//    re-validates every client-posted field against the SCHEDULE anyway) ───

export function serializePermission(p: DcaSpendPermission): string {
  return JSON.stringify({
    account: p.account,
    spender: p.spender,
    token: p.token,
    allowance: p.allowance.toString(),
    period: p.period,
    start: p.start,
    end: p.end,
    salt: p.salt.toString(),
    extraData: p.extraData,
  })
}

export function parsePermission(raw: unknown): DcaSpendPermission | null {
  try {
    const o = typeof raw === 'string' ? JSON.parse(raw) : raw
    if (!o || typeof o !== 'object') return null
    const r = o as Record<string, unknown>
    const addr = (v: unknown): `0x${string}` | null => (typeof v === 'string' && HEX_ADDR.test(v) ? (v as `0x${string}`) : null)
    const uint = (v: unknown): number | null => (typeof v === 'number' && Number.isInteger(v) && v >= 0 ? v : null)
    const big = (v: unknown): bigint | null => {
      if (typeof v === 'bigint') return v
      if (typeof v === 'string' && /^\d+$/.test(v)) return BigInt(v)
      return null
    }
    const account = addr(r.account)
    const spender = addr(r.spender)
    const token = addr(r.token)
    const allowance = big(r.allowance)
    const period = uint(r.period)
    const start = uint(r.start)
    const end = uint(r.end)
    const salt = big(r.salt)
    const extraData = typeof r.extraData === 'string' && /^0x[0-9a-fA-F]*$/.test(r.extraData) ? (r.extraData as `0x${string}`) : null
    if (!account || !spender || !token || allowance === null || period === null || start === null || end === null || salt === null || extraData === null) return null
    return { account, spender, token, allowance, period, start, end, salt, extraData }
  } catch {
    return null
  }
}

// ── Permission ⇄ schedule agreement (shared by the arm route AND the sweep;
//    one rulebook, two enforcement moments) ────────────────────────────────

export interface PermissionScheduleTerms {
  ownerWallet: string
  buyUsd: number
  cadence: DcaCadence
  usdcAddress: string
  spender: string
  nowSec: number
}

export function permissionMatchesSchedule(p: DcaSpendPermission, t: PermissionScheduleTerms): { ok: boolean; problems: string[] } {
  const problems: string[] = []
  if (p.account.toLowerCase() !== t.ownerWallet.toLowerCase()) problems.push('permission account is not the schedule owner')
  if (p.spender.toLowerCase() !== t.spender.toLowerCase()) problems.push('permission spender is not the bound Yeetful spender')
  if (p.token.toLowerCase() !== t.usdcAddress.toLowerCase()) problems.push("permission token is not the chain's canonical USDC")
  if (p.allowance !== usdcAtomic(t.buyUsd)) problems.push(`allowance must be exactly $${t.buyUsd} per period`)
  if (p.period !== PERIOD_SECONDS[t.cadence]) problems.push(`period must be exactly the ${t.cadence} window`)
  if (p.start > t.nowSec) problems.push('permission is not valid yet')
  if (p.end <= t.nowSec) problems.push('permission has expired — re-arm to continue')
  if (p.end - p.start > PERMISSION_LIFE_SECONDS + PERMISSION_START_GRACE_SECONDS) problems.push('permission life exceeds the one-year bound')
  if (p.extraData !== '0x') problems.push('extraData must be empty')
  return { ok: problems.length === 0, problems }
}

// ── Arm / disarm grammar (narrow, deterministic-or-nothing; runs BEFORE the
//    manage grammar so "turn off autopilot" never reads as "cancel") ───────

const ARM_RE =
  /\b(?:(?:make|set|switch|turn|put|flip)\s+(?:my\s+)?(?:([A-Za-z]{2,12})\s+)?(?:dca|recurring\s+buys?)[\s\w]*\b(?:autonomous|automatic|auto(?:pilot)?)|(?:arm|autopilot)\s+(?:my\s+)?(?:([A-Za-z]{2,12})\s+)?(?:dca|recurring\s+buys?))\b/i
const DISARM_RE =
  /\b(?:(?:disarm|de-?activate)\s+(?:my\s+)?(?:([A-Za-z]{2,12})\s+)?(?:dca|recurring\s+buys?)|(?:turn\s+off|switch\s+off|disable|stop)\s+(?:the\s+|my\s+)?(?:([A-Za-z]{2,12})\s+)?(?:dca\s+)?(?:autopilot|auto(?:nomous)?(?:\s+mode)?)|(?:my\s+)?(?:([A-Za-z]{2,12})\s+)?dca\s+back\s+to\s+(?:manual|confirm))\b/i

// 'dca' rides in because the optional token slot sits directly before an
// OPTIONAL literal "dca" — "turn off my dca autopilot" must not read the
// noun as a token filter.
const TOKEN_STOPWORDS = /^(my|the|a|this|that|every|each|dca)$/i

export function parseDcaAutoToggle(message: string): { op: 'arm' | 'disarm'; token: string | null } | null {
  const dis = message.match(DISARM_RE)
  if (dis) {
    const tok = dis[1] ?? dis[2] ?? dis[3] ?? null
    return { op: 'disarm', token: tok && !TOKEN_STOPWORDS.test(tok) ? tok.toUpperCase() : null }
  }
  const arm = message.match(ARM_RE)
  if (arm) {
    const tok = arm[1] ?? arm[2] ?? null
    return { op: 'arm', token: tok && !TOKEN_STOPWORDS.test(tok) ? tok.toUpperCase() : null }
  }
  return null
}

// ── guardAutoBuy — the independent re-decode. NOTHING is sent unless every
//    check passes. Mirrors transfer-exec's doctrine: the builder built it,
//    the guard doesn't trust the builder. ──────────────────────────────────

export interface AutoBuyGuardInput {
  schedule: { mode: string; status: string; buyUsd: number; cadence: DcaCadence; chainId: number }
  permission: DcaSpendPermission
  ownerWallet: string
  spender: string
  chain: { chainId: number; swapRouter02: string; usdcAddress: string }
  /** The buy token's resolved address on this chain (from the official list). */
  expectedBuyAddr: string
  /** The txChain steps the venue builder produced ({to, data, value}). */
  steps: Array<{ to: string; data: string; value: string }>
  /** The exact atomic USDC the sweep pulled (== permission.allowance). */
  pulledAtomic: bigint
  nowSec: number
}

const check = (id: string, ok: boolean, note: string): GuardrailCheck => ({ id, level: 'block', ok, note })

export function guardAutoBuy(input: AutoBuyGuardInput): { ok: boolean; checks: GuardrailCheck[] } {
  const { schedule, permission, ownerWallet, spender, chain, expectedBuyAddr, steps, pulledAtomic, nowSec } = input
  const checks: GuardrailCheck[] = []
  const owner = ownerWallet.toLowerCase()

  checks.push(check('armed', schedule.mode === 'auto' && schedule.status === 'active', schedule.mode === 'auto' && schedule.status === 'active' ? 'Schedule is armed and active.' : `Schedule is ${schedule.status}/${schedule.mode} — autopilot must not touch it.`))

  const match = permissionMatchesSchedule(permission, {
    ownerWallet,
    buyUsd: schedule.buyUsd,
    cadence: schedule.cadence,
    usdcAddress: chain.usdcAddress,
    spender,
    nowSec,
  })
  checks.push(check('permission', match.ok, match.ok ? `Permission binds exactly $${schedule.buyUsd}/${schedule.cadence} of USDC to the bound spender.` : match.problems.join('; ')))

  checks.push(check('pull-amount', pulledAtomic === permission.allowance, pulledAtomic === permission.allowance ? 'Pull is exactly the signed allowance — never more.' : `Pull ${pulledAtomic} ≠ signed allowance ${permission.allowance}.`))

  checks.push(check('chain', schedule.chainId === chain.chainId, schedule.chainId === chain.chainId ? 'Build is on the schedule’s chain.' : 'Build chain does not match the schedule.'))

  // Every step's target must be a pinned contract; every step's calldata must
  // re-decode to exactly the shape the sweep intends. Unknown = refusal.
  if (steps.length < 1 || steps.length > 2) {
    checks.push(check('steps', false, `Expected approve?+swap (1–2 steps), got ${steps.length}.`))
    return { ok: false, checks }
  }
  const swapStep = steps[steps.length - 1]
  const approveStep = steps.length === 2 ? steps[0] : null

  if (approveStep) {
    let approveOk = false
    let note = 'Approve step does not decode as an exact-amount USDC approval to SwapRouter02.'
    if (approveStep.to.toLowerCase() === chain.usdcAddress.toLowerCase() && approveStep.value === '0') {
      try {
        const dec = decodeFunctionData({ abi: erc20Abi, data: approveStep.data as `0x${string}` })
        if (dec.functionName === 'approve') {
          const [spenderArg, amountArg] = dec.args as [string, bigint]
          approveOk = spenderArg.toLowerCase() === chain.swapRouter02.toLowerCase() && amountArg === pulledAtomic
          note = approveOk ? 'Exact-amount USDC approval to the pinned SwapRouter02.' : `Approve pays ${spenderArg} for ${amountArg} — not the pinned router for the exact pull.`
        }
      } catch {
        /* refusal below */
      }
    }
    checks.push(check('approve', approveOk, note))
  }

  let swapOk = false
  let swapNote = 'Swap step does not decode as a pinned SwapRouter02 multicall.'
  if (swapStep.to.toLowerCase() === chain.swapRouter02.toLowerCase() && swapStep.value === '0') {
    try {
      const outer = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: swapStep.data as `0x${string}` })
      if (outer.functionName === 'multicall') {
        const [deadline, calls] = outer.args as [bigint, readonly `0x${string}`[]]
        if (Number(deadline) <= nowSec) {
          swapNote = 'Swap deadline already passed — stale build.'
        } else if (calls.length < 1 || calls.length > 2) {
          swapNote = `Expected swap(+sweep) in the multicall, got ${calls.length} calls.`
        } else {
          const inner = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: calls[0] })
          if (inner.functionName === 'exactInputSingle') {
            const p = (inner.args as readonly unknown[])[0] as {
              tokenIn: string
              tokenOut: string
              recipient: string
              amountIn: bigint
              amountOutMinimum: bigint
            }
            const tokenInOk = p.tokenIn.toLowerCase() === chain.usdcAddress.toLowerCase()
            const tokenOutOk = p.tokenOut.toLowerCase() === expectedBuyAddr.toLowerCase()
            const amountOk = p.amountIn === pulledAtomic
            const minOutOk = p.amountOutMinimum > BigInt(0)
            let recipientOk = false
            let recipientNote = ''
            if (calls.length === 2) {
              // Fee build: output parks on the router, sweepTokenWithFee pays
              // the OWNER minus the visible treasury bps.
              const sweep = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: calls[1] })
              if (sweep.functionName === 'sweepTokenWithFee') {
                const [sweepToken, , sweepRecipient] = sweep.args as [string, bigint, string, bigint, string]
                recipientOk = p.recipient.toLowerCase() === ADDRESS_THIS.toLowerCase() && sweepRecipient.toLowerCase() === owner && sweepToken.toLowerCase() === expectedBuyAddr.toLowerCase()
                recipientNote = recipientOk ? '' : ` Sweep pays ${sweepRecipient} — not the schedule owner.`
              } else {
                recipientNote = ` Second call is ${sweep.functionName}, not sweepTokenWithFee.`
              }
            } else {
              recipientOk = p.recipient.toLowerCase() === owner
              recipientNote = recipientOk ? '' : ` Swap pays ${p.recipient} — not the schedule owner.`
            }
            swapOk = tokenInOk && tokenOutOk && amountOk && minOutOk && recipientOk
            swapNote = swapOk
              ? `Swaps the exact pull USDC → the schedule token, output pinned to the owner's wallet.`
              : `${!tokenInOk ? 'tokenIn is not USDC. ' : ''}${!tokenOutOk ? 'tokenOut is not the schedule token. ' : ''}${!amountOk ? 'amountIn is not the exact pull. ' : ''}${!minOutOk ? 'No minimum-out bound. ' : ''}${recipientNote}`.trim()
          } else {
            swapNote = `First multicall entry is ${inner.functionName}, not exactInputSingle.`
          }
        }
      }
    } catch {
      /* refusal below */
    }
  }
  checks.push(check('swap', swapOk, swapNote))

  return { ok: checks.every((c) => c.ok), checks }
}

/** Atomic USDC → the exact human string the venue builder must be fed, so
 *  amountIn re-derives to the identical atomic value (6 decimals). */
export function usdcAtomsToHuman(atomic: bigint): string {
  const whole = atomic / BigInt(1_000_000)
  const frac = (atomic % BigInt(1_000_000)).toString().padStart(6, '0').replace(/0+$/, '')
  return frac ? `${whole}.${frac}` : whole.toString()
}
