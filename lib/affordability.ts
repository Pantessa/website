// lib/affordability.ts — THE affordability choke point.
//
//  "A stranger with a $0 wallet must never see a Sign button."
//
//  Squad GTM 2026-09-08, PATHS round 3. The native swap layer pre-reads the
//  sell balance (#450) and hands a shortfall to the funding plan — but that
//  guard lives INSIDE one layer. Three other producers of signables never
//  asked the wallet anything:
//    · the planner passthrough (a first-party MCP tool's build reaches the
//      card as-is — "Convert two dollars of ETH to USDC" fell past the swap
//      grammar and the Uniswap MCP built a 2 ETH swap for an empty wallet;
//      the link visitor saw "Sign & send swap" — links.md round 2),
//    · the cross-chain layer (NEAR 1Click quotes any amount for any address),
//    · the jobs runner (a typed "Fund robinhood chain with $20 from base"
//      compiles and the first step's approve is offered to a $0 wallet).
//  Instead of a fourth per-layer belt, every signable now passes ONE gate on
//  its way out: decode what the artifact SPENDS from the wallet (native value,
//  ERC-20 approve/transfer/swap-in, Permit2 approve, a CoW order's sell side),
//  read the wallet's balance of exactly that, and when the wallet PROVABLY
//  can't cover it, replace the artifact with a named refusal. Wired at the
//  /api/chat exit (JSON + SSE — /chat, /i, /embed and the planner all leave
//  through it) and at the jobs runner's offer.
//
//  Posture, in one line each:
//    · A verdict needs a SUCCESSFUL balance read below a DECODED spend. An
//      undecodable artifact, an unknown chain, or a failed read is `unknown`
//      → the artifact passes untouched (the producing layer's own guards
//      stand; an RPC error is not chain state — the #721 lesson).
//    · A lone approve is not a spend. It only counts when the SAME artifact
//      spends what it approved (approve → swap / deposit), so a first-party
//      tool's bounded approve card (SECURITY §E3 pin) is untouched.
//    · Gas is enforced only at ZERO: a wallet with no native token on the
//      chain can't send ANY transaction, so that refusal can never disagree
//      with a layer that sized its own gas leg. Orders (CoW) need no gas.
//    · Spend tokens are strict: held < needs → short, by name.

import { decodeFunctionData, erc20Abi, formatUnits, isAddress } from 'viem'
import { chainById, publicClientFor } from '@/lib/chains'
import { dynamicTokenByAddress } from '@/lib/token-list'
import { fundingOriginWords } from '@/lib/funding-origins'

export type SpendKind = 'value' | 'approve' | 'transfer' | 'swap-in' | 'permit2' | 'order'

export interface Spend {
  chainId: number
  /** 'ETH' for the chain's native token, else the lowercase ERC-20 address. */
  token: string
  atoms: bigint
  kind: SpendKind
  /** Which step of a chain produced it (0 for single artifacts). */
  step: number
}

export type AffordabilityVerdict =
  | { kind: 'ok'; checked: number }
  | { kind: 'no-spend' }
  | { kind: 'unknown'; reason: string }
  | {
      kind: 'short'
      chainId: number
      chainName: string
      token: string
      symbol: string
      decimals: number
      held: bigint
      needs: bigint
      /** true = the wallet has NO native token on the chain (can't pay gas). */
      gas: boolean
    }

type Tx = { to?: unknown; data?: unknown; value?: unknown; chainId?: unknown }

// Selectors (first 4 bytes of keccak(signature)).
const SEL_APPROVE = '0x095ea7b3' // approve(address,uint256)
const SEL_TRANSFER = '0xa9059cbb' // transfer(address,uint256)
const SEL_PERMIT2_APPROVE = '0x87517c45' // approve(address token,address spender,uint160,uint48)
const SEL_MULTICALL_DEADLINE = '0x5ae401dc' // multicall(uint256 deadline,bytes[])
const SEL_MULTICALL = '0xac9650d8' // multicall(bytes[])
const SEL_EXACT_INPUT_SINGLE = '0x04e45aaf' // SwapRouter02 exactInputSingle((address,address,uint24,address,uint256,uint256,uint160))
const SEL_EXACT_INPUT = '0xb858183f' // SwapRouter02 exactInput((bytes,address,uint256,uint256))

/** "Unlimited" allowances aren't a spend (2^200 is far past any real amount). */
const UNBOUNDED = BigInt(1) << BigInt(200)

