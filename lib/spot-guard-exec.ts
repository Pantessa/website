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
//
//  After the pull the sell can still fail (a price that moved past the
//  bound, a deadline, an RPC), and the one-shot permission can never pull
//  again. So nothing after the pull reads "failed" (lib/autopilot-unwind):
//  one fresh retry against the same floor, then the pull goes back to the
//  owner, and a run that can't prove where the money went stays UNWINDING
//  until the next pass's reconcile does.
// ─────────────────────────────────────────────────────────────────────────

import { spendPermissionManagerAbi } from '@coinbase/cdp-sdk'
import { encodeFunctionData, erc20Abi, formatUnits } from 'viem'
import prisma from '@/lib/db'
import { buildsNatively } from '@/scripts/ask-ladder'
import { jobsEnv } from '@/lib/jobs-runner'
import { chainById, primaryStable, publicClientFor } from '@/lib/chains'
import { getActiveGrant } from '@/lib/grant-store'
import { resolveToken, tokenDecimals, humanToAtoms } from '@/lib/cow'
import { ensureTokenList } from '@/lib/token-list'
import { buildUniswapSwap } from '@/lib/uniswap-venue'
import { usdPerToken } from '@/lib/usd-probe'
import { getSpenderAddress, isCdpConfigured, spendNetwork } from '@/lib/cdp'
import { SPEND_PERMISSION_MANAGER } from '@/lib/spend-permission'
import { planRefund, reissueMatches, type LedgerStep } from '@/lib/autopilot-unwind'
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
  spotRearmAsk,
  spotTriggerFired,
  spotUnwindCopy,
  type SpotSellGuardInput,
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
  /** Set when the turn was a manage verb the session may not perform
   *  (lib/chat-mutation-gate) — the reply is the sign-in invitation. */
  signInGate?: import('@/lib/chat-mutation-gate').SignInGate
  /** What to press when the guard can't be armed. NO-DEAD-ENDS squad.
   *  Options are ordinary clarify chips (lib/clarify): every `resume` is a
   *  sentence the native ladder builds, checked below. The alert door rides
   *  the reply as a markdown link, the same idiom the add-a-dapp doors use —
   *  a chip kind that opens a URL does not exist and is not worth inventing
   *  for one refusal. */
  clarify?: { question: string; options: { label: string; resume: string }[] }
  buildPath: string
}

/**
 * What we offer when the stop CANNOT be armed — and today, in production,
 * that is every single arm ask. Two independent walls: the autopilot rails
 * need `CDP_SPEND_NETWORK`, and even with them the one-shot Spend Permission
 * is enforced by the wallet's OWN contract, while every door we ship mints an
 * EOA (MetaMask, CDP `createOnLogin:'eoa'`, Coinbase `eoaOnly`, Phantom). So
 * the refusal is the product on this path, and a wall of prose is the whole
 * experience (QA drive `protect/eth`, 2026-09-21: honest, and still nothing
 * to press).
 *
 * The honest substitute is a PRICE ALERT: `/api/cron/alerts` is live, it
 * watches every minute, it emails, and it hands the owner the sell when it
 * fires — the signature stays the gate, which is the only part automation was
 * ever going to remove. The door is the symbol page, where the alert form
 * lives.
 *
 * Deliberately NOT offered: a CoW limit sell at the stop price. A sell limit
 * BELOW the market is marketable and fills immediately — it would dump the
 * user's bag the moment they tapped a button labelled "protection".
 */
