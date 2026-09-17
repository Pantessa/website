// ─────────────────────────────────────────────────────────────────────────
//  DCA AUTOPILOT — the pure half of the autonomous tier (Spend Permissions).
//
//  The trust model, in one breath: the user's SMART wallet signs ONE
//  SpendPermission whose allowance is EXACTLY the schedule's per-period
//  dollar amount — the on-chain SpendPermissionManager (Coinbase's audited
//  contract, the same address on every supported chain) caps what our
//  spender can ever pull, regardless of anything in this codebase. Each due
//  period the sweep pulls that exact amount, swaps it through the SAME
//  guarded venue builder as every other Pantessa swap with the output pinned
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
import { LINK_SWAP_FEE_BPS, SWAP_FEE_BPS, TREASURY_ADDRESS, swapFeeAtoms } from '@/lib/fees'
import { usdcAtomic, SPEND_PERMISSION_MANAGER } from '@/lib/spend-permission'
import { ADDRESS_THIS, FEE_TIERS, SWAP_ROUTER_02_ABI } from '@/lib/uniswap-venue'
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
  /** Pantessa's CDP-managed spender. */
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
  if (p.spender.toLowerCase() !== t.spender.toLowerCase()) problems.push('permission spender is not the bound Pantessa spender')
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

// ── The independent floor — the sweep reads a market mark and derives it;
//    guardAutoBuy holds the build's OWNER minimum to it. ─────────────────────

/** How far below the market the owner's minimum may sit before an autonomous
 *  buy refuses, in bps. The mark is usdPerToken: one whole token sold into its
 *  best v3 pool. The gap it measures therefore includes the pool fee both
 *  ways, the builder's 50 bps slippage bound, the treasury's cut and the buy's
 *  price impact. Measured on Base, 2026-09-17: 0.8–1.7% on 5–30 bps pools
 *  (ETH, cbBTC, AERO, VIRTUAL, EURC, ZORA), 2.7% on a 1% pool (MORPHO), and a
 *  thin USDC pool far past it (a $100 DEGEN buy: 44%). */
export const AUTO_BUY_FLOOR_BPS = 300

/**
 * The autonomous buy's independent floor, in the buy token's atoms: what the
 * pulled USDC (6 decimals) buys at `markUsd` (USD per whole token, read by the
 * sweep, never taken from the build), less AUTO_BUY_FLOOR_BPS. Bigint math off
 * the mark scaled to 1e18. Zero when no honest floor can be made (a mark that
 * isn't a positive finite number, bad decimals), and guardAutoBuy refuses a
 * zero floor.
 */
export function autoBuyFloorAtoms(pulledAtomic: bigint, markUsd: number, buyDecimals: number): bigint {
  const zero = BigInt(0)
  if (pulledAtomic <= zero || !Number.isInteger(buyDecimals) || buyDecimals < 0) return zero
  const markE18 = markUsd * 1e18
  if (!Number.isFinite(markE18) || markE18 < 1) return zero
  return (pulledAtomic * BigInt(10) ** BigInt(buyDecimals + 12) * BigInt(10_000 - AUTO_BUY_FLOOR_BPS)) / (BigInt(Math.round(markE18)) * BigInt(10_000))
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
  /** The schedule buys native ETH (lib/chains buysNativeEth on the
   *  schedule's own token): the output must be UNWRAPPED to the owner. False
   *  = an ERC-20 schedule, where an unwrap delivers the wrong asset. */
  nativeOut: boolean
  /** The txChain steps the venue builder produced ({to, data, value}). */
  steps: Array<{ to: string; data: string; value: string }>
  /** The exact atomic USDC the sweep pulled (== permission.allowance). */
  pulledAtomic: bigint
  /** The sweep's independent floor in the buy token's atoms
   *  (autoBuyFloorAtoms off the market mark). Zero refuses. */
  minOutAtomic: bigint
  nowSec: number
}

const check = (id: string, ok: boolean, note: string): GuardrailCheck => ({ id, level: 'block', ok, note })

/**
 * Every byte re-decoded against the pins, never against the build. Expected:
 * [approve(USDC → the pinned router, exactly the pull)] + swap, with swap =
 * SwapRouter02.multicall(deadline, calls), tokenIn = USDC, tokenOut = the
 * schedule token, amountIn = the pull, no price limit, a real v3 tier, and
 * calls in one of the shapes the v3 builder emits:
 *   ERC-20, fee off: [exactInputSingle(recipient = the OWNER)]
 *   ERC-20, fee on:  [exactInputSingle(recipient = the router),
 *                     sweepTokenWithFee(the token, the swap's minOut,
 *                                       the OWNER, a canonical tier, the treasury)]
 *   native ETH:      [exactInputSingle(recipient = the router),
 *                     unwrapWETH9WithFee(the swap's minOut, the OWNER,
 *                                        a canonical tier, the treasury)
 *                     | unwrapWETH9(the swap's minOut, the OWNER)]
 * The fee is the default (lib/fees), so fee on is what the sweep builds. The
 * floor guards the OWNER's proceeds: the swap's minOut and, fee on, the
 * minimum left after the treasury's cut must both clear it.
 */
