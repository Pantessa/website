// ─────────────────────────────────────────────────────────────────────────
//  THE POLICY POOL — the DeskFill indexer (LEDGER lane, 2026-11-02)
//
//  Reads the hook's `DeskFill` logs from the stored cursor (first pass: the
//  deploy block) in ≤2,000-block windows over Alchemy's RPC for the pool's
//  chain, and writes one `fill` row per log (+ a `mined` row for the tx when
//  the intent has none yet). (txHash, logIndex) is unique, so a re-read is a
//  no-op; the cursor moves only after a window's rows landed.
//
//  Config: `readPolicyPoolEnv()` reads the env shape fixed in the squad
//  README. BUILDER's lib/policy-pool/config.ts `policyPoolConfig()` is the
//  canonical reader; it had not landed when this was written, so this reads
//  the same variables with the same rule (POLICY_POOL_HOOK unset → null).
//  Swap to policyPoolConfig() at integration.
// ─────────────────────────────────────────────────────────────────────────

import { createPublicClient, fallback, http, isAddress, type Address, type Hex, type PublicClient } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import prisma from '@/lib/db'
import { POLICY_POOL_HOOK_ABI, intentIdFor, poolIdFor } from '@/lib/policy-pool/spec'

export const POLICY_POOL_LOG_WINDOW = 2_000
/** Windows read per pass — bounds one cron call (~20k blocks ≈ 11h of Base). */
export const POLICY_POOL_MAX_WINDOWS = 10

const ZERO: Address = '0x0000000000000000000000000000000000000000'

/** Known USDC on the two pool chains — the leg priced 1:1. */
export const POLICY_POOL_USDC: Record<number, Address> = {
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  84532: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
}

export interface PolicyPoolEnv {
  chainId: 8453 | 84532
  hook: Address
  currency0: Address
  currency1: Address
  fee: number
  tickSpacing: number
  poolId: Hex
  deployBlock: number
  signer: Address | null
  maxUsd: number
}

/** The pool facts from env, or null when the hook isn't deployed (pure over `env`). */
export function readPolicyPoolEnv(env: Record<string, string | undefined> = process.env): PolicyPoolEnv | null {
  const hook = env.POLICY_POOL_HOOK?.trim()
  if (!hook || !isAddress(hook)) return null
  const chainId = Number(env.POLICY_POOL_CHAIN_ID ?? 84532)
  if (chainId !== 8453 && chainId !== 84532) return null
  const addr = (v: string | undefined, d: Address): Address => {
    const s = v?.trim()
    if (!s || s === '0x0' || s === '0') return d
    return isAddress(s) ? (s.toLowerCase() as Address) : d
  }
  const currency0 = addr(env.POLICY_POOL_CURRENCY0, ZERO)
  const currency1 = addr(env.POLICY_POOL_CURRENCY1, POLICY_POOL_USDC[chainId])
  const fee = Number(env.POLICY_POOL_FEE ?? 500) || 500
  const tickSpacing = Number(env.POLICY_POOL_TICK_SPACING ?? 10) || 10
  const signer = env.POLICY_SIGNER_ADDRESS?.trim()
  const maxUsd = Number(env.POLICY_POOL_MAX_USD ?? 500)
  const h = hook.toLowerCase() as Address
  return {
    chainId,
    hook: h,
    currency0,
    currency1,
    fee,
    tickSpacing,
    poolId: poolIdFor({ currency0, currency1, fee, tickSpacing, hooks: h }),
    deployBlock: Math.max(0, Math.floor(Number(env.POLICY_POOL_DEPLOY_BLOCK ?? 0)) || 0),
    signer: signer && isAddress(signer) ? (signer.toLowerCase() as Address) : null,
    maxUsd: Number.isFinite(maxUsd) && maxUsd > 0 ? maxUsd : 500,
  }
}