export function spotGuardFallback(token: string, pct: number, lead: string): SpotGuardTurn {
  const sym = token.toUpperCase()
  const options = [{ label: `Sell my ${sym} now`, resume: `Sell all my ${sym}` }].filter((o) => buildsNatively(o.resume))
  return {
    reply:
      `${lead} ` +
      `Here's what does work today: **[set a ${pct}% price alert on ${sym}](/t/${encodeURIComponent(sym)})** — it's watched every minute, you get the mail, and the sell comes back ready to send (you still sign it, which is the part that was never going away)` +
      (options.length ? `. Or sell now, if you'd rather not watch it at all.` : `.`),
    ...(options.length ? { clarify: { question: `What should I do about your ${sym}?`, options } } : {}),
    buildPath: 'native-spot-guard',
  }
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
export async function runSpotGuardTurn(
  message: string,
  wallet: string | undefined,
  trace: Trace,
  /** Does the SIWE session OWN `wallet`? Arming ends in the wallet's own
   *  Spend Permission signature (connect-to-act); pause / resume / retire
   *  change what watches the wallet with no signature and need it
   *  (lib/chat-mutation-gate). Defaults CLOSED. */
  walletProven = false,
): Promise<SpotGuardTurn | null> {
  const manage = parseSpotGuardManage(message)
  if (manage) {
    if (!wallet) return { reply: '🛡️ Connect your wallet first — spot protections belong to an address.', buildPath: 'native-spot-guard' }
    if (!walletProven) {
      const { mutationGate } = await import('@/lib/chat-mutation-gate')
      trace({ type: 'note', level: 'warn', label: `spot guardian: ${manage.op} asked but the session does not own the wallet — answering the sign-in gate, nothing changed` })
      return { ...mutationGate('spot-manage'), buildPath: 'native-spot-guard' }
    }
    return await runManage(manage.op, manage.token, wallet.toLowerCase(), trace)
  }

  const ask = parseSpotGuardArm(message)
  if (!ask) return null
  trace({ type: 'status', label: `spot guardian claimed the turn: protect ${ask.amountHuman ?? 'all'} ${ask.token} (${ask.triggerMode} ${ask.triggerValue}) — planner bypassed` })

  if (!wallet) {
    return { reply: '🛡️ Connect your wallet to arm spot protection — the permission is signed by, and scoped to, your address.', buildPath: 'native-spot-guard' }
  }
  if (!isCdpConfigured() || spendNetwork() !== 'base') {
    // Was: "…the autopilot rails, which aren't provisioned in this
    // environment yet" — our infrastructure, described to a stranger, with
    // nothing to press. Say what we can't do in their terms, then offer the
    // thing that works.
    trace({ type: 'note', level: 'warn', label: 'spot guardian: automatic selling is not configured here — answering with the alert door and a sell chip' })
    return spotGuardFallback(
      ask.token,
      ask.triggerMode === 'price_move_pct' ? ask.triggerValue : 5,
      `🛡️ I can't sell your ${ask.token.toUpperCase()} for you automatically yet — that part isn't switched on.`,
    )
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
    const pct = ask.triggerMode === 'price_move_pct' ? ask.triggerValue : 5
    const fallback = spotGuardFallback(
      sym,
      pct,
      `🛡️ **Spot protection needs a smart wallet.** The stop works through a one-shot Spend Permission that your wallet's own contract enforces — that's what keeps it non-custodial (I hold a one-time allowance for exactly the protected amount, never your keys). ` +
        `This wallet is a regular EOA, so there's no contract to enforce it with: an arm here would look armed and could never fire, so nothing was armed. ` +
        `A Coinbase Smart Wallet can arm this today; EOA support (EIP-7702 upgrades) is on the way.`,
    )
    // A perp position on the same coin CAN be watched today — the HL
    // Guardian has fired in production. Offered as a third chip, never
    // instead of the alert: it protects a different position.
    const perpAsk = `protect my ${sym} long with a ${pct}% stop`
    if (native && fallback.clarify && buildsNatively(perpAsk)) fallback.clarify.options.push({ label: `Protect a ${sym} perp on Hyperliquid instead`, resume: perpAsk })
    return fallback
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
    // A run that pulled used the one-shot permission: resuming would watch a
    // stop that can never pull again, and its run row is the record of where
    // the owner's money went. Only a run that pulled nothing clears.
    const pulledRun = await prisma.spotGuardRun.findFirst({ where: { policyId: p.id, status: { in: ['unwinding', 'refunded', 'sold'] } } })
    if (pulledRun) {
      return {
        reply:
          pulledRun.status === 'unwinding'
            ? `🛡️ That stop already fired and its ${p.amountHuman} ${p.tokenSymbol} is on its way back to your wallet — there's nothing to resume until it lands.`
            : `🛡️ That stop already fired and used its one-time permission${pulledRun.status === 'refunded' ? ` (your ${p.amountHuman} ${p.tokenSymbol} went back to your wallet)` : ''}. To protect ${p.tokenSymbol} again, re-arm it: "${spotRearmAsk(p)}".`,
        buildPath: 'native-spot-guard',
      }
    }
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

// ── The sell build (the sweep's step 1) ────────────────────────────────────

export interface SpotSellBuild {
  steps: SpotSellStep[]
  /** The guard's independent floor, in the stable's atoms. */
  minOutAtomic: bigint
  /** The pull in whole tokens (the run's receipt value). */
  amountTokens: number
  /** The registry pins the guard checks the steps against. */
  guardChain: SpotSellGuardInput['chain']
}

/**
 * The stop's sell, built exactly as the sweep sends it: a fresh v3 quote
 * with the output pinned to the owner at the builder's default fee, the wrap
 * for a native protection, and the independent floor off the fired mark. No
 * DB, no CDP, nothing signed: the sweep and the harness's live pin both run
 * this, so guardSpotSell is always proven against the build it really gets
 * (a hand-built 1-call fixture once hid that every fee-on stop refused).
 *
 * `held: 'wrapped'` builds the retry of a native pull a first attempt
 * already wrapped: no wrap step, the WETH sells directly. The approval is
 * always there, exactly the pull: the builder drops it when the spender's
 * allowance already covers the pull, which a failed attempt leaves behind,
 * and the guard takes only the shape with it.
 */
export async function buildSpotSell(input: {
  chainId: number
  native: boolean
  tokenSymbol: string
  ownerWallet: string
  spender: string
  pulled: bigint
  markUsd: number
  held?: 'native' | 'wrapped'
}): Promise<{ ok: true; build: SpotSellBuild } | { ok: false; detail: string }> {
  const chain = chainById(input.chainId)
  const stable = primaryStable(input.chainId)
  const registryRouter = chain?.uniswap?.swapRouter02
  const weth = chain?.wrappedNative
  if (!chain || !stable || !registryRouter || !weth) {
    return { ok: false, detail: 'Chain registry incomplete — refused.' }
  }
  await ensureTokenList(input.chainId)
  const dec = input.native ? 18 : (tokenDecimals(input.tokenSymbol, input.chainId) ?? 18)
  const sellAddr = input.native ? weth : resolveToken(input.tokenSymbol, input.chainId)
  if (!sellAddr) return { ok: false, detail: `Couldn't resolve ${input.tokenSymbol} on ${chain.name} — refused.` }
  const amountTokens = Number(formatUnits(input.pulled, dec))
  const built = await buildUniswapSwap({
    sellToken: input.native ? 'WETH' : input.tokenSymbol,
    buyToken: stable.symbol,
    amountHuman: formatUnits(input.pulled, dec),
    from: input.spender,
    chainId: input.chainId,
    recipient: input.ownerWallet,
  })
  if (built.blocked) {
    return { ok: false, detail: `Venue build refused: ${built.guardrails.checks.filter((c) => !c.ok).map((c) => c.note).join(' ') || 'guardrail block'}` }
  }
  const minOutAtomic = BigInt(Math.floor(input.markUsd * amountTokens * (1 - MIN_OUT_SLIP) * 10 ** stable.decimals))
  const wrapStep: SpotSellStep | null =
    input.native && input.held !== 'wrapped'
      ? {
          to: weth,
          data: encodeFunctionData({ abi: [{ name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] }] as const, functionName: 'deposit' }),
          value: input.pulled.toString(),
        }
      : null
  // No Base token needs an allowance reset (lib/erc20-approval), and
  // guardSpotSell takes exactly one approval — stop before the pull otherwise.
  if (built.resetTx) return { ok: false, detail: 'Venue build carried an allowance reset this autopilot does not send. Nothing pulled.' }
  const approveStep: SpotSellStep = built.approveTx
    ? { to: built.approveTx.to, data: built.approveTx.data, value: built.approveTx.value ?? '0' }
    : { to: sellAddr, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [registryRouter, input.pulled] }), value: '0' }
  const swapStep: SpotSellStep = { to: built.swapTx.to, data: built.swapTx.data, value: built.swapTx.value ?? '0' }
  return {
    ok: true,
    build: {
      steps: [...(wrapStep ? [wrapStep] : []), approveStep, swapStep],
      minOutAtomic,
      amountTokens,
      guardChain: { chainId: input.chainId, usdcAddress: stable.address, swapRouter02: registryRouter, wethAddress: weth },
    },
  }
}

