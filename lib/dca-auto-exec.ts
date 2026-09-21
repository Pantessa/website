// ─────────────────────────────────────────────────────────────────────────
//  DCA AUTOPILOT — the I/O half: the arm/disarm chat turn, the arm
//  validation + on-chain simulation, and the sweep that executes due
//  periods. Guardian discipline throughout: originEnv fence, per-period
//  idempotency claims BEFORE any tx, kill-switch hold, fail-closed guard
//  (independent calldata re-decode) before anything is sent, and every
//  outcome lands as a receipt row (dca_auto_runs — the standing-value
//  table, guardian-runs pattern).
//
//  Execution order per due period (deliberate):
//    build swap (fresh quote + the floor off a market mark) → guardAutoBuy →
//    pull → approve → swap.
//  The guard runs BEFORE the pull, so a refused build costs nothing and the
//  user's USDC never moves. A buy that fails AFTER the pull (a price that
//  moved past the bound, a deadline) gets one fresh retry, re-guarded; if
//  that doesn't fill either, the USDC goes back to the owner — never a
//  second pull that period, and never parked on the spender
//  (lib/autopilot-unwind). A run that can't prove where the money went stays
//  UNWINDING, holds the schedule's next pulls, and the next pass reconciles.
// ─────────────────────────────────────────────────────────────────────────

import { spendPermissionManagerAbi } from '@coinbase/cdp-sdk'
import { encodeFunctionData, erc20Abi } from 'viem'
import prisma from '@/lib/db'
import { jobsEnv } from '@/lib/jobs-runner'
import { buysNativeEth, chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { getActiveGrant } from '@/lib/grant-store'
import { resolveToken, tokenDecimals } from '@/lib/cow'
import { ensureTokenList } from '@/lib/token-list'
import { buildUniswapSwap } from '@/lib/uniswap-venue'
import { usdPerToken } from '@/lib/usd-probe'
import { getSpenderAddress, isCdpConfigured, spendNetwork } from '@/lib/cdp'
import { SPEND_PERMISSION_MANAGER } from '@/lib/spend-permission'
import { cadenceLabel, periodKeyFor, type DcaCadence } from '@/lib/dca'
import type { DcaTurn } from '@/lib/dca-exec'
import { parseLedger, planRefund, reissueMatches } from '@/lib/autopilot-unwind'
import {
  permissionWindowSpend,
  resolveLedger,
  RunLedger,
  saleFailureWords,
  sendRunTx,
  settleRun,
  verifyPull,
  type SaleStep,
  type SettleResult,
} from '@/lib/autopilot-unwind-exec'
import { NATIVE_TOKEN_SENTINEL } from '@/lib/spot-guard'
import {
  autoBuyFloorAtoms,
  buildDcaSpendPermission,
  dcaUnwindCopy,
  guardAutoBuy,
  parseDcaAutoToggle,
  parsePermission,
  permissionMatchesSchedule,
  serializePermission,
  spendPermissionTypedData,
  usdcAtomsToHuman,
  type AutoBuyGuardInput,
  type DcaSpendPermission,
} from '@/lib/dca-auto'

type Trace = (event: unknown) => void

/** Autopilot v1 is Base-only: SpendPermissionManager + deep USDC venue
 *  liquidity live there. Robinhood-chain stock autopilot is the queued
 *  Permit2-executor lane. */
export const DCA_AUTO_CHAIN_ID = 8453

const LIVE_JOB = ['running', 'waiting_signature', 'waiting_settlement', 'paused']

// ── SpendPermissionManager reads/calls (Base public client, viem) ──────────

function baseClient() {
  const client = publicClientFor(DCA_AUTO_CHAIN_ID)
  if (!client) throw new Error('No Base RPC client configured.')
  return client
}

const permissionTuple = (p: DcaSpendPermission) => ({
  account: p.account,
  spender: p.spender,
  token: p.token,
  allowance: p.allowance,
  period: p.period,
  start: p.start,
  end: p.end,
  salt: p.salt,
  extraData: p.extraData,
})

/** The manager's LIVE EIP-712 domain (ERC-5267) — read from the contract so
 *  the typed data the user signs can never drift from what the chain
 *  verifies. Unreadable → null → the arm turn refuses (fail closed). */
export async function managerSigningDomain(): Promise<{ name: string; version: string } | null> {
  try {
    const [, name, version] = (await baseClient().readContract({
      address: SPEND_PERMISSION_MANAGER as `0x${string}`,
      abi: spendPermissionManagerAbi,
      functionName: 'eip712Domain',
    })) as unknown as [string, string, string, bigint, string, string, bigint[]]
    if (!name || !version) return null
    return { name, version }
  } catch {
    return null
  }
}

export async function managerGetHash(p: DcaSpendPermission): Promise<`0x${string}` | null> {
  try {
    return (await baseClient().readContract({
      address: SPEND_PERMISSION_MANAGER as `0x${string}`,
      abi: spendPermissionManagerAbi,
      functionName: 'getHash',
      args: [permissionTuple(p)],
    })) as `0x${string}`
  } catch {
    return null
  }
}

export async function managerIsApproved(p: DcaSpendPermission): Promise<boolean> {
  try {
    return (await baseClient().readContract({
      address: SPEND_PERMISSION_MANAGER as `0x${string}`,
      abi: spendPermissionManagerAbi,
      functionName: 'isApproved',
      args: [permissionTuple(p)],
    })) as boolean
  } catch {
    return false
  }
}

/** Prove the signature verifies ON-CHAIN before storing anything: simulate
 *  approveWithSignature from the spender. A wallet that can't back the
 *  permission (EOA, wrong signer, bad domain) reverts here — the arm is
 *  refused and nothing persists. */
// Exported for the Spot Guardian's arm route — one simulation rulebook.
export async function simulateApprove(p: DcaSpendPermission, signature: `0x${string}`, spender: `0x${string}`): Promise<{ ok: boolean; reason?: string }> {
  try {
    await baseClient().simulateContract({
      address: SPEND_PERMISSION_MANAGER as `0x${string}`,
      abi: spendPermissionManagerAbi,
      functionName: 'approveWithSignature',
      args: [permissionTuple(p), signature],
      account: spender,
    })
    return { ok: true }
  } catch (e) {
    return { ok: false, reason: (e as Error).message?.slice(0, 300) }
  }
}

// ── The arm/disarm chat turn ───────────────────────────────────────────────

/** The turn artifact the arm card consumes. Bigints ride as strings; the
 *  client rebuilds them for signTypedData. */
export interface DcaArmOffer {
  scheduleId: string
  network: 'base'
  spender: string
  /** serialized DcaSpendPermission (posts back verbatim with the signature) */
  permission: string
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    types: Record<string, Array<{ name: string; type: string }>>
    primaryType: 'SpendPermission'
    /** allowance + salt as strings for transport */
    message: Record<string, string | number>
  }
  /** what the permission enforces, for the card's copy */
  enforced: { buyUsd: number; cadence: DcaCadence; buyToken: string }
}

