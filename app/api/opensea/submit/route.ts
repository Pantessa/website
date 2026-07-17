import { NextRequest, NextResponse } from 'next/server'
import { verifyTypedData } from 'viem'
import {
  OPENSEA_POLICY_HOST,
  SEAPORT_1_6,
  SEAPORT_EIP712_TYPES,
  fetchCollectionFees,
  fetchNftMeta,
  guardListingComponents,
  openseaChainIdOf,
  openseaSlugOf,
  osPost,
  seaportDomain,
  type SeaportOrderComponents,
} from '@/lib/opensea'
import { policyCheck } from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'
import { usdPerToken } from '@/lib/usd-probe'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// POST /api/opensea/submit — relay a USER-SIGNED Seaport listing to OpenSea
// (the CoW submit relay's marketplace twin). The server NEVER signs: the
// wallet signed the exact order the guardrails approved; this route re-gates
// before forwarding. Body: { chainId, parameters, signature, from }
// Re-gate at the moment of submission (defense against a tampered or stale
// build):
//   · the signature must RECOVER to `from` over these exact parameters
//     (a swapped-out order dies here, whatever the client sent),
//   · the payout set re-derives from the collection's LIVE fee schedule —
//     recipients outside offerer + published fees are refused,
//   · not expired, and the wallet's spend policy re-checks at NOW's totals.
// A placed listing ledgers at its USD value like any spend.
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}) as Record<string, unknown>)
  const chainId = typeof body.chainId === 'number' ? body.chainId : 1
  const signature = typeof body.signature === 'string' ? body.signature : ''
  const from = typeof body.from === 'string' ? body.from : ''
  const parameters = (body.parameters ?? null) as SeaportOrderComponents | null

  const chainSlug = openseaSlugOf(chainId)
  if (!chainSlug) return NextResponse.json({ error: `OpenSea is not configured for chain ${chainId}.` }, { status: 400 })
  if (!/^0x[0-9a-fA-F]+$/.test(signature) || signature.length < 130) {
    return NextResponse.json({ error: 'A valid EIP-712 signature is required.' }, { status: 400 })
  }
  if (!/^0x[0-9a-fA-F]{40}$/.test(from)) {
    return NextResponse.json({ error: 'A valid `from` wallet address is required.' }, { status: 400 })
  }
  if (!parameters || !Array.isArray(parameters.offer) || parameters.offer.length !== 1 || !Array.isArray(parameters.consideration)) {
    return NextResponse.json({ error: 'A complete Seaport order (parameters) is required.' }, { status: 400 })
  }
  if (parameters.offerer.toLowerCase() !== from.toLowerCase()) {
    return NextResponse.json({ error: `Refused: the order's offerer is ${parameters.offerer}, not the signing wallet.` }, { status: 403 })
  }
  if (Number(parameters.endTime) <= Math.floor(Date.now() / 1000)) {
    return NextResponse.json({ error: 'Refused: the listing is already expired — rebuild it.' }, { status: 400 })
  }

  // ── The signature must be over EXACTLY these parameters, by `from` ────────
  const signedByOfferer = await verifyTypedData({
    address: from as `0x${string}`,
    domain: seaportDomain(chainId),
    types: SEAPORT_EIP712_TYPES,
    primaryType: 'OrderComponents',
    message: parameters,
    signature: signature as `0x${string}`,
  } as unknown as Parameters<typeof verifyTypedData>[0]).catch(() => false)
  if (!signedByOfferer) {
    return NextResponse.json({ error: 'Refused: the signature does not verify over these order parameters for the signing wallet.' }, { status: 403 })
  }

  // ── Re-derive the allowed payout set from the LIVE fee schedule ───────────
  const item = parameters.offer[0]
  const nft = await fetchNftMeta(chainId, item.token, item.identifierOrCriteria)
  if (!nft) return NextResponse.json({ error: 'Refused: OpenSea could not resolve the listed NFT to re-check its fee schedule.' }, { status: 502 })
  const colInfo = await fetchCollectionFees(nft.collection)
  if (!colInfo) return NextResponse.json({ error: 'Refused: the collection fee schedule is unavailable.' }, { status: 502 })

  let priceWei = BigInt(0)
  try {
    for (const c of parameters.consideration) priceWei += BigInt(c.startAmount)
  } catch {
    return NextResponse.json({ error: 'Malformed consideration amounts.' }, { status: 400 })
  }
  const verdict = guardListingComponents(parameters, {
    offerer: from,
    token: item.token,
    identifier: item.identifierOrCriteria,
    priceWei,
    feeRecipients: colInfo.fees.map((f) => f.recipient),
    requiredZone: colInfo.requiredZone,
  })
  if (!verdict.ok) {
    return NextResponse.json({ error: `Refused at submission: ${verdict.reasons.join(' ')}` }, { status: 403 })
  }

  // ── Spend-policy re-gate at NOW's totals ──────────────────────────────────
  const eth = await usdPerToken(chainId, 'ETH').catch(() => null)
  const valueUsd = eth ? Number(((Number(priceWei) / 1e18) * eth.usd).toFixed(2)) : null
  const grant = await getActiveGrant(from.toLowerCase())
  const policy = grant ? toPolicy(grant) : null
  const spentToday = grant ? await spentTodayUsd(grant.id) : 0
  const { violation } = policyCheck(valueUsd, policy, spentToday, OPENSEA_POLICY_HOST)
  if (violation && grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: OPENSEA_POLICY_HOST,
      serviceName: 'OpenSea',
      amountUsd: 0,
      ok: false,
      note: `blocked: ${violation} (opensea listing submit)`,
    })
    return NextResponse.json({ error: `Refused by your spend policy at submission: ${violation}.` }, { status: 403 })
  }

  // ── Relay to OpenSea ──────────────────────────────────────────────────────
  const relay = await osPost(`/orders/${chainSlug}/seaport/listings`, {
    parameters,
    signature,
    protocol_address: SEAPORT_1_6,
  })
  if (!relay.ok) {
    const detail = typeof relay.data === 'string' ? relay.data.slice(0, 300) : JSON.stringify(relay.data).slice(0, 300)
    return NextResponse.json({ error: `OpenSea rejected the listing (HTTP ${relay.status}): ${detail}` }, { status: 502 })
  }
  const orderHash = (relay.data as { order?: { order_hash?: string } })?.order?.order_hash ?? null
  const openseaUrl = `https://opensea.io/assets/${chainSlug}/${item.token}/${item.identifierOrCriteria}`

  if (grant) {
    await recordLedger({
      grantId: grant.id,
      orgId: grant.orgId ?? undefined,
      host: OPENSEA_POLICY_HOST,
      serviceName: 'OpenSea',
      amountUsd: valueUsd ?? 0,
      ok: true,
      note: `opensea listing placed: ${nft.name ?? `#${item.identifierOrCriteria}`} at ${(Number(priceWei) / 1e18).toFixed(4)} ETH`.slice(0, 200),
    })
  }

  return NextResponse.json({ orderHash, openseaUrl })
}