/** Why a retry's guard refused, in the owner's words. The floor is the
 *  common one (the market kept falling after the stop fired); anything else
 *  names the checks. */
function spotRetryRefusalWords(checks: Array<{ id: string; ok: boolean; note: string }>, firedMark: number): string {
  const failed = checks.filter((c) => !c.ok)
  if (failed.length > 0 && failed.every((c) => c.id === 'swap' && /quote floor/.test(c.note))) {
    return `the price kept falling, and a fresh quote would have sold under the floor, ${MIN_OUT_SLIP * 100}% below the $${short(firedMark, 2)} the stop fired at`
  }
  return `the fresh sell didn't pass its guard: ${failed.map((c) => c.note).join(' ')}`
}

/** The guarded steps, named for the run's ledger: [wrap] approve swap. */
function spotSaleSteps(steps: SpotSellStep[]): SaleStep[] {
  const names: SaleStep['step'][] = steps.length === 3 ? ['wrap', 'approve', 'swap'] : ['approve', 'swap']
  return steps.map((s, i) => ({ step: names[i], to: s.to, data: s.data, value: s.value }))
}

// ── The sweep (per-minute cron) ────────────────────────────────────────────

export interface SpotSweepSummary {
  scanned: number
  fired: number
  sold: string[]
  held: string[]
  failed: string[]
  /** Pulled, the sell didn't go through, the pull went back to the owner. */
  refunded: string[]
  /** Pulled, and where the money went isn't proven yet (reconcile continues). */
  unwinding: string[]
}

