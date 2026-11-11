// ─────────────────────────────────────────────────────────────────────────
//  CoW order-book refusals, in words — and which stage gets the blame.
//
//  Born 2026-11-11: a wallet SIGNED a $25 USDC → UNI limit order on Base,
//  CoW's order book refused the signed order, and the relay answered 502
//  "CoW order book rejected the order: …". The sign button tested every
//  error for /rejected|denied/ and printed "Signature rejected in the wallet
//  — check the wallet is on Base." The wallet had said yes; CoW's reason was
//  in no log, no row, no screen.
//
//  Two rules live here:
//   1. Only the WALLET stage may be called a rejection. A relay or order-book
//      answer is shown in its own words (signOrderErrorText).
//   2. The order book's answer keeps its errorType (CoW's OrderPostError
//      name, e.g. InsufficientBalance, WrongOwner) next to plain words, so a
//      screen, a log line and a /dashboard/failures row all say the same
//      thing (cowRefusalOf + cowRefusalWords).
//
//  Pure: no imports with side effects; the button and the relay both use it.
// ─────────────────────────────────────────────────────────────────────────

import { signStageError, type SignStage } from '@/lib/wallet-refusal'

/** What CoW's order book said, normalized. `errorType` is CoW's own name
 *  (null when the body carried none, e.g. an HTML 5xx page). */
export interface CowRefusal {
  status: number
  errorType: string | null
  description: string | null
}

const clean = (v: unknown, n: number): string | null =>
  typeof v === 'string' && v.trim() ? v.trim().replace(/\s+/g, ' ').slice(0, n) : null

/** Pure: read CoW's error body (`{ errorType, description }`). Never throws. */
export function cowRefusalOf(status: number, data: unknown): CowRefusal {
  const o = data && typeof data === 'object' ? (data as Record<string, unknown>) : {}
  const errorType = clean(o.errorType, 60)
  return {
    status,
    errorType: errorType && /^[A-Za-z0-9]+$/.test(errorType) ? errorType : null,
    description: clean(o.description, 240),
  }
}

/** Plain reasons, keyed by CoW's errorType (crates/orderbook/src/api/post_order.rs). */
const REASONS: Array<[RegExp, string]> = [
  [/^InsufficientBalance$/, "the wallet doesn't hold enough of the token it is selling on this chain"],
  [/^InsufficientAllowance$/, "CoW isn't approved to move the token being sold yet; approve it, then sign again"],
  [/^TransferSimulationFailed$/, "CoW's test transfer of the token being sold failed"],
  [
    /^(WrongOwner|InvalidSignature|InvalidEip1271Signature|IncompatibleSigningScheme|MissingFrom|AppdataFromMismatch)$/,
    "CoW couldn't verify the signature as this wallet's",
  ],
  [/^DuplicatedOrder$/, "this exact order is already on CoW's book"],
  [/^TooManyLimitOrders$/, 'this wallet has too many open limit orders on CoW; cancel one first'],
  [/^(InvalidAppData|AppDataHashMismatch|MetadataSerializationFailed)$/, "CoW didn't accept the order's app data"],
  [
    /^(UnsupportedToken|UnsupportedBuyTokenDestination|UnsupportedSellTokenSource|InvalidNativeSellToken|SameBuyAndSellToken)$/,
    "CoW doesn't support this pair as signed",
  ],
  [/^(InsufficientValidTo|ExcessiveValidTo|InvalidValidFrom)$/, "the order's expiry is outside what CoW accepts"],
  [/^(QuoteNotVerified|TooMuchGas|FastPathLimitTooTight)$/, "CoW couldn't price the order safely"],
  [/^(ZeroAmount|NonZeroFee|SellAmountOverflow)$/, "the order's amounts aren't valid for CoW"],
  [/^Forbidden$/, "CoW doesn't take orders from this wallet"],
]

/** Pure: the one sentence a person sees (and the relay logs) for a refusal.
 *  Always says the wallet signed and nothing was placed, and ends with CoW's
 *  own name for the error so the line is diagnosable from a screenshot. */
export function cowRefusalWords(r: CowRefusal): string {
  const reason = (r.errorType && REASONS.find(([re]) => re.test(r.errorType!))?.[1]) || null
  const raw = [r.errorType, r.description].filter(Boolean).join(': ') || `HTTP ${r.status}`
  return reason
    ? `CoW's order book refused the signed order: ${reason}. Nothing was placed. (${raw})`
    : `CoW's order book refused the signed order. Nothing was placed. (${raw})`
}

/** Pure: the error line the CoW sign button shows. Only the wallet stage
 *  can read as a rejection (lib/wallet-refusal signStageError); a relay or
 *  order-book answer is shown as the relay wrote it. */
export function signOrderErrorText(stage: SignStage, words: string, chainName: string): string {
  // A human "no" — or a wallet that reports a chain mismatch as one (Coinbase
  // Wallet) — gets the network hint; the beacon drops the same set.
  const declined = `Signature rejected in the wallet. Nothing was placed. (If you didn’t cancel: check the wallet is on ${chainName}.)`
  if (stage === 'server') return words.trim() || 'The order relay refused the signed order. Nothing was placed.'
  const line = signStageError('wallet', words, declined)
  return line === declined ? line : `The wallet couldn't sign the order: ${line}`
}
