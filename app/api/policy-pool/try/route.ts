import { NextRequest, NextResponse } from 'next/server'
import { parseEventLogs, type Address, type Hex } from 'viem'
import prisma from '@/lib/db'
import { mintSlug } from '@/lib/intent-links'
import { isInternalRun } from '@/lib/internal-run'
import { clientIpFrom, hashIp } from '@/lib/turn-limits'
import { POLICY_POOL_REFRESH_KIND, POLICY_POOL_VENUE, policyPoolClient, policyPoolConfig, policyPoolExplorerTx, type PolicyPoolConfig } from '@/lib/policy-pool/config'
import { recordPolicyPoolEvent } from '@/lib/policy-pool/ledger'
import { POLICY_POOL_HOOK_ABI } from '@/lib/policy-pool/spec'
import {
  TRY_IP_CAP,
  TRY_PLAIN_ORIGIN,
  TRY_WALLET_CAP,
  TRY_WINDOW_MS,
  TryLimiter,
  parseTryRequest,
  revertReasonFor,
  tryChainVerdict,
  type TryRequest,
} from '@/lib/policy-pool/try'
import { GatedV4PoolError, NoV4PoolError, buildPolicyPoolSwap, encodeV4SwapCalldata, isPolicyPoolRefusal, policyPoolRevertName, type V4PoolKey } from '@/lib/uniswap-v4'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 60

// POST /api/policy-pool/try — the /policy-pool "Try it" strip's server door
// (TRYIT lane, squad policy-pool 2026-11-02). Public, by the connected
// wallet's address (same class as /api/chat's native builds): the desk
// policy and the attestation are the desk's to issue, and an attestation is
// bound to `swapper = the wallet` as tx.origin, so nobody can use another
// wallet's. Three actions:
//   plain    → the $1 USDC → ETH Universal Router swap with EMPTY hookData,
//              simulated first (the hook's revert by name), returned for the
//              wallet to send with a fixed gas limit (an estimate would refuse)
//   attested → the desk policy → attestation for THIS wallet → the guarded
//              build (lib/uniswap-v4 buildPolicyPoolSwap, the same chain the
//              chat turn returns, Permit2 approvals included); a refusal is a
//              200 with the policy's own sentence and no artifact
//   report   → a tx hash the wallet sent: the SERVER reads the receipt (from
//              = the wallet, to = the pinned router), decodes a revert by
//              re-simulating at the parent block, and writes the ledger rows
//              the chain proves (signed / mined / fill, or onchain_revert)
// NEVER for Base mainnet (8453), on either side (lib/policy-pool/try
// tryChainVerdict). Rate-limited per wallet and per IP (in-process window).

const walletLimiter = new TryLimiter(TRY_WALLET_CAP, TRY_WINDOW_MS)
const ipLimiter = new TryLimiter(TRY_IP_CAP, TRY_WINDOW_MS)
const ONE_USDC = BigInt(1_000_000)

function poolOrRefusal(): { cfg: PolicyPoolConfig } | { res: NextResponse } {
  let cfg: PolicyPoolConfig | null
  try {
    cfg = policyPoolConfig()
  } catch (e) {
    return { res: NextResponse.json({ ok: false, state: 'misconfigured', reason: e instanceof Error ? e.message : String(e) }, { status: 409 }) }
  }
  if (!cfg) return { res: NextResponse.json({ ok: false, state: 'not-deployed', reason: 'The policy pool is not deployed yet (POLICY_POOL_HOOK is unset).' }, { status: 409 }) }
  return { cfg }
}

const eq = (a: string | null | undefined, b: string | null | undefined) => !!a && !!b && a.toLowerCase() === b.toLowerCase()

