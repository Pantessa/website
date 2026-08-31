import { NextRequest, NextResponse } from 'next/server'
import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { recoverMessageAddress } from 'viem'
import {
  clampFundUsd,
  onrampConsentMessage,
  onrampEnabled,
  onrampUrl,
  ONRAMP_ASSET,
  ONRAMP_CONSENT_TTL_MS,
  type OnrampNetwork,
} from '@/lib/onramp'
import { bumpAndCheckOnrampSession, clientIpFrom } from '@/lib/turn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mints a single-use Coinbase Onramp session token and returns the hosted URL
// to open. Coinbase has required the token since 2025-07-31 — a bare pay.
// coinbase.com URL is rejected — so this route is not optional plumbing, it IS
// the on-ramp.
//
// AUTHENTICATED BY WALLET PROOF. This route used to be open on purpose: the
// wallet being funded is empty, so it cannot pay gas, and connect-to-act
// (#553) says the tx signature is the ownership proof. CDP's integration
// review (case 500PC00000kDVUv, 2026-08-28) called that spoofable and they are
// right about the exposure that remained — anyone could burn our CDP session
// quota against any address they cared to name.
//
// The error in the old reasoning was conflating "cannot transact" with "cannot
// sign". personal_sign costs no gas, so an empty wallet CAN prove it is the
// wallet. The caller signs a consent naming the exact address, amount, asset
// and network; we re-derive that text and recover the signer. No match, no
// token. This is the HL delegated-consent shape (#647), not SIWE: it proves
// address control for ONE funding session and mints no session of its own, so
// the connect-to-act contract is intact — nobody is asked to sign in to act.
//
// Kept underneath as defence in depth: the per-IP hourly fence, and the fact
// that a minted token can only ever deliver funds TO the address inside it. It
// can never move money out.

const CDP_HOST = 'api.developer.coinbase.com'
const CDP_PATH = '/onramp/v1/token'
const NETWORKS: OnrampNetwork[] = ['base', 'ethereum', 'arbitrum']

export async function POST(req: NextRequest) {
  if (!onrampEnabled()) {
    // Fail closed, and say which half is missing — a silent 404 here reads as
    // "the button is broken" during setup.
    return NextResponse.json({ error: 'On-ramp not configured.' }, { status: 503 })
  }

  if (await bumpAndCheckOnrampSession(clientIpFrom(req.headers))) {
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
  const asset = typeof body.asset === 'string' && body.asset.trim() ? body.asset.trim() : ONRAMP_ASSET
  // Clamp, do NOT re-plan: the chip's amount already carries the headroom, so
  // running planFundUsd again compounds it (rendered $14, charged $16).
  const presetFiatUsd = clampFundUsd(body.presetFiatUsd)

  // ── Wallet proof. Runs BEFORE the CDP call so a spoofed request never costs
  // us a session token, and before any of it is logged.
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

  try {
    const jwt = await generateJwt({
      apiKeyId: process.env.CDP_API_KEY_ID!,
      apiKeySecret: process.env.CDP_API_KEY_SECRET!,
      requestMethod: 'POST',
      requestHost: CDP_HOST,
      requestPath: CDP_PATH,
      expiresIn: 120,
    })

    const res = await fetch(`https://${CDP_HOST}${CDP_PATH}`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${jwt}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ addresses: [{ address, blockchains: [network] }], assets: [asset] }),
      signal: AbortSignal.timeout(12_000),
    })

    if (!res.ok) {
      // Never echo Coinbase's body — it can carry account detail. The status
      // is enough to tell a misconfiguration from a transient failure.
      console.error(`[onramp] session token failed: ${res.status}`)
      return NextResponse.json({ error: 'Could not start the funding session.' }, { status: 502 })
    }

    const data = (await res.json()) as { token?: string }
    if (!data.token) {
      return NextResponse.json({ error: 'Could not start the funding session.' }, { status: 502 })
    }

    return NextResponse.json({
      url: onrampUrl({ sessionToken: data.token, presetFiatUsd, asset, network }),
      presetFiatUsd,
    })
  } catch {
    return NextResponse.json({ error: 'Could not start the funding session.' }, { status: 502 })
  }
}
