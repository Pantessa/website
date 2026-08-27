import { NextRequest, NextResponse } from 'next/server'
import { generateJwt } from '@coinbase/cdp-sdk/auth'
import { clampFundUsd, onrampEnabled, onrampUrl, ONRAMP_ASSET, type OnrampNetwork } from '@/lib/onramp'
import { bumpAndCheckOnrampSession, clientIpFrom } from '@/lib/turn-limits'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Mints a single-use Coinbase Onramp session token and returns the hosted URL
// to open. Coinbase has required the token since 2025-07-31 — a bare pay.
// coinbase.com URL is rejected — so this route is not optional plumbing, it IS
// the on-ramp.
//
// Unauthenticated ON PURPOSE: the wallet being funded has not signed anything
// yet, and cannot — it is empty, which is the whole reason we are here
// (connect-to-act, #553: the signature is the ownership proof, and there is
// nothing to sign until there are funds). The exposure is therefore CDP quota
// on a caller-named address, fenced per-IP, and a token that can only ever
// deliver funds TO the address named in it. It can never move money out.

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