export async function POST(req: NextRequest) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ ok: false, error: 'Body must be JSON.' }, { status: 400 })
  }
  const parsed = parseTryRequest(body)
  if (!parsed.ok) return NextResponse.json({ ok: false, error: parsed.error }, { status: 400 })
  const r = parsed.req
  // The chain rule FIRST — before any env read could make a mainnet pool
  // look like a door: 8453 on the request refuses whatever the env says.
  if (r.chainId === 8453) return NextResponse.json({ ok: false, refused: 'mainnet', reason: tryChainVerdict({ cfgChainId: 0, bodyChainId: 8453 }) }, { status: 403 })
  const pool = poolOrRefusal()
  if ('res' in pool) return pool.res
  const { cfg } = pool
  const verdict = tryChainVerdict({ cfgChainId: cfg.chainId, bodyChainId: r.chainId })
  if (verdict) return NextResponse.json({ ok: false, refused: 'mainnet', reason: verdict }, { status: 403 })
  const ip = clientIpFrom(req.headers)
  if (!walletLimiter.allow(`w:${r.wallet.toLowerCase()}`) || (ip && !ipLimiter.allow(`i:${hashIp(ip)}`))) {
    return NextResponse.json({ ok: false, error: 'Slow down — this door takes a dozen tries per wallet every ten minutes.' }, { status: 429 })
  }
  const client = policyPoolClient(cfg.chainId)
  if (!client) return NextResponse.json({ ok: false, state: 'misconfigured', reason: `No RPC client for ${cfg.chainName}.` }, { status: 409 })
  const internal = isInternalRun(req.headers, body)
  const explorer = policyPoolExplorerTx(cfg.chainId)

  if (r.action === 'plain') return plain(cfg, client, r)
  if (r.action === 'attested') return attested(cfg, r, internal)
  return report(cfg, client, r, internal, explorer)
}

type Client = NonNullable<ReturnType<typeof policyPoolClient>>

// ── plain: the same swap, no note ─────────────────────────────────────────
async function plain(cfg: PolicyPoolConfig, client: Client, r: Extract<TryRequest, { action: 'plain' }>) {
  const poolKey: V4PoolKey = { ...cfg.poolKey }
  const deadline = Math.floor(Date.now() / 1000) + 600
  // USDC (currency1) → ETH (currency0): zeroForOne false, exact-in 1 USDC,
  // minOut 1 wei, no fee split, NO hookData — byte-identical to a wallet
  // that never heard of the desk.
  const data = encodeV4SwapCalldata({ poolKey, zeroForOne: false, amountIn: ONE_USDC, minOut: BigInt(1), deadline, feeBps: 0 })
  let simulated: string | null = null
  let simulatedDetail = 'the call PASSED in simulation'
  try {
    await client.call({ account: r.wallet, to: cfg.pins.universalRouter, data })
  } catch (err) {
    simulated = policyPoolRevertName(err)
    simulatedDetail = simulated ? `reverted ${simulated}()` : err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : String(err)
  }
  const intentId = `try-plain-${mintSlug(8).toLowerCase()}`
  return NextResponse.json({
    ok: true,
    action: 'plain',
    intentId,
    origin: TRY_PLAIN_ORIGIN,
    chainId: cfg.chainId,
    chainName: cfg.chainName,
    simulated,
    simulatedDetail,
    expect: 'NotAttested',
    // The wallet sends this as is. `gas` is fixed because an estimate would
    // refuse a transaction the chain is about to revert — the revert IS the
    // scene. 400k covers the router + the hook's revert path with room.
    tx: { to: cfg.pins.universalRouter, data, value: '0', chainId: cfg.chainId, gas: '400000', action: 'swap' },
    summary: `Swap 1 USDC → ETH through the policy pool on ${cfg.chainName} with NO attestation — the hook will revert NotAttested()`,
  })
}