export const explorerBase = (chainId: number): string => (chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org')
export const chainLabel = (chainId: number): string => (chainId === 8453 ? 'Base' : chainId === 84532 ? 'Base Sepolia' : `chain ${chainId}`)

function clientFor(chainId: 8453 | 84532): PublicClient {
  const key = process.env.ALCHEMY_API_KEY
  const net = chainId === 8453 ? 'base-mainnet' : 'base-sepolia'
  const chain = chainId === 8453 ? base : baseSepolia
  const transports = [
    ...(key ? [http(`https://${net}.g.alchemy.com/v2/`, { fetchOptions: { headers: { Authorization: `Bearer ${key}` } } })] : []),
    http(),
  ]
  return createPublicClient({ chain, transport: fallback(transports) }) as PublicClient
}

export interface HookState {
  /** The signer the hook actually checks — the truth, whatever env says. */
  policySigner: Address
  paused: boolean
}
let hookStateCache: { key: string; at: number; value: HookState | null } | null = null

/** Read the hook's live `policySigner()` + `paused()` (cached 60s, 2.5s
 *  budget). Null when the chain can't be read — the page falls back to env
 *  and says so, never guesses. */
export async function readHookState(pool: Pick<PolicyPoolEnv, 'chainId' | 'hook'>): Promise<HookState | null> {
  const key = `${pool.chainId}:${pool.hook}`
  if (hookStateCache && hookStateCache.key === key && Date.now() - hookStateCache.at < 60_000) return hookStateCache.value
  const client = clientFor(pool.chainId as 8453 | 84532)
  const read = Promise.all([
    client.readContract({ address: pool.hook, abi: POLICY_POOL_HOOK_ABI, functionName: 'policySigner' }),
    client.readContract({ address: pool.hook, abi: POLICY_POOL_HOOK_ABI, functionName: 'paused' }),
  ]).then(([policySigner, paused]) => ({ policySigner: (policySigner as Address).toLowerCase() as Address, paused: Boolean(paused) }))
  const value = await Promise.race([read, new Promise<null>((r) => setTimeout(() => r(null), 2_500))]).catch(() => null)
  // A failed read is retried after 10s, a good one held 60s.
  hookStateCache = { key, at: value ? Date.now() : Date.now() - 50_000, value }
  return value
}

/** One DeskFill log → the fill row's fields (pure). `amount0/1` are the
 *  swapper's BalanceDelta: negative = paid in, positive = received. */
export function fillFieldsFor(
  args: { intentId: Hex; swapper: Address; poolId: Hex; zeroForOne: boolean; amount0: bigint; amount1: bigint; origin: string },
  pool: Pick<PolicyPoolEnv, 'chainId' | 'currency0' | 'currency1'>,
): { amountIn: string | null; amountOut: string | null; usd: number | null; meta: Record<string, unknown> } {
  const abs = (v: bigint) => (v < BigInt(0) ? -v : v)
  const legs = [
    { amt: args.amount0, currency: pool.currency0 },
    { amt: args.amount1, currency: pool.currency1 },
  ]
  const inLeg = legs.find((l) => l.amt < BigInt(0)) ?? null
  const outLeg = legs.find((l) => l.amt > BigInt(0)) ?? null
  const usdc = POLICY_POOL_USDC[pool.chainId]
  const usdcLeg = legs.find((l) => l.currency.toLowerCase() === usdc)
  const usd = usdcLeg ? Math.round((Number(abs(usdcLeg.amt)) / 1e6) * 100) / 100 : null
  return {
    amountIn: inLeg ? abs(inLeg.amt).toString() : null,
    amountOut: outLeg ? abs(outLeg.amt).toString() : null,
    usd,
    meta: {
      onchainIntentId: args.intentId,
      poolId: args.poolId,
      zeroForOne: args.zeroForOne,
      amount0: args.amount0.toString(),
      amount1: args.amount1.toString(),
      currencyIn: inLeg?.currency ?? null,
      currencyOut: outLeg?.currency ?? null,
      source: 'indexer',
    },
  }
}

/** bytes32 intentId → the desk's own id, for the ids the ledger already
 *  knows (an off-chain row recorded the desk id; the chain only has its hash). */
async function deskIdsByHash(): Promise<Map<string, string>> {
  const rows = await prisma.policyPoolEvent.findMany({
    where: { intentId: { not: null }, kind: { not: 'fill' } },
    distinct: ['intentId'],
    select: { intentId: true },
    orderBy: { createdAt: 'desc' },
    take: 5_000,
  })
  const out = new Map<string, string>()
  for (const r of rows) if (r.intentId) out.set(intentIdFor(r.intentId).toLowerCase(), r.intentId)
  return out
}

export interface IndexPassResult {
  chainId: number
  from: number
  to: number
  tip: number
  logs: number
  written: number
  mined: number
  windows: number
}

/** One indexer pass. Throws on RPC/DB failure (the cron reports it); the
 *  cursor only advances past windows whose rows were written. */
export async function indexPolicyPool(pool: PolicyPoolEnv, opts: { maxWindows?: number } = {}): Promise<IndexPassResult> {
  const client = clientFor(pool.chainId)
  const tip = Number(await client.getBlockNumber())
  const cur = await prisma.policyPoolCursor.findUnique({ where: { chainId: pool.chainId } })
  const start = cur ? cur.lastBlock + 1 : pool.deployBlock
  const result: IndexPassResult = { chainId: pool.chainId, from: start, to: start - 1, tip, logs: 0, written: 0, mined: 0, windows: 0 }
  if (start > tip) return result
  const deskIds = await deskIdsByHash()
  const blockTimes = new Map<bigint, Date>()
  const maxWindows = opts.maxWindows ?? POLICY_POOL_MAX_WINDOWS
  let from = start
  while (from <= tip && result.windows < maxWindows) {
    const to = Math.min(from + POLICY_POOL_LOG_WINDOW - 1, tip)
    const logs = await client.getContractEvents({
      address: pool.hook,
      abi: POLICY_POOL_HOOK_ABI,
      eventName: 'DeskFill',
      fromBlock: BigInt(from),
      toBlock: BigInt(to),
    })
    for (const log of logs) {
      if (log.blockNumber === null || log.logIndex === null || !log.transactionHash) continue
      const a = log.args as { intentId: Hex; swapper: Address; poolId: Hex; zeroForOne: boolean; amount0: bigint; amount1: bigint; origin: string }
      result.logs += 1
      let at = blockTimes.get(log.blockNumber)
      if (!at) {
        const blk = await client.getBlock({ blockNumber: log.blockNumber })
        at = new Date(Number(blk.timestamp) * 1000)
        blockTimes.set(log.blockNumber, at)
      }
      const f = fillFieldsFor(a, pool)
      const intentId = deskIds.get(a.intentId.toLowerCase()) ?? a.intentId.toLowerCase()
      const txHash = log.transactionHash.toLowerCase()
      const common = {
        chainId: pool.chainId,
        intentId,
        origin: a.origin.slice(0, 200),
        swapper: a.swapper.toLowerCase(),
        txHash,
        blockNumber: Number(log.blockNumber),
        createdAt: at,
      }
      const w = await prisma.policyPoolEvent.createMany({
        data: [{ ...common, kind: 'fill', logIndex: log.logIndex, amountIn: f.amountIn, amountOut: f.amountOut, usd: f.usd, meta: f.meta as object }],
        skipDuplicates: true,
      })
      result.written += w.count
      const minedExists = await prisma.policyPoolEvent.findFirst({ where: { kind: 'mined', intentId }, select: { id: true } })
      if (!minedExists) {
        await prisma.policyPoolEvent.create({ data: { ...common, kind: 'mined', meta: { source: 'indexer' } } })
        result.mined += 1
      }
    }
    await prisma.policyPoolCursor.upsert({
      where: { chainId: pool.chainId },
      create: { chainId: pool.chainId, lastBlock: to },
      update: { lastBlock: to },
    })
    result.to = to
    result.windows += 1
    from = to + 1
  }
  return result
}