function randomSalt(): bigint {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return BigInt('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''))
}

/**
 * "make my ETH dca autonomous" / "turn off autopilot" — the autopilot
 * layer's chat turn. Runs BEFORE the manage grammar inside runDcaTurn.
 * Returns null when the message isn't an autopilot toggle.
 */
export async function runDcaAutoToggleTurn(
  message: string,
  wallet: string | undefined,
  trace: Trace,
  /** Does the SIWE session OWN `wallet`? Arming ends in the wallet's own
   *  signature (connect-to-act); DISARMING flips a standing plan with no
   *  signature and needs it (lib/chat-mutation-gate). Defaults CLOSED. */
  walletProven = false,
): Promise<DcaTurn | null> {
  const toggle = parseDcaAutoToggle(message)
  if (!toggle) return null
  trace({ type: 'status', label: `dca autopilot layer claimed the turn: ${toggle.op}${toggle.token ? ` ${toggle.token}` : ''} — planner bypassed` })
  if (!wallet) return { reply: '🤖 Connect your wallet first — autopilot belongs to a wallet.' }
  if (toggle.op === 'disarm' && !walletProven) {
    const { mutationGate } = await import('@/lib/chat-mutation-gate')
    trace({ type: 'note', level: 'warn', label: 'dca autopilot: disarm asked but the session does not own the wallet — answering the sign-in gate, nothing changed' })
    return { ...mutationGate('dca-autopilot'), buildPath: 'native-dca-auto' }
  }

  const schedules = await prisma.dcaSchedule.findMany({
    where: {
      wallet: wallet.toLowerCase(),
      originEnv: jobsEnv(),
      status: { in: ['active', 'paused'] },
      ...(toggle.token ? { buyToken: toggle.token } : {}),
    },
    orderBy: { createdAt: 'asc' },
  })
  if (schedules.length === 0) {
    return {
      reply: toggle.token
        ? `🤖 No ${toggle.token} recurring buy on this wallet — “list my dcas” shows what's active, or start one with “buy $10 of ${toggle.token} weekly”.`
        : '🤖 No recurring buys on this wallet yet — set one up first (e.g. “buy $10 of ETH weekly”), then say “make my dca autonomous”.',
      buildPath: 'native-dca-auto',
    }
  }
  if (schedules.length > 1) {
    return {
      reply: '🤖 You have more than one recurring buy — which one?',
      clarify: {
        question: `Which schedule should I ${toggle.op === 'arm' ? 'put on autopilot' : 'take off autopilot'}?`,
        options: schedules.slice(0, 4).map((s) => ({
          label: `${s.buyToken} (${cadenceLabel(s.cadence as DcaCadence)} $${s.buyUsd})`,
          resume: toggle.op === 'arm' ? `make my ${s.buyToken} dca autonomous` : `turn off my ${s.buyToken} dca autopilot`,
        })),
      },
      buildPath: 'native-dca-auto',
    }
  }
  const s = schedules[0]
  const label = `$${s.buyUsd} of ${s.buyToken} ${cadenceLabel(s.cadence as DcaCadence)}`

  if (toggle.op === 'disarm') {
    if (s.mode !== 'auto') {
      return { reply: `🤖 Your ${s.buyToken} recurring buy is already in confirm-mode — you sign every buy. “Make my ${s.buyToken} dca autonomous” arms it.`, buildPath: 'native-dca-auto' }
    }
    await prisma.dcaSchedule.update({ where: { id: s.id }, data: { mode: 'confirm', autoError: null } })
    trace({ type: 'status', label: `dca autopilot: disarmed schedule ${s.id.slice(0, 8)}` })
    return {
      reply:
        `🤖 **Autopilot off:** ${label} is back to confirm-mode — nothing buys without your signature. ` +
        `Pantessa stops pulling immediately; the on-chain permission stays yours to revoke from your wallet whenever you like. “Make my ${s.buyToken} dca autonomous” re-arms it.`,
      buildPath: 'native-dca-auto',
      dcaScheduleId: s.id,
    }
  }

  // ── arm ──
  if (s.mode === 'auto') {
    return {
      reply: `🤖 ${label} is already on autopilot${s.autoError ? ` — but it needs you: ${s.autoError}` : ' — each due period buys itself and the receipt lands in your rail. “Turn off autopilot” any time.'}`,
      buildPath: 'native-dca-auto',
      dcaScheduleId: s.id,
    }
  }
  if (s.chainId !== DCA_AUTO_CHAIN_ID) {
    const chainName = chainById(s.chainId)?.name ?? `chain ${s.chainId}`
    return {
      reply:
        `🤖 Autopilot runs on **Base** first — your ${s.buyToken} schedule lives on ${chainName}. ` +
        `The on-chain spending cap (Coinbase's Spend Permission contract) that makes autopilot non-custodial isn't wired there yet, so that schedule stays confirm-mode: you sign each buy. A Base schedule (“buy $${s.buyUsd} of ETH ${cadenceLabel(s.cadence as DcaCadence)} on base”) can be armed today.`,
      buildPath: 'native-dca-auto',
    }
  }
  if (!isCdpConfigured() || spendNetwork() !== 'base') {
    return {
      reply: `🤖 Autopilot's signing infrastructure isn't provisioned in this environment, so I won't offer an arm that can't execute. Your ${s.buyToken} schedule keeps working in confirm-mode — you sign each buy.`,
      buildPath: 'native-dca-auto',
    }
  }
  const stable = primaryStable(s.chainId)
  if (!stable || stable.symbol !== s.sellToken) {
    return { reply: `🤖 This schedule's spend token doesn't match the chain's canonical stable — I can't arm it safely.`, buildPath: 'native-dca-auto' }
  }
  // Smart-wallet check: the permission is enforced by the wallet's own
  // contract code, so an EOA has nothing to enforce it with. Deployed code =
  // eligible; the arm route's on-chain simulation is the decisive gate.
  const code = await baseClient().getCode({ address: wallet as `0x${string}` }).catch(() => undefined)
  if (!code || code === '0x') {
    return {
      reply:
        `🤖 **Autopilot needs a smart wallet.** ${label} can buy itself only if your wallet's own contract enforces the spending cap — that's what keeps it non-custodial (we hold a one-period allowance, never your keys). ` +
        `This wallet is a regular EOA, so it stays in confirm-mode: each due buy waits for your signature, which still takes one tap. ` +
        `A Coinbase Smart Wallet can arm this today; support for more wallets (EIP-7702 upgrades) is on the way.`,
      buildPath: 'native-dca-auto',
    }
  }
  const domain = await managerSigningDomain()
  if (!domain) {
    return { reply: `🤖 I couldn't read the Spend Permission contract's signing domain just now, so I won't offer a signature I can't verify — try again in a moment.`, buildPath: 'native-dca-auto' }
  }
  const spender = await getSpenderAddress()
  const permission = buildDcaSpendPermission({
    account: wallet,
    spender,
    token: stable.address,
    buyUsd: s.buyUsd,
    cadence: s.cadence as DcaCadence,
    nowSec: Math.floor(Date.now() / 1000),
    salt: randomSalt(),
  })
  const typed = spendPermissionTypedData(permission, s.chainId, domain)
  trace({ type: 'status', label: `dca autopilot: arm offer for schedule ${s.id.slice(0, 8)} (allowance $${s.buyUsd}/${s.cadence})` })
  return {
    reply:
      `🤖 **Put ${label} on autopilot.** One signature arms it: your wallet's own contract caps Pantessa's pull at **exactly $${s.buyUsd} per ${s.cadence}** — never more, expiring in a year, revocable on-chain any time. ` +
      `Each due period the buy executes itself through the same guarded venue route you sign today, the ${s.buyToken} lands straight in YOUR wallet, and the receipt shows up in your rail. Review and sign below.`,
    buildPath: 'native-dca-auto',
    dcaScheduleId: s.id,
    dcaArm: {
      scheduleId: s.id,
      network: 'base',
      spender,
      permission: serializePermission(permission),
      typedData: {
        domain: typed.domain as unknown as DcaArmOffer['typedData']['domain'],
        types: SPEND_PERMISSION_712_TYPES_JSON,
        primaryType: 'SpendPermission',
        message: {
          account: permission.account,
          spender: permission.spender,
          token: permission.token,
          allowance: permission.allowance.toString(),
          period: permission.period,
          start: permission.start,
          end: permission.end,
          salt: permission.salt.toString(),
          extraData: permission.extraData,
        },
      },
      enforced: { buyUsd: s.buyUsd, cadence: s.cadence as DcaCadence, buyToken: s.buyToken },
    },
  }
}

const SPEND_PERMISSION_712_TYPES_JSON: Record<string, Array<{ name: string; type: string }>> = {
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
}

// ── The arm route's core (POST /api/dca/[id]/arm) ─────────────────────────

export async function armDcaSchedule(
  scheduleId: string,
  wallet: string,
  permissionRaw: unknown,
  signature: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const s = await prisma.dcaSchedule.findUnique({ where: { id: scheduleId } })
  if (!s || s.wallet !== wallet.toLowerCase() || s.originEnv !== jobsEnv()) {
    return { status: 404, body: { error: 'No such schedule on this wallet.' } }
  }
  if (s.status === 'canceled') return { status: 409, body: { error: 'This schedule was canceled.' } }
  if (s.chainId !== DCA_AUTO_CHAIN_ID) return { status: 400, body: { error: 'Autopilot is Base-only for now.' } }
  if (!isCdpConfigured() || spendNetwork() !== 'base') return { status: 503, body: { error: 'Autopilot infrastructure is not provisioned.' } }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{2,}$/.test(signature) || signature.length > 8_192) {
    return { status: 400, body: { error: 'Malformed signature.' } }
  }
  const permission = parsePermission(permissionRaw)
  if (!permission) return { status: 400, body: { error: 'Malformed permission.' } }

  const stable = primaryStable(s.chainId)
  const spender = await getSpenderAddress()
  const match = permissionMatchesSchedule(permission, {
    ownerWallet: s.wallet,
    buyUsd: s.buyUsd,
    cadence: s.cadence as DcaCadence,
    usdcAddress: stable?.address ?? '',
    spender,
    nowSec: Math.floor(Date.now() / 1000),
  })
  if (!match.ok) return { status: 400, body: { error: `Permission does not match the schedule: ${match.problems.join('; ')}` } }

  const hash = await managerGetHash(permission)
  if (!hash) return { status: 502, body: { error: "Couldn't derive the permission hash from the contract — nothing stored, try again." } }

  // Decisive gate: the chain itself must accept this signature.
  const approved = await managerIsApproved(permission)
  if (!approved) {
    const sim = await simulateApprove(permission, signature as `0x${string}`, spender)
    if (!sim.ok) {
      return { status: 400, body: { error: `The chain rejected this permission signature — nothing stored. ${sim.reason ?? ''}`.trim() } }
    }
  }

  await prisma.dcaSchedule.update({
    where: { id: s.id },
    data: {
      mode: 'auto',
      permissionJson: serializePermission(permission),
      permissionSig: signature,
      permissionHash: hash,
      permissionApproved: approved,
      spender: spender.toLowerCase(),
      armNetwork: 'base',
      armedAt: new Date(),
      autoError: null,
    },
  })
  return {
    status: 200,
    body: {
      armed: true,
      scheduleId: s.id,
      permissionHash: hash,
      enforced: `$${s.buyUsd} per ${s.cadence}, expires ${new Date(permission.end * 1000).toISOString().slice(0, 10)}`,
    },
  }
}