/** A fire can take ~30s (pull, sell, maybe a retry and a refund) and the
 *  cron's function budget is 60s: no new fire starts after this. */
const SWEEP_START_BY_MS = 20_000
/** Reconcile (a refund is ~2 sends) only starts with this much of the pass used. */
const SWEEP_RECONCILE_BY_MS = 30_000

export async function executeSpotGuardSweep(limit = 2): Promise<SpotSweepSummary> {
  const startedAt = Date.now()
  const summary: SpotSweepSummary = { scanned: 0, fired: 0, sold: [], held: [], failed: [], refunded: [], unwinding: [] }
  if (!isCdpConfigured() || spendNetwork() !== 'base') return summary

  const policies = await prisma.spotGuardPolicy.findMany({
    where: { status: 'active', originEnv: jobsEnv(), chainId: SPOT_GUARD_CHAIN_ID, permissionJson: { not: null } },
    orderBy: { armedAt: 'asc' },
  })
  summary.scanned = policies.length

  for (const p of policies) {
    if (summary.fired >= limit) break
    if (Date.now() - startedAt > SWEEP_START_BY_MS) break // the next minute picks it up
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

    // Before the pull only: nothing has moved, so the run can say so.
    const fail = async (detail: string) => {
      await prisma.spotGuardRun.update({ where: { id: run.id }, data: { status: 'failed', detail } }).catch(() => {})
      await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'error', error: detail } }).catch(() => {})
      summary.failed.push(tag)
    }

    // The run's ledger, once the first spender send is about to go out. It
    // holds only intents the database took, so it knows whether a pull went.
    let ledger: RunLedger | null = null
    try {
      const spender = await getSpenderAddress()
      if (spender.toLowerCase() !== p.spender) {
        await fail('Bound spender changed — re-arm to continue. Nothing pulled.')
        continue
      }
      const pulled = permission.allowance

      // 1. Fresh build + independent floor + guard — BEFORE any money moves.
      const sell = await buildSpotSell({
        chainId: p.chainId,
        native: p.native,
        tokenSymbol: p.tokenSymbol,
        ownerWallet: p.wallet,
        spender,
        pulled,
        markUsd: probe.usd,
      })
      if (!sell.ok) {
        await fail(`${sell.detail} Nothing pulled.`)
        continue
      }
      const { steps, amountTokens, guardChain } = sell.build
      const guardFor = (build: SpotSellBuild, held: 'native' | 'wrapped') =>
        guardSpotSell({
          policy: {
            status: 'triggered',
            tokenAddress: p.native ? NATIVE_TOKEN_SENTINEL : p.tokenAddress,
            native: p.native,
            amountAtoms: pulled,
            trigger,
            held,
          },
          permission,
          ownerWallet: p.wallet,
          spender,
          chain: build.guardChain,
          markPrice: probe.usd,
          minOutAtomic: build.minOutAtomic,
          steps: build.steps,
          pulledAtomic: pulled,
          nowSec: Math.floor(Date.now() / 1000),
        })
      const guard = guardFor(sell.build, 'native')
      if (!guard.ok) {
        await fail(`Spot guard refused: ${guard.checks.filter((c) => !c.ok).map((c) => c.note).join(' ')} Nothing pulled.`)
        continue
      }

      // 2. Approve the permission on-chain once, then pull. Every spender
      //    send from here is written to the run's ledger first and carries
      //    its derived idempotency key (lib/autopilot-unwind).
      ledger = spotLedger(run.id, null)!
      if (!p.permissionApproved && !(await managerIsApproved(permission))) {
        const permit = await sendRunTx(ledger, 1, {
          step: 'permit',
          to: SPEND_PERMISSION_MANAGER,
          data: encodeManagerCall('approveWithSignature', [permissionTuple(permission), p.permissionSig as `0x${string}`]),
          value: '0',
        })
        if (permit.outcome !== 'success') {
          await fail(`The permission couldn't be approved on-chain (${permit.words}). Nothing pulled.`)
          continue
        }
        await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { permissionApproved: true } }).catch(() => {})
      }
      const pull = await sendRunTx(ledger, 1, {
        step: 'spend',
        to: SPEND_PERMISSION_MANAGER,
        data: encodeManagerCall('spend', [permissionTuple(permission), pulled]),
        value: '0',
      })
      if ('hash' in pull && pull.hash) await prisma.spotGuardRun.update({ where: { id: run.id }, data: { spendTx: pull.hash } }).catch(() => {})
      if (pull.outcome === 'refused' || pull.outcome === 'reverted') {
        await fail(`The pull didn't go through (${pull.words}). Nothing pulled.`)
        continue
      }

      // 3. From here the owner's asset may sit on the spender, so the run
      //    ends sold, refunded, or unwinding: never "failed".
      let result: SettleResult
      if (pull.outcome === 'unresolved') {
        result = { kind: 'unwinding', note: `the pull was sent and isn't confirmed yet (${pull.words})`, operator: false, why: '' }
      } else {
        const verified = await verifyPull({ ledger, permission, permissionHash: p.permissionHash, pulledAtomic: pulled, nativeSentinel: NATIVE_TOKEN_SENTINEL, receipt: pull.receipt })
        result = await settleRun({
          ledger,
          native: p.native,
          pullVerified: verified.ok,
          allowRetry: true,
          firstSteps: spotSaleSteps(steps),
          // Attempt 2: a fresh quote, the same floor (3% under the mark the
          // stop fired at), the same guard. The kill switch stops a retry.
          rebuild: async (_attempt, held) => {
            if ((await getActiveGrant(p.wallet))?.paused) return { ok: false, words: 'the kill switch was paused, so nothing sells' }
            const heldForm = held === 'wrapped' ? 'wrapped' : 'native'
            const again = await buildSpotSell({ chainId: p.chainId, native: p.native, tokenSymbol: p.tokenSymbol, ownerWallet: p.wallet, spender, pulled, markUsd: probe.usd, held: heldForm })
            if (!again.ok) return { ok: false, words: again.detail }
            const g = guardFor(again.build, heldForm)
            if (!g.ok) return { ok: false, words: spotRetryRefusalWords(g.checks, probe.usd) }
            return { ok: true, steps: spotSaleSteps(again.build.steps) }
          },
          refund: {
            permission,
            ownerWallet: p.wallet,
            pulledAtomic: pulled,
            nativeSentinel: NATIVE_TOKEN_SENTINEL,
            wethAddress: guardChain.wethAddress,
          },
        })
        if (result.kind === 'unwinding' && result.operator && !verified.ok) result = { ...result, note: `${result.note} ${verified.note}` }
      }
      await recordSpotSettle(p, run.id, result, { markUsd: probe.usd, amountTokens }, summary, tag)
    } catch (e) {
      // A throw after a pull went out must not read "nothing pulled": the run
      // parks unwinding and the next pass's reconcile reads its ledger.
      const words = ((e as Error).message ?? String(e)).split('\n')[0].slice(0, 240)
      if (ledger?.entries.some((x) => x.step === 'spend')) {
        await recordSpotSettle(p, run.id, { kind: 'unwinding', note: `the sweep stopped mid-run (${words})`, operator: false, why: '' }, { markUsd: probe.usd, amountTokens: 0 }, summary, tag).catch(() => {})
      } else {
        await fail(`Spot guard run failed: ${words}. Nothing pulled.`)
      }
    }
  }

  // Then earlier passes' open runs (a pull that couldn't prove where the
  // money went). After the fires, so a live stop never waits on them; the
  // per-minute cadence gets to them within the function's budget.
  if (Date.now() - startedAt < SWEEP_RECONCILE_BY_MS) {
    const reconciled = await reconcileSpotGuardRuns().catch(() => null)
    if (reconciled) {
      summary.sold.push(...reconciled.sold)
      summary.refunded.push(...reconciled.refunded)
      summary.unwinding.push(...reconciled.unwinding)
      summary.failed.push(...reconciled.failed)
    }
  }
  return summary
}

