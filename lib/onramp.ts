// lib/onramp.ts — the fiat on-ramp door, planned around the user's INTENT.
//
// The only TRUE dead end in the funnel. A wallet holding nothing on any chain
// we can bridge from gets an honest refusal and NO artifact: "top up USDC or
// ETH on Base, Ethereum, or Arbitrum, tell me when it's there" is homework,
// not an action. Measured on the live /i/buy-aapl link (2026-08-27):
// 55 opened → 31 connected → 14 built. The 17 that connected and never got an
// artifact are this gap, and preflight:house can never see it because it runs
// with the funded burner.
//
// This module turns that refusal into ONE chip. Two properties carry it:
//
//   1. THE INTENT SURVIVES THE ROUND TRIP. A fund chip is a normal
//      ClarifyOption, so it still carries `resume` — the original ask,
//      restated. The on-ramp takes the user off our page; when they come back
//      the resume fires and the ask they arrived with is still the ask. A
//      funding flow that loses the intent is just a link to an exchange.
//
//   2. FAIL CLOSED. Unconfigured → no chip at all, and every refusal reads
//      exactly as it does today. Same door discipline as the x402 paid tier:
//      a half-configured on-ramp must never render a button that 500s.
//
// ── PROVIDER: STRIPE (2026-09-04) ─────────────────────────────────────────
// Was Coinbase Onramp (CDP). Switched when the Stripe crypto onramp
// application was accepted. Stripe is the merchant of record and owns KYC,
// fraud and disputes; we mint a session server-side and redirect to the
// Stripe-hosted onramp at crypto.link.com, which is the same "open a tab,
// come back when it lands" shape the CDP flow had — so the chip, the consent
// signature and the resume contract are all unchanged.
//
// What DID change, and why it matters more than the vendor swap:
//
// ── THE ASSET IS NOW ETH, NOT USDC ────────────────────────────────────────
// The wallet we are funding is EMPTY. Empty means no gas. Delivering a stable
// into it lands money that cannot move itself — precisely the gas-stranded
// state the funding layer already has to apologise for elsewhere ("$20 USDC
// Base (no gas)", #499/#549). The user pays a card fee to arrive at a second
// wall, which is the worst possible second impression.
//
// ETH is the native asset on both networks here, so one delivery covers the
// gas AND the value, and the first hop needs no ERC-20 approval. Everything
// downstream already treats ETH as a first-class funding source: classify-
// FundingBalances (lib/funding-plan) reserves GAS_RESERVE_ETH and offers the
// rest, and the Robinhood/LiFi cascade (lib/lifi-bridge) carries ETH origins
// through fundSegment's "using eth" clause. So the ETH→USDC / →USDG swap the
// plan needs is not new code — it is the cascade that was already there,
// finally being handed an origin it can spend.
//
// Stripe cannot deliver to Robinhood Chain (4663) — no on-ramp reaches a
// custom Orbit chain. It lands ETH on Base and the existing cascade carries
// it the rest of the way, so every plan here is denominated on a FUNDING_SCAN
// chain and the bridge stays the layer that crosses.

import type { ClarifyOption } from '@/lib/clarify'

/** Networks Stripe's onramp can deliver to that our funding scan also reads.
 *
 *  ARBITRUM IS GONE, deliberately: Stripe's destination_network enum has no
 *  arbitrum (base, ethereum, optimism, polygon, celo, worldchain, sui, tempo
 *  + the non-EVM chains), and Coinbase's did. Offering a network the provider
 *  will reject at their door reads to the user as our bug, so the type is the
 *  fence — lib/clarify's FUND_NETWORKS mirrors it and clamps anything else
 *  back to a plain chip. Base is the lane every chip actually uses; Ethereum
 *  is kept because the funding scan reads it and L1 is where a hand-typed
 *  address most often already is. */
export type OnrampNetwork = 'base' | 'ethereum'

/** Stripe's `destination_network` enum value per network. Identity today —
 *  it exists so the wallet-address asymmetry below has a sibling and neither
 *  gets "simplified" into a bare string. */
export const STRIPE_NETWORK: Record<OnrampNetwork, string> = {
  base: 'base',
  ethereum: 'ethereum',
}

/** Stripe's `wallet_addresses[…]` KEY per network — and no, it does not match
 *  the network enum. The network is `base`; the address key is `base_network`
 *  (their object is keyed avalanche / base_network / bitcoin / celo /
 *  ethereum / optimism / polygon / sui / tempo / worldchain / …). On Ethereum
 *  the two words agree, which is precisely what makes Base easy to get wrong.
 *
 *  Verified against the live API 2026-09-04: the intuitive `wallet_addresses
 *  [base]` is rejected outright — HTTP 400, `parameter_unknown`, "Received
 *  unknown parameter: wallet_addresses[base]". So the failure is loud, but it
 *  is loud only ON A LIVE CALL, and it takes the funding path down for every
 *  user at once behind a generic "Could not start the funding session". That
 *  is the argument for a named map plus a harness pin over a template
 *  string: the mistake becomes catchable without spending a request. */