// ── The buy build (the sweep's step 1) ─────────────────────────────────────

export interface AutoBuyBuild {
  /** approve? + swap, sent exactly as guardAutoBuy decodes them. */
  steps: AutoBuyGuardInput['steps']
  /** The guard's independent floor, in the buy token's atoms. */
  minOutAtomic: bigint
  /** The registry pins and the resolved buy token the guard checks against. */
  guardChain: AutoBuyGuardInput['chain']
  expectedBuyAddr: string
  nativeOut: boolean
  /** The builder's one-line receipt. */
  summary: string
}

/**
 * A period's buy, built exactly as the sweep sends it: a fresh v3 quote for
 * the exact pull, output pinned to the owner at the builder's default fee,
 * and the independent floor off a market mark read here, never off the
 * build. No DB writes, no CDP, nothing signed: the sweep and the harness's
 * live pin both run this, so guardAutoBuy is always proven against the build
 * it really gets.
 */
export async function buildAutoBuy(input: {
  chainId: number
  sellToken: string
  buyToken: string
  ownerWallet: string
  spender: string
  pulled: bigint
}): Promise<{ ok: true; build: AutoBuyBuild } | { ok: false; detail: string }> {
  const stable = primaryStable(input.chainId)
  await ensureTokenList(input.chainId)
  const buyAddr = resolveToken(input.buyToken, input.chainId)
  if (!stable || !buyAddr) {
    return { ok: false, detail: `Couldn't resolve ${input.buyToken}/USDC on Base — nothing pulled.` }
  }
  // The router pin comes from the REGISTRY — never from the built tx.
  const registryRouter = chainById(input.chainId)?.uniswap?.swapRouter02
  if (!registryRouter) {
    return { ok: false, detail: 'No registry-pinned SwapRouter02 for this chain — refused. Nothing pulled.' }
  }
  const buyDecimals = tokenDecimals(input.buyToken, input.chainId)
  const mark = await usdPerToken(input.chainId, input.buyToken).catch(() => null)
  if (buyDecimals === null || !mark) {
    return { ok: false, detail: `Couldn't price ${input.buyToken} on Base to set the buy's floor — refused. Nothing pulled.` }
  }
  const built = await buildUniswapSwap({
    sellToken: input.sellToken,
    buyToken: input.buyToken,
    amountHuman: usdcAtomsToHuman(input.pulled),
    from: input.spender,
    chainId: input.chainId,
    recipient: input.ownerWallet,
  })
  if (built.blocked) {
    return { ok: false, detail: `Venue build refused: ${built.guardrails.checks.filter((c) => !c.ok).map((c) => c.note).join(' ') || 'guardrail block'} Nothing pulled.` }
  }
  // The spender's USDC needs no allowance reset (lib/erc20-approval); a build
  // that carries one is not the shape guardAutoBuy checks — stop before the pull.
  if (built.resetTx) return { ok: false, detail: 'Venue build carried an allowance reset this autopilot does not send. Nothing pulled.' }
  return {
    ok: true,
    build: {
      steps: [...(built.approveTx ? [built.approveTx] : []), built.swapTx].map((s) => ({ to: s.to, data: s.data, value: s.value })),
      minOutAtomic: autoBuyFloorAtoms(input.pulled, mark.usd, buyDecimals),
      guardChain: { chainId: input.chainId, swapRouter02: registryRouter, usdcAddress: stable.address },
      expectedBuyAddr: buyAddr,
      nativeOut: buysNativeEth(input.buyToken, input.chainId),
      summary: built.summary,
    },
  }
}

