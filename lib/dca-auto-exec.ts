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
//    build swap (fresh quote) → guardAutoBuy → pull → approve → swap.
//  The guard runs BEFORE the pull, so a refused build costs nothing and the
//  user's USDC never moves. A post-pull revert (slippage) leaves the pull
//  parked on the spender, recorded honestly — never retried into a second
//  pull that period.
// ─────────────────────────────────────────────────────────────────────────

import { spendPermissionManagerAbi } from '@coinbase/cdp-sdk'
import { encodeFunctionData } from 'viem'
import prisma from '@/lib/db'
import { jobsEnv } from '@/lib/jobs-runner'
import { chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { getActiveGrant } from '@/lib/grant-store'
import { resolveToken } from '@/lib/cow'
import { ensureTokenList } from '@/lib/token-list'
import { buildUniswapSwap } from '@/lib/uniswap-venue'
import { getSpenderAddress, isCdpConfigured, sendSpenderTx, spendNetwork } from '@/lib/cdp'
import { SPEND_PERMISSION_MANAGER } from '@/lib/spend-permission'
import { cadenceLabel, periodKeyFor, type DcaCadence } from '@/lib/dca'
import type { DcaTurn } from '@/lib/dca-exec'
import {
  buildDcaSpendPermission,
  guardAutoBuy,
  parseDcaAutoToggle,
  parsePermission,
  permissionMatchesSchedule,
  serializePermission,
  spendPermissionTypedData,
  usdcAtomsToHuman,
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
async function simulateApprove(p: DcaSpendPermission, signature: `0x${string}`, spender: `0x${string}`): Promise<{ ok: boolean; reason?: string }> {
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
export async function runDcaAutoToggleTurn(message: string, wallet: string | undefined, trace: Trace): Promise<DcaTurn | null> {
  const toggle = parseDcaAutoToggle(message)
  if (!toggle) return null
  trace({ type: 'status', label: `dca autopilot layer claimed the turn: ${toggle.op}${toggle.token ? ` ${toggle.token}` : ''} — planner bypassed` })
  if (!wallet) return { reply: '🤖 Connect your wallet first — autopilot belongs to a wallet.' }

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
        `Yeetful stops pulling immediately; the on-chain permission stays yours to revoke from your wallet whenever you like. “Make my ${s.buyToken} dca autonomous” re-arms it.`,
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
      `🤖 **Put ${label} on autopilot.** One signature arms it: your wallet's own contract caps Yeetful's pull at **exactly $${s.buyUsd} per ${s.cadence}** — never more, expiring in a year, revocable on-chain any time. ` +
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

// ── The sweep (cron) ───────────────────────────────────────────────────────

export interface AutoSweepSummary {
  scanned: number
  executed: number
  bought: string[]
  held: string[]
  failed: string[]
  skipped: string[]
}

async function waitTx(hash: `0x${string}`): Promise<void> {
  const receipt = await baseClient().waitForTransactionReceipt({ hash, timeout: 60_000 })
  if (receipt.status !== 'success') throw new Error(`tx ${hash} reverted`)
}

/**
 * Execute every armed schedule whose current UTC period has no claim yet.
 * `limit` bounds EXECUTIONS per sweep (each is ~2–4 Base txs) so the route
 * fits its duration budget — the hourly cadence drains any backlog.
 */
export async function executeAutoDcaSweep(limit = 2): Promise<AutoSweepSummary> {
  const summary: AutoSweepSummary = { scanned: 0, executed: 0, bought: [], held: [], failed: [], skipped: [] }
  if (!isCdpConfigured() || spendNetwork() !== 'base') return summary

  const schedules = await prisma.dcaSchedule.findMany({
    where: { mode: 'auto', status: 'active', originEnv: jobsEnv(), chainId: DCA_AUTO_CHAIN_ID },
    orderBy: { armedAt: 'asc' },
  })
  summary.scanned = schedules.length

  for (const s of schedules) {
    if (summary.executed >= limit) break
    const cadence = s.cadence as DcaCadence
    const periodKey = periodKeyFor(cadence)
    const tag = `${s.id.slice(0, 8)}:${periodKey}`

    const claimed = await prisma.dcaAutoRun.findUnique({ where: { scheduleId_periodKey: { scheduleId: s.id, periodKey } } })
    if (claimed) continue

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

    const fail = async (detail: string) => {
      await prisma.dcaAutoRun.update({ where: { id: run.id }, data: { status: 'failed', detail } }).catch(() => {})
      await prisma.dcaSchedule.update({ where: { id: s.id }, data: { autoError: detail } }).catch(() => {})
      summary.failed.push(tag)
    }

    try {
      const stable = primaryStable(s.chainId)
      await ensureTokenList(s.chainId)
      const buyAddr = resolveToken(s.buyToken, s.chainId)
      if (!stable || !buyAddr) {
        await fail(`Couldn't resolve ${s.buyToken}/USDC on Base — nothing pulled.`)
        continue
      }
      const spender = await getSpenderAddress()
      if (spender.toLowerCase() !== s.spender) {
        await fail('Bound spender changed — re-arm to continue. Nothing pulled.')
        continue
      }
      // The router pin comes from the REGISTRY — never from the built tx.
      const registryRouter = chainById(s.chainId)?.uniswap?.swapRouter02
      if (!registryRouter) {
        await fail('No registry-pinned SwapRouter02 for this chain — refused. Nothing pulled.')
        continue
      }
      const pulled = permission.allowance

      // 1. Build fresh + guard — BEFORE any money moves.
      const built = await buildUniswapSwap({
        sellToken: s.sellToken,
        buyToken: s.buyToken,
        amountHuman: usdcAtomsToHuman(pulled),
        from: spender,
        chainId: s.chainId,
        recipient: s.wallet,
      })
      if (built.blocked) {
        await fail(`Venue build refused: ${built.guardrails.checks.filter((c) => !c.ok).map((c) => c.note).join(' ') || 'guardrail block'} Nothing pulled.`)
        continue
      }
      const steps = [...(built.approveTx ? [built.approveTx] : []), built.swapTx]
      const guard = guardAutoBuy({
        schedule: { mode: s.mode, status: s.status, buyUsd: s.buyUsd, cadence, chainId: s.chainId },
        permission,
        ownerWallet: s.wallet,
        spender,
        chain: { chainId: s.chainId, swapRouter02: registryRouter, usdcAddress: stable.address },
        expectedBuyAddr: buyAddr,
        steps,
        pulledAtomic: pulled,
        nowSec,
      })
      if (!guard.ok) {
        await fail(`Autopilot guard refused: ${guard.checks.filter((c) => !c.ok).map((c) => c.note).join(' ')} Nothing pulled.`)
        continue
      }

      // 2. Approve the permission on-chain once (first run), then pull.
      if (!s.permissionApproved && !(await managerIsApproved(permission))) {
        const approveHash = await sendSpenderTx({
          to: SPEND_PERMISSION_MANAGER as `0x${string}`,
          data: encodeManagerCall('approveWithSignature', [permissionTuple(permission), s.permissionSig as `0x${string}`]),
        })
        await waitTx(approveHash)
      }
      if (!s.permissionApproved) {
        await prisma.dcaSchedule.update({ where: { id: s.id }, data: { permissionApproved: true } }).catch(() => {})
      }
      const spendHash = await sendSpenderTx({
        to: SPEND_PERMISSION_MANAGER as `0x${string}`,
        data: encodeManagerCall('spend', [permissionTuple(permission), pulled]),
      })
      await waitTx(spendHash)
      await prisma.dcaAutoRun.update({ where: { id: run.id }, data: { spendTx: spendHash } }).catch(() => {})

      // 3. Execute the guarded build exactly as decoded.
      for (const step of steps) {
        const hash = await sendSpenderTx({ to: step.to as `0x${string}`, data: step.data as `0x${string}` })
        await waitTx(hash)
        if (step === built.swapTx) {
          await prisma.dcaAutoRun.update({ where: { id: run.id }, data: { swapTx: hash } }).catch(() => {})
        }
      }

      await prisma.dcaAutoRun.update({
        where: { id: run.id },
        data: { status: 'bought', valueUsd: s.buyUsd, detail: built.summary },
      })
      await prisma.dcaSchedule.update({ where: { id: s.id }, data: { autoError: null } }).catch(() => {})
      summary.bought.push(tag)
    } catch (e) {
      await fail(`Autopilot run failed: ${(e as Error).message?.slice(0, 240)}`)
    }
  }
  return summary
}

// Local encode helper — viem's encodeFunctionData against the vendored
// manager ABI (kept here so the pure module never imports the SDK).
function encodeManagerCall(functionName: 'approveWithSignature' | 'spend', args: readonly unknown[]): `0x${string}` {
  return encodeFunctionData({ abi: spendPermissionManagerAbi, functionName, args } as Parameters<typeof encodeFunctionData>[0])
}