export const STRIPE_WALLET_KEY: Record<OnrampNetwork, string> = {
  base: 'base_network',
  ethereum: 'ethereum',
}

/** Assets we can both buy at Stripe and plan with downstream. ETH is what the
 *  chip emits (it is the gas); USDC stays valid because the funding scan
 *  reads it and the consent signature has to bind whatever we send. */
export const ONRAMP_ASSETS = ['ETH', 'USDC'] as const
export type OnrampAsset = (typeof ONRAMP_ASSETS)[number]

/** Stripe's `destination_currency` enum value per asset (lowercase codes). */
export const STRIPE_CURRENCY: Record<OnrampAsset, string> = { ETH: 'eth', USDC: 'usdc' }

/** Native, so it funds its own gas. See the ASSET note in the header. */
export const ONRAMP_ASSET: OnrampAsset = 'ETH'

/** Narrow an asset string to one we can actually deliver, else null. */
export function onrampAssetOf(raw: unknown): OnrampAsset | null {
  if (typeof raw !== 'string') return null
  const up = raw.trim().toUpperCase()
  return (ONRAMP_ASSETS as readonly string[]).includes(up) ? (up as OnrampAsset) : null
}

/** The smallest preset that can still produce a fillable plan on Base.
 *
 *  DERIVED, not chosen. Work it backwards from the parity guard: a bridged
 *  value leg must clear MIN_VALUE_LEG_USD ($9, lib/lifi-bridge) and a
 *  gas-bearing segment carries GAS_LEG_USD ($2) on top, so ~$11 has to
 *  SURVIVE to the wallet. Against that, a preset loses Stripe's onramp fee
 *  (~4% of source, plus a network fee) on the way in, and ORIGIN_ETH_KEEPBACK
 *  + ETH_TWO_LEG_HEADROOM_USD + the floor() in the origin scan on the way
 *  out (~$2 on Base). $15 is the first round number that clears both ends.
 *
 *  It cannot import those constants — lib/lifi-bridge is server-side and this
 *  module is imported by a client component — so scripts/test-api.ts owns the
 *  cross-check and fails if the parity floor moves out from under it. */
export const ONRAMP_MIN_USD = 15

/** Ceiling on any preset — mirrors clarify's MAX_FUND_USD clamp. */
export const ONRAMP_MAX_USD = 500

/** Headroom over the plan, as a fraction of it. Was 10% for a stable bought
 *  through Coinbase; 15% now because an ETH preset is spent before the plan
 *  sees it:
 *
 *    • ETH drifts between the preset and settlement — minutes, but a card
 *      purchase is not instant and the plan is denominated in dollars,
 *    • the ETH→stable leg pays gas, slippage and our own 20bps,
 *    • the origin scan floor()s the movable row to whole dollars.
 *
 *  NOT Stripe's fee. The first cut of this comment claimed the onramp fee
 *  came out of the fiat; the first live session (2026-09-04, PT) showed the
 *  opposite — "Pay $17.00 · Receive 0.00688 ETH @ $2467.76 (≈ $17.00) ·
 *  Fees $0.69 · Total $17.69". source_amount converts IN FULL and the fee is
 *  charged on top, so the card is billed a little more than the chip says
 *  and the wallet receives exactly the preset's worth. The 15% is kept: it
 *  was sized with that fee inside it, and the asymmetry below says the
 *  spare belongs in the user's wallet, not in a tighter constant.
 *
 *  The asymmetry decides the direction to round: over-provisioning leaves the
 *  user ETH in their own wallet, which is theirs and which the next ask can
 *  spend. Under-provisioning burns a card payment AND a KYC round trip to
 *  arrive at the same wall. Round up. */
export const ONRAMP_HEADROOM = 0.15

/** Dollars of ETH that never reach the plan because the origin scan keeps
 *  them back: ORIGIN_ETH_KEEPBACK (0.0002 ETH on Base, 0.002 on mainnet)
 *  keeps the wallet signable after the leg, ETH_TWO_LEG_HEADROOM_USD covers
 *  a gas-bearing segment's first leg, and classifyFundingBalances floor()s
 *  the movable row to whole dollars.
 *
 *  Carried in USD rather than ETH, and carried HIGH, because this module is
 *  pure and has no price feed — the same round-up asymmetry as ONRAMP_HEADROOM
 *  applies, and mainnet's 0.002 ETH keep-back is worth anywhere from $6 to
 *  $16 across a plausible price range. Base is the lane that matters; the
 *  mainnet figure is a conservative fence, not a forecast. */