// ── The sweep (cron) ───────────────────────────────────────────────────────

/** buildAutoBuy's refusal as the run's own words: the sweep's `fail` adds
 *  "Nothing pulled." itself, and a settle note reads it mid-sentence. */
const asWords = (detail: string) => {
  const w = detail.replace(/\s*(—\s*)?nothing pulled\.?\s*$/i, '').trim()
  return w ? w[0].toLowerCase() + w.slice(1) : 'the build refused'
}

export interface AutoSweepSummary {
  scanned: number
  executed: number
  bought: string[]
  held: string[]
  failed: string[]
  skipped: string[]
  /** Pulled, the buy didn't go through, the USDC went back to the owner. */
  refunded: string[]
  /** Pulled, and where the money went isn't proven yet (reconcile continues). */
  unwinding: string[]
}

/** An execution can take ~30s (pull, buy, maybe a retry and a refund) and
 *  the cron's function budget is 60s: no new execution starts after this. */
const SWEEP_START_BY_MS = 20_000

/** The period word a schedule's receipt copy uses. */
const cadenceNoun = (c: DcaCadence) => (c === 'day' ? 'day' : c === 'week' ? 'week' : 'month')

/**
 * Execute every armed schedule whose current UTC period has no claim yet.
 * `limit` bounds EXECUTIONS per sweep (each is ~2–4 Base txs) so the route
 * fits its duration budget — the hourly cadence drains any backlog.
 */
