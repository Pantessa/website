import { NextRequest, NextResponse } from 'next/server'
import { recoverMessageAddress, recoverTypedDataAddress } from 'viem'
import { splitSignature } from '@/lib/hl-guardian'
import { getActiveDelegation, retireDelegation, signL1ActionWithDelegation } from '@/lib/hl-guardian-store'
import {
  fetchHlSnapshot,
  guardHlBuilderFeeApproval,
  guardHlExecBuild,
  guardHlLeverageBuild,
  hlActionTypedData,
  hlApproveBuilderFeeTypedData,
  hlConsentMessage,
  HL_EXEC_POLICY_HOST,
  type HlWireAction,
  type HlWireApproveBuilderFeeAction,
  type HlWireLeverageAction,
  type HlWireOrderAction,
} from '@/lib/hyperliquid-exec'
import { policyCheck } from '@/lib/tx-guardrails'
import { getActiveGrant, recordLedger, spentTodayUsd, toPolicy } from '@/lib/grant-store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The Hyperliquid submit relay — the CoW-submit twin for L1 actions. The
// client sends back the EXACT action+nonce it was offered plus the wallet's
// signature over our typed data. Before anything reaches /exchange we:
//   1. re-derive the typed data from action+nonce and RECOVER the signer —
//      the signature authenticates the wallet AND pins the action bytes;
//   2. re-guard against the LIVE market (mark moved past the slippage bound
//      → refuse; stale quotes die here, not on the venue);
//   3. re-gate the wallet's spend policy + kill switch at submit time.
// No SIWE needed: the recovered signature IS the auth.
//
// TWO ways the wallet can say yes to an L1 action (orders + leverage):
//   direct    — { signature }: the wallet signed our phantom-agent typed data
//               (domain chainId 1337) itself. Works in wallets that don't
//               police the EIP-712 domain chain (Rabby, raw keys).
//   delegated — { mode: 'delegated', consentSignature }: the wallet signed
//               the personal_sign CONSENT text over the action's own hash
//               (chain-agnostic — MetaMask refuses 1337 typed data outright,
//               see lib/hyperliquid-exec), and the wallet's ACTIVE Pantessa
//               agent (the guardian delegation) signs the same bytes here.
//               No delegation → 409 { code: 'delegation-required' } and the
//               client offers the one-time "enable trading" approval.
// Both converge on the same guard + policy + venue relay below.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: HlWireAction | HlWireApproveBuilderFeeAction
    nonce?: number
    signature?: string
    mode?: 'direct' | 'delegated'
    consentSignature?: string
    from?: string
    isTestnet?: boolean
    expected?: { coin?: string; kind?: string; isBuy?: boolean; leverage?: number }
  }
  const { action, nonce, from, expected } = body
  const delegated = body.mode === 'delegated'
  const isFeeApproval = (action as { type?: string } | undefined)?.type === 'approveBuilderFee'
  const proof = delegated ? body.consentSignature : body.signature
  if (
    !action ||
    typeof nonce !== 'number' ||
    typeof proof !== 'string' ||
    typeof from !== 'string' ||
    (!isFeeApproval && !expected?.coin) ||
    (delegated && isFeeApproval)
  ) {
    return NextResponse.json(
      { error: delegated ? 'action, nonce, consentSignature, from and expected are required.' : 'action, nonce, signature, from and expected are required.' },
      { status: 400 },
    )
  }
  const signature = proof
  const isLeverage = action.type === 'updateLeverage'
  if (!isFeeApproval) {
    if (isLeverage) {
      if (typeof expected?.leverage !== 'number') {
        return NextResponse.json({ error: 'expected.leverage is required for a leverage update.' }, { status: 400 })
      }
    } else if (expected?.kind !== 'open' && expected?.kind !== 'close') {
      return NextResponse.json({ error: 'expected.kind must be open|close.' }, { status: 400 })
    }
  }
  const isTestnet = body.isTestnet === true

  // ── One-time builder-fee cap approval — USER-SIGNED, not phantom-agent ──
  // Recovery derives the HyperliquidSignTransaction typed data from the
  // action itself (signatureChainId lives INSIDE the signed bytes, so it
  // can't be swapped after the fact), then the guard pins recipient + rate.
  if (isFeeApproval) {
    const fa = action as HlWireApproveBuilderFeeAction
    const td = hlApproveBuilderFeeTypedData(fa)
    let feeSigner: string
    try {
      feeSigner = await recoverTypedDataAddress({
        domain: td.domain as Parameters<typeof recoverTypedDataAddress>[0]['domain'],
        types: td.types,
        primaryType: td.primaryType,
        message: td.message,
        signature: signature as `0x${string}`,
      })
    } catch {
      return NextResponse.json({ error: 'Signature does not verify against this approval.' }, { status: 403 })
    }
    if (feeSigner.toLowerCase() !== from.toLowerCase()) {
      return NextResponse.json({ error: 'Signature recovers to a different wallet than `from`.' }, { status: 403 })
    }
    if (fa.nonce !== nonce || Math.abs(Date.now() - nonce) > 120_000) {
      return NextResponse.json({ error: 'This approval is stale — ask again for a fresh build.' }, { status: 400 })
    }
    const feeGuard = guardHlBuilderFeeApproval(fa, isTestnet)
    if (!feeGuard.ok) {
      const bad = feeGuard.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note)
      return NextResponse.json({ error: `Refused at submit: ${bad.join(' ')}` }, { status: 403 })
    }
    const feeGrant = await getActiveGrant(from.toLowerCase())
    if (feeGrant?.paused) {
      await recordLedger({ grantId: feeGrant.id, host: HL_EXEC_POLICY_HOST, amountUsd: 0, ok: false, note: 'blocked: ACCOUNT_FROZEN (hl fee approval)', orgId: feeGrant.orgId ?? undefined })
      return NextResponse.json({ error: 'Your account kill switch is ON — unpause it to trade.' }, { status: 403 })
    }
    const feeApiUrl = isTestnet ? 'https://api.hyperliquid-testnet.xyz' : 'https://api.hyperliquid.xyz'
    const feeRes = await fetch(`${feeApiUrl}/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: fa, nonce, signature: splitSignature(signature) }),
    })
    const feeVenue = (await feeRes.json().catch(() => null)) as { status?: string; response?: unknown } | null
    if (!feeRes.ok || feeVenue?.status !== 'ok') {
      const msg = typeof feeVenue?.response === 'string' ? feeVenue.response : `venue rejected the approval (HTTP ${feeRes.status})`
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    // Not money moved — the cap only lets future fills carry the fee.
    if (feeGrant) {
      await recordLedger({
        grantId: feeGrant.id,
        host: HL_EXEC_POLICY_HOST,
        serviceName: 'Hyperliquid',
        amountUsd: 0,
        ok: true,
        note: `hl builder-fee cap approved: ${fa.maxFeeRate}`,
        orgId: feeGrant.orgId ?? undefined,
      }).catch(() => {})
    }
    return NextResponse.json({ status: 'builder-fee-approved', maxFeeRate: fa.maxFeeRate })
  }
  if (!expected?.coin) {
    return NextResponse.json({ error: 'expected is required.' }, { status: 400 })
  }

  // 1 — recover the signer. Direct: from OUR typed-data derivation of the
  //     action. Delegated: from OUR consent-text derivation of the same
  //     action (the text carries the action hash, so consent binds bytes),
  //     then the wallet's live delegation must exist for the agent to sign.
  const typedData = hlActionTypedData(action as HlWireAction, nonce, isTestnet)
  let signer: string
  let delegation: Awaited<ReturnType<typeof getActiveDelegation>> = null
  if (delegated) {
    const consent = hlConsentMessage({
      from,
      action: action as HlWireAction,
      nonce,
      isTestnet,
      expected: { coin: expected!.coin!, kind: expected?.kind, isBuy: expected?.isBuy, leverage: expected?.leverage },
    })
    try {
      signer = await recoverMessageAddress({ message: consent, signature: signature as `0x${string}` })
    } catch {
      return NextResponse.json({ error: 'Consent signature does not verify against this action.' }, { status: 403 })
    }
    if (signer.toLowerCase() !== from.toLowerCase()) {
      return NextResponse.json({ error: 'Consent recovers to a different wallet than `from`.' }, { status: 403 })
    }
    delegation = await getActiveDelegation(from, isTestnet)
    if (!delegation) {
      return NextResponse.json(
        { error: 'No active Pantessa agent on this Hyperliquid account — enable trading once, then retry.', code: 'delegation-required' },
        { status: 409 },
      )
    }
  } else {
    try {
      signer = await recoverTypedDataAddress({
        domain: typedData.domain as Parameters<typeof recoverTypedDataAddress>[0]['domain'],
        types: typedData.types,
        primaryType: typedData.primaryType,
        message: typedData.message,
        signature: signature as `0x${string}`,
      })
    } catch {
      return NextResponse.json({ error: 'Signature does not verify against this action.' }, { status: 403 })
    }
    if (signer.toLowerCase() !== from.toLowerCase()) {
      return NextResponse.json({ error: 'Signature recovers to a different wallet than `from`.' }, { status: 403 })
    }
  }
  // Nonce staleness: HL rejects old nonces anyway; refuse clearly first.
  if (Math.abs(Date.now() - nonce) > 120_000) {
    return NextResponse.json({ error: 'This build is stale (nonce >2 min old) — ask again for a fresh quote.' }, { status: 400 })
  }

  // 2 — re-guard against the live market. Leverage updates get their own
  //     guard (asset/mode/multiple pinned vs live meta); orders the full
  //     market re-check.
  const coin = expected.coin.toUpperCase()
  let snap
  try {
    snap = await fetchHlSnapshot(coin, from, isTestnet)
  } catch (e) {
    return NextResponse.json({ error: `Hyperliquid read failed: ${(e as Error).message}` }, { status: 502 })
  }
  const guard = isLeverage
    ? guardHlLeverageBuild(
        { kind: 'open', coin, leverage: expected.leverage },
        action as HlWireLeverageAction,
        { assetIndex: snap.assetIndex, maxLeverage: snap.maxLeverage },
      )
    : guardHlExecBuild(
        { kind: expected.kind as 'open' | 'close', coin, isBuy: expected.isBuy },
        action as HlWireOrderAction,
        { markPx: snap.markPx, assetIndex: snap.assetIndex, withdrawableUsd: snap.withdrawableUsd, positionSzi: snap.positionSzi },
      )
  if (!guard.ok) {
    const bad = guard.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note)
    return NextResponse.json({ error: `Refused at submit: ${bad.join(' ')}` }, { status: 403 })
  }

  // 3 — spend policy + kill switch, at the point of submission.
  const grant = await getActiveGrant(from.toLowerCase())
  if (grant?.paused) {
    await recordLedger({ grantId: grant.id, host: HL_EXEC_POLICY_HOST, amountUsd: 0, ok: false, note: 'blocked: ACCOUNT_FROZEN (hl submit)', orgId: grant.orgId ?? undefined })
    return NextResponse.json({ error: 'Your account kill switch is ON — unpause it to trade.' }, { status: 403 })
  }
  if (grant) {
    const spent = await spentTodayUsd(grant.id)
    const { violation } = policyCheck(guard.valueUsd, toPolicy(grant), spent, HL_EXEC_POLICY_HOST)
    if (violation) {
      await recordLedger({ grantId: grant.id, host: HL_EXEC_POLICY_HOST, amountUsd: 0, ok: false, note: `blocked: ${violation} (hl submit)`, orgId: grant.orgId ?? undefined })
      return NextResponse.json({ error: `Blocked by your spend policy: ${violation}.` }, { status: 403 })
    }
  }

  // The venue signature: the wallet's own, or — after consent + guard + policy
  // all passed — the delegated agent's over the SAME typed data.
  let venueSignature = signature
  if (delegation) {
    try {
      venueSignature = await signL1ActionWithDelegation(delegation, typedData)
    } catch (e) {
      return NextResponse.json({ error: `Delegated signing unavailable: ${(e as Error).message}` }, { status: 503 })
    }
  }

  // Relay to the venue.
  const apiUrl = isTestnet ? 'https://api.hyperliquid-testnet.xyz' : 'https://api.hyperliquid.xyz'
  const res = await fetch(`${apiUrl}/exchange`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, nonce, signature: splitSignature(venueSignature) }),
  })
  const venue = (await res.json().catch(() => null)) as
    | { status?: string; response?: { data?: { statuses?: unknown[] } } | string }
    | null
  if (!res.ok || venue?.status !== 'ok') {
    const msg = typeof venue?.response === 'string' ? venue.response : `venue rejected the order (HTTP ${res.status})`
    // The venue no longer recognizes the agent (removed in the HL app, or
    // never approved): retire the row and hand the client the enable door.
    if (delegation && /does not exist|not approved|api wallet|agent/i.test(msg)) {
      await retireDelegation(delegation.id)
      return NextResponse.json({ error: `${msg} — enable trading again to mint a fresh Pantessa agent.`, code: 'delegation-required' }, { status: 409 })
    }
    return NextResponse.json({ error: msg }, { status: 502 })
  }
  // Leverage set: no fill statuses — 'ok' from the venue IS the receipt.
  // Not money moved (amountUsd 0) but ledgered for the audit trail.
  if (isLeverage) {
    if (grant) {
      await recordLedger({
        grantId: grant.id,
        host: HL_EXEC_POLICY_HOST,
        serviceName: 'Hyperliquid',
        amountUsd: 0,
        ok: true,
        note: `hl leverage set: ${coin} ${expected.leverage}x cross${delegation ? ' (delegated agent)' : ''}`,
        orgId: grant.orgId ?? undefined,
      }).catch(() => {})
    }
    return NextResponse.json({ status: 'leverage-set', leverage: expected.leverage })
  }

  const status = (venue.response as { data?: { statuses?: unknown[] } })?.data?.statuses?.[0]
  if (status && typeof status === 'object' && 'error' in status) {
    return NextResponse.json({ error: String((status as { error: unknown }).error) }, { status: 502 })
  }
  const filled = status && typeof status === 'object' && 'filled' in status
    ? ((status as { filled: { totalSz: string; avgPx: string; oid: number } }).filled)
    : null

  if (grant) {
    await recordLedger({
      grantId: grant.id,
      host: HL_EXEC_POLICY_HOST,
      serviceName: 'Hyperliquid',
      amountUsd: guard.valueUsd ?? 0,
      ok: true,
      note: `hl ${expected.kind} ${filled ? 'filled' : 'placed'}: ${coin}${delegation ? ' (delegated agent)' : ''}`,
      orgId: grant.orgId ?? undefined,
    }).catch(() => {})
  }

  return NextResponse.json({
    status: filled ? 'filled' : 'unfilled',
    filled,
    valueUsd: guard.valueUsd,
    explorerUrl: `https://app.hyperliquid${isTestnet ? '-testnet' : ''}.xyz/trade/${coin}`,
  })
}
