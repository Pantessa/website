import { NextRequest, NextResponse } from 'next/server'
import { recoverMessageAddress } from 'viem'
import {
  clampFundUsd,
  onrampAssetOf,
  onrampConsentMessage,
  onrampEnabled,
  ONRAMP_ASSET,
  ONRAMP_CONSENT_TTL_MS,
  stripeOnrampParams,
  type OnrampNetwork,
} from '@/lib/onramp'
import { bumpAndCheckOnrampSession, clientIpFrom } from '@/lib/turn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mints a Stripe crypto onramp session and returns the hosted URL to open.
//
// PROVIDER SWITCHED 2026-09-04: Coinbase Onramp (CDP) → Stripe, on acceptance
// into Stripe's crypto onramp programme. Stripe is the merchant of record and
// owns KYC, fraud and disputes. The session create call returns a
// `redirect_url` into the Stripe-hosted onramp (crypto.link.com), which is the
// same hand-off shape CDP's session token had — so nothing above this route
// changed: same chip, same consent signature, same resume contract.
//
// The asset is now ETH rather than USDC. The wallet being funded is empty, so
// a stable would land money that cannot pay its own gas; ETH funds the gas and
// the value in one delivery and the existing cascade swaps it onward. See the
// header of lib/onramp.ts for the full reasoning.
//
// AUTHENTICATED BY WALLET PROOF. This route used to be open on purpose: the
// wallet being funded is empty, so it cannot pay gas, and connect-to-act
// (#553) says the tx signature is the ownership proof. Coinbase's integration
// review (case 500PC00000kDVUv, 2026-08-28) called that spoofable and they
// were right about the exposure that remained — anyone could burn our session
// quota against any address they cared to name. The provider changed; the
// finding was about us, so the proof stays.
//
// The error in the old reasoning was conflating "cannot transact" with "cannot
// sign". personal_sign costs no gas, so an empty wallet CAN prove it is the
// wallet. The caller signs a consent naming the exact address, amount, asset
// and network; we re-derive that text and recover the signer. No match, no
// session. This is the HL delegated-consent shape (#647), not SIWE: it proves
// address control for ONE funding session and mints no session of its own, so
// the connect-to-act contract is intact — nobody is asked to sign in to act.
//
// Kept underneath as defence in depth: the per-IP hourly fence, and the fact
// that a minted session can only ever deliver funds TO the address inside it.
// Stripe enforces that last part for us — lock_wallet_address, plus
// single-value destination_currencies/networks, mean the session cannot be
// steered to another address, asset or chain after the user has signed for it.
// It can never move money out.

const STRIPE_ONRAMP_URL = 'https://api.stripe.com/v1/crypto/onramp_sessions'
const NETWORKS: OnrampNetwork[] = ['base', 'ethereum']