const PERMIT2_APPROVE_ABI = [
  {
    type: 'function',
    name: 'approve',
    stateMutability: 'nonpayable',
    inputs: [
      { name: 'token', type: 'address' },
      { name: 'spender', type: 'address' },
      { name: 'amount', type: 'uint160' },
      { name: 'expiration', type: 'uint48' },
    ],
    outputs: [],
  },
] as const

const ROUTER_ABI = [
  {
    type: 'function',
    name: 'multicall',
    stateMutability: 'payable',
    inputs: [
      { name: 'deadline', type: 'uint256' },
      { name: 'data', type: 'bytes[]' },
    ],
    outputs: [{ name: '', type: 'bytes[]' }],
  },
  {
    type: 'function',
    name: 'multicall',
    stateMutability: 'payable',
    inputs: [{ name: 'data', type: 'bytes[]' }],
    outputs: [{ name: '', type: 'bytes[]' }],
  },
  {
    type: 'function',
    name: 'exactInputSingle',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'tokenIn', type: 'address' },
          { name: 'tokenOut', type: 'address' },
          { name: 'fee', type: 'uint24' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
          { name: 'sqrtPriceLimitX96', type: 'uint160' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
  {
    type: 'function',
    name: 'exactInput',
    stateMutability: 'payable',
    inputs: [
      {
        name: 'params',
        type: 'tuple',
        components: [
          { name: 'path', type: 'bytes' },
          { name: 'recipient', type: 'address' },
          { name: 'amountIn', type: 'uint256' },
          { name: 'amountOutMinimum', type: 'uint256' },
        ],
      },
    ],
    outputs: [{ name: 'amountOut', type: 'uint256' }],
  },
] as const

function bigOf(v: unknown): bigint | null {
  if (typeof v === 'bigint') return v
  if (typeof v === 'number' && Number.isFinite(v)) return BigInt(Math.trunc(v))
  if (typeof v === 'string' && /^(?:0x[0-9a-fA-F]+|\d+)$/.test(v.trim())) {
    try {
      return BigInt(v.trim())
    } catch {
      return null
    }
  }
  return null
}

function chainIdOf(tx: Tx, fallback?: number): number | null {
  const raw = tx.chainId ?? fallback
  const n = typeof raw === 'string' ? Number(raw) : raw
  return typeof n === 'number' && Number.isInteger(n) && n > 0 ? n : null
}

/** What ONE transaction spends from the signer. Pure; never throws. */
export function spendsOfTx(tx: Tx, step = 0, fallbackChainId?: number): Spend[] {
  const chainId = chainIdOf(tx, fallbackChainId)
  if (chainId === null) return []
  const to = typeof tx.to === 'string' && isAddress(tx.to) ? tx.to.toLowerCase() : null
  const out: Spend[] = []
  const value = bigOf(tx.value ?? '0') ?? BigInt(0)
  if (value > BigInt(0)) out.push({ chainId, token: 'ETH', atoms: value, kind: 'value', step })
  const data = typeof tx.data === 'string' && /^0x[0-9a-fA-F]*$/.test(tx.data) ? (tx.data as `0x${string}`) : null
  if (!data || data.length < 10 || !to) return out
  const sel = data.slice(0, 10).toLowerCase()
  try {
    if (sel === SEL_APPROVE) {
      const d = decodeFunctionData({ abi: erc20Abi, data })
      if (d.functionName === 'approve') {
        const amount = d.args[1] as bigint
        if (amount > BigInt(0) && amount < UNBOUNDED) out.push({ chainId, token: to, atoms: amount, kind: 'approve', step })
      }
    } else if (sel === SEL_TRANSFER) {
      const d = decodeFunctionData({ abi: erc20Abi, data })
      if (d.functionName === 'transfer') {
        const amount = d.args[1] as bigint
        if (amount > BigInt(0)) out.push({ chainId, token: to, atoms: amount, kind: 'transfer', step })
      }
    } else if (sel === SEL_PERMIT2_APPROVE) {
      const d = decodeFunctionData({ abi: PERMIT2_APPROVE_ABI, data })
      const amount = d.args[2] as bigint
      const token = (d.args[0] as string).toLowerCase()
      if (amount > BigInt(0) && amount < UNBOUNDED) out.push({ chainId, token, atoms: amount, kind: 'permit2', step })
    } else if (sel === SEL_MULTICALL_DEADLINE || sel === SEL_MULTICALL) {
      const d = decodeFunctionData({ abi: ROUTER_ABI, data })
      if (d.functionName === 'multicall') {
        const inner = (d.args.length === 2 ? d.args[1] : d.args[0]) as readonly `0x${string}`[]
        for (const call of inner) {
          const isel = call.slice(0, 10).toLowerCase()
          if (isel !== SEL_EXACT_INPUT_SINGLE && isel !== SEL_EXACT_INPUT) continue
          const id = decodeFunctionData({ abi: ROUTER_ABI, data: call })
          let tokenIn: string | null = null
          let amountIn: bigint | null = null
          if (id.functionName === 'exactInputSingle') {
            const p = id.args[0] as { tokenIn: string; amountIn: bigint }
            tokenIn = p.tokenIn.toLowerCase()
            amountIn = p.amountIn
          } else if (id.functionName === 'exactInput') {
            const p = id.args[0] as { path: `0x${string}`; amountIn: bigint }
            tokenIn = `0x${p.path.slice(2, 42)}`.toLowerCase()
            amountIn = p.amountIn
          }
          // An ETH-in swap rides the tx value (the router wraps) — already
          // counted above; the WETH "amountIn" would double-count it.
          if (tokenIn && amountIn && amountIn > BigInt(0) && value === BigInt(0)) {
            out.push({ chainId, token: tokenIn, atoms: amountIn, kind: 'swap-in', step })
          }
        }
      }
    }
  } catch {
    /* undecodable → whatever the value said, nothing more */
  }
  return out
}

/** A CoW order's sell side (protocol 'cow' only — Seaport sells an NFT, HL is
 *  venue-side collateral; both stay with their own layers). */
export function spendsOfOrder(orderRequest: unknown): Spend[] {
  if (!orderRequest || typeof orderRequest !== 'object') return []
  const o = orderRequest as { protocol?: unknown; chainId?: unknown; typedData?: { message?: Record<string, unknown> } }
  if (o.protocol !== 'cow') return []
  const chainId = chainIdOf({ chainId: o.chainId })
  const msg = o.typedData?.message
  if (chainId === null || !msg) return []
  const sellToken = typeof msg.sellToken === 'string' && isAddress(msg.sellToken) ? msg.sellToken.toLowerCase() : null
  const sellAmount = bigOf(msg.sellAmount)
  if (!sellToken || !sellAmount || sellAmount <= BigInt(0)) return []
  return [{ chainId, token: sellToken, atoms: sellAmount, kind: 'order', step: 0 }]
}

/** Every spend a response payload's signable carries. Pure. */
export function spendsOfPayload(payload: Record<string, unknown>): { spends: Spend[]; stepCount: number } {
  const spends: Spend[] = []
  let stepCount = 1
  const txChain = payload.txChain as { steps?: Array<{ tx?: Tx }> } | undefined
  if (txChain && Array.isArray(txChain.steps)) {
    stepCount = txChain.steps.length
    txChain.steps.forEach((s, i) => {
      if (s && s.tx && typeof s.tx === 'object') spends.push(...spendsOfTx(s.tx, i))
    })
  } else if (payload.txRequest && typeof payload.txRequest === 'object') {
    spends.push(...spendsOfTx(payload.txRequest as Tx, 0))
  }
  if (payload.orderRequest) spends.push(...spendsOfOrder(payload.orderRequest))
  return { spends, stepCount }
}

export interface Requirement {
  chainId: number
  token: string
  atoms: bigint
  /** false = an order (no gas needed on-chain). */
  needsGas: boolean
}

/**
 * Collapse spends into what the wallet must HOLD right now, per chain+token.
 * Same token twice in one artifact = the larger figure (approve → swap name
 * the same amount); native value legs on the same chain add up. A lone
 * approve (nothing in the artifact spends what it approved) is dropped.
 */
export function requirementsOf(spends: Spend[], stepCount = 1): Requirement[] {
  const byKey = new Map<string, Requirement>()
  const spentTokens = new Set(spends.filter((s) => s.kind !== 'approve' && s.kind !== 'permit2').map((s) => `${s.chainId}:${s.token}`))
  for (const s of spends) {
    const key = `${s.chainId}:${s.token}`
    // An approve counts when the artifact spends what it approved — decoded
    // (approve → exactInputSingle) OR by construction: a chain step that
    // approves and then hands the next step to the venue (approve → LiFi
    // bridge / Aave supply / Bridge2 deposit) approves exactly what that
    // step spends. A LONE approve (single tx, last step) is not a spend.
    const followedByAStep = s.step < stepCount - 1
    if ((s.kind === 'approve' || s.kind === 'permit2') && !spentTokens.has(key) && !followedByAStep) continue
    const cur = byKey.get(key)
    const needsGas = s.kind !== 'order'
    if (!cur) {
      byKey.set(key, { chainId: s.chainId, token: s.token, atoms: s.atoms, needsGas })
      continue
    }
    cur.needsGas = cur.needsGas || needsGas
    cur.atoms = s.kind === 'value' && s.token === 'ETH' ? cur.atoms + s.atoms : cur.atoms > s.atoms ? cur.atoms : s.atoms
  }
  return [...byKey.values()]
}

export interface BalanceReader {
  native(chainId: number, wallet: string): Promise<bigint>
  erc20(chainId: number, token: string, wallet: string): Promise<{ balance: bigint; decimals: number; symbol: string }>
}

function tokenMeta(chainId: number, token: string): { symbol: string; decimals: number } | null {
  const chain = chainById(chainId)
  const lower = token.toLowerCase()
  for (const [sym, info] of Object.entries(chain?.tokens ?? {})) {
    if (info.address.toLowerCase() === lower && sym !== 'ETH') return { symbol: sym, decimals: info.decimals }
  }
  const dyn = dynamicTokenByAddress(lower, chainId)
  return dyn ? { symbol: dyn.symbol, decimals: dyn.decimals } : null
}

/** The live reader: the registry's pinned client (fallback transport). */
export const rpcBalanceReader: BalanceReader = {
  async native(chainId, wallet) {
    const client = publicClientFor(chainId)
    if (!client) throw new Error(`no RPC for chain ${chainId}`)
    return client.getBalance({ address: wallet as `0x${string}` })
  },
  async erc20(chainId, token, wallet) {
    const client = publicClientFor(chainId)
    if (!client) throw new Error(`no RPC for chain ${chainId}`)
    const meta = tokenMeta(chainId, token)
    const addr = token as `0x${string}`
    const [balance, decimals, symbol] = await Promise.all([
      client.readContract({ address: addr, abi: erc20Abi, functionName: 'balanceOf', args: [wallet as `0x${string}`] }),
      meta ? Promise.resolve(meta.decimals) : client.readContract({ address: addr, abi: erc20Abi, functionName: 'decimals' }).then(Number),
      meta ? Promise.resolve(meta.symbol) : client.readContract({ address: addr, abi: erc20Abi, functionName: 'symbol' }).catch(() => `${token.slice(0, 6)}…${token.slice(-4)}`),
    ])
    return { balance, decimals, symbol: String(symbol) }
  },
}

/**
 * The verdict for one wallet against one payload's signable. Every read is
 * guarded: a failed read is `unknown`, never a refusal (the layer that built
 * the artifact already stood behind it).
 */
export async function checkAffordability(
  wallet: string,
  payload: Record<string, unknown>,
  reader: BalanceReader = rpcBalanceReader,
): Promise<AffordabilityVerdict> {
  const { spends, stepCount } = spendsOfPayload(payload)
  const reqs = requirementsOf(spends, stepCount)
  if (reqs.length === 0) return { kind: 'no-spend' }
  const nativeCache = new Map<number, bigint>()
  const nativeOf = async (chainId: number) => {
    const hit = nativeCache.get(chainId)
    if (hit !== undefined) return hit
    const v = await reader.native(chainId, wallet)
    nativeCache.set(chainId, v)
    return v
  }
  try {
    for (const r of reqs) {
      const chain = chainById(r.chainId)
      if (!chain) return { kind: 'unknown', reason: `chain ${r.chainId} is not in the registry` }
      if (r.token === 'ETH') {
        const held = await nativeOf(r.chainId)
        if (held < r.atoms) return { kind: 'short', chainId: r.chainId, chainName: chain.name, token: 'ETH', symbol: 'ETH', decimals: 18, held, needs: r.atoms, gas: false }
        continue
      }
      const { balance, decimals, symbol } = await reader.erc20(r.chainId, r.token, wallet)
      if (balance < r.atoms) return { kind: 'short', chainId: r.chainId, chainName: chain.name, token: r.token, symbol, decimals, held: balance, needs: r.atoms, gas: false }
      if (r.needsGas) {
        const gasHeld = await nativeOf(r.chainId)
        if (gasHeld === BigInt(0)) return { kind: 'short', chainId: r.chainId, chainName: chain.name, token: 'ETH', symbol: 'ETH', decimals: 18, held: gasHeld, needs: BigInt(0), gas: true }
      }
    }
  } catch (err) {
    return { kind: 'unknown', reason: err instanceof Error ? err.message.split('\n')[0].slice(0, 160) : 'balance read failed' }
  }
  return { kind: 'ok', checked: reqs.length }
}

const fmt = (atoms: bigint, decimals: number) => {
  const s = formatUnits(atoms, decimals)
  const n = Number(s)
  if (!Number.isFinite(n)) return s
  return n === 0 ? '0' : n >= 1 ? n.toFixed(Math.min(6, decimals)).replace(/\.?0+$/, '') : s.replace(/(\.\d*?[1-9])0+$/, '$1').replace(/\.0+$/, '')
}

/** The sentence the stranger reads instead of a Sign button. */
export function affordabilityRefusal(v: Extract<AffordabilityVerdict, { kind: 'short' }>): string {
  const origins = fundingOriginWords()
  if (v.gas) {
    return (
      `⛽ Nothing to sign yet: this transaction runs on ${v.chainName} and the wallet holds no ETH there to pay for it. ` +
      `Send a little ETH to this wallet on ${v.chainName} (or USDC/ETH on ${origins} and ask for a top-up), then ask again — nothing was built.`
    )
  }
  const needs = fmt(v.needs, v.decimals)
  const held = fmt(v.held, v.decimals)
  return (
    `🔄 Nothing to sign yet: this would spend ${needs} ${v.symbol} on ${v.chainName} and the wallet holds ${held} ${v.symbol} there. ` +
    `Send ${v.symbol} to this wallet on ${v.chainName} (or USDC/ETH on ${origins}), then ask again — nothing was built.`
  )
}

export const AFFORDABILITY_SHORT_PATH = 'native-affordability-short'

/**
 * Gate a response payload: when its signable is provably unaffordable, the
 * artifact is REMOVED and the reply becomes the refusal. Every other verdict
 * returns the payload untouched (plus a `affordability` note for the trace).
 * Works on both wire shapes — `reply` (JSON) and `content` (SSE event).
 */
export async function gateSignablePayload<T extends Record<string, unknown>>(
  payload: T,
  wallet: string | null | undefined,
  opts: { reader?: BalanceReader; log?: (line: string) => void } = {},
): Promise<{ payload: T; verdict: AffordabilityVerdict | null }> {
  if (!wallet || !isAddress(wallet)) return { payload, verdict: null }
  if (!payload.txRequest && !payload.txChain && !payload.orderRequest) return { payload, verdict: null }
  // The one declared exemption: a resting CoW limit order settles whenever
  // the funds arrive, and the swap layer SAYS so on the card (the 💤 line).
  // Only the route composes payloads, so a tool can't declare this for itself.
  const exempt = (payload.affordability as { exempt?: unknown } | undefined)?.exempt
  if (exempt === 'resting-limit-order' && payload.orderRequest && !payload.txRequest && !payload.txChain) {
    return { payload, verdict: { kind: 'no-spend' } }
  }
  const verdict = await checkAffordability(wallet, payload, opts.reader)
  if (verdict.kind === 'unknown') opts.log?.(`[affordability] unverified signable (${verdict.reason}) — passing the artifact through`)
  if (verdict.kind !== 'short') return { payload, verdict }
  const textKey = typeof payload.content === 'string' && typeof payload.reply !== 'string' ? 'content' : 'reply'
  opts.log?.(`[affordability] withheld a signable: ${verdict.symbol} on ${verdict.chainName} — holds ${fmt(verdict.held, verdict.decimals)}, needs ${fmt(verdict.needs, verdict.decimals)}${verdict.gas ? ' (gas)' : ''}; was ${String(payload.buildPath ?? 'unlabeled')}`)
  const gated: Record<string, unknown> = { ...payload }
  delete gated.txRequest
  delete gated.txChain
  delete gated.orderRequest
  delete gated.jobToken
  gated[textKey] = affordabilityRefusal(verdict)
  gated.buildPath = AFFORDABILITY_SHORT_PATH
  gated.affordability = {
    short: { chainId: verdict.chainId, token: verdict.token, symbol: verdict.symbol, held: verdict.held.toString(), needs: verdict.needs.toString(), gas: verdict.gas },
    withheldBuildPath: typeof payload.buildPath === 'string' ? payload.buildPath : null,
  }
  return { payload: gated as T, verdict }
}