export async function executeAutoDcaSweep(limit = 2): Promise<AutoSweepSummary> {
  const startedAt = Date.now()
  const summary: AutoSweepSummary = { scanned: 0, executed: 0, bought: [], held: [], failed: [], skipped: [], refunded: [], unwinding: [] }
  if (!isCdpConfigured() || spendNetwork() !== 'base') return summary

  // Earlier passes' open runs first (a pull that couldn't prove where the
  // money went), then this period's buys.
  const reconciled = await reconcileDcaAutoRuns().catch(() => null)
  if (reconciled) {
    summary.bought.push(...reconciled.bought)
    summary.refunded.push(...reconciled.refunded)
    summary.unwinding.push(...reconciled.unwinding)
    summary.failed.push(...reconciled.failed)
  }

  const schedules = await prisma.dcaSchedule.findMany({
    where: { mode: 'auto', status: 'active', originEnv: jobsEnv(), chainId: DCA_AUTO_CHAIN_ID },
    orderBy: { armedAt: 'asc' },
  })
  summary.scanned = schedules.length

  for (const s of schedules) {
    if (summary.executed >= limit) break
    if (Date.now() - startedAt > SWEEP_START_BY_MS) break // the next hour picks it up
    const cadence = s.cadence as DcaCadence
    const periodKey = periodKeyFor(cadence)
    const tag = `${s.id.slice(0, 8)}:${periodKey}`

    const claimed = await prisma.dcaAutoRun.findUnique({ where: { scheduleId_periodKey: { scheduleId: s.id, periodKey } } })
    if (claimed) continue

    // An earlier period's pull still unaccounted for holds every new pull on
    // this schedule: never move more of the owner's money while some is
    // on its way back (reconcile above closes it).
    const open = await prisma.dcaAutoRun.findFirst({ where: { scheduleId: s.id, status: { in: ['running', 'unwinding'] } }, select: { periodKey: true } })
    if (open) {
      summary.held.push(tag)
      continue
    }

    // A manual buy in flight or settled this period wins — autopilot defers.
    const manual = await prisma.dcaRun.findUnique({ where: { scheduleId_periodKey: { scheduleId: s.id, periodKey } } })
    if (manual?.jobId) {
      const job = await prisma.job.findUnique({ where: { id: manual.jobId }, select: { status: true } })
      if (job?.status === 'done') {
        await prisma.dcaAutoRun
          .create({ data: { scheduleId: s.id, wallet: s.wallet, periodKey, status: 'skipped', detail: 'Bought manually this period — autopilot deferred.' } })
          .catch(() => {})
        summary.skipped.push(tag)
        continue
      }
      if (job && LIVE_JOB.includes(job.status)) {
        summary.skipped.push(tag)
        continue // no claim — revisit next sweep in case the manual offer lapses
      }
    }

    // Kill switch: an explicit pause halts pulls, visibly, without claiming
    // the period (resumes where it left off when unpaused).
    const grant = await getActiveGrant(s.wallet)
    if (grant?.paused) {
      await prisma.dcaSchedule.update({ where: { id: s.id }, data: { autoError: 'Kill switch is paused — autopilot is holding (nothing pulled).' } })
      summary.held.push(tag)
      continue
    }

    const permission = parsePermission(s.permissionJson)
    const nowSec = Math.floor(Date.now() / 1000)
    if (!permission || !s.spender || !s.permissionSig) {
      await prisma.dcaSchedule.update({ where: { id: s.id }, data: { autoError: 'Stored permission is unreadable — re-arm to continue.' } })
      summary.held.push(tag)
      continue
    }
    if (permission.end <= nowSec) {
      await prisma.dcaSchedule.update({ where: { id: s.id }, data: { autoError: 'Permission expired — say “make my dca autonomous” to re-arm.' } })
      summary.held.push(tag)
      continue
    }

    // Claim BEFORE any tx — overlapping crons converge on one attempt.
    let run
    try {
      run = await prisma.dcaAutoRun.create({ data: { scheduleId: s.id, wallet: s.wallet, periodKey, status: 'running' } })
    } catch {
      continue // lost the claim race
    }
    summary.executed += 1

    // Before the pull only: nothing has moved, so the run can say so.
    const fail = async (detail: string) => {
      await prisma.dcaAutoRun.update({ where: { id: run.id }, data: { status: 'failed', detail } }).catch(() => {})
      await prisma.dcaSchedule.update({ where: { id: s.id }, data: { autoError: detail } }).catch(() => {})
      summary.failed.push(tag)
    }

    // The run's ledger, once the first spender send is about to go out. It
    // holds only intents the database took, so it knows whether a pull went.
    let ledger: RunLedger | null = null
    try {
      const spender = await getSpenderAddress()
      if (spender.toLowerCase() !== s.spender) {
        await fail('Bound spender changed — re-arm to continue. Nothing pulled.')
        continue
      }
      // The refund's WETH pin and the chain's registry row.
      const chain = chainById(s.chainId)
      if (!chain) {
        await fail('Unknown chain — refused. Nothing pulled.')
        continue
      }
      const pulled = permission.allowance

      // 1. Build fresh + the independent floor + guard — BEFORE any money
      //    moves. A retry after the pull runs this same build and guard again.
      //    buildAutoBuy is what the harness's live pin builds too.
      let summaryLine = ''
      const buildBuy = async (): Promise<{ ok: true; steps: SaleStep[]; summary: string } | { ok: false; words: string }> => {
        const buy = await buildAutoBuy({ chainId: s.chainId, sellToken: s.sellToken, buyToken: s.buyToken, ownerWallet: s.wallet, spender, pulled })
        if (!buy.ok) return { ok: false, words: asWords(buy.detail) }
        const { steps: raw, minOutAtomic, guardChain, expectedBuyAddr, nativeOut } = buy.build
        const guard = guardAutoBuy({
          schedule: { mode: s.mode, status: s.status, buyUsd: s.buyUsd, cadence, chainId: s.chainId },
          permission,
          ownerWallet: s.wallet,
          spender,
          chain: guardChain,
          expectedBuyAddr,
          nativeOut,
          steps: raw,
          pulledAtomic: pulled,
          minOutAtomic,
          nowSec: Math.floor(Date.now() / 1000),
        })
        if (!guard.ok) return { ok: false, words: `the autopilot guard refused: ${guard.checks.filter((c) => !c.ok).map((c) => c.note).join(' ')}` }
        const steps: SaleStep[] = raw.map((t, i) => ({ step: i === raw.length - 1 ? 'swap' : 'approve', to: t.to, data: t.data, value: t.value ?? '0' }))
        return { ok: true, steps, summary: buy.build.summary }
      }
      const first = await buildBuy()
      if (!first.ok) {
        await fail(`${first.words[0].toUpperCase()}${first.words.slice(1)} Nothing pulled.`)
        continue
      }
      summaryLine = first.summary

      // 2. Approve the permission on-chain once (first run), then pull. Every
      //    spender send from here is written to the run's ledger first and
      //    carries its derived idempotency key (lib/autopilot-unwind).
      ledger = dcaLedger(run.id, null)!
      if (!s.permissionApproved && !(await managerIsApproved(permission))) {
        const permit = await sendRunTx(ledger, 1, {
          step: 'permit',
          to: SPEND_PERMISSION_MANAGER,
          data: encodeManagerCall('approveWithSignature', [permissionTuple(permission), s.permissionSig as `0x${string}`]),
          value: '0',
        })
        if (permit.outcome !== 'success') {
          await fail(`The permission couldn't be approved on-chain (${permit.words}). Nothing pulled.`)
          continue
        }
      }
      if (!s.permissionApproved) {
        await prisma.dcaSchedule.update({ where: { id: s.id }, data: { permissionApproved: true } }).catch(() => {})
      }
      const pull = await sendRunTx(ledger, 1, {
        step: 'spend',
        to: SPEND_PERMISSION_MANAGER,
        data: encodeManagerCall('spend', [permissionTuple(permission), pulled]),
        value: '0',
      })
      if ('hash' in pull && pull.hash) await prisma.dcaAutoRun.update({ where: { id: run.id }, data: { spendTx: pull.hash } }).catch(() => {})
      if (pull.outcome === 'refused' || pull.outcome === 'reverted') {
        await fail(`The pull didn't go through (${pull.words}). Nothing pulled.`)
        continue
      }

      // 3. From here the owner's USDC may sit on the spender, so the run
      //    ends bought, refunded, or unwinding: never "failed".
      let result: SettleResult
      if (pull.outcome === 'unresolved') {
        result = { kind: 'unwinding', note: `the pull was sent and isn't confirmed yet (${pull.words})`, operator: false, why: '' }
      } else {
        const verified = await verifyPull({ ledger, permission, permissionHash: s.permissionHash, pulledAtomic: pulled, nativeSentinel: NATIVE_TOKEN_SENTINEL, receipt: pull.receipt })
        result = await settleRun({
          ledger,
          native: false,
          pullVerified: verified.ok,
          allowRetry: true,
          firstSteps: first.steps,
          // Attempt 2: a fresh quote, the same guard. The kill switch stops it.
          rebuild: async () => {
            if ((await getActiveGrant(s.wallet))?.paused) return { ok: false, words: 'the kill switch was paused, so nothing buys' }
            const again = await buildBuy()
            if (!again.ok) return again
            summaryLine = again.summary
            return { ok: true, steps: again.steps }
          },
          refund: { permission, ownerWallet: s.wallet, pulledAtomic: pulled, nativeSentinel: NATIVE_TOKEN_SENTINEL, wethAddress: chain.wrappedNative },
        })
        if (result.kind === 'unwinding' && result.operator && !verified.ok) result = { ...result, note: `${result.note} ${verified.note}` }
      }
      await recordDcaSettle(s, run.id, result, summaryLine, summary, tag)
    } catch (e) {
      // A throw after a pull went out must not read "nothing pulled": the run
      // parks unwinding and the next pass's reconcile reads its ledger.
      const words = ((e as Error).message ?? String(e)).split('\n')[0].slice(0, 240)
      if (ledger?.entries.some((x) => x.step === 'spend')) {
        await recordDcaSettle(s, run.id, { kind: 'unwinding', note: `the sweep stopped mid-run (${words})`, operator: false, why: '' }, '', summary, tag).catch(() => {})
      } else {
        await fail(`Autopilot run failed: ${words}. Nothing pulled.`)
      }
    }
  }
  return summary
}

