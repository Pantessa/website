import { NextRequest, NextResponse } from 'next/server'
import { recoverMessageAddress, recoverTypedDataAddress } from 'viem'
import { splitSignature } from '@/lib/hl-guardian'
import { getActiveDelegation, retireDelegation, signL1ActionWithDelegation } from '@/lib/hl-guardian-store'
import {
  fetchHlSnapshot,
  guardHlBuilderFeeApproval,
  guardHlDexTransfer,
  guardHlExecBuild,
  guardHlLeverageBuild,
  HL_NONCE_MAX_AGE_MS,
  canonicalizeHlAction,
  hlActionTypedData,
  hlApproveBuilderFeeTypedData,
  hlCoinLabel,
  hlConsentMessage,
  hlSendAssetTypedData,
  HL_EXEC_POLICY_HOST,
  type HlWireAction,
  type HlWireApproveBuilderFeeAction,
  type HlWireLeverageAction,
  type HlWireOrderAction,
  type HlWireSendAssetAction,
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
//
// Two USER-SIGNED actions ride the same relay (typed data on the wallet's OWN
// chain, so every wallet signs them; never delegated): the one-time
// builder-fee cap approval, and the move of USDC from the wallet's main perp
// balance into a builder dex (a standard account keeps a separate balance per
// dex — lib/hyperliquid-exec guardHlDexTransfer pins it to the signer's own
// account, a dex we place orders on, and USDC).
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as {
    action?: HlWireAction | HlWireApproveBuilderFeeAction | HlWireSendAssetAction
    nonce?: number
    signature?: string
    mode?: 'direct' | 'delegated'
    consentSignature?: string
    from?: string
    isTestnet?: boolean
    expected?: { coin?: string; kind?: string; isBuy?: boolean; leverage?: number }
  }
  // Key order is part of the venue's action HASH (msgpack), and a client's
  // action has usually been through storage on the way here — Postgres jsonb
  // re-sorts object keys, so a job step's order arrives as {a,b,p,r,s,t}.
  // Put it back in the venue's schema order BEFORE anything hashes, guards or
  // relays it. See canonicalizeHlAction (lib/hyperliquid-exec).
  const action = (body.action ? canonicalizeHlAction(body.action as HlWireAction) : body.action) as
    | HlWireAction
    | HlWireApproveBuilderFeeAction
    | HlWireSendAssetAction
    | undefined
  const { nonce, from, expected } = body
  const delegated = body.mode === 'delegated'
  const isFeeApproval = (action as { type?: string } | undefined)?.type === 'approveBuilderFee'
  const isDexTransfer = (action as { type?: string } | undefined)?.type === 'sendAsset'
  // Signed by the wallet itself on its own chain — never by the agent.
  const isUserSigned = isFeeApproval || isDexTransfer
  const proof = delegated ? body.consentSignature : body.signature
  if (
    !action ||
    typeof nonce !== 'number' ||
    typeof proof !== 'string' ||
    typeof from !== 'string' ||
    (!isUserSigned && !expected?.coin) ||
    (delegated && isUserSigned)
  ) {
    return NextResponse.json(
      { error: delegated ? 'action, nonce, consentSignature, from and expected are required.' : 'action, nonce, signature, from and expected are required.' },
      { status: 400 },
    )
  }
  const signature = proof
  const isLeverage = action.type === 'updateLeverage'
  if (!isUserSigned) {
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
    if (fa.nonce !== nonce || Math.abs(Date.now() - nonce) > HL_NONCE_MAX_AGE_MS) {
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
  // ── Builder-dex collateral move — USER-SIGNED, the wallet's own account ──
  // Same recovery discipline as the fee approval: the typed data is derived
  // from the action (signatureChainId rides inside the signed bytes), the
  // recovered signer must be `from`, and the guard pins destination = the
  // signer, source = the main perp balance, a dex we build on, and USDC —
  // against the main balance read live. Nothing here can send funds to
  // anyone else: a foreign destination never reaches the venue.
  if (isDexTransfer) {
    const xfer = action as HlWireSendAssetAction
    const td = hlSendAssetTypedData(xfer)
    let xferSigner: string
    try {
      xferSigner = await recoverTypedDataAddress({
        domain: td.domain as Parameters<typeof recoverTypedDataAddress>[0]['domain'],
        types: td.types,
        primaryType: td.primaryType,
        message: td.message,
        signature: signature as `0x${string}`,
      })
    } catch {
      return NextResponse.json({ error: 'Signature does not verify against this transfer.' }, { status: 403 })
    }
    if (xferSigner.toLowerCase() !== from.toLowerCase()) {
      return NextResponse.json({ error: 'Signature recovers to a different wallet than `from`.' }, { status: 403 })
    }
    if (xfer.nonce !== nonce || Math.abs(Date.now() - nonce) > HL_NONCE_MAX_AGE_MS) {
      return NextResponse.json({ error: 'This transfer is stale — ask again for a fresh build.' }, { status: 400 })
    }
    const xferApiUrl = isTestnet ? 'https://api.hyperliquid-testnet.xyz' : 'https://api.hyperliquid.xyz'
    // What the main perp balance has free RIGHT NOW (unread → the venue has
    // the last word on the amount; every other field is still pinned).
    const mainFree = await fetch(`${xferApiUrl}/info`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ type: 'clearinghouseState', user: from.toLowerCase() }),
    })
      .then((r) => (r.ok ? (r.json() as Promise<{ withdrawable?: string }>) : null))
      .then((j) => (j && Number.isFinite(Number(j.withdrawable)) ? Number(j.withdrawable) : null))
      .catch(() => null)
    const xferGuard = guardHlDexTransfer(xfer, { from, isTestnet, mainWithdrawableUsd: mainFree })
    if (!xferGuard.ok) {
      const bad = xferGuard.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note)
      return NextResponse.json({ error: `Refused at submit: ${bad.join(' ')}` }, { status: 403 })
    }
    const xferGrant = await getActiveGrant(from.toLowerCase())
    if (xferGrant?.paused) {
      await recordLedger({ grantId: xferGrant.id, host: HL_EXEC_POLICY_HOST, amountUsd: 0, ok: false, note: 'blocked: ACCOUNT_FROZEN (hl dex transfer)', orgId: xferGrant.orgId ?? undefined })
      return NextResponse.json({ error: 'Your account kill switch is ON — unpause it to trade.' }, { status: 403 })
    }
    const xferRes = await fetch(`${xferApiUrl}/exchange`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: xfer, nonce, signature: splitSignature(signature) }),
    })
    const xferVenue = (await xferRes.json().catch(() => null)) as { status?: string; response?: unknown } | null
    if (!xferRes.ok || xferVenue?.status !== 'ok') {
      const msg = typeof xferVenue?.response === 'string' ? xferVenue.response : `venue rejected the transfer (HTTP ${xferRes.status})`
      return NextResponse.json({ error: msg }, { status: 502 })
    }
    // Not money moved — the USDC changed ledgers inside the wallet's own account.
    if (xferGrant) {
      await recordLedger({
        grantId: xferGrant.id,
        host: HL_EXEC_POLICY_HOST,
        serviceName: 'Hyperliquid',
        amountUsd: 0,
        ok: true,
        note: `hl collateral moved: $${xfer.amount} USDC main perp balance -> ${xfer.destinationDex} dex (own account)`,
        orgId: xferGrant.orgId ?? undefined,
      }).catch(() => {})
    }
    return NextResponse.json({ status: 'dex-transfer-done', dex: xfer.destinationDex, amount: xfer.amount })
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
  if (Math.abs(Date.now() - nonce) > HL_NONCE_MAX_AGE_MS) {
    return NextResponse.json({ error: 'This build is stale (nonce >2 min old) — ask again for a fresh quote.' }, { status: 400 })
  }

  // 2 — re-guard against the live market. Leverage updates get their own
  //     guard (asset/mode/multiple pinned vs live meta); orders the full
  //     market re-check.
  // The coin as the ask named it (`SP500`, `xyz:SP500`, `HYPE`): the snapshot
  // resolves it to the venue's market the same way the build did — the main
  // book first, then the builder dexes we place orders on — and the guard
  // then holds the action's asset id to THAT market's live id.
  const coin = hlCoinLabel(expected.coin)
  let snap
  try {
    snap = await fetchHlSnapshot(coin, from, isTestnet, expected.kind === 'open' ? expected.isBuy : undefined)
  } catch (e) {
    return NextResponse.json({ error: `Hyperliquid read failed: ${(e as Error).message}` }, { status: 502 })
  }
  const market = { dex: snap.dex ?? null, dexIndex: snap.dexIndex ?? null, localIndex: snap.localIndex, isTestnet }
  const guard = isLeverage
    ? guardHlLeverageBuild(
        { kind: 'open', coin, leverage: expected.leverage },
        action as HlWireLeverageAction,
        { assetIndex: snap.assetIndex, maxLeverage: snap.maxLeverage, marginMode: snap.marginMode, ...market },
      )
    : guardHlExecBuild(
        { kind: expected.kind as 'open' | 'close', coin, isBuy: expected.isBuy },
        action as HlWireOrderAction,
        { markPx: snap.markPx, assetIndex: snap.assetIndex, withdrawableUsd: snap.withdrawableUsd, positionSzi: snap.positionSzi, szDecimals: snap.szDecimals, ...market },
      )
  if (!guard.ok) {
    const bad = guard.checks.filter((c) => !c.ok && c.level === 'block').map((c) => c.note)
    return NextResponse.json({ error: `Refused at submit: ${bad.join(' ')}` }, { status: 403 })
  }

  // 3 — the kill switch, at the point of submission (the spend policy was
  //     retired 2026-10-30; policyCheck refuses only frozen / revoked now).
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
      return NextResponse.json({ error: `Refused by your account's kill switch: ${violation}.` }, { status: 403 })
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
    // Hyperliquid prints back the address it RECOVERED from our signature.
    // Two very different failures wear the same words:
    //   · it names OUR agent  → the approval really is gone (removed in the
    //     HL app, or expired venue-side ahead of our clock). Retire the row
    //     and hand the client the enable door.
    //   · it names ANY OTHER address → the recovery itself is wrong: the
    //     bytes we hashed are not the bytes the venue hashed. That is our
    //     bug, never the wallet's — and retiring here destroys a working
    //     agent and loops the user through "enable trading" forever, one
    //     wasted wallet signature per lap (live 2026-09-23, the key-order
    //     bug canonicalizeHlAction now closes). Keep the agent; say so.
    const unknownSigner = /does not exist|not approved|api wallet|agent/i.test(msg)
    const named = /0x[0-9a-fA-F]{40}/.exec(msg)?.[0]?.toLowerCase()
    const namesOurAgent = !named || named === delegation?.agentAddress.toLowerCase()
    if (delegation && unknownSigner && namesOurAgent) {
      await retireDelegation(delegation.id)
      return NextResponse.json({ error: `${msg} — enable trading again to mint a fresh Pantessa agent.`, code: 'delegation-required' }, { status: 409 })
    }
    if (delegation && unknownSigner && named) {
      console.warn(`[hl/submit] signature recovered to ${named}, not the approved agent ${delegation.agentAddress} — action bytes disagree with the venue`, JSON.stringify(action))
      return NextResponse.json(
        {
          error:
            'Hyperliquid did not recognize the signature on this order, so nothing was placed. Your Pantessa agent is still approved — this one is ours to fix. Ask again for a fresh build.',
        },
        { status: 502 },
      )
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
        note: `hl leverage set: ${coin} ${expected.leverage}x ${(action as HlWireLeverageAction).isCross ? 'cross' : 'isolated'}${delegation ? ' (delegated agent)' : ''}`,
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
    // The venue's own market name — a builder-dex market is `xyz:SP500` there.
    explorerUrl: `https://app.hyperliquid${isTestnet ? '-testnet' : ''}.xyz/trade/${snap.coin ?? coin}`,
  })
}
