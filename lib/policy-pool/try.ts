// ─────────────────────────────────────────────────────────────────────────
//  THE POLICY POOL — "Try it" (TRYIT lane, squad policy-pool 2026-11-02)
//
//  The pure half of the /policy-pool Try-it strip and its server door
//  (app/api/policy-pool/try). CLIENT-SAFE: no prisma, no builder, no env —
//  components/policy-pool/TryIt imports this; the route adds the server
//  pieces. Three asks, each a sentence the connect-to-act door can hold:
//    plain    — the same $1 swap with EMPTY hookData; the hook reverts it
//    attested — "Buy $1 of ETH through the policy pool": policy → attestation
//               → guarded build → the viewer signs → fill
//    overcap  — the same ask at $5,000: the desk policy refuses, nothing built
//  Plus `report`: the client hands the server a tx hash and the SERVER reads
//  the receipt — the chain is the evidence, never the client's claim.
// ─────────────────────────────────────────────────────────────────────────

export type TryAction = 'plain' | 'attested' | 'overcap'
export type TryRequestAction = TryAction | 'report'

export const TRY_USD: Record<TryAction, number> = { plain: 1, attested: 1, overcap: 5000 }

/** The sentence each button holds through the connect door (rule 6). The
 *  attested + over-cap ones are the chat's own grammar, verbatim. */
export const TRY_ASKS: Record<TryAction, string> = {
  plain: 'Swap $1 of USDC for ETH in the policy pool without the note',
  attested: 'Buy $1 of ETH through the policy pool',
  overcap: 'Buy $5,000 of ETH through the policy pool',
}

/** Which action a held ask names, or null. */
export function tryActionForAsk(ask: string): TryAction | null {
  const t = ask.trim()
  for (const [k, v] of Object.entries(TRY_ASKS)) if (v === t) return k as TryAction
  return null
}

/** What each button is about to do — one sentence, shown before the tap. */
export const TRY_BLURBS: Record<TryAction, { title: string; body: string }> = {
  plain: {
    title: 'Swap without the note',
    body: 'Builds the same $1 USDC → ETH swap through the Universal Router with EMPTY hookData. Your wallet signs it; the hook reverts it on-chain (NotAttested).',
  },
  attested: {
    title: 'Buy $1 through the desk',
    body: 'The desk policy checks $1 against its cap, the policy signer attests it for YOUR wallet, the guard verifies the hookData, you sign, the fill lands.',
  },
  overcap: {
    title: 'Ask for $5,000',
    body: 'The same ask at $5,000. The desk policy refuses with its cap sentence; nothing is built and your wallet is never asked.',
  },
}

/** Base Sepolia faucets — the hint when the viewer's wallet holds nothing there. */
export const TRY_FAUCETS: { name: string; href: string }[] = [
  { name: 'Coinbase faucet', href: 'https://portal.cdp.coinbase.com/products/faucet' },
  { name: 'Alchemy faucet', href: 'https://www.alchemy.com/faucets/base-sepolia' },
]

export const BASE_MAINNET_CHAIN_ID = 8453
export const TRY_MAINNET_REFUSAL = 'The Try-it door never runs on Base mainnet (8453) — it rehearses on the testnet the pool is deployed to.'

/** The door's one chain rule, both sides: the pool's env chain and the
 *  chain the client expects. 8453 on either side is a refusal by name. */
