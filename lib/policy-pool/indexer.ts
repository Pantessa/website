// ─────────────────────────────────────────────────────────────────────────
//  THE POLICY POOL — the DeskFill indexer (LEDGER lane, 2026-11-02)
//
//  Reads the hook's `DeskFill` logs from the stored cursor (first pass: the
//  deploy block) in ≤2,000-block windows over Alchemy's RPC for the pool's
//  chain, and writes one `fill` row per log (+ a `mined` row for the tx when
//  the intent has none yet). (txHash, logIndex) is unique, so a re-read is a
//  no-op; the cursor moves only after a window's rows landed.
//
//  Config: lib/policy-pool/config `policyPoolConfig()` (BUILDER) — null when
//  POLICY_POOL_HOOK is unset (not deployed); `policyPoolClient()` is the
//  chain's client (Alchemy base-sepolia with the key, the public RPC after).
// ─────────────────────────────────────────────────────────────────────────

import type { Address, Hex } from 'viem'
import prisma from '@/lib/db'
import { policyPoolClient, type PolicyPoolConfig } from '@/lib/policy-pool/config'
import { POLICY_POOL_HOOK_ABI, intentIdFor } from '@/lib/policy-pool/spec'

export const POLICY_POOL_LOG_WINDOW = 2_000
/** Windows read per pass — bounds one cron call (~20k blocks ≈ 11h of Base). */
export const POLICY_POOL_MAX_WINDOWS = 10

/** Known USDC on the two pool chains — the leg priced 1:1. */
export const POLICY_POOL_USDC: Record<number, Address> = {
  8453: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
  84532: '0x036cbd53842c5426634e7929541ec2318f3dcf7e',
}

/** The pool facts the indexer needs, from the config (lowercased once). */
export interface IndexedPool {
  chainId: number
  hook: Address
  currency0: Address
  currency1: Address
  deployBlock: number | null
}
export function indexedPoolOf(cfg: PolicyPoolConfig): IndexedPool {
  return {
    chainId: cfg.chainId,
    hook: cfg.hook.toLowerCase() as Address,
    currency0: cfg.poolKey.currency0.toLowerCase() as Address,
    currency1: cfg.poolKey.currency1.toLowerCase() as Address,
    deployBlock: cfg.deployBlock,
  }
}

function clientFor(chainId: number) {
  const c = policyPoolClient(chainId)
  if (!c) throw new Error(`No RPC client for chain ${chainId}.`)
  return c
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
export async function readHookState(pool: { chainId: number; hook: Address }): Promise<HookState | null> {
  const key = `${pool.chainId}:${pool.hook}`
  if (hookStateCache && hookStateCache.key === key && Date.now() - hookStateCache.at < 60_000) return hookStateCache.value
  const client = clientFor(pool.chainId)
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
  pool: Pick<IndexedPool, 'chainId' | 'currency0' | 'currency1'>,
): { amountIn: string | null; amountOut: string | null; usd: number | null; meta: Record<string, unknown> } {
  const abs = (v: bigint) => (v < BigInt(0) ? -v : v)
  const legs = [
    { amt: args.amount0, currency: pool.currency0.toLowerCase() as Address },
    { amt: args.amount1, currency: pool.currency1.toLowerCase() as Address },
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
  /** Desk-recorded fill rows the chain's log upgraded in place. */
  upgraded: number
  mined: number
  windows: number
}

/** One indexer pass. Throws on RPC/DB failure (the cron reports it); the
 *  cursor only advances past windows whose rows were written. */
export async function indexPolicyPool(cfg: PolicyPoolConfig, opts: { maxWindows?: number } = {}): Promise<IndexPassResult> {
  const pool = indexedPoolOf(cfg)
  const client = clientFor(pool.chainId)
  const tip = Number(await client.getBlockNumber())
  const cur = await prisma.policyPoolCursor.findUnique({ where: { chainId: pool.chainId } })
  const maxWindows = opts.maxWindows ?? POLICY_POOL_MAX_WINDOWS
  // No cursor and no POLICY_POOL_DEPLOY_BLOCK: start one pass's reach behind
  // the tip rather than walking from genesis (say so in the result).
  const start = cur ? cur.lastBlock + 1 : pool.deployBlock ?? Math.max(0, tip - POLICY_POOL_LOG_WINDOW * maxWindows + 1)
  const result: IndexPassResult = { chainId: pool.chainId, from: start, to: start - 1, tip, logs: 0, written: 0, upgraded: 0, mined: 0, windows: 0 }
  if (start > tip) return result
  const deskIds = await deskIdsByHash()
  const blockTimes = new Map<bigint, Date>()
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
      // The desk may have recorded this fill first (no logIndex): upgrade that
      // row in place — the chain's amounts, keeping the desk's meta — so one
      // log is one fill row, whichever side wrote first.
      const offchain = await prisma.policyPoolEvent.findFirst({ where: { kind: 'fill', txHash, logIndex: null }, orderBy: { createdAt: 'asc' } })
      const already = await prisma.policyPoolEvent.findFirst({ where: { txHash, logIndex: log.logIndex }, select: { id: true } })
      if (already) {
        // Re-read of a window we already wrote — nothing to do.
      } else if (offchain) {
        const deskMeta = offchain.meta && typeof offchain.meta === 'object' && !Array.isArray(offchain.meta) ? (offchain.meta as Record<string, unknown>) : {}
        await prisma.policyPoolEvent.update({
          where: { id: offchain.id },
          data: { ...common, intentId: offchain.intentId ?? intentId, logIndex: log.logIndex, amountIn: f.amountIn, amountOut: f.amountOut, usd: f.usd, meta: { ...deskMeta, ...f.meta } as object },
        })
        result.written += 1
        result.upgraded += 1
      } else {
        try {
          await prisma.policyPoolEvent.create({ data: { ...common, kind: 'fill', logIndex: log.logIndex, amountIn: f.amountIn, amountOut: f.amountOut, usd: f.usd, meta: f.meta as object } })
          result.written += 1
        } catch (e) {
          // A concurrent pass wrote this log first ((txHash, logIndex) is unique).
          if ((e as { code?: string }).code !== 'P2002') throw e
        }
      }
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