// ── Recording a pulled run's end ────────────────────────────────────────────

async function recordSpotSettle(
  p: { id: string; tokenSymbol: string; amountHuman: string; triggerMode: string; triggerValue: number },
  runId: string,
  result: SettleResult,
  ctx: { markUsd: number; amountTokens: number },
  summary: Pick<SpotSweepSummary, 'sold' | 'refunded' | 'unwinding' | 'failed'>,
  tag: string,
): Promise<void> {
  const rearmAsk = spotRearmAsk(p)
  if (result.kind === 'sold') {
    const valueUsd = ctx.amountTokens > 0 ? Number((ctx.markUsd * ctx.amountTokens).toFixed(2)) : null
    await prisma.spotGuardRun.update({
      where: { id: runId },
      data: { status: 'sold', swapTx: result.hash, ...(valueUsd !== null ? { valueUsd } : {}), detail: `Stop fired at $${short(ctx.markUsd, 2)} — sold ${p.amountHuman} ${p.tokenSymbol} → USDC to the owner.` },
    })
    await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'done', error: null } }).catch(() => {})
    summary.sold.push(tag)
    return
  }
  if (result.kind === 'nothing-pulled') {
    const detail = `The sweep stopped before the pull landed (${result.note}) — nothing pulled.`
    await prisma.spotGuardRun.update({ where: { id: runId }, data: { status: 'failed', detail } }).catch(() => {})
    await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'error', error: detail } }).catch(() => {})
    summary.failed.push(tag)
    return
  }
  const outcome = result.kind === 'refunded' ? 'refunded' : result.operator ? 'operator' : 'unwinding'
  // A person has to look: say so where one will (the function's logs).
  if (outcome === 'operator') console.error(`[spot-guard] run ${runId} (${p.amountHuman} ${p.tokenSymbol}) needs an operator: ${result.kind === 'unwinding' ? result.note : ''}`)
  const copy = spotUnwindCopy({
    outcome,
    tokenSymbol: p.tokenSymbol,
    amountHuman: p.amountHuman,
    markUsd: ctx.markUsd,
    why: result.why,
    refundTx: result.kind === 'refunded' ? result.hash : undefined,
    note: result.kind === 'unwinding' ? result.note : undefined,
    rearmAsk,
  })
  await prisma.spotGuardRun
    .update({ where: { id: runId }, data: { status: result.kind === 'refunded' ? 'refunded' : 'unwinding', ...(result.kind === 'refunded' ? { refundTx: result.hash } : {}), detail: copy } })
    .catch(() => {})
  await prisma.spotGuardPolicy.update({ where: { id: p.id }, data: { status: 'error', error: copy } }).catch(() => {})
  if (result.kind === 'refunded') summary.refunded.push(tag)
  else summary.unwinding.push(tag)
}