// ── Recording a pulled run's end ────────────────────────────────────────────

async function recordDcaSettle(
  s: { id: string; buyUsd: number; buyToken: string; cadence: string },
  runId: string,
  result: SettleResult,
  summaryLine: string,
  summary: Pick<AutoSweepSummary, 'bought' | 'refunded' | 'unwinding' | 'failed'>,
  tag: string,
): Promise<void> {
  if (result.kind === 'sold') {
    await prisma.dcaAutoRun.update({
      where: { id: runId },
      data: { status: 'bought', swapTx: result.hash, valueUsd: s.buyUsd, detail: summaryLine || `Bought $${s.buyUsd} of ${s.buyToken} to the owner.` },
    })
    await prisma.dcaSchedule.update({ where: { id: s.id }, data: { autoError: null } }).catch(() => {})
    summary.bought.push(tag)
    return
  }
  if (result.kind === 'nothing-pulled') {
    const detail = `The sweep stopped before the pull landed (${result.note}) — nothing pulled.`
    await prisma.dcaAutoRun.update({ where: { id: runId }, data: { status: 'failed', detail } }).catch(() => {})
    await prisma.dcaSchedule.update({ where: { id: s.id }, data: { autoError: detail } }).catch(() => {})
    summary.failed.push(tag)
    return
  }
  // A person has to look: say so where one will (the function's logs).
  if (result.kind === 'unwinding' && result.operator) console.error(`[dca-auto] run ${runId} ($${s.buyUsd} USDC) needs an operator: ${result.note}`)
  const copy = dcaUnwindCopy({
    outcome: result.kind === 'refunded' ? 'refunded' : result.operator ? 'operator' : 'unwinding',
    buyUsd: s.buyUsd,
    buyToken: s.buyToken,
    period: cadenceNoun(s.cadence as DcaCadence),
    why: result.why,
    refundTx: result.kind === 'refunded' ? result.hash : undefined,
    note: result.kind === 'unwinding' ? result.note : undefined,
  })
  await prisma.dcaAutoRun
    .update({ where: { id: runId }, data: { status: result.kind === 'refunded' ? 'refunded' : 'unwinding', ...(result.kind === 'refunded' ? { refundTx: result.hash } : {}), detail: copy } })
    .catch(() => {})
  await prisma.dcaSchedule.update({ where: { id: s.id }, data: { autoError: copy } }).catch(() => {})
  if (result.kind === 'refunded') summary.refunded.push(tag)
  else summary.unwinding.push(tag)
}

