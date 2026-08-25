// ─────────────────────────────────────────────────────────────────────────
//  SPOT GUARDIAN — the I/O half: the arm/manage chat turn, the arm
//  validation (chain-simulated, nothing stored on a signature the chain
//  would reject), and the per-minute sweep. DCA-autopilot discipline
//  throughout: originEnv fence, claim BEFORE any tx, kill-switch hold,
//  guardSpotSell (independent re-decode) before anything moves, every
//  outcome a receipt row (spot_guard_runs).
//
//  Execution order on a fired trigger (deliberate):
//    claim → fresh quote + build → guardSpotSell → approveWithSignature? →
//    pull → [wrap] → approve → sell → USDC lands on the OWNER.
//  The guard runs BEFORE the pull; a refused build costs nothing and the
//  policy parks in 'error' for the owner (resume retries) — never a blind
//  loop on a live market.
// ─────────────────────────────────────────────────────────────────────────

import { spendPermissionManagerAbi } from '@coinbase/cdp-sdk'
import { encodeFunctionData, erc20Abi, formatUnits } from 'viem'
import prisma from '@/lib/db'
import { jobsEnv } from '@/lib/jobs-runner'
import { chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { getActiveGrant } from '@/lib/grant-store'
import { resolveToken, tokenDecimals, humanToAtoms } from '@/lib/cow'
import { ensureTokenList } from '@/lib/token-list'
import { buildUniswapSwap } from '@/lib/uniswap-venue'
import { usdPerToken } from '@/lib/usd-probe'
import { getSpenderAddress, isCdpConfigured, sendSpenderTx, spendNetwork } from '@/lib/cdp'
import { SPEND_PERMISSION_MANAGER } from '@/lib/spend-permission'
import {
  managerGetHash,
  managerIsApproved,
  managerSigningDomain,
  simulateApprove,
} from '@/lib/dca-auto-exec'
import { parsePermission, serializePermission, spendPermissionTypedData } from '@/lib/dca-auto'
import {
  buildSpotGuardPermission,
  guardSpotSell,
  NATIVE_TOKEN_SENTINEL,
  parseSpotGuardArm,
  parseSpotGuardManage,
  permissionMatchesPolicy,
  spotTriggerFired,
  type SpotSellStep,
  type SpotTrigger,
} from '@/lib/spot-guard'

type Trace = (event: unknown) => void

/** Spot Guardian v1 rides the autopilot chain: Base. */
export const SPOT_GUARD_CHAIN_ID = 8453
/** Native "protect everything" keeps a little back — the owner's smart
 *  wallet may still want gas headroom even when sponsored. */
const NATIVE_KEEP_BACK_ETH = 0.0002
/** The guard's independent floor: 3% under the fired mark. */
const MIN_OUT_SLIP = 0.03
const MAX_ACTIVE_POLICIES_PER_WALLET = 5

const short = (n: number, max = 6) => Number(n.toFixed(max)).toString()

// ── The arm offer (chat → sign card → POST /api/spot-guard/[id]/arm) ───────

export interface SpotGuardArmOffer {
  policyId: string
  network: 'base'
  spender: string
  /** serialized permission (posts back verbatim with the signature) */
  permission: string
  typedData: {
    domain: { name: string; version: string; chainId: number; verifyingContract: string }
    types: Record<string, Array<{ name: string; type: string }>>
    primaryType: 'SpendPermission'
    message: Record<string, string | number>
  }
  enforced: { tokenSymbol: string; amountHuman: string; triggerLabel: string }
}

export interface SpotGuardTurn {
  reply: string
  spotGuardArm?: SpotGuardArmOffer
  buildPath: string
}

function randomSalt(): bigint {
  const bytes = new Uint8Array(32)
  crypto.getRandomValues(bytes)
  return BigInt('0x' + Array.from(bytes, (b) => b.toString(16).padStart(2, '0')).join(''))
}

function triggerLabel(mode: string, value: number, refPrice: number): string {
  return mode === 'price'
    ? `if it touches $${value}`
    : `if it drops ${value}% from $${short(refPrice, 2)}`
}

/**
 * The spot-guard chat gate. MUST run BEFORE the HL guardian gate — its
 * grammar refuses perp-worded asks by construction, but the HL parser's
 * loose coin slot would happily read "spot" as a coin.
 * Returns null when the message isn't a spot-guard ask.
 */
export async function runSpotGuardTurn(message: string, wallet: string | undefined, trace: Trace): Promise<SpotGuardTurn | null> {
  const manage = parseSpotGuardManage(message)
  if (manage) {
    if (!wallet) return { reply: '🛡️ Connect your wallet first — spot protections belong to an address.', buildPath: 'native-spot-guard' }
    return await runManage(manage.op, manage.token, wallet.toLowerCase(), trace)
  }

  const ask = parseSpotGuardArm(message)
  if (!ask) return null
  trace({ type: 'status', label: `spot guardian claimed the turn: protect ${ask.amountHuman ?? 'all'} ${ask.token} (${ask.triggerMode} ${ask.triggerValue}) — planner bypassed` })

  if (!wallet) {
    return { reply: '🛡️ Connect your wallet to arm spot protection — the permission is signed by, and scoped to, your address.', buildPath: 'native-spot-guard' }
  }
  if (!isCdpConfigured() || spendNetwork() !== 'base') {
    return { reply: '🛡️ Spot protection runs on the autopilot rails, which aren’t provisioned in this environment yet.', buildPath: 'native-spot-guard' }
  }

  const chainId = SPOT_GUARD_CHAIN_ID
  const chain = chainById(chainId)!
  await ensureTokenList(chainId)
  const sym = ask.token.toUpperCase()
  const native = sym === 'ETH'
  const erc20Addr = native ? null : resolveToken(sym, chainId)
  if (!native && !erc20Addr) {
    return { reply: `🛡️ I don't know the token ${sym} on ${chain.name} — spot protection covers Base tokens (ETH, WETH, CBETH, …).`, buildPath: 'native-spot-guard' }
  }
  const stable = primaryStable(chainId)
  if (!stable) return { reply: '🛡️ No stable configured for this chain — nothing armed.', buildPath: 'native-spot-guard' }
  if (!native && erc20Addr!.toLowerCase() === stable.address.toLowerCase()) {
    return { reply: `🛡️ ${sym} is the chain's own dollar — there's nothing to protect it against.`, buildPath: 'native-spot-guard' }
  }

  const client = publicClientFor(chainId)
  if (!client) return { reply: '🛡️ Base RPC unavailable right now — try again in a minute.', buildPath: 'native-spot-guard' }
  const owner = wallet.toLowerCase() as `0x${string}`
  const dec = native ? 18 : (tokenDecimals(sym, chainId) ?? 18)

  // Smart-wallet check (ported from the DCA autopilot arm, squad 2026-08-18):
  // the one-shot Spend Permission is enforced by the WALLET's own contract —
  // the SpendPermissionManager pulls via the smart wallet's execute(). An EOA
  // has no code to enforce it with, so a permission it signs can never be
  // spent: the sweep would arm a protection that NEVER fires. Every front
  // door we ship mints an EOA today (MetaMask, CDP createOnLogin:'eoa',
  // Coinbase eoaOnly), so this refuses by name BEFORE a signature is asked
  // for. Fail closed: an unreadable code slot refuses too.
  const code = await client.getCode({ address: owner }).catch(() => undefined)
  if (!code || code === '0x') {
    trace({ type: 'note', level: 'warn', label: `spot guardian: ${owner.slice(0, 10)}… has no contract code (EOA) — a Spend Permission it signs could never be spent; refusing by name, nothing armed` })
    return {
      reply:
        `🛡️ **Spot protection needs a smart wallet.** The stop works through a one-shot Spend Permission that your wallet's own contract enforces — that's what keeps it non-custodial (I hold a one-time allowance for exactly the protected amount, never your keys). ` +
        `This wallet is a regular EOA, so there's no contract to enforce it with: an arm here would look armed and could never fire, so nothing was armed. ` +
        `A Coinbase Smart Wallet can arm this today; EOA support (EIP-7702 upgrades) is on the way.` +
        (native ? ` If the ${sym} sits on a Hyperliquid perp instead, "protect my ${sym} long with a ${ask.triggerMode === 'price_move_pct' ? ask.triggerValue : 10}% stop" arms the Guardian there.` : ''),
      buildPath: 'native-spot-guard',
    }
  }

  // Live balance — the protected amount must exist at arm time.
  let balanceAtoms: bigint
  try {
    balanceAtoms = native
      ? await client.getBalance({ address: owner })
      : ((await client.readContract({ address: erc20Addr as `0x${string}`, abi: erc20Abi, functionName: 'balanceOf', args: [owner] })) as bigint)
  } catch {
    return { reply: '🛡️ Couldn’t read your balance right now — nothing armed, try again.', buildPath: 'native-spot-guard' }
  }
  const keepBackStr = native ? humanToAtoms(String(NATIVE_KEEP_BACK_ETH), 18) : null
  const keepBack = keepBackStr ? BigInt(keepBackStr) : BigInt(0)
  const protectable = balanceAtoms > keepBack ? balanceAtoms - keepBack : BigInt(0)

  let amountAtoms: bigint
  if (ask.amountHuman) {
    const parsedStr = humanToAtoms(ask.amountHuman, dec)
    const parsed = parsedStr ? BigInt(parsedStr) : null
    if (!parsed || parsed <= BigInt(0)) return { reply: `🛡️ Couldn't read the amount “${ask.amountHuman}”.`, buildPath: 'native-spot-guard' }
    if (parsed > balanceAtoms) {
      return { reply: `🛡️ You asked to protect ${ask.amountHuman} ${sym} but the wallet holds ${short(Number(formatUnits(balanceAtoms, dec)))} — nothing armed.`, buildPath: 'native-spot-guard' }
    }
    amountAtoms = parsed
  } else {
    if (protectable <= BigInt(0)) {
      return { reply: `🛡️ No ${sym} to protect on ${chain.name}${native ? ' (after a small gas keep-back)' : ''} — nothing armed.`, buildPath: 'native-spot-guard' }
    }
    amountAtoms = protectable
  }
  const amountHuman = short(Number(formatUnits(amountAtoms, dec)))

  // Arm-time reference price from the SAME venue quoter the sell will use.
  const probe = await usdPerToken(chainId, native ? 'ETH' : sym)
  if (!probe) return { reply: `🛡️ Couldn't price ${sym} on ${chain.name} to anchor the trigger — nothing armed.`, buildPath: 'native-spot-guard' }
  const refPrice = probe.usd
  if (ask.triggerMode === 'price' && ask.triggerValue >= refPrice) {
    return { reply: `🛡️ ${sym} is already at $${short(refPrice, 2)} — a $${ask.triggerValue} stop would fire instantly. Pick a line below the market.`, buildPath: 'native-spot-guard' }
  }

  const activeCount = await prisma.spotGuardPolicy.count({ where: { wallet: owner, status: { in: ['active', 'awaiting_signature'] }, originEnv: jobsEnv() } })
  if (activeCount >= MAX_ACTIVE_POLICIES_PER_WALLET) {
    return { reply: `🛡️ ${MAX_ACTIVE_POLICIES_PER_WALLET} protections is the per-wallet cap — retire one first ("cancel my ${sym} spot protection").`, buildPath: 'native-spot-guard' }
  }
  const dupe = await prisma.spotGuardPolicy.findFirst({ where: { wallet: owner, tokenSymbol: sym, status: { in: ['active', 'awaiting_signature'] }, originEnv: jobsEnv() } })
  if (dupe) {
    return { reply: `🛡️ ${sym} already has a spot protection ${dupe.status === 'active' ? 'armed and watching' : 'awaiting your signature'} — cancel it first to re-arm with new terms.`, buildPath: 'native-spot-guard' }
  }

  const spender = await getSpenderAddress()
  const tokenAddress = native ? NATIVE_TOKEN_SENTINEL : (erc20Addr as string)
  const nowSec = Math.floor(Date.now() / 1000)
  const permission = buildSpotGuardPermission({ account: owner, spender, token: tokenAddress, amountAtoms, nowSec, salt: randomSalt() })

  const domain = await managerSigningDomain()
  if (!domain) return { reply: '🛡️ Couldn’t read the permission manager’s signing domain from the chain — nothing armed, try again.', buildPath: 'native-spot-guard' }
  const typed = spendPermissionTypedData(permission, chainId, domain)

  const policy = await prisma.spotGuardPolicy.create({
    data: {
      wallet: owner,
      status: 'awaiting_signature',
      originEnv: jobsEnv(),
      chainId,
      tokenSymbol: sym,
      tokenAddress: tokenAddress.toLowerCase(),
      native,
      amountAtoms: amountAtoms.toString(),
      amountHuman,
      triggerMode: ask.triggerMode,
      triggerValue: ask.triggerValue,
      refPrice,
      spender: spender.toLowerCase(),
      armNetwork: 'base',
    },
  })

  const label = triggerLabel(ask.triggerMode, ask.triggerValue, refPrice)
  trace({ type: 'status', label: `spot guardian: policy ${policy.id.slice(0, 8)} drafted — ${amountHuman} ${sym}, ${label}, awaiting the permission signature` })
  return {
    reply:
      `🛡️ **Spot protection ready to arm** — ${amountHuman} ${sym}, ${label}.\n\n` +
      `One signature arms it: a one-shot Spend Permission for exactly ${amountHuman} ${sym}, enforced by Coinbase's on-chain SpendPermissionManager — ` +
      `I can never pull more, and I only pull if the trigger fires, selling to USDC that lands straight in YOUR wallet. ` +
      `Watching every minute; cancel any time ("cancel my ${sym} spot protection").`,
    spotGuardArm: {
      policyId: policy.id,
      network: 'base',
      spender,
      permission: serializePermission(permission),
      typedData: {
        domain: typed.domain as SpotGuardArmOffer['typedData']['domain'],
        types: typed.types as unknown as SpotGuardArmOffer['typedData']['types'],
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
      enforced: { tokenSymbol: sym, amountHuman, triggerLabel: label },
    },
    buildPath: 'native-spot-guard',
  }
}

async function runManage(op: 'pause' | 'resume' | 'cancel', token: string | null, wallet: string, trace: Trace): Promise<SpotGuardTurn> {
  const where = { wallet, originEnv: jobsEnv(), ...(token ? { tokenSymbol: token } : {}), status: { in: ['active', 'paused', 'error', 'awaiting_signature'] } }
  const policies = await prisma.spotGuardPolicy.findMany({ where, orderBy: { createdAt: 'desc' } })
  if (policies.length === 0) {
    return { reply: `🛡️ No ${token ? `${token} ` : ''}spot protection on this wallet.`, buildPath: 'native-spot-guard' }
  }
  const p = policies[0]
  trace({ type: 'status', label: `spot guardian manage: ${op} ${p.tokenSymbol} (${p.id.slice(0, 8)}, was ${p.status})` })
  if (op === 'cancel') {
    await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'done', error: null } })
    return { reply: `🛡️ ${p.tokenSymbol} spot protection retired — nothing watches it now. The on-chain permission stays yours to revoke from your wallet.`, buildPath: 'native-spot-guard' }
  }
  if (op === 'pause') {
    if (p.status !== 'active') return { reply: `🛡️ That protection is ${p.status} — nothing to pause.`, buildPath: 'native-spot-guard' }
    await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'paused' } })
    return { reply: `🛡️ Paused — ${p.tokenSymbol} is unwatched until you resume.`, buildPath: 'native-spot-guard' }
  }
  // resume: paused → active; error → active with a fresh slate (failed run
  // row cleared so the one-shot claim can be retaken).
  if (p.status === 'paused') {
    await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'active' } })
    return { reply: `🛡️ Resumed — watching ${p.tokenSymbol} again (${triggerLabel(p.triggerMode, p.triggerValue, p.refPrice)}).`, buildPath: 'native-spot-guard' }
  }
  if (p.status === 'error') {
    await prisma.spotGuardRun.deleteMany({ where: { policyId: p.id, status: 'failed' } })
    await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'active', error: null } })
    return { reply: `🛡️ Cleared the error and resumed — watching ${p.tokenSymbol} again.`, buildPath: 'native-spot-guard' }
  }
  return { reply: `🛡️ That protection is ${p.status} — nothing to resume.`, buildPath: 'native-spot-guard' }
}