function spotLedger(runId: string, raw: string | null): RunLedger | null {
  return RunLedger.open('spot', runId, raw, async (json) => {
    await prisma.spotGuardRun.update({ where: { id: runId }, data: { txLog: json } })
  })
}

// ── Reconcile: runs an earlier pass left open ──────────────────────────────

/** A run the in-pass flow still owns writes its ledger every few seconds;
 *  one quiet this long was left by a pass that ended (timed out, killed). */
const UNWINDING_QUIET_MS = 90_000
const RUNNING_STALE_MS = 3 * 60_000

/**
 * Close what an earlier pass left open: a run parked UNWINDING, or one still
 * RUNNING long after any pass could own it (the function hit its time limit
 * mid-run). The ledger's open sends are resolved from receipts or replayed
 * keys, then the same decision table runs with no retry: a pass minutes
 * later returns the money, it never sells late.
 */
export async function reconcileSpotGuardRuns(limit = 3): Promise<Pick<SpotSweepSummary, 'sold' | 'refunded' | 'unwinding' | 'failed'>> {
  const out: Pick<SpotSweepSummary, 'sold' | 'refunded' | 'unwinding' | 'failed'> = { sold: [], refunded: [], unwinding: [], failed: [] }
  const now = Date.now()
  const runs = await prisma.spotGuardRun.findMany({
    where: {
      policy: { originEnv: jobsEnv(), chainId: SPOT_GUARD_CHAIN_ID },
      OR: [
        { status: 'unwinding', updatedAt: { lt: new Date(now - UNWINDING_QUIET_MS) } },
        { status: 'running', updatedAt: { lt: new Date(now - RUNNING_STALE_MS) } },
      ],
    },
    include: { policy: true },
    orderBy: { updatedAt: 'asc' },
    take: limit,
  })
  for (const run of runs) {
    // The row's updatedAt is the lease: only one pass takes a quiet run.
    const lease = await prisma.spotGuardRun.updateMany({ where: { id: run.id, updatedAt: run.updatedAt }, data: { status: run.status } })
    if (lease.count !== 1) continue
    const p = run.policy
    const tag = `${p.id.slice(0, 8)}:${p.tokenSymbol}`
    const markUsd = run.markPrice ?? 0
    const permission = parsePermission(p.permissionJson)
    const ledger = spotLedger(run.id, run.txLog)
    const chain = chainById(p.chainId)
    const router = chain?.uniswap?.swapRouter02
    const weth = chain?.wrappedNative
    if (!permission || !ledger || !router || !weth || !p.spender) {
      await recordSpotSettle(p, run.id, { kind: 'unwinding', note: "the run's ledger or permission doesn't read", operator: true, why: '' }, { markUsd, amountTokens: 0 }, out, tag)
      continue
    }
    const pulled = permission.allowance
    const sellAddr = p.native ? weth : p.tokenAddress
    try {
      const expected = spotExpectedRequests({ permission, signature: p.permissionSig, pulled, native: p.native, weth, router, sellAddr, owner: p.wallet })
      await resolveLedger(ledger, {
        spendLanded: async () => {
          const at = ledger.entries.find((e) => e.step === 'spend')?.at ?? Math.floor(run.createdAt.getTime() / 1000)
          const w = await permissionWindowSpend(permission, at)
          // One-shot: the permission's only window, so any spend is this run's.
          return w === null || w === 'overwritten' ? null : w.spend > BigInt(0)
        },
        expected: (e) => reissueMatches(e, expected, router),
      })
      const verified = await verifyPull({ ledger, permission, permissionHash: p.permissionHash, pulledAtomic: pulled, nativeSentinel: NATIVE_TOKEN_SENTINEL })
      let result = await settleRun({
        ledger,
        native: p.native,
        pullVerified: verified.ok,
        allowRetry: false,
        rebuild: async () => ({ ok: false, words: 'a later pass never sells' }),
        refund: { permission, ownerWallet: p.wallet, pulledAtomic: pulled, nativeSentinel: NATIVE_TOKEN_SENTINEL, wethAddress: weth },
      })
      if (result.kind === 'unwinding' && result.operator && !verified.ok) result = { ...result, note: `${result.note} ${verified.note}` }
      const dec = p.native ? 18 : (tokenDecimals(p.tokenSymbol, p.chainId) ?? 18)
      await recordSpotSettle(p, run.id, result, { markUsd, amountTokens: Number(formatUnits(pulled, dec)) }, out, tag)
    } catch (e) {
      const words = ((e as Error).message ?? String(e)).split('\n')[0].slice(0, 200)
      await recordSpotSettle(p, run.id, { kind: 'unwinding', note: `reconcile stopped (${words})`, operator: false, why: saleFailureWords(ledger.entries) }, { markUsd, amountTokens: 0 }, out, tag)
    }
  }
  return out
}