// ── attested: the desk builds for THIS wallet ─────────────────────────────
async function attested(cfg: PolicyPoolConfig, r: Extract<TryRequest, { action: 'attested' }>, internal: boolean) {
  const intentId = `chat-try-${mintSlug(10).toLowerCase()}`
  const origin = `desk:${intentId}`
  const amountHuman = r.usd.toFixed(2).replace(/\.00$/, '')
  try {
    const built = await buildPolicyPoolSwap({
      sellToken: 'USDC',
      buyToken: 'ETH',
      amountHuman,
      from: r.wallet,
      chainId: cfg.chainId,
      intentId,
      origin,
      swapper: r.wallet,
    })
    if (isPolicyPoolRefusal(built)) {
      return NextResponse.json({ ok: false, action: 'attested', refused: built.kind, reason: built.reason, ...(built.capUsd !== undefined ? { capUsd: built.capUsd } : {}), intentId, origin, usd: r.usd })
    }
    if (built.blocked) {
      const reasons = built.guardrails.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note).join(' ')
      return NextResponse.json({ ok: false, action: 'attested', blocked: true, reason: `Built but refused by the guardrails: ${reasons || 'a safety check failed.'}`, guardrails: built.guardrails, intentId, origin, usd: r.usd })
    }
    return NextResponse.json({
      ok: true,
      action: 'attested',
      intentId,
      origin,
      usd: built.usd,
      chainId: cfg.chainId,
      chainName: cfg.chainName,
      summary: built.summary,
      guardrails: built.guardrails,
      policyPool: { intentId, origin, poolId: built.poolId, hook: built.hook, expiry: built.attestation.expiry, swapper: built.attestation.swapper },
      // The SAME shape the chat turn returns (app/api/chat preparePolicyPoolTurn):
      // SendTxChain walks it, and the swap step is re-quoted + re-attested
      // for the same intent through /api/tx/refresh (its chat-<id> gate
      // accepts this id; the origin is re-derived server-side there).
      txChain: {
        summary: built.summary,
        steps: built.steps,
        refresh: {
          kind: POLICY_POOL_REFRESH_KIND,
          stepIndex: built.steps.length - 1,
          params: { sellToken: 'USDC', buyToken: 'ETH', amountHuman, chainId: String(cfg.chainId), venue: POLICY_POOL_VENUE, intentId, origin },
        },
      },
      internal,
    })
  } catch (err) {
    if (err instanceof NoV4PoolError || err instanceof GatedV4PoolError) {
      return NextResponse.json({ ok: false, action: 'attested', refused: 'venue', reason: err.message, intentId, origin, usd: r.usd })
    }
    const msg = err instanceof Error ? err.message.split('\n')[0].slice(0, 240) : 'build failed'
    console.warn(`[policy-pool try] attested build failed: ${msg}`)
    return NextResponse.json({ ok: false, action: 'attested', error: `The build failed: ${msg}`, intentId, origin }, { status: 502 })
  }
}

// ── report: the chain says what happened ──────────────────────────────────
async function alreadyRecorded(txHash: string, kind: string): Promise<boolean> {
  try {
    return !!(await prisma.policyPoolEvent.findFirst({ where: { txHash: txHash.toLowerCase(), kind }, select: { id: true } }))
  } catch {
    return false
  }
}