function dcaLedger(runId: string, raw: string | null): RunLedger | null {
  return RunLedger.open('dca', runId, raw, async (json) => {
    await prisma.dcaAutoRun.update({ where: { id: runId }, data: { txLog: json } })
  })
}

// ── Reconcile: runs an earlier pass left open ──────────────────────────────

/** A run the in-pass flow still owns writes its ledger every few seconds;
 *  one quiet this long was left by a pass that ended (timed out, killed). */
const UNWINDING_QUIET_MS = 90_000
const RUNNING_STALE_MS = 3 * 60_000

/**
 * Close what an earlier pass left open (a run parked UNWINDING, or one still
 * RUNNING long after any pass could own it): resolve the ledger's open sends
 * from receipts or replayed keys, then run the decision table with no
 * retry, so a later pass returns the USDC and never buys late.
 */
export async function reconcileDcaAutoRuns(limit = 3): Promise<Pick<AutoSweepSummary, 'bought' | 'refunded' | 'unwinding' | 'failed'>> {
  const out: Pick<AutoSweepSummary, 'bought' | 'refunded' | 'unwinding' | 'failed'> = { bought: [], refunded: [], unwinding: [], failed: [] }
  const now = Date.now()
  const runs = await prisma.dcaAutoRun.findMany({
    where: {
      schedule: { originEnv: jobsEnv(), chainId: DCA_AUTO_CHAIN_ID },
      OR: [
        { status: 'unwinding', updatedAt: { lt: new Date(now - UNWINDING_QUIET_MS) } },
        { status: 'running', updatedAt: { lt: new Date(now - RUNNING_STALE_MS) } },
      ],
    },
    include: { schedule: true },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })
  for (const run of runs) {
    // The row's updatedAt is the lease: only one pass takes a quiet run.
    const lease = await prisma.dcaAutoRun.updateMany({ where: { id: run.id, updatedAt: run.updatedAt }, data: { status: run.status } })
    if (lease.count !== 1) continue
    const s = run.schedule
    const tag = `${s.id.slice(0, 8)}:${run.periodKey}`
    const permission = parsePermission(s.permissionJson)
    const ledger = dcaLedger(run.id, run.txLog)
    const chain = chainById(s.chainId)
    const router = chain?.uniswap?.swapRouter02
    const stable = primaryStable(s.chainId)
    if (!permission || !ledger || !router || !chain || !stable) {
      await recordDcaSettle(s, run.id, { kind: 'unwinding', note: "the run's ledger or permission doesn't read", operator: true, why: '' }, '', out, tag)
      continue
    }
    const pulled = permission.allowance
    try {
      const refunds = planRefund({ form: 'erc20', ownerWallet: s.wallet, pulledAtomic: pulled, token: permission.token, wethAddress: chain.wrappedNative })
      const expected = {
        ...(s.permissionSig && /^0x[0-9a-fA-F]+$/.test(s.permissionSig)
          ? { permit: [{ to: SPEND_PERMISSION_MANAGER, data: encodeManagerCall('approveWithSignature', [permissionTuple(permission), s.permissionSig as `0x${string}`]), value: '0' }] }
          : {}),
        spend: [{ to: SPEND_PERMISSION_MANAGER, data: encodeManagerCall('spend', [permissionTuple(permission), pulled]), value: '0' }],
        approve: [{ to: stable.address, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [router, pulled] }), value: '0' }],
        return: refunds,
      }
      await resolveLedger(ledger, {
        spendLanded: async () => {
          const at = ledger.entries.find((e) => e.step === 'spend')?.at ?? Math.floor(run.createdAt.getTime() / 1000)
          const w = await permissionWindowSpend(permission, at)
          if (w === null || w === 'overwritten') return null
          if (w.spend === BigInt(0)) return false
          // One pull per window: if another run of this schedule confirmed a
          // pull in the same window, that was the window's pull, not this one.
          const siblings = await prisma.dcaAutoRun.findMany({
            where: { scheduleId: s.id, id: { not: run.id }, createdAt: { gte: new Date((w.start - 300) * 1000), lt: new Date(w.end * 1000) } },
            select: { txLog: true },
          })
          const siblingPulled = siblings.some((x) => parseLedger(x.txLog)?.some((e) => e.step === 'spend' && e.outcome === 'success' && e.at >= w.start - 300 && e.at < w.end))
          return !siblingPulled
        },
        expected: (e) => reissueMatches(e, expected, router),
      })
      const verified = await verifyPull({ ledger, permission, permissionHash: s.permissionHash, pulledAtomic: pulled, nativeSentinel: NATIVE_TOKEN_SENTINEL })
      let result = await settleRun({
        ledger,
        native: false,
        pullVerified: verified.ok,
        allowRetry: false,
        rebuild: async () => ({ ok: false, words: 'a later pass never buys' }),
        refund: { permission, ownerWallet: s.wallet, pulledAtomic: pulled, nativeSentinel: NATIVE_TOKEN_SENTINEL, wethAddress: chain.wrappedNative },
      })
      if (result.kind === 'unwinding' && result.operator && !verified.ok) result = { ...result, note: `${result.note} ${verified.note}` }
      await recordDcaSettle(s, run.id, result, '', out, tag)
    } catch (e) {
      const words = ((e as Error).message ?? String(e)).split('\n')[0].slice(0, 200)
      await recordDcaSettle(s, run.id, { kind: 'unwinding', note: `reconcile stopped (${words})`, operator: false, why: saleFailureWords(ledger.entries) }, '', out, tag)
    }
  }
  return out
}

// Local encode helper — viem's encodeFunctionData against the vendored
// manager ABI (kept here so the pure module never imports the SDK).
function encodeManagerCall(functionName: 'approveWithSignature' | 'spend', args: readonly unknown[]): `0x${string}` {
  return encodeFunctionData({ abi: spendPermissionManagerAbi, functionName, args } as Parameters<typeof encodeFunctionData>[0])
}