export function guardAutoBuy(input: AutoBuyGuardInput): { ok: boolean; checks: GuardrailCheck[] } {
  const { schedule, permission, ownerWallet, spender, chain, expectedBuyAddr, nativeOut, steps, pulledAtomic, minOutAtomic, nowSec } = input
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

  const hasFloor = minOutAtomic > BigInt(0)
  checks.push(check('min-out', hasFloor, hasFloor ? 'An independent floor off the market mark is set.' : 'No independent floor — refusing a floorless autonomous buy.'))

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
          swapNote = `Expected swap(+payout) in the multicall, got ${calls.length} calls.`
        } else {
          const inner = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: calls[0] })
          if (inner.functionName === 'exactInputSingle') {
            const p = (inner.args as readonly unknown[])[0] as {
              tokenIn: string
              tokenOut: string
              fee: number
              recipient: string
              amountIn: bigint
              amountOutMinimum: bigint
              sqrtPriceLimitX96: bigint
            }
            const problems: string[] = []
            if (p.tokenIn.toLowerCase() !== chain.usdcAddress.toLowerCase()) problems.push('tokenIn is not USDC')
            if (p.tokenOut.toLowerCase() !== expectedBuyAddr.toLowerCase()) problems.push('tokenOut is not the schedule token')
            if (p.amountIn !== pulledAtomic) problems.push('amountIn is not the exact pull')
            // A price limit can stop the swap part-way: the output still clears
            // the minimum, the run reads "bought", and the unspent rest of the
            // pull stays on the spender. The builder never sets one.
            if (p.sqrtPriceLimitX96 !== BigInt(0)) problems.push('the swap carries a price limit, so it could spend only part of the pull')
            // A tier with no pool reverts, and by then the pull has happened.
            if (!(FEE_TIERS as readonly number[]).includes(Number(p.fee))) problems.push(`pool fee ${p.fee} is not a Uniswap v3 tier`)
            if (p.amountOutMinimum <= BigInt(0)) problems.push('no minimum-out bound')
            else if (p.amountOutMinimum < minOutAtomic) problems.push(`minOut ${p.amountOutMinimum} is below the floor ${minOutAtomic}`)
            let feeBips = 0
            if (calls.length === 2) {
              // Output parks on the router. An ERC-20 schedule: sweepTokenWithFee
              // pays the OWNER minus the treasury's canonical bps. A native-ETH
              // schedule: unwrapWETH9WithFee (or unwrapWETH9, fee off) pays the
              // owner in ETH. Either shape on the wrong schedule delivers the
              // wrong asset and refuses.
              if (p.recipient.toLowerCase() !== ADDRESS_THIS.toLowerCase()) problems.push(`swap pays ${p.recipient}, not the router the payout call pays from`)
              let payout: { functionName: string; args?: readonly unknown[] } | null = null
              try {
                payout = decodeFunctionData({ abi: SWAP_ROUTER_02_ABI, data: calls[1] })
              } catch {
                problems.push('second call does not decode as a SwapRouter02 payout')
              }
              if (payout) {
                const kind = nativeOut ? 'unwrap' : 'sweep'
                let paid: { min: bigint; to: string; fee: { bips: bigint; to: string } | null } | null = null
                if (nativeOut && payout.functionName === 'unwrapWETH9WithFee') {
                  const [min, to, bips, feeTo] = payout.args as readonly [bigint, string, bigint, string]
                  paid = { min, to, fee: { bips, to: feeTo } }
                } else if (nativeOut && payout.functionName === 'unwrapWETH9') {
                  const [min, to] = payout.args as readonly [bigint, string]
                  paid = { min, to, fee: null }
                } else if (!nativeOut && payout.functionName === 'sweepTokenWithFee') {
                  const [token, min, to, bips, feeTo] = payout.args as readonly [string, bigint, string, bigint, string]
                  if (token.toLowerCase() !== expectedBuyAddr.toLowerCase()) problems.push('the sweep is not for the schedule token')
                  paid = { min, to, fee: { bips, to: feeTo } }
                } else {
                  problems.push(
                    nativeOut
                      ? `second call is ${payout.functionName}, not an unwrap to native ETH — the schedule buys ETH`
                      : `second call is ${payout.functionName}, not sweepTokenWithFee`,
                  )
                }
                if (paid) {
                  if (paid.to.toLowerCase() !== owner) problems.push(`${kind} pays ${paid.to}, not the schedule owner`)
                  if (paid.fee) {
                    if (paid.fee.to.toLowerCase() !== TREASURY_ADDRESS.toLowerCase()) problems.push(`the fee goes to ${paid.fee.to}, not the Pantessa treasury`)
                    // 0 bps reverts on-chain; anything else is off our price list.
                    if (paid.fee.bips > BigInt(0) && [SWAP_FEE_BPS, LINK_SWAP_FEE_BPS].includes(Number(paid.fee.bips))) feeBips = Number(paid.fee.bips)
                    else problems.push(`fee ${paid.fee.bips}bps is not a canonical tier`)
                  }
                  if (paid.min !== p.amountOutMinimum) {
                    problems.push(`${kind} minimum ${paid.min} ≠ the swap's minOut ${p.amountOutMinimum}`)
                  } else if (feeBips > 0) {
                    // What the owner is guaranteed once the treasury takes its cut.
                    const ownerMin = paid.min - swapFeeAtoms(paid.min, feeBips)
                    if (ownerMin < minOutAtomic) problems.push(`the owner's minimum after the ${feeBips}bps fee, ${ownerMin}, is below the floor ${minOutAtomic}`)
                  }
                }
              }
            } else if (nativeOut) {
              problems.push('a direct payout delivers WETH — the schedule buys native ETH')
            } else if (p.recipient.toLowerCase() !== owner) {
              problems.push(`swap pays ${p.recipient}, not the schedule owner`)
            }
            swapOk = problems.length === 0
            const payoutWords = calls.length === 1 ? 'paid straight to the owner' : nativeOut ? 'unwrapped to the owner as native ETH' : 'swept to the owner'
            swapNote = swapOk
              ? `Swaps the exact pull USDC → the schedule token, ${payoutWords}${feeBips > 0 ? ` minus ${feeBips}bps to the treasury` : ''}, the owner's minimum at or above the floor.`
              : `${problems.join('; ')}.`
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