/** Every deterministic request a spot run could send, encoded afresh — a
 *  later pass re-issues a ledger entry only if it matches one exactly. */
function spotExpectedRequests(input: {
  permission: NonNullable<ReturnType<typeof parsePermission>>
  signature: string | null
  pulled: bigint
  native: boolean
  weth: string
  router: string
  sellAddr: string
  owner: string
}): Partial<Record<LedgerStep, Array<{ to: string; data: string; value: string }>>> {
  const { permission, signature, pulled, native, weth, router, sellAddr, owner } = input
  const refunds = native
    ? [...planRefund({ form: 'wrapped', ownerWallet: owner, pulledAtomic: pulled, token: permission.token, wethAddress: weth })]
    : planRefund({ form: 'erc20', ownerWallet: owner, pulledAtomic: pulled, token: permission.token, wethAddress: weth })
  return {
    ...(signature && /^0x[0-9a-fA-F]+$/.test(signature)
      ? { permit: [{ to: SPEND_PERMISSION_MANAGER, data: encodeManagerCall('approveWithSignature', [permissionTuple(permission), signature as `0x${string}`]), value: '0' }] }
      : {}),
    spend: [{ to: SPEND_PERMISSION_MANAGER, data: encodeManagerCall('spend', [permissionTuple(permission), pulled]), value: '0' }],
    wrap: native ? [{ to: weth, data: encodeFunctionData({ abi: [{ name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] }] as const, functionName: 'deposit' }), value: pulled.toString() }] : [],
    approve: [{ to: sellAddr, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [router as `0x${string}`, pulled] }), value: '0' }],
    unwrap: refunds.filter((s) => s.step === 'unwrap'),
    return: refunds.filter((s) => s.step === 'return'),
  }
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