// ── Arm completion (the POST from the sign card) ───────────────────────────

export async function armSpotGuardPolicy(
  policyId: string,
  wallet: string,
  permissionRaw: unknown,
  signature: string,
): Promise<{ status: number; body: Record<string, unknown> }> {
  const p = await prisma.spotGuardPolicy.findUnique({ where: { id: policyId } })
  if (!p || p.wallet !== wallet.toLowerCase() || p.originEnv !== jobsEnv()) {
    return { status: 404, body: { error: 'No such protection on this wallet.' } }
  }
  if (p.status !== 'awaiting_signature') return { status: 409, body: { error: `This protection is ${p.status}.` } }
  if (!isCdpConfigured() || spendNetwork() !== 'base') return { status: 503, body: { error: 'Spot-guard infrastructure is not provisioned.' } }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{2,}$/.test(signature) || signature.length > 8_192) {
    return { status: 400, body: { error: 'Malformed signature.' } }
  }
  const permission = parsePermission(permissionRaw)
  if (!permission) return { status: 400, body: { error: 'Malformed permission.' } }

  const spender = await getSpenderAddress()
  const match = permissionMatchesPolicy(permission, {
    ownerWallet: p.wallet,
    spender,
    tokenAddress: p.native ? NATIVE_TOKEN_SENTINEL : p.tokenAddress,
    amountAtoms: BigInt(p.amountAtoms),
    nowSec: Math.floor(Date.now() / 1000),
  })
  if (!match.ok) return { status: 400, body: { error: `Permission does not match the protection: ${match.problems.join('; ')}` } }

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

  await prisma.spotGuardPolicy.update({
    where: { id: p.id },
    data: {
      status: 'active',
      permissionJson: serializePermission(permission),
      permissionSig: signature,
      permissionHash: hash,
      permissionApproved: approved,
      spender: spender.toLowerCase(),
      armedAt: new Date(),
      error: null,
    },
  })
  return {
    status: 200,
    body: {
      armed: true,
      policyId: p.id,
      permissionHash: hash,
      enforced: `${p.amountHuman} ${p.tokenSymbol}, ${triggerLabel(p.triggerMode, p.triggerValue, p.refPrice)}`,
    },
  }
}