export const ONRAMP_ETH_KEEP_USD: Record<OnrampNetwork, number> = { base: 2, ethereum: 16 }

/** What to preset in the on-ramp for a plan that needs `needUsd`. Always at
 *  or above the plan, at or above the derived floor, and never above the
 *  clamp. Pure — the harness pins the arithmetic, not a live quote. */
export function planFundUsd(needUsd: number, network: OnrampNetwork = 'base'): number {
  const keep = ONRAMP_ETH_KEEP_USD[network] ?? ONRAMP_ETH_KEEP_USD.base
  // No plan to size against. Still never below the keep-back: a preset that
  // cannot even clear it delivers ETH the scan will not offer, which is a
  // charge for nothing.
  if (!Number.isFinite(needUsd) || needUsd <= 0) return Math.max(ONRAMP_MIN_USD, Math.ceil(keep))
  // Round to cents BEFORE the ceil: 100 * 1.15 is 114.99999999999999 in
  // binary floating point, which would preset $115 off a $114.99 intent and
  // read as a glitch either way it lands.
  const withHeadroom = Number((needUsd * (1 + ONRAMP_HEADROOM) + keep).toFixed(2))
  return Math.min(ONRAMP_MAX_USD, Math.max(ONRAMP_MIN_USD, Math.ceil(withHeadroom)))
}

/** Clamp a preset the CLIENT sends back. Distinct from planFundUsd on
 *  purpose: the chip's amount ALREADY carries the headroom and the keep-back,
 *  so re-planning it server-side compounds — live drive 2026-08-27 rendered
 *  $14 and charged $16. The server's job here is bounds, not arithmetic. */
export function clampFundUsd(raw: unknown): number {
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n) || n <= 0) return ONRAMP_MIN_USD
  return Math.min(ONRAMP_MAX_USD, Math.max(ONRAMP_MIN_USD, Math.ceil(n)))
}

/** Fail closed. STRIPE_SECRET_KEY is what mints the session; the flag is what
 *  says we mean it. Both, or no chip at all. */
export function onrampEnabled(): boolean {
  return process.env.ONRAMP_ENABLED === 'true' && Boolean(process.env.STRIPE_SECRET_KEY)
}

/** The exact Stripe create-session payload, as a pure function of the values
 *  the consent signature bound. Pure and exported so scripts/test-api.ts can
 *  pin it: the highest-risk detail in this integration is the wallet-address
 *  key (`base_network`, not `base`; see STRIPE_WALLET_KEY), and a payload
 *  assembled inline in the route handler could only ever be checked by
 *  spending a live request.
 *
 *  The single-value `destination_currencies` / `destination_networks` arrays
 *  are how Stripe LOCKS a choice; with `lock_wallet_address` they make the
 *  minted session capable of exactly one thing — the thing the user signed
 *  for — and nothing else. */
export function stripeOnrampParams(input: {
  address: string
  presetFiatUsd: number
  asset: OnrampAsset
  network: OnrampNetwork
  /** Real client IP, or null. Stripe uses it for geographic supportability
   *  and fraud; NEVER faked, because a wrong region is a wrong refusal. */
  customerIp?: string | null
}): URLSearchParams {
  const { address, presetFiatUsd, asset, network, customerIp } = input
  const params = new URLSearchParams({
    source_currency: 'usd',
    source_amount: String(presetFiatUsd),
    destination_currency: STRIPE_CURRENCY[asset],
    'destination_currencies[0]': STRIPE_CURRENCY[asset],
    destination_network: STRIPE_NETWORK[network],
    'destination_networks[0]': STRIPE_NETWORK[network],
    [`wallet_addresses[${STRIPE_WALLET_KEY[network]}]`]: address,
    lock_wallet_address: 'true',
  })
  if (customerIp) params.set('customer_ip_address', customerIp)
  return params
}

/** Stripe's error code when it will not serve the customer the session
 *  describes — at create time the only "information provided about the
 *  customer" is the IP we pass, so this is, in practice, the region check
 *  answering early (docs: "If the user's IP is in a region we can't support,
 *  we return an HTTP 400 with an appropriate error code"). */
export const STRIPE_UNSUPPORTABLE_CUSTOMER = 'crypto_onramp_unsupportable_customer'

export type StripeOnrampFailure =
  /** About the USER: Stripe will not onramp from where they are. A complete
   *  sentence, no operator suffix. */
  | { kind: 'region'; message: string }
  /** About US: key rejected (401), onramp not approved (403), bad payload
   *  (400), anything else. Generic copy; the status is the diagnostic. */
  | { kind: 'stripe'; message: string }