async function report(cfg: PolicyPoolConfig, client: Client, r: Extract<TryRequest, { action: 'report' }>, internal: boolean, explorer: string) {
  const receipt = await client.getTransactionReceipt({ hash: r.txHash }).catch(() => null)
  if (!receipt) return NextResponse.json({ ok: false, pending: true, reason: 'No receipt yet — the transaction is not mined (or not on this chain).' }, { status: 404 })
  if (!eq(receipt.from, r.wallet)) return NextResponse.json({ ok: false, error: 'That transaction was not sent by this wallet.' }, { status: 403 })
  if (!eq(receipt.to, cfg.pins.universalRouter)) return NextResponse.json({ ok: false, error: "That transaction did not go to the pool's Universal Router." }, { status: 403 })
  const blockNumber = Number(receipt.blockNumber)
  const swapper = r.wallet.toLowerCase()
  const currencyMeta = { currencyIn: cfg.poolKey.currency1, currencyOut: cfg.poolKey.currency0 }
  const txUrl = `${explorer}${r.txHash}`

  if (receipt.status === 'success') {
    const fills = parseEventLogs({ abi: POLICY_POOL_HOOK_ABI, logs: receipt.logs.filter((l) => eq(l.address, cfg.hook)), eventName: 'DeskFill' })
    const f = fills[0] ?? null
    // The desk id: the client's label when it is one of ours; the chain's
    // bytes32 otherwise (the indexer joins it later if a row knows it).
    const intentId = r.intentId ?? f?.args.intentId ?? undefined
    const origin = f?.args.origin ?? (intentId ? `desk:${intentId}` : undefined)
    const abs = (v: bigint) => (v < BigInt(0) ? -v : v)
    const amountIn = f ? abs(f.args.amount1).toString() : undefined
    const amountOut = f ? abs(f.args.amount0).toString() : undefined
    const usd = f ? Math.round((Number(abs(f.args.amount1)) / 1e6) * 100) / 100 : undefined
    const base = { intentId, origin, swapper, chainId: cfg.chainId, amountIn, amountOut, usd, txHash: r.txHash }
    const meta = { ...currencyMeta, source: 'try', internal }
    if (!(await alreadyRecorded(r.txHash, 'signed'))) await recordPolicyPoolEvent({ kind: 'signed', ...base, meta })
    if (!(await alreadyRecorded(r.txHash, 'mined'))) await recordPolicyPoolEvent({ kind: 'mined', ...base, blockNumber, meta })
    if (f && !(await alreadyRecorded(r.txHash, 'fill'))) {
      await recordPolicyPoolEvent({ kind: 'fill', ...base, blockNumber, meta: { ...meta, poolId: f.args.poolId, zeroForOne: f.args.zeroForOne, onchainIntentId: f.args.intentId } })
    }
    return NextResponse.json({
      ok: true,
      action: 'report',
      status: 'success',
      blockNumber,
      txUrl,
      intentId: intentId ?? null,
      fill: f ? { intentId: f.args.intentId, swapper: f.args.swapper, amount0: f.args.amount0.toString(), amount1: f.args.amount1.toString(), origin: f.args.origin } : null,
    })
  }

  // Reverted: the receipt carries no reason, so re-run the call at the parent
  // block (the state the tx saw) and read the hook's error by name. A pass
  // there means the state moved under it; try the tip once, then say so.
  const tx = await client.getTransaction({ hash: r.txHash }).catch(() => null)
  let name: string | null = null
  if (tx) {
    for (const at of [receipt.blockNumber - BigInt(1), undefined] as const) {
      try {
        await client.call({ account: tx.from, to: tx.to ?? undefined, data: tx.input, value: tx.value, ...(at !== undefined ? { blockNumber: at } : {}) })
      } catch (err) {
        name = policyPoolRevertName(err)
        if (name) break
      }
    }
  }
  const reason = revertReasonFor(name)
  const intentId = r.intentId ?? undefined
  const plainShaped = !!intentId && intentId.startsWith('try-plain-')
  if (!(await alreadyRecorded(r.txHash, 'onchain_revert'))) {
    await recordPolicyPoolEvent({
      kind: 'onchain_revert',
      intentId,
      origin: plainShaped ? TRY_PLAIN_ORIGIN : intentId ? `desk:${intentId}` : undefined,
      swapper,
      chainId: cfg.chainId,
      ...(plainShaped ? { amountIn: ONE_USDC.toString(), usd: 1 } : {}),
      txHash: r.txHash,
      blockNumber,
      reason,
      meta: { ...currencyMeta, revert: name, source: 'try', internal, simulated: false },
    })
  }
  return NextResponse.json({ ok: true, action: 'report', status: 'reverted', revert: name, reason, blockNumber, txUrl, intentId: intentId ?? null })
}