// ── The sweep (per-minute cron) ────────────────────────────────────────────

export interface SpotSweepSummary {
  scanned: number
  fired: number
  sold: string[]
  held: string[]
  failed: string[]
}

export async function executeSpotGuardSweep(limit = 2): Promise<SpotSweepSummary> {
  const summary: SpotSweepSummary = { scanned: 0, fired: 0, sold: [], held: [], failed: [] }
  if (!isCdpConfigured() || spendNetwork() !== 'base') return summary

  const policies = await prisma.spotGuardPolicy.findMany({
    where: { status: 'active', originEnv: jobsEnv(), chainId: SPOT_GUARD_CHAIN_ID, permissionJson: { not: null } },
    orderBy: { armedAt: 'asc' },
  })
  summary.scanned = policies.length

  for (const p of policies) {
    if (summary.fired >= limit) break
    const tag = `${p.id.slice(0, 8)}:${p.tokenSymbol}`
    const nowSec = Math.floor(Date.now() / 1000)

    const probe = await usdPerToken(p.chainId, p.native ? 'ETH' : p.tokenSymbol).catch(() => null)
    await prisma.spotGuardPolicy
      .update({ where: { id: p.id }, data: { lastChecked: new Date(), ...(probe ? { lastMark: probe.usd } : {}) } })
      .catch(() => {})
    if (!probe) continue // unreadable market — never fire blind

    const trigger: SpotTrigger = { mode: p.triggerMode as SpotTrigger['mode'], value: p.triggerValue, refPrice: p.refPrice }
    if (!spotTriggerFired(trigger, probe.usd).fired) continue

    const permission = parsePermission(p.permissionJson)
    if (!permission || !p.spender || !p.permissionSig) {
      await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'error', error: 'Stored permission is unreadable — re-arm to keep the guard.' } }).catch(() => {})
      summary.held.push(tag)
      continue
    }
    if (permission.end <= nowSec) {
      await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'error', error: 'Permission expired — re-arm to keep the guard.' } }).catch(() => {})
      summary.held.push(tag)
      continue
    }
    // Kill switch holds WITHOUT claiming — resumes watching when unpaused.
    const grant = await getActiveGrant(p.wallet)
    if (grant?.paused) {
      await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { error: 'Trigger fired but the kill switch is paused — holding (nothing pulled).' } }).catch(() => {})
      summary.held.push(tag)
      continue
    }

    // Claim BEFORE any tx: active → triggered, atomically; plus the
    // one-run-per-policy row. Losing either race means another pass owns it.
    const claim = await prisma.spotGuardPolicy.updateMany({ where: { id: p.id, status: 'active' }, data: { status: 'triggered' } })
    if (claim.count !== 1) continue
    let run
    try {
      run = await prisma.spotGuardRun.create({ data: { policyId: p.id, wallet: p.wallet, markPrice: probe.usd } })
    } catch {
      continue
    }
    summary.fired += 1

    const fail = async (detail: string) => {
      await prisma.spotGuardRun.update({ where: { id: run.id }, data: { status: 'failed', detail } }).catch(() => {})
      await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'error', error: detail } }).catch(() => {})
      summary.failed.push(tag)
    }

    try {
      const chain = chainById(p.chainId)
      const stable = primaryStable(p.chainId)
      const registryRouter = chain?.uniswap?.swapRouter02
      const weth = chain?.wrappedNative
      if (!chain || !stable || !registryRouter || !weth) {
        await fail('Chain registry incomplete — refused. Nothing pulled.')
        continue
      }
      const spender = await getSpenderAddress()
      if (spender.toLowerCase() !== p.spender) {
        await fail('Bound spender changed — re-arm to continue. Nothing pulled.')
        continue
      }
      await ensureTokenList(p.chainId)
      const pulled = permission.allowance
      const dec = p.native ? 18 : (tokenDecimals(p.tokenSymbol, p.chainId) ?? 18)
      const amountTokens = Number(formatUnits(pulled, dec))
      const sellSymbol = p.native ? 'WETH' : p.tokenSymbol

      // 1. Fresh build + independent floor + guard — BEFORE any money moves.
      const built = await buildUniswapSwap({
        sellToken: sellSymbol,
        buyToken: stable.symbol,
        amountHuman: formatUnits(pulled, dec),
        from: spender,
        chainId: p.chainId,
        recipient: p.wallet,
      })
      if (built.blocked) {
        await fail(`Venue build refused: ${built.guardrails.checks.filter((c) => !c.ok).map((c) => c.note).join(' ') || 'guardrail block'} Nothing pulled.`)
        continue
      }
      const minOutAtomic = BigInt(Math.floor(probe.usd * amountTokens * (1 - MIN_OUT_SLIP) * 10 ** stable.decimals))
      const wrapStep: SpotSellStep | null = p.native
        ? {
            to: weth,
            data: encodeFunctionData({ abi: [{ name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] }] as const, functionName: 'deposit' }),
            value: pulled.toString(),
          }
        : null
      const venueSteps = [...(built.approveTx ? [built.approveTx] : []), built.swapTx].map((s: { to: string; data: string; value?: string }) => ({
        to: s.to,
        data: s.data,
        value: s.value ?? '0',
      }))
      const steps: SpotSellStep[] = [...(wrapStep ? [wrapStep] : []), ...venueSteps]
      const guard = guardSpotSell({
        policy: {
          status: 'triggered',
          tokenAddress: p.native ? NATIVE_TOKEN_SENTINEL : p.tokenAddress,
          native: p.native,
          amountAtoms: pulled,
          trigger,
        },
        permission,
        ownerWallet: p.wallet,
        spender,
        chain: { chainId: p.chainId, usdcAddress: stable.address, swapRouter02: registryRouter, wethAddress: weth },
        markPrice: probe.usd,
        minOutAtomic,
        steps,
        pulledAtomic: pulled,
        nowSec,
      })
      if (!guard.ok) {
        await fail(`Spot guard refused: ${guard.checks.filter((c) => !c.ok).map((c) => c.note).join(' ')} Nothing pulled.`)
        continue
      }

      // 2. Approve the permission on-chain once, then pull.
      if (!p.permissionApproved && !(await managerIsApproved(permission))) {
        const approveHash = await sendSpenderTx({
          to: SPEND_PERMISSION_MANAGER as `0x${string}`,
          data: encodeManagerCall('approveWithSignature', [permissionTuple(permission), p.permissionSig as `0x${string}`]),
        })
        await waitTx(approveHash)
        await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { permissionApproved: true } }).catch(() => {})
      }
      const spendHash = await sendSpenderTx({
        to: SPEND_PERMISSION_MANAGER as `0x${string}`,
        data: encodeManagerCall('spend', [permissionTuple(permission), pulled]),
      })
      await waitTx(spendHash)
      await prisma.spotGuardRun.update({ where: { id: run.id }, data: { spendTx: spendHash } }).catch(() => {})

      // 3. Execute the guarded steps exactly as decoded.
      for (const step of steps) {
        const hash = await sendSpenderTx({
          to: step.to as `0x${string}`,
          data: step.data as `0x${string}`,
          ...(step.value !== '0' ? { value: BigInt(step.value) } : {}),
        })
        await waitTx(hash)
        if (step === steps[steps.length - 1]) {
          await prisma.spotGuardRun.update({ where: { id: run.id }, data: { swapTx: hash } }).catch(() => {})
        }
      }

      const valueUsd = Number((probe.usd * amountTokens).toFixed(2))
      await prisma.spotGuardRun.update({
        where: { id: run.id },
        data: { status: 'sold', valueUsd, detail: `Stop fired at $${short(probe.usd, 2)} — sold ${p.amountHuman} ${p.tokenSymbol} → USDC to the owner.` },
      })
      await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'done', error: null } }).catch(() => {})
      summary.sold.push(tag)
    } catch (e) {
      await fail(`Spot guard run failed: ${(e as Error).message?.slice(0, 240)}`)
    }
  }
  return summary
}

// Local helpers (mirrors dca-auto-exec's — kept private there and here).
const permissionTuple = (p: NonNullable<ReturnType<typeof parsePermission>>) => ({
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

function encodeManagerCall(functionName: 'approveWithSignature' | 'spend', args: readonly unknown[]): `0x${string}` {
  return encodeFunctionData({ abi: spendPermissionManagerAbi, functionName, args } as Parameters<typeof encodeFunctionData>[0])
}

async function waitTx(hash: `0x${string}`): Promise<void> {
  const client = publicClientFor(SPOT_GUARD_CHAIN_ID)
  if (!client) return
  await client.waitForTransactionReceipt({ hash, timeout: 120_000 })
}