export function tryChainVerdict(input: { cfgChainId: number; bodyChainId?: number | null }): string | null {
  if (input.cfgChainId === BASE_MAINNET_CHAIN_ID) return TRY_MAINNET_REFUSAL
  if (input.bodyChainId === BASE_MAINNET_CHAIN_ID) return TRY_MAINNET_REFUSAL
  if (input.bodyChainId != null && input.bodyChainId !== input.cfgChainId) {
    return `This page expected the pool on chain ${input.bodyChainId}, but the desk pins it to chain ${input.cfgChainId}. Reload the page.`
  }
  return null
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
const TX_HASH_RE = /^0x[0-9a-fA-F]{64}$/
/** The ids this door mints: the attested path wears the chat's own `chat-`
 *  prefix (the /api/tx/refresh recipe gate accepts exactly `chat-<id>`, and a
 *  self-minted id with a `desk:` origin is the same trust class as a bare
 *  chat turn's); the plain path's id only labels its revert row. */
export const TRY_ATTESTED_ID_RE = /^chat-try-[a-z0-9]{6,16}$/
export const TRY_PLAIN_ID_RE = /^try-plain-[a-z0-9]{6,16}$/
export const TRY_PLAIN_ORIGIN = 'demo:try-plain-wallet'

export type TryRequest =
  | { action: 'plain'; wallet: `0x${string}`; chainId: number | null }
  | { action: 'attested'; wallet: `0x${string}`; chainId: number | null; usd: number }
  | { action: 'report'; wallet: `0x${string}`; chainId: number | null; txHash: `0x${string}`; intentId: string | null }

/** Parse an untrusted POST body into one of the door's requests, or a 400 reason. */
export function parseTryRequest(body: unknown): { ok: true; req: TryRequest } | { ok: false; error: string } {
  if (!body || typeof body !== 'object') return { ok: false, error: 'Body must be a JSON object.' }
  const b = body as Record<string, unknown>
  const wallet = typeof b.wallet === 'string' && ADDRESS_RE.test(b.wallet) ? (b.wallet as `0x${string}`) : null
  if (!wallet) return { ok: false, error: 'wallet must be a 0x-prefixed 40-hex address (the connected wallet).' }
  const chainId = b.chainId === undefined || b.chainId === null ? null : typeof b.chainId === 'number' && Number.isInteger(b.chainId) && b.chainId > 0 ? b.chainId : NaN
  if (Number.isNaN(chainId)) return { ok: false, error: 'chainId must be a positive integer when given.' }
  switch (b.action) {
    case 'plain':
      return { ok: true, req: { action: 'plain', wallet, chainId } }
    case 'attested': {
      const usd = typeof b.usd === 'number' ? b.usd : typeof b.usd === 'string' && /^\d+(\.\d{1,2})?$/.test(b.usd) ? Number(b.usd) : NaN
      if (!Number.isFinite(usd) || usd <= 0 || usd > 1_000_000) return { ok: false, error: 'usd must be a positive dollar amount (at most $1,000,000).' }
      return { ok: true, req: { action: 'attested', wallet, chainId, usd: Math.round(usd * 100) / 100 } }
    }
    case 'report': {
      const txHash = typeof b.txHash === 'string' && TX_HASH_RE.test(b.txHash) ? (b.txHash.toLowerCase() as `0x${string}`) : null
      if (!txHash) return { ok: false, error: 'txHash must be a 32-byte hex.' }
      const intentId = typeof b.intentId === 'string' && (TRY_ATTESTED_ID_RE.test(b.intentId) || TRY_PLAIN_ID_RE.test(b.intentId)) ? b.intentId : null
      return { ok: true, req: { action: 'report', wallet, chainId, txHash, intentId } }
    }
    default:
      return { ok: false, error: "action must be one of 'plain', 'attested', 'report'." }
  }
}

/** A sliding-window limiter, pure in `now`: N hits per key per window. The
 *  route keeps one per process (serverless-instance local — a fence against
 *  a spree, not a ledger). */
export class TryLimiter {
  private hits = new Map<string, number[]>()
  constructor(private readonly max: number, private readonly windowMs: number) {}
  /** True when this hit is allowed (and recorded). */
  allow(key: string, now = Date.now()): boolean {
    const floor = now - this.windowMs
    const list = (this.hits.get(key) ?? []).filter((t) => t > floor)
    if (list.length >= this.max) {
      this.hits.set(key, list)
      return false
    }
    list.push(now)
    this.hits.set(key, list)
    // Forget idle keys so the map never grows without bound.
    if (this.hits.size > 5_000) for (const [k, v] of this.hits) if (!v.some((t) => t > floor)) this.hits.delete(k)
    return true
  }
}
export const TRY_WALLET_CAP = 12
export const TRY_IP_CAP = 40
export const TRY_WINDOW_MS = 10 * 60 * 1000

/** `NotAttested()` from a decoded hook revert name; the honest fallback otherwise. */
export function revertReasonFor(name: string | null): string {
  return name ? `${name}()` : 'reverted on-chain (the reason bytes were not the hook’s)'
}

/** The ledger kinds the strip waits for after each action (in walk order). */
export const TRY_EXPECTED_KINDS: Record<TryAction, string[]> = {
  plain: ['onchain_revert'],
  attested: ['guard_allowed', 'attested', 'signed', 'mined', 'fill'],
  overcap: ['guard_refused'],
}
