// ─────────────────────────────────────────────────────────────────────────
//  Yeetful protocol fees — the single source of truth. Every fee-bearing
//  venue (LiFi today; future aggregator/settlement venues) imports the
//  treasury address and the fee rate from HERE — never a local constant,
//  never a model-supplied value.
//
//  SWAP_FEE_BPS is deliberately BELOW Uniswap's 25 bps interface fee: the
//  chat should never be the expensive way to do the same swap. 20 bps on a
//  $100 stock swap = $0.20 — visible in the artifact, always as its own
//  explicit transfer step (or a venue's native fee field), never hidden
//  inside slippage.
// ─────────────────────────────────────────────────────────────────────────

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

/** Yeetful's fee treasury. Env-overridable (YEETFUL_TREASURY) so staging can
 *  point at a burner; an invalid override falls back to the pinned default
 *  rather than silently shipping fees to a typo. */
export const TREASURY_ADDRESS: `0x${string}` =
  process.env.YEETFUL_TREASURY && ADDR_RE.test(process.env.YEETFUL_TREASURY)
    ? (process.env.YEETFUL_TREASURY as `0x${string}`)
    : '0x9Cc0B7A0DdB091E17647d689206e730131E9892A'

/** Fee on fee-bearing swap venues, in basis points. Default 20 (0.20%) —
 *  deliberately below Uniswap's 25 bps interface fee. Env override
 *  (YEETFUL_SWAP_FEE_BPS) is clamped to [0, 100]: a fee above 1% is assumed
 *  to be a misconfiguration, not a business decision. */
export const SWAP_FEE_BPS: number = (() => {
  const raw = Number(process.env.YEETFUL_SWAP_FEE_BPS ?? '20')
  if (!Number.isInteger(raw) || raw < 0 || raw > 100) return 20
  return raw
})()

/** The fee in input-token atoms for a given swap input. Floor division —
 *  rounding always favors the user; dust amounts round to a zero fee (and
 *  the venue then attaches no fee step at all). */
export function swapFeeAtoms(amountIn: bigint, bps: number = SWAP_FEE_BPS): bigint {
  if (amountIn <= BigInt(0) || bps <= 0) return BigInt(0)
  return (amountIn * BigInt(bps)) / BigInt(10_000)
}