/** Classify a non-2xx create-session response. Pure — takes the status and
 *  the raw body — because the first cut of this lived inline in the route as
 *  a regex over message text and was WRONG: it looked for "unsupported" and
 *  "not supported", and Stripe's actual words are "unsupportable" and "unable
 *  to support". Codes are the contract; prose is a fallback. */
export function classifyStripeOnrampFailure(status: number, rawBody: string): StripeOnrampFailure {
  let code = ''
  let message = ''
  try {
    const parsed = JSON.parse(rawBody) as { error?: { code?: unknown; message?: unknown } }
    code = typeof parsed.error?.code === 'string' ? parsed.error.code : ''
    message = typeof parsed.error?.message === 'string' ? parsed.error.message : ''
  } catch {
    message = rawBody
  }
  const unsupportable =
    status === 400 &&
    (code === STRIPE_UNSUPPORTABLE_CUSTOMER || /unsupportable|unable to support|region|country/i.test(message))
  if (unsupportable) {
    return {
      kind: 'region',
      message:
        "Stripe can't offer card funding from where you are right now — you can still send USDC or ETH to this wallet on Base, Ethereum, or Arbitrum.",
    }
  }
  return { kind: 'stripe', message: 'Could not start the funding session.' }
}

export interface FundChipParams {
  /** Dollars the smallest plan needs, solver fees included. */
  needUsd: number
  /** What the money is FOR, as the refusal already says it ("buy $10 of
   *  AAPL"). This is the whole point — the chip names the intent. */
  actionLabel: string
  /** The ask, restated, fired when the user returns from the on-ramp. Must
   *  round-trip the parse ladder like any other resume string. */
  resume: string
  /** Where the on-ramp should deliver. Base unless the caller knows better. */
  network?: OnrampNetwork
}

/** The fund chip, or null when the door is closed. Callers append it to their
 *  existing options and MUST keep their own refusal copy intact — the chip is
 *  an addition to an honest answer, never a replacement for one. */
export function fundChipFor(params: FundChipParams): ClarifyOption | null {
  if (!onrampEnabled()) return null
  const { needUsd, actionLabel, resume, network = 'base' } = params
  if (!resume.trim() || !actionLabel.trim()) return null
  const presetFiatUsd = planFundUsd(needUsd, network)
  return {
    label: `Add $${presetFiatUsd} with card or bank → ${actionLabel}`,
    resume,
    fund: { presetFiatUsd, asset: ONRAMP_ASSET, network },
  }
}

/** How long a consent signature stays good. Long enough to read the wallet
 *  prompt and think, short enough that a captured signature is worthless by
 *  the time it is replayed. */
export const ONRAMP_CONSENT_TTL_MS = 10 * 60_000

export interface OnrampConsentInput {
  address: string
  presetFiatUsd: number
  asset: string
  network: OnrampNetwork
  /** Client clock, echoed back with the signature. Bounds the replay window. */
  issuedAt: number
}

/**
 * The exact personal_sign text the wallet shows, and the exact text the server
 * re-derives to recover the signer. Line-keyed so a human can read every fact
 * it binds — Coinbase's integration review (case 500PC00000kDVUv, 2026-08-28)
 * called the unauthenticated route spoofable, and this is the answer: proof
 * that whoever asked for a session controls the address it delivers to. The
 * provider changed; the finding was about us, so the proof stays.
 *
 * personal_sign, not a transaction: the wallet being funded is empty by
 * definition, so it can pay no gas. It can still sign, which costs nothing and
 * is the only ownership proof available before there are funds — the same
 * consent-over-a-free-signature shape the HL delegated door uses.
 *
 * Deliberately NOT SIWE: signing in is how you KEEP a thread (#553), and this
 * wallet has not transacted yet. This proves address control for ONE funding
 * session and mints no session of its own.
 *
 * Every fact on these lines is also LOCKED at Stripe (lock_wallet_address plus
 * single-value destination_currencies / destination_networks), so the consent
 * is not a description of what we intend — it is a description of the only
 * thing the session can do.
 */
export function onrampConsentMessage(input: OnrampConsentInput): string {
  return [
    'Pantessa — fund this wallet',
    `Wallet: ${input.address.toLowerCase()}`,
    // A STARTING amount, said plainly: Stripe's source_amount is a default
    // their checkout lets the user change. The wallet, asset and chain ARE
    // locked (lock_wallet_address + single-value destination arrays), so the
    // consent must not imply it caps a number it does not cap.
    `Amount: $${input.presetFiatUsd} USD to start — you can change this at checkout`,
    `Asset: ${input.asset} on ${input.network}`,
    `Issued: ${new Date(input.issuedAt).toISOString()}`,
    'Signing opens a Stripe checkout that can only deliver funds TO this wallet. It moves nothing out and costs no gas.',
  ].join('\n')
}
