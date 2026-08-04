// ─────────────────────────────────────────────────────────────────────────
//  Pantessa protocol fees — the single source of truth. Every fee-bearing
//  venue imports the treasury address and the fee rate from HERE — never a
//  local constant, never a model-supplied value. Fee-bearing venues today:
//  LiFi (explicit transfer step), Uniswap v3 (router-native
//  sweepTokenWithFee split), CoW (protocol-native partnerFee in the signed
//  appData document).
//
//  SWAP_FEE_BPS is deliberately BELOW Uniswap's 25 bps interface fee: the
//  chat should never be the expensive way to do the same swap. 20 bps on a
//  $100 stock swap = $0.20 — visible in the artifact, always as its own
//  explicit transfer step (or a venue's native fee field), never hidden
//  inside slippage.
// ─────────────────────────────────────────────────────────────────────────

const ADDR_RE = /^0x[0-9a-fA-F]{40}$/

/** Pantessa's fee treasury. Env-overridable (YEETFUL_TREASURY) so staging can
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

// ── Hyperliquid builder fee (perp orders) ───────────────────────────────────
// HL's venue-native interface fee: orders carry `builder: {b, f}` where f is
// in TENTHS of a basis point (f=10 → 1bp; venue cap f=100 → 10bps → "0.1%"
// on perps). The user approves the cap ONCE (a user-signed
// approveBuilderFee action); after that every guarded perp order pays the
// fee from the fill, venue-enforced — no extra transaction. The builder
// account must hold ≥100 USDC of HL perps account value to receive fees
// (venue rule — an owner-funded prerequisite, checked in the drill).

/** HL builder fee in the venue's tenths-of-a-bp unit. Default 100 = 10bps =
 *  the venue's perp cap (decided 2026-07-30, HANDOFF-yeetcall-gtm). Env
 *  override clamped to [0, 100] — the venue rejects more; 0 disables (no
 *  builder field rides the order at all). */
export const HL_BUILDER_FEE_TENTH_BPS: number = (() => {
  const raw = Number(process.env.YEETFUL_HL_BUILDER_FEE_TENTH_BPS ?? '100')
  if (!Number.isInteger(raw) || raw < 0 || raw > 100) return 100
  return raw
})()

/** The approval's maxFeeRate string — approve EXACTLY what we charge, never
 *  a looser cap (f=100 → "0.1%"; 1% = 1000 units). */
export const HL_BUILDER_MAX_FEE_RATE = `${HL_BUILDER_FEE_TENTH_BPS / 1000}%`

/** LINK-originated spot flow pays this tier (decided 2026-07-30,
 *  HANDOFF-yeetcall-gtm): the /i experience prices at 50bps — still at
 *  half of what Telegram-bot retail demonstrably pays — while organic
 *  chat keeps SWAP_FEE_BPS. Omitting the slug isn't an evasion vector:
 *  it just buys the price anyone gets in chat. Env-clamped [0, 100];
 *  values ≤ SWAP_FEE_BPS collapse the tier to the base rate. */
export const LINK_SWAP_FEE_BPS: number = (() => {
  const raw = Number(process.env.YEETFUL_LINK_SWAP_FEE_BPS ?? '50')
  if (!Number.isInteger(raw) || raw < 0 || raw > 100) return 50
  return Math.max(raw, SWAP_FEE_BPS)
})()

// ── Creator fee-split (intent links) ────────────────────────────────────────
// Half of the swap fee on link-attributed conversions accrues to the link's
// creator — the referral rail. Phase 1 is LEDGERED (fees land in the
// treasury unchanged; earnings compute read-time from embed_turns and pay
// out as USDC-on-Base claims). Phase 2 points the venue fee recipient at a
// per-creator deterministic split contract — same math, on-chain enforced.

/** Fraction of the Pantessa fee the link creator earns. */
export const CREATOR_FEE_SPLIT = 0.5

// ── The NEAR Intents (1Click) venue fee ─────────────────────────────────────
// 1Click carries an `appFees` field on the quote: the fee comes out of the
// INPUT before the swap, so on EXACT_INPUT (what we always send) the deposit
// the user signs is UNCHANGED — a venue-native fee with no extra transaction,
// exactly like CoW's partnerFee and Uniswap's sweepTokenWithFee.
//
// The catch: 1Click splits every app fee 50/50 with the protocol. We REQUEST
// SWAP_FEE_BPS so the user pays the same 0.20% here as everywhere else, and
// we KEEP half of it. Earnings math must read the net, never the request.