export async function POST(req: NextRequest) {
  if (!onrampEnabled()) {
    // Fail closed, and say which half is missing — a silent 404 here reads as
    // "the button is broken" during setup.
    return NextResponse.json({ error: 'On-ramp not configured.' }, { status: 503 })
  }

  const ip = clientIpFrom(req.headers)
  if (await bumpAndCheckOnrampSession(ip)) {
    return NextResponse.json({ error: 'Too many funding sessions this hour.' }, { status: 429 })
  }

  let body: Record<string, unknown>
  try {
    body = (await req.json()) as Record<string, unknown>
  } catch {
    return NextResponse.json({ error: 'Bad JSON.' }, { status: 400 })
  }

  const address = typeof body.address === 'string' ? body.address.trim() : ''
  if (!/^0x[0-9a-fA-F]{40}$/.test(address)) {
    return NextResponse.json({ error: 'A destination wallet address is required.' }, { status: 400 })
  }
  const network = NETWORKS.find((n) => n === body.network) ?? 'base'
  // Narrowed, not trusted: an asset Stripe's enum doesn't carry would be
  // rejected at their door as a 400 we'd have to explain. Refuse it here,
  // where we can say what happened.
  const asset = onrampAssetOf(body.asset) ?? ONRAMP_ASSET
  // Clamp, do NOT re-plan: the chip's amount already carries the headroom, so
  // running planFundUsd again compounds it (rendered $14, charged $16).
  const presetFiatUsd = clampFundUsd(body.presetFiatUsd)

  // ── Wallet proof. Runs BEFORE the Stripe call so a spoofed request never
  // costs us a session, and before any of it is logged.
  const issuedAt = typeof body.issuedAt === 'number' ? body.issuedAt : Number(body.issuedAt)
  if (!Number.isFinite(issuedAt)) {
    return NextResponse.json({ error: 'A signed funding consent is required.', stage: 'auth' }, { status: 401 })
  }
  // Both directions: a future-dated `issuedAt` would otherwise buy an
  // arbitrarily long-lived signature.
  if (Math.abs(Date.now() - issuedAt) > ONRAMP_CONSENT_TTL_MS) {
    return NextResponse.json(
      { error: 'This funding request expired — tap the chip again.', stage: 'auth' },
      { status: 401 },
    )
  }

  const signature = typeof body.signature === 'string' ? body.signature.trim() : ''
  if (!/^0x[0-9a-fA-F]{130}$/.test(signature)) {
    return NextResponse.json({ error: 'A signed funding consent is required.', stage: 'auth' }, { status: 401 })
  }

  // Re-derive the consent from the values WE just validated, never from a
  // caller-supplied string: the signature is only meaningful if it binds the
  // address, amount, asset and network this request will actually use.
  let signer: string
  try {
    signer = await recoverMessageAddress({
      message: onrampConsentMessage({ address, presetFiatUsd, asset, network, issuedAt }),
      signature: signature as `0x${string}`,
    })
  } catch {
    return NextResponse.json(
      { error: 'That signature does not match this funding request.', stage: 'auth' },
      { status: 401 },
    )
  }
  if (signer.toLowerCase() !== address.toLowerCase()) {
    return NextResponse.json(
      { error: 'That signature is from a different wallet than the one being funded.', stage: 'auth' },
      { status: 403 },
    )
  }

  // Built by a PURE function so the harness can pin it without spending a
  // live request — in particular the wallet-address key, which is
  // `base_network` and not `base` (Stripe 400s `parameter_unknown` on the
  // wrong one, which would take the whole funding path down at once). The
  // same function locks the currency, the network and the address, so the
  // minted session can do exactly what the consent above describes and
  // nothing else.
  //
  // The IP is passed through, never faked: Stripe uses it for geographic
  // supportability and answers 400 up front when the region can't be served,
  // which is a better answer than letting the user reach the hosted page and
  // be turned away there. clientIpFrom returns null for loopback and
  // header-less requests, and null means we simply don't claim to know.
  const form = stripeOnrampParams({ address, presetFiatUsd, asset, network, customerIp: ip })

  // Signing and calling were separated in the CDP era because collapsing both
  // into one catch made every failure an indistinguishable 502. Stripe needs
  // no JWT step — the secret key is the credential — so what survives is the
  // discipline: the upstream STATUS is safe to surface (it is not a body and
  // carries no account detail) and it is the fact that tells a rejected key
  // from an unapproved onramp from a bad payload.
  try {
    const res = await fetch(STRIPE_ONRAMP_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY!}`,
        'Content-Type': 'application/x-www-form-urlencoded',
      },
      body: form.toString(),
      signal: AbortSignal.timeout(12_000),
    })

    if (!res.ok) {
      // The body can carry account detail, so it is logged and never returned
      // wholesale. 401 = the key is rejected. 403 = the key is fine but this
      // account has no onramp access (application not approved). 400 = our
      // payload, OR an unservable region — the one 400 worth explaining,
      // because it is about the USER and not about us.
      const raw = await res.text().catch(() => '')
      console.error(`[onramp] stripe session failed: ${res.status} ${raw.slice(0, 400)}`)
      const unsupportedRegion =
        res.status === 400 && /region|country|not (?:available|supported)|unsupported/i.test(raw)
      return NextResponse.json(
        {
          error: unsupportedRegion
            ? 'Card funding is not available in your region yet — you can still send USDC or ETH to this wallet on Base, Ethereum, or Arbitrum.'
            : 'Could not start the funding session.',
          stage: unsupportedRegion ? 'region' : 'stripe',
          upstreamStatus: res.status,
        },
        { status: unsupportedRegion ? 400 : 502 },
      )
    }

    const data = (await res.json()) as { redirect_url?: string; id?: string }
    if (!data.redirect_url) {
      // A session with no redirect_url is the embedded-widget shape. We are
      // the hosted integration, so this means the account is provisioned for
      // something else — a real condition, not a transient one.
      console.error(`[onramp] stripe session ${data.id ?? '(no id)'} returned no redirect_url`)
      return NextResponse.json(
        { error: 'Could not start the funding session.', stage: 'stripe' },
        { status: 502 },
      )
    }

    return NextResponse.json({ url: data.redirect_url, presetFiatUsd })
  } catch (e) {
    const why = e instanceof Error ? e.message : 'unknown'
    console.error(`[onramp] stripe session request threw: ${why}`)
    return NextResponse.json(
      { error: 'Could not start the funding session.', stage: 'network', detail: why.slice(0, 200) },
      { status: 502 },
    )
  }
}