/** What we ask 1Click for — the user-facing rate, same as every venue. */
export const CROSS_CHAIN_FEE_BPS = SWAP_FEE_BPS

/** 1Click's cut of every app fee (documented + verified live 2026-07-28). */
export const ONECLICK_FEE_SPLIT = 0.5

/** What actually reaches the treasury on a cross-chain swap. */
export const CROSS_CHAIN_NET_FEE_BPS = Math.round(CROSS_CHAIN_FEE_BPS * (1 - ONECLICK_FEE_SPLIT))

/** Pantessa's NET fee in bps per build path — what the treasury keeps after
 *  the venue's own cut. Uniswap/CoW/LiFi hand over the whole SWAP_FEE_BPS;
 *  NEAR Intents keeps half; HL perp orders carry the builder fee (f/10 bps,
 *  all ours). Everything NOT in this map (funding legs, NFTs, transfers,
 *  votes, staking, guardian protection closes, sales) is fee-free by the
 *  conversions-not-movements rule and earns nothing. */
export const NET_FEE_BPS_BY_BUILD_PATH: Record<string, number> = {
  'native-swap-uniswap': SWAP_FEE_BPS,
  'native-swap-uniswap-v4': SWAP_FEE_BPS,
  'native-swap-lifi': SWAP_FEE_BPS,
  'native-swap-cow': SWAP_FEE_BPS,
  'native-cross-chain': CROSS_CHAIN_NET_FEE_BPS,
  'native-hl-exec': HL_BUILDER_FEE_TENTH_BPS / 10,
}

/** Build paths whose artifacts CARRY a venue fee — the ONLY paths creator
 *  earnings accrue on. Derived from the map's POSITIVE entries so an
 *  env-disabled fee (0) drops its path here too. */
export const FEE_BEARING_BUILD_PATHS = new Set(
  Object.entries(NET_FEE_BPS_BY_BUILD_PATH).filter(([, bps]) => bps > 0).map(([path]) => path),
)

/** Pantessa's net fee rate for a build path; 0 when the path is fee-free. */
export function netFeeBpsFor(buildPath: string | null | undefined): number {
  return (buildPath && NET_FEE_BPS_BY_BUILD_PATH[buildPath]) || 0
}

/** Effective NET bps for ONE turn row (C2b): the STAMPED tier when the row
 *  carries one — CoW/Uniswap hand the whole fee over, so the stamped rate IS
 *  the net — else the per-path default. Cross-chain keeps the path fallback
 *  (its stamped rate would be gross; 1Click keeps half). Callers still gate
 *  on FEE_BEARING_BUILD_PATHS — a stray stamp on a fee-free path earns $0. */
export function netFeeBpsForTurn(buildPath: string | null | undefined, feeBps: number | null | undefined): number {
  if (buildPath === 'native-cross-chain') return netFeeBpsFor(buildPath)
  if (typeof feeBps === 'number' && feeBps > 0) return feeBps
  return netFeeBpsFor(buildPath)
}

/** Creator earnings on a signed, fee-bearing notional — half of what Pantessa
 *  actually keeps, which is NOT always half of what the user paid (see the
 *  1Click split above). Callers pass the path's net rate. */
export function creatorEarningsUsd(valueUsd: number, netBps: number = SWAP_FEE_BPS): number {
  if (!(valueUsd > 0) || !(netBps > 0)) return 0
  return valueUsd * (netBps / 10_000) * CREATOR_FEE_SPLIT
}

/** Display for a creator earning. The split is SUB-CENT at test scale — a $1
 *  swap earns $0.001 — so two decimals render every early real conversion as
 *  "$0.00", indistinguishable from a fee-free route that earned nothing at
 *  all. Exact zero keeps the familiar $0.00; under a cent shows the tiny bits
 *  (4 decimals, trailing zeros trimmed) so a tester can watch the rail work
 *  on a dollar; a cent or more is money and rounds like money. */
export function formatEarnedUsd(n: number): string {
  if (!(n > 0)) return '$0.00'
  if (n >= 0.01) return `$${n.toFixed(2)}`
  if (n < 0.0001) return '<$0.0001'
  return `$${n.toFixed(4).replace(/0+$/, '')}`
}

/** Fees went live with the LiFi venue on 2026-07-15 (July 1 gives margin).
 *  Every fee figure — the admin treasury inflow window AND any ledgered
 *  estimate derived from embed_turns — starts the clock HERE: the treasury
 *  address is an old wallet with unrelated history, and signed fee-bearing
 *  turns before this date carried no fee. */
export const FEES_LIVE_SINCE = Date.parse('2026-07-01T00:00:00Z')
