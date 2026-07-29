#!/usr/bin/env tsx
/**
 * End-to-end test of the spend-account API surface against a running dev
 * server (npm run dev) + the real database. Consolidates the verification
 * patterns from the autopilot runs into a standing harness:
 *
 *   • SIWE auth (nonce → sign → session)
 *   • API keys: mint (show-once secret), list (no secrets), revoke, Bearer auth
 *   • Grants: CRUD, cap validation, owner scoping
 *   • EIP-712 grant signing: GET payload → sign → PUT, voiding on terms change
 *   • Hosted-ledger sync: POST receipts, cross-wallet 404, spend totals
 *   • Public activity feed: shape + caching, P1 anonymization (full wallet
 *     absent), P2 denial rows aggregate-only
 *   • Chat receipts: Message.meta round-trip + public share-page render
 *   • Blog: admin-gated CRUD + draft/publish flow (set BLOG_ADMIN_PK and start
 *     the dev server with ADMIN_WALLETS=<its address>; skipped when unset)
 *
 * Every row is created under throwaway wallets and deleted at the end; the
 * final checks verify zero rows remain.
 *
 *   npm run dev        # in one terminal
 *   npm run test:api   # in another
 */
import { readFile } from 'node:fs/promises'
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { grantTypedData } from '../lib/grant-typed-data'
import { grantViolation, type GrantPolicy } from '../lib/spend-grant'
import { routerPrompt, parseRouterDecision, selectInferenceProvider, routeMessage, shortlistEndpoints } from '../lib/router'
import { buildSmartRequest, computeRating, type PlannableEndpoint } from '../lib/endpoint-planner'
import { buildSignableArtifact, isActionIntent, orderRequestOf, txRequestOf, txChainOf } from '../lib/transaction-layer'
import { resolveToken, buildCowOrderTypedData, cowOrderAction, buildCowLimitOrder, buildCowSubmitBody, describeCowOrder, describeAmount, formatAtoms, tokenDecimals, tokenLabel, humanToAtoms, applySlippage, COW_APP_DATA_JSON, COW_APP_DATA_HASH, GPV2_SETTLEMENT, type CowQuoteResult } from '../lib/cow'
import { primeTokenList } from '../lib/token-list'
import { pairStockToken, stockChipLabel } from '../lib/stock-pairing'
import { chartPairFor, changePct24h, aggregateCandles, type Candle } from '../lib/charts'
import { pureChecks, policyCheck, orderValueUsd, buildReport } from '../lib/cow-guardrails'
import { policyCheckInflow, recipientCheck, validityCheck, MAX_VALID_SEC } from '../lib/tx-guardrails'
import { guardPlannerArtifact, PERMIT2_ADDRESS } from '../lib/planner-artifact-guard'
import { parseSwapIntent, swapClarify } from '../lib/swap-intent'
import { activeLinkCapFor, composeMcps } from '../lib/intent-links'
import { formatEarnedUsd, netFeeBpsFor, creatorEarningsUsd, FEE_BEARING_BUILD_PATHS, CROSS_CHAIN_FEE_BPS, CROSS_CHAIN_NET_FEE_BPS } from '../lib/fees'
import { hexLuminance, normalizeAccent, normalizeBg, parseBrandHtml, validateBrandUrl } from '../lib/brand-scan'
import { brandBloomTint, brandCtaStyle, brandThemeStyle } from '../lib/brand-theme'
import {
  clientIpFrom,
  decideTurnLimit,
  hashIp,
  limitKeysFor,
  UNSIGNED_IP_HOURLY_CAP,
  UNSIGNED_WALLET_HOURLY_CAP,
} from '../lib/turn-limits'
import { HOUSE_LINKS, houseLinkMarks } from '../lib/house-links'
import { isDbChatId } from '../lib/chat-ids'
import { usdToTokenAmount } from '../lib/usd-probe'
import { parseRobinhoodBridge, guardRobinhoodBridge, RH_L1_INBOX, ARB_SYS } from '../lib/robinhood-bridge'
import { parseNftAsk, parseOpenSeaItemUrl, guardNftTransfer, ERC721_ABI as NFT_ERC721_ABI, ERC1155_ABI as NFT_ERC1155_ABI } from '../lib/nft-layer'
import { parseNftListAsk, parseNftMarketAsk, parseNftTransferFollowUp, nftTransferPending, nftAskFromPending } from '../lib/nft-layer'
import { nftGalleryChains, nftRowActions } from '../lib/nft-gallery'
import { groupCollections, marketReplyCopy, offersDisplay, valuationDisplay } from '../lib/nft-market'
import { nftGalleryOf, nftMarketOf } from '../lib/nft-display'
import { getProtocolMark, YeetfulMark } from '../components/protocol-marks'
import { splitListingPrice, buildListingComponents, guardListingComponents, openseaAssetUrl, SEAPORT_1_6, guardBuyFulfillment, fulfillmentToCalldata, normalizeOpenseaListing, normalizeOpenseaOffer, collectionSlugCandidates } from '../lib/opensea'
import { keccak256, stringToBytes, decodeFunctionData, parseAbi } from 'viem'
import { isCacheable, routeCacheKey, getCached, setCached, clearRouteCache } from '../lib/route-cache'
import { routeSavings } from '../lib/route-telemetry'
import { portfolioFromToolResult, portfolioOf } from '../lib/portfolio-display'
import { jobContextFor } from '../lib/job-context'
import { crossChainAgentOf, detectCrossChain, swapWorkingContext } from '../lib/swap-intent'
import { encodeV4SwapCalldata, guardUniswapV4Build, type V4BuiltStep, type V4GuardExpectations, type V4PoolKey } from '../lib/uniswap-v4'
import { guardLifiBuild, verifyLifiQuoteEcho, lifiPriceAcceptable, lifiRoutersFor, type LifiBuiltStep, type LifiGuardExpectations, type LifiQuote } from '../lib/lifi-venue'
import { clampNativeSellAtoms, FUNDING_ALT_USDC, fundingAltUsdcFor, fundingNeedUsd, GAS_TOPUP_ETH, guardLifiBridgeBuild, lifiBridgeRoutersFor, parseRhFundingFollowUp, planDownsizedRobinhoodBuy, planRobinhoodFundingAdvice, planRobinhoodFundingChips, rhFundingPending, robinhoodBuyNeedUsd, verifyLifiBridgeEcho, type FundingOrigin, type LifiBridgeExpectations, type LifiBridgeStep } from '../lib/lifi-bridge'
import { classifyOneclickStatus, inflightDepositFromPending, inflightPendingData, inflightSettlingNote } from '../lib/inflight-funding'
import { sanitizeWorkingContext } from '../lib/working-context'
import { parseRobinhoodFunding, parseSameChainSwapSegment, JOB_SEGMENT_PARSERS } from '../lib/jobs'
import { parseMultiSendSegments, parseTransferSegment } from '../lib/transfer-exec'
import { buildFundsDetail, classifyTurn, FAILURE_PROBE_TOKENS, moneyShaped } from '../lib/ask-failure'
import { canonicalChainWord, normalizeChainWords } from '../lib/chain-lexicon'
import { decideFundingTurn, detectBalanceShortfall, fundingPlanUsd, planFundingChips, planStrandedRescue, promisableCapacityUsd, rankFundingSources, shortRefusalCopy, softenClaimedFailureBlock, type FundingNeed, type FundingSource } from '../lib/funding-plan'
import { compileDcaBuy, dcaRunChip, parseDcaCreate, parseDcaManage, parseDcaRun, periodKeyFor } from '../lib/dca'
import { briefingNeedsCount, briefingTile, composeBriefingItems, type BriefingInputs, type BriefingPosition } from '../lib/briefing'
import { moveAsk, parseRebalanceAsk, planRebalance, type RebalanceInputs } from '../lib/rebalance'
import {
  buildSpotGuardPermission,
  guardSpotSell,
  NATIVE_TOKEN_SENTINEL,
  parseSpotGuardArm,
  parseSpotGuardManage,
  permissionMatchesPolicy,
  spotTriggerFired,
} from '../lib/spot-guard'
import { spotGuardShareContent } from '../lib/share-receipts'
import {
  buildDcaSpendPermission,
  guardAutoBuy,
  parseDcaAutoToggle,
  parsePermission,
  permissionMatchesSchedule,
  serializePermission,
  spendPermissionTypedData,
  usdcAtomsToHuman,
  SPEND_PERMISSION_MANAGER,
} from '../lib/dca-auto'
import { ADDRESS_THIS, SWAP_ROUTER_02_ABI } from '../lib/uniswap-venue'
import { firstUserPromptOf, shareTweetHrefOf } from '../lib/shared-chat'
import {
  VIA_RE,
  dcaShareContent,
  guardianShareContent,
  maskAddressTokens,
  receiptTryHref,
  receiptTweetHref,
  txShareContent,
  viaIdOf,
} from '../lib/share-receipts'
import { EXAMPLE_PROMPTS } from '../lib/examples'
import { swapFeeAtoms, SWAP_FEE_BPS, TREASURY_ADDRESS } from '../lib/fees'
import { APP_CHAINS, chainById, chainNamedIn, explorerTokenUrl, sanitizeChainId } from '../lib/chains'
import { parseCrossChainSwap, guardCrossChainBuild, expectedOriginChainId, parseCrossChainFollowUp, crossChainPending, crossChainValueUsd } from '../lib/cross-chain-swap'
import {
  parseAaveSupply,
  competingVenueOf,
  pickSupplyReserve,
  guardAaveSupplyBuild,
  parseAaveSupplyFollowUp,
  parseAaveOp,
  parseAaveOpFollowUp,
  guardAaveOpBuild,
  pickWithdrawPosition,
  pickRepayPosition,
  pickBorrowReserve,
  reserveForOp,
  reserveLegIds,
  WITHDRAW_MAX_SENTINEL,
} from '../lib/aave-supply'
import { encodeFunctionData, erc20Abi } from 'viem'
import {
  evaluatePolicy,
  formatPx,
  formatSz,
  buildGuardianClose,
  guardGuardianClose,
  approveAgentArtifacts,
  splitSignature,
  parseGuardianArm,
  planForExistingPolicy,
  type GuardianPolicyParams,
  type GuardianPosition,
} from '../lib/hl-guardian'
import {
  parseHlIntent,
  buildHlOrderAction,
  guardHlExecBuild,
  buildHlDeposit,
  buildHlLeverageAction,
  guardHlLeverageBuild,
  hlActionTypedData,
  hlCollateralTargetUsd,
  HL_BRIDGE2_ARBITRUM,
  HL_MIN_DEPOSIT_USDC,
  ARBITRUM_USDC,
  type HlOrderIntent,
} from '../lib/hyperliquid-exec'
import { compileJobAsk as compileJobAskFull, type CompiledJob } from '../lib/jobs'

// Harness shim: the pre-pairing checks below narrow on `'problem' in x` only.
// A stock-pairing clarify folds into a problem-shaped result here (their asks
// all use real tickers, so none ever clarifies); the clarify-specific checks
// call compileJobAskFull directly.
const compileJobAsk = (m: string): CompiledJob | { problem: string } | null => {
  const r = compileJobAskFull(m)
  return r && 'clarify' in r ? { problem: `clarify: ${r.clarify.question}` } : r
}
import { signJobToken, verifyJobToken } from '../lib/job-token'
import {
  guardLidoStakeBuild,
  isLidoGuidedAsk,
  parseLidoStake,
  suggestedStakeEth,
  LIDO_STETH_MAINNET,
  LIDO_WSTETH_MAINNET,
  type LidoBuiltStake,
} from '../lib/lido-stake'
import { classifyLegacyTurn, INTERNAL_ORIGIN_SQL, isInternalOrigin, STANDING_TURN_SQL } from '../lib/value-origin'
import { PLAN_BY_ID, planCreditsFor, ALLOWANCE_CUTOFF } from '../lib/plans'
import { FREE_DAILY_TURN_CAP, HOUSE_DAILY_TURN_CAP } from '../lib/billing'

const BASE = process.env.BASE ?? 'http://localhost:3000'
const DOMAIN = new URL(BASE).host

let pass = 0
let fail = 0
function check(name: string, ok: boolean, extra = '') {
  console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
  ok ? pass++ : fail++
}

function getCookie(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

async function signIn(account: PrivateKeyAccount): Promise<string> {
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`)
  const nonceCookie = getCookie(nonceRes, 'yf_siwe_nonce')
  const { nonce } = await nonceRes.json()
  const message = createSiweMessage({
    address: account.address,
    chainId: 8453,
    domain: DOMAIN,
    nonce,
    uri: BASE,
    version: '1',
  })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = getCookie(res, 'yf_session')
  if (!session) throw new Error(`SIWE sign-in failed (${res.status})`)
  return session
}

/** Strip React's inter-text-node comments before asserting on rendered HTML. */
const flat = (html: string) => html.replace(/<!--.*?-->/g, '')


// Chat probes below deliberately provoke refusals and fall-throughs — mark
// them so the ask-failure log (lib/ask-failure.ts) skips harness traffic.
const realFetch = globalThis.fetch
globalThis.fetch = ((input: Parameters<typeof realFetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  if (typeof url === 'string' && url.includes('/api/chat')) {
    init = { ...(init ?? {}), headers: { ...((init?.headers as Record<string, string>) ?? {}), 'x-yf-no-ask-log': '1' } }
  }
  return realFetch(input, init)
}) as typeof fetch

async function main() {
  console.log(`\nTesting the spend-account API @ ${BASE}\n`)
  const owner = privateKeyToAccount(generatePrivateKey())
  const mallory = privateKeyToAccount(generatePrivateKey())

  // ── Auth ──────────────────────────────────────────────────────────────────
  console.log('— auth')
  const session = await signIn(owner)
  check('owner signs in via SIWE', !!session)
  const mallorySession = await signIn(mallory)
  check('second wallet signs in', !!mallorySession)
  const C = { cookie: session }
  const CJ = { 'content-type': 'application/json', ...C }

  // ── API keys ──────────────────────────────────────────────────────────────
  console.log('— api keys')
  const anonMint = await fetch(`${BASE}/api/keys`, { method: 'POST' })
  check('mint without session → 401', anonMint.status === 401)

  const mintRes = await fetch(`${BASE}/api/keys`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ label: 'test:api harness' }),
  })
  const minted = await mintRes.json()
  check('mint returns yf_ plaintext once', mintRes.status === 201 && /^yf_[0-9a-f]{64}$/.test(minted.secret ?? ''))
  const B = { authorization: `Bearer ${minted.secret}` }
  const BJ = { 'content-type': 'application/json', ...B }

  const keyList = await (await fetch(`${BASE}/api/keys`, { headers: C })).json()
  const row = Array.isArray(keyList) && keyList.find((k: { id: string }) => k.id === minted.id)
  check('key listed with prefix, never secret/hash', !!row && !('secret' in row) && !('hash' in row))

  const badBearer = await fetch(`${BASE}/api/grants`, {
    headers: { authorization: `Bearer yf_${'0'.repeat(64)}` },
  })
  check('wrong Bearer key → 401', badBearer.status === 401)

  // ── Grants ────────────────────────────────────────────────────────────────
  console.log('— grants')
  const badCaps = await fetch(`${BASE}/api/grants`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ allow: ['a.test'], perCallUsd: 0, perDayUsd: 1 }),
  })
  check('perCallUsd=0 rejected', badCaps.status === 400)
  const noAllow = await fetch(`${BASE}/api/grants`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ perCallUsd: 0.01, perDayUsd: 1 }),
  })
  check('empty allowlist rejected', noAllow.status === 400)

  const grantRes = await fetch(`${BASE}/api/grants`, {
    method: 'POST',
    headers: BJ, // Bearer creates grants too
    body: JSON.stringify({
      allow: ['https://b.example.test/path', 'a.example.test'],
      perCallUsd: 0.05,
      perDayUsd: 2,
      totalUsd: 10,
    }),
  })
  const grant = await grantRes.json()
  check('Bearer key creates a grant', grantRes.status === 201 && !!grant.id)
  check('allow normalized to bare hosts', Array.isArray(grant.allow) && grant.allow.includes('b.example.test'))
  check('create response carries signed:false', grant.signed === false)

  const malloryRead = await fetch(`${BASE}/api/grants/${grant.id}`, {
    headers: { cookie: mallorySession },
  })
  check("another wallet can't read the grant (404)", malloryRead.status === 404)

  // ── EIP-712 signing ───────────────────────────────────────────────────────
  console.log('— eip-712 signing')
  const tdRes = await fetch(`${BASE}/api/grants/${grant.id}/signature`, { headers: C })
  const tdBody = await tdRes.json()
  check(
    'GET signature returns sorted, micro-denominated payload',
    tdRes.status === 200 &&
      tdBody.typedData?.primaryType === 'SpendGrant' &&
      JSON.stringify(tdBody.typedData.message.allow) === JSON.stringify(['a.example.test', 'b.example.test']) &&
      tdBody.typedData.message.perCallUsdMicros === '50000',
  )

  const foreignSig = await mallory.signTypedData(grantTypedData({ ...grant, expiresAt: new Date(grant.expiresAt) }))
  const badPut = await fetch(`${BASE}/api/grants/${grant.id}/signature`, {
    method: 'PUT',
    headers: CJ,
    body: JSON.stringify({ signature: foreignSig }),
  })
  check("someone else's signature → 400", badPut.status === 400)

  const ownerSig = await owner.signTypedData(grantTypedData({ ...grant, expiresAt: new Date(grant.expiresAt) }))
  const putRes = await fetch(`${BASE}/api/grants/${grant.id}/signature`, {
    method: 'PUT',
    headers: BJ, // Bearer works on the signature route too
    body: JSON.stringify({ signature: ownerSig }),
  })
  check('owner signature verifies (via Bearer)', putRes.status === 200 && (await putRes.json()).signed === true)

  const patched = await (
    await fetch(`${BASE}/api/grants/${grant.id}`, {
      method: 'PATCH',
      headers: CJ,
      body: JSON.stringify({ perDayUsd: 3 }),
    })
  ).json()
  check('cap change voids the signature', patched.signed === false && patched.signature === null)

  const freshTd = (await (await fetch(`${BASE}/api/grants/${grant.id}/signature`, { headers: C })).json()).typedData
  const resign = await owner.signTypedData(
    grantTypedData({ ...grant, perDayUsd: 3, expiresAt: new Date(grant.expiresAt) }),
  )
  const reput = await fetch(`${BASE}/api/grants/${grant.id}/signature`, {
    method: 'PUT',
    headers: CJ,
    body: JSON.stringify({ signature: resign }),
  })
  check('re-sign after voiding works', reput.status === 200 && freshTd.message.perDayUsdMicros === '3000000')

  // ── Optional spend policy: the master on/off switch ─────────────────────────
  console.log('— optional spend policy')
  // Pure-logic: the gate short-circuits when the policy is off. A call that
  // violates BOTH the allowlist and the per-call cap is allowed when off, and
  // blocked when on — proving "off = unrestricted, any host, no caps".
  const offPolicy: GrantPolicy = {
    id: 'test', allow: ['only.allowed.test'], perCallUsd: 0.01, perDayUsd: 0.01,
    totalUsd: null, expiresAt: new Date(Date.now() + 86_400_000), status: 'active',
    spendPolicyEnabled: false,
  }
  check(
    'policy OFF → off-allowlist + over-cap call is allowed (unrestricted)',
    grantViolation(offPolicy, 'not.allowed.test', 9.99, 0) === null,
  )
  check(
    'policy ON → the same call is blocked',
    grantViolation({ ...offPolicy, spendPolicyEnabled: true }, 'not.allowed.test', 9.99, 0) === 'NOT_ALLOWED',
  )
  // The open-by-default wildcard: ['*'] allows any host — the caps stay the
  // real gate (same call over the per-call cap is still refused).
  check(
    "wildcard allowlist ['*'] admits any host (caps still bite)",
    grantViolation({ ...offPolicy, spendPolicyEnabled: true, allow: ['*'], perCallUsd: 200, perDayUsd: 200 }, 'brand.new.mcp.test', 9.99, 0) === null &&
      grantViolation({ ...offPolicy, spendPolicyEnabled: true, allow: ['*'] }, 'brand.new.mcp.test', 9.99, 0) === 'OVER_PER_CALL',
  )
  // INFLOWS (sale proceeds — NFT listings): the account pays nothing, so the
  // caps and allowlist never apply; only the kill switches survive direction.
  // A $1,831 sale under a $200 cap must PASS; a frozen account refuses it.
  const inPolicy: GrantPolicy = { ...offPolicy, spendPolicyEnabled: true, allow: ['only.allowed.test'], perCallUsd: 200, perDayUsd: 200 }
  check(
    'inflow gate: sale over every cap + off-allowlist host still passes',
    policyCheckInflow(1831.77, inPolicy).violation === null && policyCheckInflow(1831.77, inPolicy).check.ok,
  )
  check('inflow gate: unpriceable proceeds pass (no VALUE_UNKNOWN wall)', policyCheckInflow(null, inPolicy).violation === null)
  check('inflow gate: frozen account refuses everything', policyCheckInflow(10, { ...inPolicy, paused: true }).violation === 'ACCOUNT_FROZEN')
  check('inflow gate: revoked account refuses everything', policyCheckInflow(10, { ...inPolicy, status: 'revoked' }).violation === 'REVOKED')
  // API plumbing: PATCH the flag; it persists and does NOT void the signature
  // (it's just a power switch, not a change to the signed terms).
  const polOn = await (
    await fetch(`${BASE}/api/grants/${grant.id}`, {
      method: 'PATCH', headers: CJ, body: JSON.stringify({ spendPolicyEnabled: true }),
    })
  ).json()
  check(
    'PATCH spendPolicyEnabled persists, signature preserved',
    polOn.spendPolicyEnabled === true && polOn.signed === true && polOn.signature !== null,
  )
  const polOff = await (
    await fetch(`${BASE}/api/grants/${grant.id}`, {
      method: 'PATCH', headers: BJ, body: JSON.stringify({ spendPolicyEnabled: false }),
    })
  ).json()
  check('owner can switch the policy back off (Bearer)', polOff.spendPolicyEnabled === false)

  // ── Direct host allows (the blocked-swap fix-it) ───────────────────────────
  console.log('— direct host allow (allowAdd)')
  // Native venue policy hosts (uniswap.yeetful.com, …) can never enter the
  // approval-DERIVED allowlist — allowAdd is the way out of NOT_ALLOWED, and
  // it lands in BOTH allow (enforced now) and extraAllow (survives re-derive).
  const allowAdded = await (
    await fetch(`${BASE}/api/grants/${grant.id}`, {
      method: 'PATCH', headers: CJ, body: JSON.stringify({ allowAdd: 'Uniswap.Yeetful.com' }),
    })
  ).json()
  check(
    'PATCH allowAdd lands in allow + extraAllow (lowercased)',
    allowAdded.allow?.includes('uniswap.yeetful.com') && allowAdded.extraAllow?.includes('uniswap.yeetful.com'),
  )
  check('allowAdd (allowlist change) voids the signature', allowAdded.signed === false)
  const allowAgain = await (
    await fetch(`${BASE}/api/grants/${grant.id}`, {
      method: 'PATCH', headers: CJ, body: JSON.stringify({ allowAdd: 'uniswap.yeetful.com' }),
    })
  ).json()
  check(
    'allowAdd is idempotent (no duplicate hosts)',
    allowAgain.allow?.filter((h: string) => h === 'uniswap.yeetful.com').length === 1 &&
      allowAgain.extraAllow?.filter((h: string) => h === 'uniswap.yeetful.com').length === 1,
  )
  const badHost = await fetch(`${BASE}/api/grants/${grant.id}`, {
    method: 'PATCH', headers: CJ, body: JSON.stringify({ allowAdd: 'not a host!' }),
  })
  check('allowAdd rejects a non-hostname (400)', badHost.status === 400)
  // Open-by-default semantics (2026-07-17 flip): every agent is enabled out
  // of the gate. Un-curated → the ['*'] wildcard allowlist; the first
  // explicit OFF replaces it with a concrete list that must keep BOTH the
  // native venue hosts (always allowed — the user signs those) and any
  // direct allows (extraAllow) — the silent-wipe regression the column
  // exists for. Throwaway grant (newest-active is what the sync targets).
  {
    const apDefault = (await (await fetch(`${BASE}/api/approvals`, { headers: C })).json()) as { serverId: string; approved: boolean }[]
    check('approvals default ON for a fresh account (curate down)', apDefault.length > 0 && apDefault.every((r) => r.approved))
    const g2 = await (
      await fetch(`${BASE}/api/grants`, {
        method: 'POST', headers: BJ,
        body: JSON.stringify({ allow: ['a.example.test'], perCallUsd: 0.05, perDayUsd: 2 }),
      })
    ).json()
    await fetch(`${BASE}/api/grants/${g2.id}`, { method: 'PATCH', headers: CJ, body: JSON.stringify({ allowAdd: 'direct.example.test' }) })
    const dir = await (await fetch(`${BASE}/api/servers`)).json()
    const srv = dir.find((s: { callable: boolean }) => s.callable) ?? dir[0]
    // Curate: toggle ONE agent off → concrete allowlist, everything else kept.
    await fetch(`${BASE}/api/approvals`, { method: 'PUT', headers: CJ, body: JSON.stringify({ serverId: srv.id, approved: false }) })
    const curated = await (await fetch(`${BASE}/api/grants/${g2.id}`, { headers: C })).json()
    check(
      'curated re-derive keeps direct allows + native venue hosts',
      Array.isArray(curated.allow) &&
        !curated.allow.includes('*') &&
        curated.allow.includes('direct.example.test') &&
        curated.allow.includes('uniswap.yeetful.com'),
    )
    // House inference must survive curation: without api.anthropic.com every
    // chat turn refuses NOT_ALLOWED — the product reads as broken.
    check('curated re-derive keeps house inference (api.anthropic.com)', curated.allow.includes('api.anthropic.com'))
    // Un-curate: back to ON → the wildcard returns (new MCPs need no re-sync).
    await fetch(`${BASE}/api/approvals`, { method: 'PUT', headers: CJ, body: JSON.stringify({ serverId: srv.id, approved: true }) })
    const open = await (await fetch(`${BASE}/api/grants/${g2.id}`, { headers: C })).json()
    check('zero explicit OFFs → wildcard allowlist', Array.isArray(open.allow) && open.allow.includes('*'))
    // Re-enabling LEAVES NOTHING BEHIND. The table stores curation (the OFFs);
    // an approved:true row is a no-op the reader already assumes, and writing
    // one made this very block mint a permanent phantom "new wallet" in the
    // adoption metrics on every harness run (276 of them by 2026-07-28).
    const reOpen = (await (await fetch(`${BASE}/api/approvals`, { headers: C })).json()) as { approved: boolean }[]
    check(
      'un-curating clears the row (default ON restored, no no-op rows left behind)',
      reOpen.length > 0 && reOpen.every((r) => r.approved),
    )
    await fetch(`${BASE}/api/grants/${g2.id}`, { method: 'DELETE', headers: C })
  }

  // ── Failed-job retry (the fix-it's rebuild) ────────────────────────────────
  console.log('— job retry')
  const retryMissing = await fetch(`${BASE}/api/jobs/job_does_not_exist/retry`, { method: 'POST', headers: CJ })
  check('job retry: unknown job → 400 (never 500)', retryMissing.status === 400)
  const retryAnon = await fetch(`${BASE}/api/jobs/job_does_not_exist/retry`, { method: 'POST' })
  check('job retry: no auth → 401', retryAnon.status === 401)

  // ── Saved MCP shortlist (pick 1–3) ──────────────────────────────────────────
  console.log('— shortlist')
  const slNoAuth = await fetch(`${BASE}/api/shortlist`)
  check('shortlist read requires auth → 401', slNoAuth.status === 401)

  const slEmpty = await (await fetch(`${BASE}/api/shortlist`, { headers: C })).json()
  check(
    'fresh wallet → empty shortlist',
    Array.isArray(slEmpty.serviceIds) && slEmpty.serviceIds.length === 0,
  )

  // Real service ids from the directory — the shortlist validates against them.
  const slDir = await (await fetch(`${BASE}/api/servers`)).json()
  const svc: string[] = (Array.isArray(slDir) ? slDir : [])
    .map((s: { id: string }) => s.id)
    .filter(Boolean)
  const [s1, s2, s3, s4] = svc

  if (svc.length >= 2) {
    const saved = await (
      await fetch(`${BASE}/api/shortlist`, {
        method: 'PUT', headers: CJ, body: JSON.stringify({ serviceIds: [s1, s2] }),
      })
    ).json()
    check(
      'save shortlist of 2 persists, order kept',
      saved.serviceIds?.length === 2 && saved.serviceIds[0] === s1 && saved.serviceIds[1] === s2,
    )

    const reread = await (await fetch(`${BASE}/api/shortlist`, { headers: C })).json()
    check('shortlist survives a re-read (DB-backed)', reread.serviceIds?.length === 2)

    // Unknown ids are silently dropped, not stored.
    const cleaned = await (
      await fetch(`${BASE}/api/shortlist`, {
        method: 'PUT', headers: CJ, body: JSON.stringify({ serviceIds: [s1, 'bogus-id-xyz'] }),
      })
    ).json()
    check(
      'unknown service ids are dropped',
      cleaned.serviceIds?.length === 1 && cleaned.serviceIds[0] === s1,
    )

    // Isolation: another wallet has its own (empty) shortlist.
    const mShortlist = await (
      await fetch(`${BASE}/api/shortlist`, { headers: { cookie: mallorySession } })
    ).json()
    check('shortlist is per-wallet (mallory sees empty)', mShortlist.serviceIds?.length === 0)
  }

  // >3 valid ids is a 400 — never a silent truncation.
  if (svc.length >= 4) {
    const tooMany = await fetch(`${BASE}/api/shortlist`, {
      method: 'PUT', headers: CJ, body: JSON.stringify({ serviceIds: [s1, s2, s3, s4] }),
    })
    check('shortlist > 3 rejected (400)', tooMany.status === 400)
  }

  // Non-array body → 400; empty array clears it (fallback to whole-catalog).
  const slBad = await fetch(`${BASE}/api/shortlist`, {
    method: 'PUT', headers: CJ, body: JSON.stringify({ serviceIds: 'nope' }),
  })
  check('shortlist PUT with non-array → 400', slBad.status === 400)
  const slClear = await (
    await fetch(`${BASE}/api/shortlist`, {
      method: 'PUT', headers: CJ, body: JSON.stringify({ serviceIds: [] }),
    })
  ).json()
  check(
    'empty shortlist clears (fallback to whole-catalog)',
    Array.isArray(slClear.serviceIds) && slClear.serviceIds.length === 0,
  )

  // ── Per-wallet working set (DB mirror of store.walletSets — NO cap) ─────────
  console.log('— wallet working set')
  const wsNoAuth = await fetch(`${BASE}/api/working-set`)
  check('working-set read requires auth → 401', wsNoAuth.status === 401)

  const wsEmpty = await (await fetch(`${BASE}/api/working-set`, { headers: C })).json()
  check(
    'fresh wallet → empty working set',
    Array.isArray(wsEmpty.serviceIds) && wsEmpty.serviceIds.length === 0,
  )

  if (svc.length >= 4) {
    // Four ids — deliberately MORE than the shortlist's cap of 3: the working
    // set mirrors whatever the user toggled on, uncapped.
    const wsSaved = await (
      await fetch(`${BASE}/api/working-set`, {
        method: 'PUT', headers: CJ, body: JSON.stringify({ serviceIds: [s1, s2, s3, s4] }),
      })
    ).json()
    check(
      'save a 4-MCP working set (beyond the shortlist cap), order kept',
      wsSaved.serviceIds?.length === 4 && wsSaved.serviceIds[0] === s1 && wsSaved.serviceIds[3] === s4,
    )

    const wsReread = await (await fetch(`${BASE}/api/working-set`, { headers: C })).json()
    check(
      'working set survives a re-read (DB-backed restore path)',
      wsReread.serviceIds?.length === 4 && wsReread.serviceIds[1] === s2,
    )

    // Duplicates collapse, unknown ids are dropped (a deleted custom MCP must
    // not ghost across devices).
    const wsCleaned = await (
      await fetch(`${BASE}/api/working-set`, {
        method: 'PUT', headers: CJ, body: JSON.stringify({ serviceIds: [s1, s1, 'bogus-id-xyz', s2] }),
      })
    ).json()
    check(
      'working set de-dupes + drops unknown ids',
      wsCleaned.serviceIds?.length === 2 && wsCleaned.serviceIds[0] === s1 && wsCleaned.serviceIds[1] === s2,
    )

    // Isolation: another wallet has its own (empty) working set.
    const mWs = await (
      await fetch(`${BASE}/api/working-set`, { headers: { cookie: mallorySession } })
    ).json()
    check('working set is per-wallet (mallory sees empty)', mWs.serviceIds?.length === 0)
  }

  const wsBad = await fetch(`${BASE}/api/working-set`, {
    method: 'PUT', headers: CJ, body: JSON.stringify({ serviceIds: 'nope' }),
  })
  check('working-set PUT with non-array → 400', wsBad.status === 400)

  const wsClear = await (
    await fetch(`${BASE}/api/working-set`, {
      method: 'PUT', headers: CJ, body: JSON.stringify({ serviceIds: [] }),
    })
  ).json()
  check(
    'empty working set clears',
    Array.isArray(wsClear.serviceIds) && wsClear.serviceIds.length === 0,
  )

  // ── Billing: plans + YEET credits (read-only — no rows to clean up) ────────
  console.log('— billing')
  const planNoAuth = await fetch(`${BASE}/api/billing/plan`)
  check('billing plan read requires auth → 401', planNoAuth.status === 401)
  const planRes = await fetch(`${BASE}/api/billing/plan`, { headers: C })
  const planBody = await planRes.json()
  check(
    'fresh wallet is on the free tier with the full allowance',
    planRes.status === 200 &&
      planBody.usage?.plan === 'free' &&
      planBody.usage?.allowance === 250 &&
      planBody.usage?.used === 0 &&
      planBody.usage?.remaining === 250,
    `plan=${planBody.usage?.plan} used=${planBody.usage?.used}`,
  )
  // COGS lock-in (PRICING.md addendum 2026-07-21): allowances sized so a
  // maxed plan never exceeds its price in inference cost; pre-cutoff paid
  // subscriptions keep their original allowance forever.
  check(
    'plans: right-sized allowances (250 / 8k / 40k) with legacy grandfathering (25k / 150k)',
    PLAN_BY_ID.free.credits === 250 &&
      PLAN_BY_ID.growth.credits === 8000 && PLAN_BY_ID.growth.legacyCredits === 25000 &&
      PLAN_BY_ID.scale.credits === 40000 && PLAN_BY_ID.scale.legacyCredits === 150000,
  )
  const preCutoff = new Date(ALLOWANCE_CUTOFF - 86_400_000)
  const postCutoff = new Date(ALLOWANCE_CUTOFF + 86_400_000)
  check(
    'plans: planCreditsFor grandfathers pre-cutoff subs, current for new + free',
    planCreditsFor(PLAN_BY_ID.growth, preCutoff) === 25000 &&
      planCreditsFor(PLAN_BY_ID.growth, postCutoff) === 8000 &&
      planCreditsFor(PLAN_BY_ID.scale, preCutoff) === 150000 &&
      planCreditsFor(PLAN_BY_ID.free, preCutoff) === 250 &&
      planCreditsFor(PLAN_BY_ID.growth, null) === 8000,
  )
  check(
    'billing: circuit breakers exported with sane clamped defaults (the "leave it open" bound)',
    FREE_DAILY_TURN_CAP >= 5 && FREE_DAILY_TURN_CAP <= 1000 && HOUSE_DAILY_TURN_CAP >= 100,
  )
  check(
    'plan config ships 3 plans (free/growth/scale)',
    Array.isArray(planBody.plans) &&
      planBody.plans.length === 3 &&
      planBody.plans.some((p: { id: string; priceUsd: number }) => p.id === 'free' && p.priceUsd === 0),
  )
  const coNoAuth = await fetch(`${BASE}/api/billing/checkout`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ plan: 'growth' }),
  })
  check('checkout requires a SIWE session → 401', coNoAuth.status === 401)
  const coBadPlan = await fetch(`${BASE}/api/billing/checkout`, {
    method: 'POST', headers: CJ, body: JSON.stringify({ plan: 'free' }),
  })
  // Without STRIPE_SECRET_KEY the route answers 503 before validating the
  // plan id; with a key configured a free plan must 400.
  check('checkout refuses the free plan (400) or reports Stripe unconfigured (503)', coBadPlan.status === 400 || coBadPlan.status === 503)
  const whUnsigned = await fetch(`${BASE}/api/billing/webhook`, { method: 'POST', body: '{}' })
  check('webhook without signature/config → 400 or 503', whUnsigned.status === 400 || whUnsigned.status === 503)

  // ── Embed keys: public attribution keys + the sites ledger ────────────────
  console.log('— embed keys')
  const ekNoAuth = await fetch(`${BASE}/api/embed-keys`)
  check('embed-keys list requires auth → 401', ekNoAuth.status === 401)
  const ekMint = await fetch(`${BASE}/api/embed-keys`, {
    method: 'POST', headers: CJ, body: JSON.stringify({ label: 'harness site' }),
  })
  const ek = await ekMint.json()
  check(
    'mint returns a public yfe_ key',
    ekMint.status === 201 && typeof ek.key === 'string' && /^yfe_[0-9a-f]{24}$/.test(ek.key),
    ek.key,
  )
  // The sight beacon is public (it runs on strangers' sites) — a mount under
  // the key + a page URL lands as an attributed site row.
  const sight = await fetch(`${BASE}/api/embed/sight`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: ek.key, page: 'https://harness-embed.test/swap' }),
  })
  const sightBody = await sight.json()
  check('sight beacon attributes a keyed mount', sight.status === 200 && sightBody.attributed === true)
  const ekList = await (await fetch(`${BASE}/api/embed-keys`, { headers: C })).json()
  const ekMine = (ekList.keys as { id: string; key: string; sites: { origin: string }[] }[]).find(
    (k) => k.key === ek.key,
  )
  check(
    'embeds list shows the sighted origin under the key',
    !!ekMine && ekMine.sites.some((s: { origin: string }) => s.origin === 'https://harness-embed.test'),
  )
  // ── Embed turn telemetry + owner insights ─────────────────────────────────
  // Two turns in one session: a dead-end shape (refused, no tx) so the
  // insights rollup has something real to classify.
  const tele1 = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: ek.key, sessionId: 'harness-session-1', page: 'https://harness-embed.test/swap',
      prompt: 'swap 5 USDC to WETH on my chain', outcome: 'refused', detail: 'no route for that chain',
    }),
  })
  check('telemetry records a keyed turn', tele1.status === 200 && (await tele1.json()).ok === true)
  const teleBadKey = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'yfe_000000000000000000000000', sessionId: 'harness-session-1', page: 'https://x.test/', prompt: 'hi', outcome: 'answered' }),
  })
  check('telemetry drops an unknown key (202)', teleBadKey.status === 202)
  // Money flow: a built-then-signed pair carrying the guardrail-priced
  // notional — insights must sum it into builtUsd / signedUsd — plus the
  // build layer that constructed it (embed_turns.build_path).
  const tele2 = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: ek.key, sessionId: 'harness-session-2', page: 'https://harness-embed.test/swap',
      prompt: 'swap 25 USDC to WETH', outcome: 'tx-built', artifact: 'tx', chain: 'base', valueUsd: 25.5,
      buildPath: 'native-swap-uniswap',
    }),
  })
  const tele3 = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: ek.key, sessionId: 'harness-session-2', page: 'https://harness-embed.test/swap',
      outcome: 'signed', artifact: 'tx', chain: 'base', valueUsd: 25.5, txUrl: 'https://basescan.org/tx/0xharness',
      buildPath: 'native-swap-uniswap',
    }),
  })
  check('telemetry records tx-built + signed turns with valueUsd', tele2.status === 200 && tele3.status === 200)
  // A beacon with an unrecognized buildPath still records the turn — but the
  // bogus layer name is dropped, landing in the 'unattributed' bucket.
  const tele4 = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: ek.key, sessionId: 'harness-session-3', page: 'https://harness-embed.test/swap',
      prompt: 'supply 1 USDC', outcome: 'tx-built', artifact: 'tx-chain', chain: 'ethereum', buildPath: 'not-a-layer',
    }),
  })
  check('telemetry records a turn with an unknown buildPath (field dropped)', tele4.status === 200)
  // Attended-vs-standing: a signed job-step turn must record (the server
  // stamps origin_kind = job-step; a bogus jobId is ignored, never an error).
  const tele5 = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: ek.key, sessionId: 'harness-session-4', page: 'https://harness-embed.test/swap',
      outcome: 'signed', artifact: 'job-step', chain: 'multi', valueUsd: 1.25,
      buildPath: 'native-job', jobId: 'not-a-real-job-id-shape!!',
    }),
  })
  check('telemetry records a signed job-step turn (standing origin, bad jobId ignored)', tele5.status === 200 && (await tele5.json()).ok === true)
  // First-party lane (yeetful.com chat, keyless): only value-bearing outcomes
  // are accepted, and only from our own origin — both rejections write nothing.
  const fpAnswered = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstParty: true, sessionId: 'harness-fp-rejected', page: `${BASE}/chat`, outcome: 'answered' }),
  })
  check('first-party beacon rejects non-value outcomes (202)', fpAnswered.status === 202)
  const fpForeign = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ firstParty: true, sessionId: 'harness-fp-foreign', page: 'https://stranger.test/chat', outcome: 'signed', artifact: 'tx', valueUsd: 999 }),
  })
  check('first-party beacon rejects foreign origins (202) — keyless embeds still record nothing', fpForeign.status === 202)
  const insNoAuth = await fetch(`${BASE}/api/embeds/insights`)
  check('insights require auth → 401', insNoAuth.status === 401)
  const ins = await (await fetch(`${BASE}/api/embeds/insights`, { headers: C })).json()
  check(
    'insights: the refused turn lands as a dead-end session with the verbatim ask',
    ins.totals?.turns === 5 &&
      ins.totals?.deadEndSessions === 1 &&
      Array.isArray(ins.deadEnds) &&
      ins.deadEnds[0]?.turns?.[0]?.prompt === 'swap 5 USDC to WETH on my chain',
    `turns=${ins.totals?.turns} deadEnds=${ins.totals?.deadEndSessions}`,
  )
  check(
    'insights: money moved sums the notional (builtUsd + signedUsd = 25.5 each)',
    ins.totals?.builtUsd === 25.5 && ins.totals?.signedUsd === 26.75,
    `builtUsd=${ins.totals?.builtUsd} signedUsd=${ins.totals?.signedUsd}`,
  )
  check(
    'insights: transactions carry valueUsd + per-site signedUsd rolls up',
    (ins.transactions as { valueUsd: number | null }[])?.some((x) => x.valueUsd === 25.5) &&
      (ins.perSite as { origin: string; signedUsd: number }[])?.find((s) => s.origin === 'https://harness-embed.test')?.signedUsd === 26.75,
  )
  check('insights: platform-wide `global` block is admin-only (absent for this wallet)', ins.global === undefined)
  // Build-layer breakdown: the uniswap pair rolls up under its layer with both
  // ends of the funnel; the bogus layer never appears (dropped at the API) and
  // its turn lands in 'unattributed'.
  const perPath = ins.perPath as { path: string; built: number; signed: number; builtUsd: number; signedUsd: number }[] | undefined
  const uniRow = perPath?.find((p) => p.path === 'native-swap-uniswap')
  check(
    'insights: perPath pairs built → signed under the reported build layer',
    uniRow?.built === 1 && uniRow?.signed === 1 && uniRow?.builtUsd === 25.5 && uniRow?.signedUsd === 25.5,
    `uniRow=${JSON.stringify(uniRow)}`,
  )
  check(
    'insights: unknown buildPath is dropped → unattributed bucket, never stored verbatim',
    !perPath?.some((p) => p.path === 'not-a-layer') &&
      (perPath?.find((p) => p.path === 'unattributed')?.built ?? 0) === 1,
    `perPath=${JSON.stringify(perPath)}`,
  )
  check(
    'insights: transactions carry buildPath',
    (ins.transactions as { buildPath: string | null }[])?.some((x) => x.buildPath === 'native-swap-uniswap'),
  )

  const ekGone = await fetch(`${BASE}/api/embed-keys/${ek.id}?purge=1`, { method: 'DELETE', headers: C })
  const ekAfter = await (await fetch(`${BASE}/api/embed-keys`, { headers: C })).json()
  const insAfter = await (await fetch(`${BASE}/api/embeds/insights`, { headers: C })).json()
  check(
    'purge-revoke removes the key + its sites + its turns',
    ekGone.status === 200 &&
      !(ekAfter.keys as { key: string }[]).some((k) => k.key === ek.key) &&
      insAfter.totals?.turns === 0,
  )

  // ── Onboarding cohorts (admin-only) ───────────────────────────────────────
  // The recent-users progress view (/dashboard/users): per-wallet journey
  // milestones + funnel. Same gate as /api/admin/overview — the harness
  // wallets are never admins, so this only exercises the gate.
  console.log('— onboarding cohorts')
  const cohNoAuth = await fetch(`${BASE}/api/admin/cohorts`)
  check('cohorts: no auth → 401', cohNoAuth.status === 401)
  const cohNonAdmin = await fetch(`${BASE}/api/admin/cohorts?days=7&external=1`, { headers: C })
  check('cohorts: signed-in non-admin → 403', cohNonAdmin.status === 403)

  // ── Treasury (admin-only) ─────────────────────────────────────────────────
  // Fees-collected view (/dashboard/treasury): on-chain inflow + x402 ledger.
  // The harness wallets are never admins, so this only exercises the gate.
  console.log('— treasury')
  const treNoAuth = await fetch(`${BASE}/api/admin/treasury`)
  check('treasury: no auth → 401', treNoAuth.status === 401)
  const treNonAdmin = await fetch(`${BASE}/api/admin/treasury?days=90`, { headers: C })
  check('treasury: signed-in non-admin → 403', treNonAdmin.status === 403)

  // ── Ledger sync ───────────────────────────────────────────────────────────
  console.log('— ledger sync')
  const ledgerRes = await fetch(`${BASE}/api/grants/${grant.id}/ledger`, {
    method: 'POST',
    headers: BJ,
    body: JSON.stringify({
      host: 'https://a.example.test/v1/x',
      amountUsd: 0.01,
      ok: true,
      txHash: '0xtest',
      serviceName: 'Harness',
    }),
  })
  const entry = await ledgerRes.json()
  check('receipt synced, host normalized', ledgerRes.status === 201 && entry.host === 'a.example.test')

  const badLedger = await fetch(`${BASE}/api/grants/${grant.id}/ledger`, {
    method: 'POST',
    headers: BJ,
    body: JSON.stringify({ amountUsd: 1 }),
  })
  check('ledger rejects missing host', badLedger.status === 400)

  const crossLedger = await fetch(`${BASE}/api/grants/${grant.id}/ledger`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: mallorySession },
    body: JSON.stringify({ host: 'x.test', amountUsd: 0 }),
  })
  check("another wallet can't write the ledger (404)", crossLedger.status === 404)

  const detail = await (await fetch(`${BASE}/api/grants/${grant.id}`, { headers: C })).json()
  check(
    'grant read shows synced spend',
    detail.spentTodayUsd === 0.01 && detail.ledger.some((e: { id: string }) => e.id === entry.id),
  )

  // ── On-chain backing: Coinbase Spend Permission (slice 1) ─────────────────
  console.log('— spend permission')
  const spNoAuth = await fetch(`${BASE}/api/grants/${grant.id}/spend-permission`)
  check('spend-permission read requires auth (→ 401)', spNoAuth.status === 401)

  const sp = await (await fetch(`${BASE}/api/grants/${grant.id}/spend-permission`, { headers: C })).json()
  check(
    'spend-permission read: not backed yet, maps the per-day cap on-chain',
    sp.backed === false &&
      sp.spendPermissionId == null &&
      typeof sp.terms?.allowanceAtomic === 'string' &&
      BigInt(sp.terms.allowanceAtomic) === BigInt(Math.round(detail.perDayUsd * 1_000_000)) &&
      sp.terms.periodSeconds === 86_400 &&
      sp.terms.manager === '0xf85210B21cC50302F477BA56686d2019dC9b67Ad',
  )

  // POST creates a REAL on-chain permission when CDP is configured, so the
  // standing suite only exercises the gate (unauthed → 401) — it never triggers
  // a create. The live create is covered by scripts/verify-cdp-spend-permission.ts
  // (Base Sepolia, run manually). When CDP is unprovisioned the authed POST 503s
  // with the steps; we don't assert that here to avoid env-dependent flakiness.
  const spPostNoAuth = await fetch(`${BASE}/api/grants/${grant.id}/spend-permission`, { method: 'POST' })
  check('spend-permission create requires auth (→ 401)', spPostNoAuth.status === 401)

  // ── Connected agents (a key IS an agent: budget + attributed spend) ───────
  console.log('— connected agents')
  const selfRaise = await fetch(`${BASE}/api/keys/${minted.id}`, {
    method: 'PATCH',
    headers: BJ, // the agent's own key must NOT set its own budget
    body: JSON.stringify({ perDayUsd: 100 }),
  })
  check("agent can't raise its own budget (Bearer PATCH → 401)", selfRaise.status === 401)

  const badBudget = await fetch(`${BASE}/api/keys/${minted.id}`, {
    method: 'PATCH',
    headers: CJ,
    body: JSON.stringify({ perDayUsd: -1 }),
  })
  check('negative budget rejected', badBudget.status === 400)

  const setBudget = await fetch(`${BASE}/api/keys/${minted.id}`, {
    method: 'PATCH',
    headers: CJ,
    body: JSON.stringify({ perDayUsd: 0.05 }),
  })
  check('owner sets agent budget (SIWE)', setBudget.status === 200 && (await setBudget.json()).perDayUsd === 0.05)

  // The 0.01 receipt above arrived via Bearer — it must be attributed to the key.
  const agentRows = await (await fetch(`${BASE}/api/keys`, { headers: C })).json()
  const agentRow = agentRows.find((k: { id: string }) => k.id === minted.id)
  check(
    'key list carries budget + attributed spent-today',
    agentRow?.perDayUsd === 0.05 && agentRow?.spentTodayUsd === 0.01,
  )

  const anonPolicy = await fetch(`${BASE}/api/agent/policy`)
  check('policy endpoint without key → 401', anonPolicy.status === 401)

  const policyRes = await fetch(`${BASE}/api/agent/policy`, { headers: B })
  const policy = await policyRes.json()
  check(
    'agent policy: budget, spend, remaining, grant terms',
    policyRes.status === 200 &&
      policy.agent?.perDayUsd === 0.05 &&
      policy.agent?.spentTodayUsd === 0.01 &&
      Math.abs(policy.agent?.remainingTodayUsd - 0.04) < 1e-9 &&
      policy.agent?.overBudget === false &&
      policy.grant?.id === grant.id,
  )

  // Push the agent to its budget: the receipt response must flag overBudget so
  // the SDK knows to stop paying.
  const capSync = await fetch(`${BASE}/api/grants/${grant.id}/ledger`, {
    method: 'POST',
    headers: BJ,
    body: JSON.stringify({ host: 'agent.example.test', amountUsd: 0.04, ok: true, serviceName: 'Harness' }),
  })
  const capped = await capSync.json()
  check(
    'receipt sync reports agent budget status (overBudget at the cap)',
    capSync.status === 201 && capped.agent?.spentTodayUsd === 0.05 && capped.agent?.overBudget === true,
  )

  // ── Kill switch: reversible agent pause (Run 12) ─────────────────────────
  const bearerPause = await fetch(`${BASE}/api/keys/${minted.id}`, {
    method: 'PATCH',
    headers: BJ, // an agent must not be able to un/freeze itself
    body: JSON.stringify({ paused: true }),
  })
  check("agent can't pause itself (Bearer PATCH → 401)", bearerPause.status === 401)

  const pauseRes = await fetch(`${BASE}/api/keys/${minted.id}`, {
    method: 'PATCH',
    headers: CJ,
    body: JSON.stringify({ paused: true }),
  })
  check('owner pauses the agent (SIWE)', pauseRes.status === 200 && (await pauseRes.json()).paused === true)

  const pausedPolicy = await (await fetch(`${BASE}/api/agent/policy`, { headers: B })).json()
  check(
    'paused agent: policy halted=AGENT_PAUSED',
    pausedPolicy.halted === true && pausedPolicy.haltReason === 'AGENT_PAUSED' && pausedPolicy.agent?.paused === true,
  )

  const resumeRes = await fetch(`${BASE}/api/keys/${minted.id}`, {
    method: 'PATCH',
    headers: CJ,
    body: JSON.stringify({ paused: false }),
  })
  const resumedPolicy = await (await fetch(`${BASE}/api/agent/policy`, { headers: B })).json()
  check(
    'resume clears the halt (reversible — history intact)',
    resumeRes.status === 200 && resumedPolicy.halted === false && resumedPolicy.haltReason === null,
  )

  // The Overview tile's data: connected-agents count + top key by spend today.
  const statsRes = await fetch(`${BASE}/api/dashboard/stats`, { headers: C })
  const stats = await statsRes.json()
  check(
    'dashboard stats: connected-agents block (count + top-today attribution)',
    statsRes.status === 200 &&
      stats.agents?.connected === 1 &&
      stats.agents?.topToday?.label === 'test:api harness' &&
      stats.agents?.topToday?.spentTodayUsd === 0.05,
  )

  // Onboarding checklist signals (Get started card) — SIWE-only, and always
  // the five links-first booleans (mint → share → funnel → conversion →
  // claim). Values depend on what the harness wallet has done so far, so
  // assert shape + types, not specific ticks.
  const onboardNoAuth = await fetch(`${BASE}/api/dashboard/onboarding`)
  check('onboarding signals require auth → 401', onboardNoAuth.status === 401)
  const onboardRes = await fetch(`${BASE}/api/dashboard/onboarding`, { headers: C })
  const onboard = await onboardRes.json()
  check(
    'onboarding signals: minted/opened/connected/converted/claimed booleans',
    onboardRes.status === 200 &&
      ['minted', 'opened', 'connected', 'converted', 'claimed'].every((k) => typeof onboard[k] === 'boolean'),
  )

  // /pricing displays the creator rail (links-first: kickbacks are a selling
  // point, not a footnote) — the split and the per-plan link caps.
  const pricingRes = await fetch(`${BASE}/pricing`)
  const pricingHtml = await pricingRes.text()
  check(
    'pricing: creator kickback + active-link caps displayed',
    pricingRes.status === 200 &&
      /creator kickbacks/i.test(pricingHtml) &&
      pricingHtml.includes('3 active intent links') &&
      pricingHtml.includes('25 active intent links') &&
      pricingHtml.includes('Unlimited intent links'),
  )

  // Payees: the wallet's claimed MCP servers (dashboard Agents → My MCP servers).
  // SIWE-only; a fresh wallet has claimed nothing, so an empty array.
  const mineNoAuth = await fetch(`${BASE}/api/mcp/mine`)
  check('claimed servers (/api/mcp/mine) requires auth → 401', mineNoAuth.status === 401)
  const mineRes = await fetch(`${BASE}/api/mcp/mine`, { headers: C })
  const mine = await mineRes.json()
  check(
    'claimed servers: authed → array (empty for a fresh wallet)',
    mineRes.status === 200 && Array.isArray(mine) && mine.length === 0,
  )

  // Earn side: receipt ingestion (POST /api/mcp/receipts) + earnings rollup.
  const recNoAuth = await fetch(`${BASE}/api/mcp/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ mcp: 'yeetful-claude', amountUsd: 0.01 }),
  })
  check('earn receipts: no auth → 401', recNoAuth.status === 401)
  // The harness wallet hasn't claimed anything → can't report for any MCP.
  const recUnowned = await fetch(`${BASE}/api/mcp/receipts`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ mcp: 'yeetful-claude', amountUsd: 0.01 }),
  })
  check('earn receipts: reporting an MCP you do not own → 403/404', [403, 404].includes(recUnowned.status))
  const earnRes = await fetch(`${BASE}/api/dashboard/earnings`, { headers: C })
  const earn = await earnRes.json()
  check(
    'earnings rollup: authed → kpis shape (zero for a fresh wallet)',
    earnRes.status === 200 && earn.kpis?.callsServed === 0 && Array.isArray(earn.byMcp) && earn.series30d?.length === 30,
  )

  // ── Public activity feed (Run 7: anonymized network proof-of-life) ───────
  console.log('— public activity')
  // Seed a DENIAL receipt too — the public feed must aggregate it, not list it.
  const denialSync = await fetch(`${BASE}/api/grants/${grant.id}/ledger`, {
    method: 'POST',
    headers: BJ,
    body: JSON.stringify({
      host: 'denied.example.test',
      amountUsd: 0,
      ok: false,
      note: 'NOT_ALLOWED',
    }),
  })
  check('denial receipt synced for the P2 probe', denialSync.status === 201)

  const actRes = await fetch(`${BASE}/api/activity`)
  const actText = await actRes.text()
  const act = JSON.parse(actText) as {
    stats: { settledUsd: number; settledCalls: number; callsToday: number; blockedCalls: number; activeAccounts: number }
    daily: unknown[]
    top: { service: string }[]
    recent: { host: string; account: string; amountUsd: number }[]
  }
  check(
    'activity: public 200 with stats/daily/top/recent',
    actRes.status === 200 &&
      typeof act.stats?.settledUsd === 'number' &&
      typeof act.stats?.blockedCalls === 'number' &&
      Array.isArray(act.daily) && Array.isArray(act.top) && Array.isArray(act.recent),
  )
  check('activity: cache header set', /s-maxage/.test(actRes.headers.get('cache-control') ?? ''))

  const ours = act.recent.find((r) => r.host === 'a.example.test')
  check(
    'activity: settled receipt visible with truncated account',
    !!ours && /^0x[0-9a-fA-F]{4}…[0-9a-fA-F]{4}$/.test(ours.account),
  )
  // P1: the throwaway owner is a fresh random wallet — its full address
  // appearing ANYWHERE in the public payload would be an anonymization leak.
  check(
    'activity: P1 — full wallet address absent from public payload',
    !actText.toLowerCase().includes(owner.address.toLowerCase()),
  )
  check(
    'activity: P2 — denial rows absent from public feed (aggregate only)',
    !act.recent.some((r) => r.host === 'denied.example.test') && act.stats.blockedCalls >= 1,
  )

  // /activity page — the consolidated public money story (links-first: the
  // overview + the link-economy section + the live feed on one page).
  const actPageRes = await fetch(`${BASE}/activity`)
  const actPageHtml = await actPageRes.text()
  check(
    'activity: page renders the consolidated money story (hero + live feed)',
    actPageRes.status === 200 && /moving money\./.test(actPageHtml) && /Live routing/.test(actPageHtml),
  )

  // ── Attended vs standing (the falsifiable-test split, lib/value-origin) ──
  console.log('— attended vs standing split')
  const ovRes = await fetch(`${BASE}/api/activity/overview`)
  const ov = (await ovRes.json()) as {
    hero: {
      systemTotalUsd: number
      attendedUsd: number
      attendedCount: number
      standingUsd: number
      standingCount: number
      standing: { jobsUsd: number; guardianUsd: number; x402Usd: number }
    }
    series: { signedUsd: number; x402Usd: number; attendedUsd: number; standingUsd: number }[]
  }
  check(
    'overview: hero carries the attended/standing split',
    ovRes.status === 200 &&
      typeof ov.hero?.attendedUsd === 'number' &&
      typeof ov.hero?.standingUsd === 'number' &&
      typeof ov.hero?.standing?.jobsUsd === 'number' &&
      typeof ov.hero?.standing?.guardianUsd === 'number' &&
      typeof ov.hero?.standing?.x402Usd === 'number',
  )
  check(
    'overview: attended + standing = the system total (the split partitions THE number)',
    Math.abs(ov.hero.attendedUsd + ov.hero.standingUsd - ov.hero.systemTotalUsd) < 0.06,
    `attended=${ov.hero?.attendedUsd} standing=${ov.hero?.standingUsd} total=${ov.hero?.systemTotalUsd}`,
  )
  check(
    'overview: standing sublines sum to the standing lane',
    Math.abs(ov.hero.standing.jobsUsd + ov.hero.standing.guardianUsd + ov.hero.standing.x402Usd - ov.hero.standingUsd) < 0.06,
  )
  check(
    'overview: every series day carries attended/standing and they partition the day',
    ov.series.every(
      (d) =>
        typeof d.attendedUsd === 'number' &&
        typeof d.standingUsd === 'number' &&
        Math.abs(d.attendedUsd + d.standingUsd - (d.signedUsd + d.x402Usd)) < 0.06,
    ),
  )
  // The legacy classifier (rows from before origin_kind existed) — pure.
  check(
    'value-origin: job artifacts and native-job builds classify STANDING; chat/embed stay ATTENDED',
    classifyLegacyTurn({ artifact: 'job-step', embedKeyId: '' }) === 'job-step' &&
      classifyLegacyTurn({ artifact: 'job', embedKeyId: 'k1' }) === 'job-step' &&
      classifyLegacyTurn({ buildPath: 'native-job', embedKeyId: '' }) === 'job-step' &&
      classifyLegacyTurn({ artifact: 'tx', embedKeyId: 'k1' }) === 'embed' &&
      classifyLegacyTurn({ artifact: 'tx', embedKeyId: '' }) === 'chat',
  )
  check(
    'value-origin: the SQL mirror covers origin_kind AND the legacy fallback',
    STANDING_TURN_SQL.includes("origin_kind IN ('job-step','dca-run')") &&
      STANDING_TURN_SQL.includes('origin_kind IS NULL') &&
      STANDING_TURN_SQL.includes('native-job'),
  )
  // Internal-traffic classification: dev drives on localhost prod builds,
  // harness fixture origins, and this project's own Vercel previews must
  // never read as growth — while real third-party embed hosts (including
  // arbitrary *.vercel.app sites) must NEVER match. In the 7 days to
  // 2026-07-27, ~$62k of an ~$80k "money moved" week was localhost sessions.
  check(
    'value-origin: internal origins classify internal (localhost/ports, .test fixtures, own previews)',
    isInternalOrigin('http://localhost:3477') &&
      isInternalOrigin('http://localhost') &&
      isInternalOrigin('https://localhost:8443') &&
      isInternalOrigin('http://127.0.0.1:3000') &&
      isInternalOrigin('https://harness-embed.test') &&
      isInternalOrigin('http://app.localhost:3000') &&
      isInternalOrigin('https://website-git-feat-intent-link-onward-paths-nate-4683s-projects.vercel.app'),
  )
  check(
    'value-origin: real traffic never classifies internal (prod, third-party hosts, foreign vercel.app)',
    !isInternalOrigin('https://www.yeetful.com') &&
      !isInternalOrigin('https://yeetful.com') &&
      !isInternalOrigin('https://app.uniswap.org') &&
      !isInternalOrigin('https://someones-dapp.vercel.app') &&
      !isInternalOrigin('https://localhosting.io') &&
      !isInternalOrigin('https://my.test-app.com') &&
      !isInternalOrigin(null) &&
      !isInternalOrigin('not a url'),
  )
  check(
    'value-origin: the internal-origin SQL mirror names all three families',
    INTERNAL_ORIGIN_SQL.includes('localhost') &&
      INTERNAL_ORIGIN_SQL.includes('test|localhost|local|example|invalid') &&
      INTERNAL_ORIGIN_SQL.includes('vercel\\.app'),
  )

  // ── Route metrics (B14: observable routing telemetry, aggregate + public) ──
  console.log('— route metrics')
  const rmRes = await fetch(`${BASE}/api/route/metrics`)
  const rmText = await rmRes.text()
  const rm = JSON.parse(rmText) as {
    turns: number; avgCostUsd: number; totalSavedUsd: number; cacheHitRate: number
    avgShortlisted: number; blockedRate: number; latencyMs: { p50: number; p95: number }
    services: { service: string; settleRate: number }[]
  }
  check(
    'route metrics: 200 with the aggregate shape',
    rmRes.status === 200 &&
      typeof rm.turns === 'number' &&
      typeof rm.avgCostUsd === 'number' &&
      typeof rm.totalSavedUsd === 'number' &&
      typeof rm.cacheHitRate === 'number' &&
      typeof rm.latencyMs?.p50 === 'number' &&
      typeof rm.latencyMs?.p95 === 'number' &&
      Array.isArray(rm.services),
  )
  check('route metrics: cache header set', /s-maxage/.test(rmRes.headers.get('cache-control') ?? ''))
  check('route metrics: P1 — no full wallet address in the payload', !rmText.toLowerCase().includes(owner.address.toLowerCase()))

  // B18 — public MCP reputation enriches the directory (shape-safe; reputation
  // only appears for services with ledger history).
  const dir = (await (await fetch(`${BASE}/api/servers`)).json()) as { name: string; reputation?: { settled: number; failed: number; settleRate: number } }[]
  check('directory: /api/servers returns the server list', Array.isArray(dir) && dir.length > 0)
  check(
    'directory: reputation (when present) is well-formed',
    dir.every((s) => !s.reputation || (typeof s.reputation.settled === 'number' && s.reputation.settleRate >= 0 && s.reputation.settleRate <= 1)),
  )

  // ── Featured ("start here") endpoints ──────────────────────────────────────
  // The curated routing signal: mcp_endpoints.featured is set by the add-MCP
  // modal (featuredTools) or the admin star on /servers/[slug]; the planner
  // floats them as starting hints and the connect-time quick view pings them
  // first. Directory rows with ≥1 featured endpoint surface splashReady.
  console.log('— featured endpoints')
  {
    const dirF = dir as unknown as { slug?: string; splashReady?: boolean }[]
    // The fleet seed (scripts/seed-featured-endpoints.ts) flags cow-free's
    // portfolio — the flag should surface through the catalog as splashReady.
    const cow = dirF.find((s) => s.slug === 'cow-free')
    check('featured: cow-free is splashReady via its featured endpoints', !cow || cow.splashReady === true, cow ? '' : 'cow-free not in directory (skipped)')
    // Admin curation is gated: no session → 401.
    const anonStar = await fetch(`${BASE}/api/servers/cow-free/featured`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpointId: 'x', featured: true }),
    })
    check('featured: PATCH without session → 401', anonStar.status === 401)
    // A signed-in non-admin wallet → 403 (the test wallets are never admins).
    const nonAdminStar = await fetch(`${BASE}/api/servers/cow-free/featured`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', cookie: session },
      body: JSON.stringify({ endpointId: 'x', featured: true }),
    })
    check('featured: PATCH as non-admin → 403', nonAdminStar.status === 403)
  }

  // ── Switchboard route preview (public, read-only, no spend) ───────────────
  // Guards the routing lever the /switchboard "try a route" demo renders: the
  // contract shape, the $0.05 ceiling, and the proven-gate invariant — the pick
  // is the cheapest PROVEN route (so the demo never "picks" a probe-dead one).
  console.log('— switchboard route preview')
  const rpRes = await fetch(`${BASE}/api/route/preview`)
  const rp = await rpRes.json()
  check(
    'route/preview: 200 with cap + categories[]',
    rpRes.status === 200 && rp.cap === 0.05 && Array.isArray(rp.categories),
  )
  check('route/preview: cache header set', /s-maxage/.test(rpRes.headers.get('cache-control') ?? ''))

  type RPCall = { method: string; url: string; params: unknown[] }
  type RPCand = { slug: string; service: string; price: number; proven: number; call: RPCall }
  type RPCat = { category: string; candidates: RPCand[]; pick: string; pickProven: boolean; saved: number }
  const cats: RPCat[] = Array.isArray(rp.categories) ? rp.categories : []
  // Real catalog should expose at least one plannable category against Neon.
  check('route/preview: at least one plannable category', cats.length > 0, `${cats.length} categories`)

  const inRange = (c: RPCat) => c.candidates.every((x) => x.price > 0 && x.price <= rp.cap)
  const pickValid = (c: RPCat) => c.candidates.some((x) => x.slug === c.pick)
  const provenGated = (c: RPCat) => {
    const pick = c.candidates.find((x) => x.slug === c.pick)
    if (!pick) return false
    const pool = c.candidates.some((x) => x.proven > 0) ? c.candidates.filter((x) => x.proven > 0) : c.candidates
    const cheapestInPool = Math.min(...pool.map((x) => x.price))
    // pickProven must reflect reality; the pick must be the cheapest of the pool
    // it was drawn from; and if any proven route exists, the pick must be proven.
    return (
      c.pickProven === pick.proven > 0 &&
      pick.price === cheapestInPool &&
      c.pickProven === c.candidates.some((x) => x.proven > 0)
    )
    // (relational > binds tighter than ===, so the first line reads as
    //  c.pickProven === (pick.proven > 0) — the pick's own proven flag matches)
  }
  const hasCall = (c: RPCat) =>
    c.candidates.every(
      (x) =>
        x.call &&
        typeof x.call.method === 'string' &&
        /^https?:\/\//.test(x.call.url) &&
        Array.isArray(x.call.params),
    )
  if (cats.length > 0) {
    check('route/preview: every candidate price in (0, cap]', cats.every(inRange))
    check('route/preview: pick is always one of the candidates', cats.every(pickValid))
    check('route/preview: proven-gate — pick is the cheapest proven route', cats.every(provenGated))
    check('route/preview: every candidate carries its call (method + url + params)', cats.every(hasCall))
  }

  // ── Router (flagship) page SEO (the routing engine must be indexable) ─────
  // Switchboard → Router (PR #171): the routing engine IS the landing page (`/`).
  // `/router` is the brand slug that permanent-redirects to it, so the canonical
  // + the sitemap entry are the site root, not a `/router` path.
  console.log('— router SEO')
  const routerRedirect = await fetch(`${BASE}/router`, { redirect: 'manual' })
  const routerLoc = routerRedirect.headers.get('location') ?? ''
  check(
    'router: /router redirects to the home flagship',
    routerRedirect.status >= 300 &&
      routerRedirect.status < 400 &&
      new URL(routerLoc, BASE).pathname === '/',
  )
  const homeHtml = flat(await (await fetch(`${BASE}/`)).text())
  check(
    'router: canonical → site root',
    /<link[^>]+rel="canonical"[^>]+href="https?:\/\/[^"/]+\/?"/.test(homeHtml),
  )
  check('router: og:image present (social card)', /<meta[^>]+property="og:image"/.test(homeHtml))
  // The links-first repositioning (2026-07-22, HANDOFF-links-first.md) leads
  // with the intent claim: "You have an intent. We do the rest." Retitle and
  // re-pin TOGETHER — this check is the pin.
  check(
    'home: descriptive <title> (the links-first claim)',
    /<title>[^<]*(You have an intent|[Ww]e do the rest|intent link)[^<]*<\/title>/.test(homeHtml),
  )
  const sitemapXml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  check('sitemap: site root is listed', /<loc>https?:\/\/[^</]+\/?<\/loc>/.test(sitemapXml))

  // ── /sign — the agent → human handoff seam ────────────────────────────────
  // External agents mint /sign?ask=<sentence> links; the page must render the
  // ask inert, hand into /chat?prompt= (prefill, never auto-send), and never
  // execute anything a link smuggles in. The URL carries a sentence — the
  // guarded native layers rebuild it from scratch on the other side.
  console.log('— sign handoff')
  {
    const signHtml = await (await fetch(`${BASE}/sign?ask=${encodeURIComponent('Buy $12 of AAPL')}&mcps=robinhood-free`)).text()
    check('sign: renders the ask', signHtml.includes('Buy $12 of AAPL'))
    check(
      'sign: hands into /chat with the ask prefilled + mcps',
      // href attributes entity-encode & as &amp; in rendered HTML
      signHtml.includes(`/chat?mcps=robinhood-free&amp;prompt=Buy%20%2412%20of%20AAPL`),
    )
    check('sign: states the only-signer contract', /only thing that can sign/i.test(signHtml))
    const hostile = await (
      await fetch(`${BASE}/sign?ask=${encodeURIComponent('<script>alert(1)</script> send to 0xdead')}&mcps=${encodeURIComponent('EVIL SLUG,robinhood-free')}`)
    ).text()
    check('sign: hostile ask renders inert (no raw <script>)', !hostile.includes('<script>alert(1)</script>'))
    // The RSC flight payload echoes raw searchParams as inert JSON — what
    // matters is the LINK: malformed slugs must never reach the /chat href.
    const hostileHref = hostile.match(/href="\/chat\?[^"]*"/)?.[0] ?? ''
    check('sign: malformed mcps slugs dropped from the handoff href, valid kept', !hostileHref.includes('EVIL') && hostileHref.includes('mcps=robinhood-free'))
    const bare = await fetch(`${BASE}/sign`)
    check('sign: bare visit 200s with the empty state', bare.status === 200 && /Nothing to review/.test(await bare.text()))
  }

  // ── Intent links — mint, funnel events, runtime page ─────────────────────
  // A link carries an ASK as a sentence; the runtime rebuilds it through the
  // guarded layers. Minting is SIWE-gated; events are best-effort public;
  // redirects are validated https AT MINT and never read from the runtime URL.
  console.log('— intent links')
  {
    // Self-healing preamble: revoke every link mallory holds from prior runs
    // so the plan cap (free = 3 active) never trips the standing checks.
    const pre = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })
    if (pre.status === 200) {
      const held = ((await pre.json()) as { links?: Array<{ slug: string }> }).links ?? []
      await Promise.all(held.map((l) => fetch(`${BASE}/api/intent-links/${l.slug}`, { method: 'DELETE', headers: { cookie: mallorySession } })))
    }

    const noAuth = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ ask: 'Buy $12 of AAPL' }),
    })
    check('intent links: mint without session → 401', noAuth.status === 401)

    const badRedirect = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: mallorySession },
      body: JSON.stringify({ ask: 'Buy $12 of AAPL', redirectUrl: 'http://evil.test/back' }),
    })
    check('intent links: non-https redirect refused at mint (400)', badRedirect.status === 400)

    const mintRes = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: mallorySession },
      body: JSON.stringify({ ask: 'Buy $12 of AAPL', redirectUrl: 'https://example.com/thanks' }),
    })
    const minted = (await mintRes.json()) as { slug?: string; mcps?: string }
    check('intent links: mint returns a slug + composed mcps', mintRes.status === 200 && !!minted.slug && (minted.mcps ?? '').includes('robinhood-free'))

    const slug = minted.slug ?? 'missing'
    const evOk = await fetch(`${BASE}/api/intent-links/${slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'open' }),
    })
    check('intent links: open event accepted unauthenticated', evOk.status === 200)
    const evBad = await fetch(`${BASE}/api/intent-links/${slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'exfiltrate' }),
    })
    check('intent links: unknown event kind → 400', evBad.status === 400)
    const evGhost = await fetch(`${BASE}/api/intent-links/zzzz9999/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'open' }),
    })
    check('intent links: events for an unknown slug → 404', evGhost.status === 404)

    const list = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })
    const listBody = (await list.json()) as { links: Array<{ slug: string; funnel: { open: number } }> }
    const row = listBody.links?.find((l) => l.slug === slug)
    check('intent links: creator list shows the link with its funnel', !!row && row.funnel.open >= 1)

    const page = await fetch(`${BASE}/i/${slug}`)
    const pageHtml = await page.text()
    check('intent links: /i runtime renders the ask + consent button', page.status === 200 && pageHtml.includes('Buy $12 of AAPL') && /Connect (&amp;|&) build/.test(pageHtml))
    // Simple-mode shell: /i is a focused full-screen landing — the brochure
    // top nav must not render on it (Navigation returns null on /i/).
    check('intent links: /i page carries no brochure nav', !pageHtml.includes('nav__tab'))
    const ghostPage = await fetch(`${BASE}/i/zzzz9999`)
    check('intent links: /i unknown slug → 404', ghostPage.status === 404)

    // Creator-chosen MCPs win when valid; junk falls back to the composer.
    const manualMint = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: mallorySession },
      body: JSON.stringify({ ask: 'Stake some ETH for me', mcps: ['lido-free', 'not-a-real-mcp'] }),
    })
    const manual = (await manualMint.json()) as { mcps?: string }
    check('intent links: manual MCP pick honored, junk slugs dropped', manualMint.status === 200 && manual.mcps === 'lido-free')

    const og = await fetch(`${BASE}/i/${slug}/opengraph-image`)
    check('intent links: OG card renders as a PNG', og.status === 200 && (og.headers.get('content-type') ?? '').includes('image/png'))

    // ── Creator fee-split (the ledgered rail) ─────────────────────────────
    // Server-truth earnings: a signed FEE-BEARING turn attributed to the
    // link accrues half the 20bps fee; a signed NON-fee-bearing turn (an
    // NFT transfer — "sell my NFT" money) moves $ but earns $0. The rule:
    // conversions pay, movements and inflows never do.
    const M = { 'content-type': 'application/json', cookie: mallorySession }
    const turn = (over: Record<string, unknown>) =>
      fetch(`${BASE}/api/embed/telemetry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstParty: true,
          sessionId: `harness-ilink-${Date.now()}`,
          page: `${BASE}/i/${slug}`,
          outcome: 'signed',
          artifact: 'tx',
          valueUsd: 100,
          intentLinkSlug: slug,
          ...over,
        }),
      })
    await turn({ buildPath: 'native-swap-uniswap' }) // fee-bearing: earns $0.10
    await turn({ buildPath: 'native-nft-transfer', valueUsd: 500 }) // moves $500, earns $0
    const after = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })
    const afterBody = (await after.json()) as {
      links: Array<{ slug: string; signedUsd: number; feeBearingUsd: number; earnedUsd: number }>
      earnings: {
        totalEarnedUsd: number
        totalSignedUsd: number
        totalFeeBearingUsd: number
        claimableUsd: number
      }
    }
    const mine = afterBody.links.find((l) => l.slug === slug)
    check(
      'intent links: fee-bearing signed turn accrues half the 20bps fee',
      !!mine && Math.abs(mine.earnedUsd - 0.1) < 0.001,
    )
    check(
      'intent links: NFT/transfer $ counts as moved but NEVER as earnings',
      !!mine && mine.signedUsd >= 600 && Math.abs(mine.earnedUsd - 0.1) < 0.001,
    )
    // A zero must be able to explain itself: the fee-bearing base rides along
    // so the UI can say "fee-free route" instead of showing a bare $0.00.
    check(
      'intent links: the fee-bearing base ships alongside moved $ (per link + total)',
      !!mine &&
        Math.abs(mine.feeBearingUsd - 100) < 0.001 &&
        afterBody.earnings.totalSignedUsd >= 600 &&
        afterBody.earnings.totalFeeBearingUsd >= 100,
    )
    // Sub-cent display: half of 20bps on a $1 test swap is $0.001 — two
    // decimals would render the tester's own proof-of-life as "$0.00".
    check(
      'intent links: sub-cent earnings render the tiny bits, not $0.00',
      formatEarnedUsd(0) === '$0.00' &&
        formatEarnedUsd(0.001) === '$0.001' &&
        formatEarnedUsd(0.0025) === '$0.0025' &&
        formatEarnedUsd(0.00001) === '<$0.0001' &&
        formatEarnedUsd(0.1) === '$0.10' &&
        formatEarnedUsd(12.345) === '$12.35',
    )
    const claim = await fetch(`${BASE}/api/intent-links/claims`, { method: 'POST', headers: M })
    check('intent links: claim below the $10 floor refused (400)', claim.status === 400)

    // The fee-split disclosure renders on creator-minted /i pages.
    const iPage = await (await fetch(`${BASE}/i/${slug}`)).text()
    check('intent links: /i discloses the creator fee split', /earns half of Yeetful/.test(iPage))

    // Plan cap: free carries 3 active links; this run minted 2, so one more
    // fits and the 4th refuses with the upgrade pointer.
    const third = await fetch(`${BASE}/api/intent-links`, { method: 'POST', headers: M, body: JSON.stringify({ ask: 'Swap $5 of ETH to USDC' }) })
    const fourth = await fetch(`${BASE}/api/intent-links`, { method: 'POST', headers: M, body: JSON.stringify({ ask: 'DCA $25 into ETH weekly' }) })
    check('intent links: free plan carries 3 active links; the 4th mint → 402 + upgrade pointer', third.status === 200 && fourth.status === 402)

    // Admin wallets mint uncapped on EVERY plan; external creators keep the
    // plan ladder (the pure gate the mint route routes every mint through).
    check(
      'intent links: admin wallets are cap-exempt on every plan',
      activeLinkCapFor('free', true) === Infinity && activeLinkCapFor('growth', true) === Infinity && activeLinkCapFor('unknown-plan', true) === Infinity,
    )
    check(
      'intent links: non-admin caps hold — free 3, growth 25, scale ∞, unknown falls back to 3',
      activeLinkCapFor('free', false) === 3 && activeLinkCapFor('growth', false) === 25 && activeLinkCapFor('scale', false) === Infinity && activeLinkCapFor('unknown-plan', false) === 3,
    )

    // Revoke frees capacity — the cap counts ACTIVE links only.
    const thirdSlug = ((await third.json()) as { slug?: string }).slug
    const revoke = await fetch(`${BASE}/api/intent-links/${thirdSlug}`, { method: 'DELETE', headers: { cookie: mallorySession } })
    const fifth = await fetch(`${BASE}/api/intent-links`, { method: 'POST', headers: M, body: JSON.stringify({ ask: 'DCA $25 into ETH weekly' }) })
    check('intent links: revoke frees capacity (next mint 200) and needs auth', revoke.status === 200 && fifth.status === 200)
    const strangerRevoke = await fetch(`${BASE}/api/intent-links/${slug}`, { method: 'DELETE' })
    check('intent links: revoking without a session → 401', strangerRevoke.status === 401)

    // The public leaderboard: server-truth board, mint CTA, no wallets.
    const board = await fetch(`${BASE}/links`)
    const boardHtml = await board.text()
    check('intent links: /links leaderboard renders with the mint CTA', board.status === 200 && /Mint yours/.test(boardHtml) && /dollars moved/i.test(boardHtml))
    check('intent links: leaderboard never leaks a wallet address', !/0x[0-9a-fA-F]{40}/.test(boardHtml))
    check('intent links: leaderboard links to the host button generator', boardHtml.includes('/links/embed'))
    // Tabs: finished flows (claims) is the default rank; dollars is the
    // second tab; recently minted lists the newest live links. They render
    // only when the board has real rows — with harness turns excluded the
    // board may legitimately be empty.
    check(
      'intent links: board tabs (Most claimed + Dollars moved + Recently minted) or the honest empty state',
      (/Most claimed/.test(boardHtml) && /Dollars moved/.test(boardHtml) && /Recently minted/.test(boardHtml)) ||
        /The board is empty/.test(boardHtml),
    )
    // The recent tab reads MINTS (not turns), so this run's freshly minted
    // active links must reach the page data with no sign required.
    check('intent links: recently-minted tab surfaces a fresh mint pre-sign', boardHtml.includes('Stake some ETH for me'))
    // The fake $600 this section signed above must NEVER rank the public
    // board — harness- sessions are excluded server-side.
    check('intent links: harness turns never rank the public board', !boardHtml.includes(`/i/${slug}`))

    // The host button generator: a public page whose form mints through the
    // same gated door; the emitted snippet is a plain <a> — the button IS an
    // intent link, so consent + redirect invariants ride along untouched.
    const genPage = await fetch(`${BASE}/links/embed`)
    const genHtml = await genPage.text()
    check(
      'intent links: /links/embed generator renders (form + return-URL field)',
      genPage.status === 200 && genHtml.includes('A button on your site that moves money.') && genHtml.includes('Return URL after signing'),
    )
    // Free one cap slot first — the cap tests above left this wallet at 3/3.
    await fetch(`${BASE}/api/intent-links/${slug}`, { method: 'DELETE', headers: { cookie: mallorySession } })
    const redirectMint = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: mallorySession },
      body: JSON.stringify({ ask: 'Buy $10 of AAPL on ours', redirectUrl: 'https://example-host.com/thanks' }),
    })
    const redirected = (await redirectMint.json()) as { slug?: string; redirectUrl?: string | null }
    check(
      'intent links: mint with a valid https redirect stores + echoes it',
      redirectMint.status === 200 && redirected.redirectUrl === 'https://example-host.com/thanks',
    )

    // ── Creator storefronts (/l/<handle>) — opt-in public pages ──────────
    // The privacy contract: a wallet is never the key to a public page;
    // only a claimed handle is, and releasing it kills the page.
    const hNoAuth = await fetch(`${BASE}/api/intent-links/handle`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ handle: 'harness-store' }),
    })
    check('storefront: claim without session → 401', hNoAuth.status === 401)
    const hBad = await fetch(`${BASE}/api/intent-links/handle`, { method: 'POST', headers: M, body: JSON.stringify({ handle: 'dashboard' }) })
    const hBad2 = await fetch(`${BASE}/api/intent-links/handle`, { method: 'POST', headers: M, body: JSON.stringify({ handle: 'x' }) })
    check('storefront: reserved + malformed handles refused (400)', hBad.status === 400 && hBad2.status === 400)
    const hClaim = await fetch(`${BASE}/api/intent-links/handle`, { method: 'POST', headers: M, body: JSON.stringify({ handle: 'Harness-Store' }) })
    check('storefront: claim normalizes + returns the page url', hClaim.status === 200 && ((await hClaim.json()) as { url?: string }).url === '/l/harness-store')
    const hSteal = await fetch(`${BASE}/api/intent-links/handle`, { method: 'POST', headers: CJ, body: JSON.stringify({ handle: 'harness-store' }) })
    const hStealBody = (await hSteal.json()) as { url?: string }
    check(
      'storefront: a taken handle refuses (409) and points at the live page',
      hSteal.status === 409 && hStealBody.url === '/l/harness-store',
    )
    // Claimed pages are LISTED — /links shows every /l/<handle> storefront,
    // so a page stays findable after the claim.
    const listedHtml = flat(await (await fetch(`${BASE}/links`)).text())
    check(
      'storefront: /links lists the claimed page under Creator pages',
      listedHtml.includes('Creator pages') && listedHtml.includes('/l/harness-store') && listedHtml.includes('@harness-store'),
    )
    const storeHtml = flat(await (await fetch(`${BASE}/l/harness-store`)).text())
    check(
      "storefront: /l page lists the creator's active links",
      storeHtml.includes('@harness-store') && storeHtml.includes('DCA $25 into ETH weekly'),
    )
    check('storefront: /l never prints the wallet', !storeHtml.toLowerCase().includes(mallory.address.toLowerCase()))
    const ghostStore = await fetch(`${BASE}/l/never-claimed-xyz`)
    check('storefront: unknown handle → 404', ghostStore.status === 404)

    // ── White-label brand (one pasted URL → logo + accent on the /l page) ──
    // Pure gates first: the SSRF fence and the HTML parser are what keep a
    // creator-supplied URL from becoming a server-side probe.
    check(
      'brand: validateBrandUrl refuses http / IPs / localhost / internal / ports, accepts a public https site',
      !validateBrandUrl('http://example.com').ok &&
        !validateBrandUrl('https://192.168.1.7').ok &&
        !validateBrandUrl('https://localhost').ok &&
        !validateBrandUrl('https://staging.internal').ok &&
        !validateBrandUrl('https://example.com:8443').ok &&
        validateBrandUrl('https://example.com').ok,
    )
    const brandFixture = `<html><head>
      <meta property="og:site_name" content="Acme Corp">
      <meta name="theme-color" content="#6633cc">
      <meta property="og:image" content="https://acme.example/social-card.png">
      <link rel="icon" href="/favicon-32.png" sizes="32x32">
      <link rel="apple-touch-icon" href="/apple-180.png" sizes="180x180">
      <link rel="manifest" href="/manifest.json">
    </head></html>`
    const brandSig = parseBrandHtml(brandFixture, 'https://acme.example/')
    check(
      'brand: parseBrandHtml reads name + theme-color + manifest and ranks apple-touch-icon > icon > favicon > og:image',
      brandSig.siteName === 'Acme Corp' &&
        brandSig.themeColor === '#6633cc' &&
        brandSig.manifestHref === 'https://acme.example/manifest.json' &&
        brandSig.logoCandidates[0] === 'https://acme.example/apple-180.png' &&
        brandSig.logoCandidates[1] === 'https://acme.example/favicon-32.png' &&
        brandSig.logoCandidates[2] === 'https://acme.example/favicon.ico' &&
        brandSig.logoCandidates[3] === 'https://acme.example/social-card.png',
    )
    check(
      'brand: normalizeAccent expands #rgb and refuses near-white/near-black (backgrounds are not accents)',
      normalizeAccent('#6633cc') === '#6633cc' &&
        normalizeAccent('ABC') === '#aabbcc' &&
        normalizeAccent('#ffffff') === null &&
        normalizeAccent('#000') === null &&
        normalizeAccent('purple') === null,
    )
    check(
      'brand: normalizeBg takes any hex (white/black backgrounds are legitimate) and hexLuminance orders dark < light',
      normalizeBg('#052b65') === '#052b65' &&
        normalizeBg('fff') === '#ffffff' &&
        normalizeBg('navy') === null &&
        (hexLuminance('#052b65') ?? 1) < 0.2 &&
        (hexLuminance('#ffffff') ?? 0) > 0.9,
    )
    // Contrast on a hyper-saturated light brand (Robinhood's #ccff00 with
    // the #526700 accent its own logo yields): the CTA must not fill with a
    // shade of the background, the bloom must not darken the page, and the
    // cards must clear the field.
    const rh = { domain: 'robinhood.com', name: 'Robinhood', logo: null, accent: '#526700', bg: '#ccff00' }
    const cow = { domain: 'cow.fi', name: 'CoW', logo: null, accent: '#012f7a', bg: '#65d9ff' }
    const navy = { domain: 'a.example', name: 'A', logo: null, accent: '#6633cc', bg: '#052b65' }
    const rhCta = brandCtaStyle(rh) as { background?: string; color?: string } | undefined
    const cowCta = brandCtaStyle(cow) as { background?: string; color?: string } | undefined
    check(
      'brand: a same-hue accent is shading, not a second color — the CTA falls to the ink pole (Robinhood black), a genuinely different brand color keeps its fill (CoW navy)',
      rhCta?.background === '#0c0e12' &&
        rhCta?.color === '#f6f8fa' &&
        cowCta?.background === '#012f7a' &&
        cowCta?.color === '#f6f8fa',
    )
    check(
      'brand: the splash bloom only ever lifts — white over a light brand, the accent when it is the brighter color',
      brandBloomTint(rh).includes('#ffffff') &&
        brandBloomTint(navy).includes('var(--accent)') &&
        brandBloomTint(null).includes('var(--accent)'),
    )
    const rhTheme = brandThemeStyle(rh) as Record<string, string> | undefined
    const navyTheme = brandThemeStyle(navy) as Record<string, string> | undefined
    check(
      'brand: light-brand surfaces pull hard toward white (cards clear a saturated field); dark brands keep the subtle lift',
      rhTheme?.['--surf-1'] === 'color-mix(in srgb, #ffffff 84%, #ccff00)' &&
        rhTheme?.['--surf-2'] === 'color-mix(in srgb, #ffffff 93%, #ccff00)' &&
        navyTheme?.['--surf-1'] === 'color-mix(in srgb, #ffffff 9%, #052b65)',
    )
    // API gates: owner-only, a claimed handle required, hostile URLs die at
    // the gate. (The live-scan happy path needs the open internet, so it
    // stays out of the harness — the accent PATCH proves the storage+render
    // loop end-to-end without it.)
    const bNoAuth = await fetch(`${BASE}/api/intent-links/brand`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ url: 'https://example.com' }),
    })
    check('brand: scan without session → 401', bNoAuth.status === 401)
    const bNoHandle = await fetch(`${BASE}/api/intent-links/brand`, { method: 'PATCH', headers: CJ, body: JSON.stringify({ accent: '#6633cc' }) })
    check('brand: branding without a claimed handle → 409', bNoHandle.status === 409)
    const bBadUrl = await fetch(`${BASE}/api/intent-links/brand`, { method: 'POST', headers: M, body: JSON.stringify({ url: 'https://localhost/x' }) })
    check('brand: a non-public URL refuses at the gate (400, never fetched)', bBadUrl.status === 400)
    const bAccent = await fetch(`${BASE}/api/intent-links/brand`, { method: 'PATCH', headers: M, body: JSON.stringify({ accent: '#6633cc' }) })
    const bAccentBad = await fetch(`${BASE}/api/intent-links/brand`, { method: 'PATCH', headers: M, body: JSON.stringify({ accent: '#ffffff' }) })
    check('brand: accent PATCH validates (#6633cc lands, near-white refused)', bAccent.status === 200 && bAccentBad.status === 400)
    const brandedHtml = flat(await (await fetch(`${BASE}/l/harness-store`)).text())
    check(
      'brand: the /l page wears the accent and keeps the Powered by Yeetful mark',
      brandedHtml.includes('--accent:#6633cc') && brandedHtml.includes('Powered by'),
    )
    // Background: the page re-themes wholesale — dark bg derives near-white
    // text, and the earlier purple accent sits too close to navy in
    // luminance, so the contrast guard swaps it for the derived fg.
    const bBg = await fetch(`${BASE}/api/intent-links/brand`, { method: 'PATCH', headers: M, body: JSON.stringify({ bg: '#052b65' }) })
    const bBgBad = await fetch(`${BASE}/api/intent-links/brand`, { method: 'PATCH', headers: M, body: JSON.stringify({ bg: 'zebra' }) })
    check('brand: bg PATCH validates (#052b65 lands, junk refused)', bBg.status === 200 && bBgBad.status === 400)
    const bgHtml = flat(await (await fetch(`${BASE}/l/harness-store`)).text())
    check(
      'brand: a dark bg re-themes the page (navy bg, derived near-white fg, low-contrast accent guarded to fg)',
      bgHtml.includes('--bg:#052b65') && bgHtml.includes('--fg:#f4f6f8') && bgHtml.includes('--accent:#f4f6f8'),
    )
    // Full-bleed: .x-main is width-capped, so the brand bg paints past its
    // box via the box-shadow spread + clip-path trick — edge to edge, no
    // horizontal scrollbar, no layout change.
    check(
      'brand: the /l background runs full-bleed past the x-main gutters',
      bgHtml.includes('box-shadow:0 0 0 100vmax #052b65') && bgHtml.includes('clip-path:inset(0 -100vmax)'),
    )
    check('brand: the /l page carries the tweet-this-page share link', bgHtml.includes('twitter.com/intent/tweet'))
    // The creator's brand rides onto their /i splash pages too (bg + accent
    // scoped to the splash) — house links (creator=null) stay pure Yeetful.
    const brandedIPage = redirected.slug ? flat(await (await fetch(`${BASE}/i/${redirected.slug}`)).text()) : ''
    check('brand: the creator brand re-themes their /i splash (bg carried)', brandedIPage.includes('--bg:#052b65'))
    const houseIPage = flat(await (await fetch(`${BASE}/i/buy-aapl`)).text())
    check('brand: house links stay pure Yeetful (no brand bg on their /i splash)', !houseIPage.includes('--bg:#'))
    const bClear = await fetch(`${BASE}/api/intent-links/brand`, { method: 'DELETE', headers: { cookie: mallorySession } })
    const unbrandedHtml = flat(await (await fetch(`${BASE}/l/harness-store`)).text())
    check(
      'brand: remove restores the default page (accent + bg gone, Powered by and the share link stay)',
      bClear.status === 200 &&
        !unbrandedHtml.includes('--accent:#6633cc') &&
        !unbrandedHtml.includes('--bg:#052b65') &&
        unbrandedHtml.includes('Powered by') &&
        unbrandedHtml.includes('twitter.com/intent/tweet'),
    )

    const hRename = await fetch(`${BASE}/api/intent-links/handle`, { method: 'POST', headers: M, body: JSON.stringify({ handle: 'harness-store-2' }) })
    const oldGone = await fetch(`${BASE}/l/harness-store`)
    check('storefront: rename frees the old handle (old page 404)', hRename.status === 200 && oldGone.status === 404)
    const hDrop = await fetch(`${BASE}/api/intent-links/handle`, { method: 'DELETE', headers: { cookie: mallorySession } })
    const droppedGone = await fetch(`${BASE}/l/harness-store-2`)
    check('storefront: release drops the page', hDrop.status === 200 && droppedGone.status === 404)

    // The agent door: a Bearer yf_ key mints as its OWNER (SIWE-less) — the
    // hands MCP's mint_intent_link (free-mcps#22) rides exactly this seam.
    // The creator on record is the key owner (the agent's operator), so
    // caps/funnels/earnings land on a human's dashboard.
    const bearerMint = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: BJ,
      body: JSON.stringify({ ask: 'Buy $5 of AAPL, planned by my agent' }),
    })
    const bearerLink = (await bearerMint.json()) as { slug?: string }
    check('intent links: a Bearer yf_ key mints as its owner (the agent door)', bearerMint.status === 200 && !!bearerLink.slug)
    const bearerList = await fetch(`${BASE}/api/intent-links`, { headers: B })
    const bearerRows = ((await bearerList.json()) as { links?: Array<{ slug: string }> }).links ?? []
    check('intent links: the bearer-minted link lists under the key owner', bearerRows.some((l) => l.slug === bearerLink.slug))
    const bearerRevoke = await fetch(`${BASE}/api/intent-links/${bearerLink.slug}`, { method: 'DELETE', headers: B })
    check('intent links: the key owner revokes it (capacity restored)', bearerRevoke.status === 200)

    // House links: the seeded canonical set (deterministic slugs,
    // creator=null — earns nothing, belongs to no dashboard). The landing
    // lane + the /links start-here strip point at these forever.
    const housePage = await fetch(`${BASE}/i/buy-aapl`)
    const houseHtml = flat(await housePage.text())
    check('house links: /i/buy-aapl is live with the canonical ask', housePage.status === 200 && houseHtml.includes('Buy $10 of AAPL'))
    check('house links: /links start-here strip renders the seeded set', boardHtml.includes('Start here') && boardHtml.includes('/i/dca-eth'))
    const homeHtml = flat(await (await fetch(`${BASE}/`)).text())
    check(
      'house links: the landing link lane renders with tappable house links',
      homeHtml.includes('A link that moves money.') && homeHtml.includes('/i/buy-aapl'),
    )
    // House-link chips wear the marks of the apps their ask runs through
    // (HouseLinkChip) — derived from composeMcps + declared venue marks, so
    // a visitor sees WHICH protocols a link calls before opening it.
    const markNames = (slug: string) => houseLinkMarks(HOUSE_LINKS.find((h) => h.slug === slug)!).map((m) => m.name)
    check(
      'house links: the cross-chain chip wears the NEAR Intents mark',
      markNames('bridge-usdc').includes('NEAR Intents'),
    )
    check(
      'house links: protected-long wears Hyperliquid + the NEAR companion',
      markNames('protected-long')[0] === 'Hyperliquid' && markNames('protected-long').includes('NEAR Intents'),
    )
    check(
      'house links: the ETH DCA chip leads with its Uniswap venue mark',
      markNames('dca-eth')[0] === 'Uniswap',
    )
    // Sync guard: every composed MCP stays represented on the chip (the cap
    // must never silently drop a compose slug as venue marks are added).
    check(
      'house links: chip marks cover the full composed set for every house ask',
      HOUSE_LINKS.every((h) => {
        const keys = houseLinkMarks(h).map((m) => m.key)
        return composeMcps(h.ask).every((s) => keys.includes(s))
      }),
    )
    check(
      'house links: the landing lane chips render the mark stacks (title carries the apps)',
      homeHtml.includes('via Uniswap + NEAR Intents'),
    )
    // The composed MCP set must survive plurals — "Show my NFTs" once
    // composed to NO opensea (\bnft\b can't match "nfts"), so the seeded
    // /i/my-nfts link dead-ended for everyone.
    check('intent links: composeMcps is plural-tolerant (NFTs → opensea-free)', composeMcps('Show my NFTs').includes('opensea-free'))
    check(
      'intent links: the protected-long ask composes hyperliquid into the set',
      composeMcps('I want a 2X Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop').includes('hyperliquid-free'),
    )
    // The "Decide for me" rules — compose doubles as the creator form's
    // suggester, so each inference is pinned where a wrong chip would ship.
    check('intent links: a same-chain swap composes Uniswap', composeMcps('Swap $20 of ETH for USDC on Base').includes('uniswap-free'))
    check(
      'intent links: a cross-chain from→to swap does NOT pull Uniswap — NEAR settles it',
      !composeMcps('Swap 5 USDC from Base to Arbitrum').includes('uniswap-free'),
    )
    check('intent links: naming the dapp pulls it (limit order → CoW)', composeMcps('Place a limit order to sell ETH at 4200').includes('cow-free'))
    check('intent links: a margin ask composes Hyperliquid', composeMcps('Add a 2x margin position on BTC').includes('hyperliquid-free'))
    check('intent links: company names compose Robinhood (Tesla → TSLA land)', composeMcps('Buy $10 of Tesla').includes('robinhood-free'))
    check(
      'intent links: NEAR Intents rides along as the bridging companion on any ask',
      composeMcps('Buy $10 of Tesla').includes('near-intents-mcp-yeetful'),
    )
    // The Guardian/jobs aha chip is a PURE intent — the funding path (deposit
    // + bridge legs) is discovered and offered by the system, never typed by
    // the visitor. The 2X is REAL: the leverage rides the parsed intent into
    // the open step's params, and the build signs a guarded updateLeverage
    // ahead of the order. Retired predecessors (/i/stop-loss, the verbose
    // four-clause phrasing, the leverage-less original) stay live in the DB,
    // just unsurfaced.
    const houseJobAsk = 'I want a 2X Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop'
    const houseJob = compileJobAskFull(houseJobAsk) as CompiledJob
    check(
      'house links: the protected-long intent compiles to open + guardian arm with the 2x in the open params',
      !!houseJob && !('problem' in houseJob) && houseJob.steps.length === 2 && houseJob.steps[0].builder === 'native-hl-exec' && houseJob.steps[1].builder === 'native-hl-guardian' &&
        (houseJob.steps[0].params as { leverage?: number }).leverage === 2 && /^2x Long/.test(houseJob.steps[0].title),
    )
    check(
      'hl: collateral target = notional/leverage (default 3), floored at the bridge minimum',
      hlCollateralTargetUsd(12) === HL_MIN_DEPOSIT_USDC && hlCollateralTargetUsd(60) === 20 && hlCollateralTargetUsd(12, 2) === 6 && hlCollateralTargetUsd(6, 2) === HL_MIN_DEPOSIT_USDC,
    )
    // The funded version the system offers must round-trip the compiler as
    // the full deposit → credit-wait → open → arm job (the chip IS the
    // contract), and its deposit clears the bridge minimum. At 2x the $12
    // position needs $6 behind it — notional/2, not the /3 default.
    const fundedHouse = compileJobAskFull(`deposit ${hlCollateralTargetUsd(12, 2)} USDC to Hyperliquid, then ${houseJobAsk}`) as CompiledJob
    check(
      'house links: the system-offered funded ask compiles deposit→wait→open→arm',
      !!fundedHouse && !('problem' in fundedHouse) && fundedHouse.steps.length === 4 && fundedHouse.steps[1].kind === 'wait',
    )
    const hlMeta = (await (await fetch('https://api.hyperliquid.xyz/info', { method: 'POST', headers: CJ, body: JSON.stringify({ type: 'meta' }) })).json()) as { universe?: Array<{ name: string }> }
    check('house links: HYPE is a live Hyperliquid perp (the house ask names it)', !!hlMeta.universe?.some((u) => u.name === 'HYPE'))
    const houseJobPage = await fetch(`${BASE}/i/protected-long`)
    const houseJobHtml = flat(await houseJobPage.text())
    check('house links: /i/protected-long is live with the pure-intent ask', houseJobPage.status === 200 && houseJobHtml.includes('then protect my HYPE long with a 5% stop'))

    // Robust cap-slot freeing: several blocks above and below each need one
    // free mint slot, and a single hardcoded revoke only works once — revoke
    // ACTIVE links until `need` slots are open (free plan cap = 3).
    const freeSlots = async (need: number) => {
      const list = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })
      const rows = ((await list.json()) as { links?: Array<{ slug: string; revoked: boolean }> }).links ?? []
      const active = rows.filter((l) => !l.revoked)
      const excess = active.length - (3 - need)
      for (const l of active.slice(0, Math.max(0, excess))) {
        await fetch(`${BASE}/api/intent-links/${l.slug}`, { method: 'DELETE', headers: { cookie: mallorySession } })
      }
    }

    // ── Ask A/B variants — one slug, N phrasings, funnel per phrasing ────
    await freeSlots(1)
    const abMint = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: M,
      body: JSON.stringify({
        ask: 'Buy $12 of TSLA',
        // dupe-of-base and sub-sentence junk must drop; the cap is 3.
        variants: ['Own a slice of Tesla for $12', 'Buy $12 of TSLA', 'x', 'Put $12 into Tesla stock', 'A fourth phrasing that fits'],
      }),
    })
    const abLink = (await abMint.json()) as { slug?: string; variants?: string[] }
    check(
      'variants: mint sanitizes (dupe + junk dropped) and caps at 3',
      abMint.status === 200 && Array.isArray(abLink.variants) && abLink.variants.length === 3 && !abLink.variants.includes('Buy $12 of TSLA') && !abLink.variants.includes('x'),
    )
    const abEvent = (variant: unknown, kind = 'open') =>
      fetch(`${BASE}/api/intent-links/${abLink.slug}/events`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ kind, variant }),
      })
    await abEvent(1)
    await abEvent(1, 'signed')
    await abEvent(0)
    const junkEvent = await abEvent(99) // out of range → stored variant-less, aggregate only
    check('variants: events accept an index; junk indexes degrade to variant-less', junkEvent.status === 200)
    const abList = (await (await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })).json()) as {
      links: Array<{ slug: string; funnel: { open: number }; funnelVariants?: Array<{ variant: number; ask: string; open: number; signed: number }> }>
    }
    const abRow = abList.links.find((l) => l.slug === abLink.slug)
    const v0 = abRow?.funnelVariants?.find((v) => v.variant === 0)
    const v1 = abRow?.funnelVariants?.find((v) => v.variant === 1)
    check(
      'variants: the creator funnel segments per phrasing (v1 converts, v0 opened)',
      !!v0 && !!v1 && v0.ask === 'Buy $12 of TSLA' && v0.open === 1 && v1.open === 1 && v1.signed === 1,
    )
    check('variants: the aggregate funnel still counts every open (junk-variant row included)', !!abRow && abRow.funnel.open === 3)
    const abPage = await fetch(`${BASE}/i/${abLink.slug}`)
    const abHtml = flat(await abPage.text())
    const phrasings = ['Buy $12 of TSLA', 'Own a slice of Tesla for $12', 'Put $12 into Tesla stock', 'A fourth phrasing that fits']
    check(
      'variants: /i serves exactly one of the phrasings per visit',
      abPage.status === 200 && phrasings.some((p) => abHtml.includes(p)),
    )

    // ── Partner-promo limits: expiry / max-signs / allowlists ────────────
    await freeSlots(1)
    const badExpiry = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: M,
      body: JSON.stringify({ ask: 'Buy $9 of AAPL for the promo', expiresAt: '2020-01-01' }),
    })
    const badAllow = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: M,
      body: JSON.stringify({ ask: 'Buy $9 of AAPL for the promo', allowWallets: [mallory.address, 'not-an-address'] }),
    })
    check('limits: past expiry and malformed allowlist entries refuse at mint (400, never a silent drop)', badExpiry.status === 400 && badAllow.status === 400)

    // Allowlist + sign cap on one link (server-truth signs, not events).
    const capMintRes = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: M,
      body: JSON.stringify({ ask: 'Buy $9 of AAPL for the promo', maxSigns: 2, allowWallets: [mallory.address] }),
    })
    const capLink = (await capMintRes.json()) as { slug?: string; maxSigns?: number; allowCount?: number }
    check('limits: mint echoes the cap and the allowlist size (never the list)', capMintRes.status === 200 && capLink.maxSigns === 2 && capLink.allowCount === 1)
    const probeYes = (await (await fetch(`${BASE}/api/intent-links/${capLink.slug}/allowed?wallet=${mallory.address}`)).json()) as { allowed?: boolean }
    const probeNo = (await (await fetch(`${BASE}/api/intent-links/${capLink.slug}/allowed?wallet=0x000000000000000000000000000000000000dEaD`)).json()) as { allowed?: boolean }
    check('limits: the allowlist probe answers membership without leaking the list', probeYes.allowed === true && probeNo.allowed === false)
    const capPageBefore = await fetch(`${BASE}/i/${capLink.slug}`)
    const signTurn = () =>
      fetch(`${BASE}/api/embed/telemetry`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          firstParty: true,
          sessionId: `harness-limits-${Date.now()}`,
          page: `${BASE}/i/${capLink.slug}`,
          outcome: 'signed',
          artifact: 'tx',
          valueUsd: 10,
          intentLinkSlug: capLink.slug,
        }),
      })
    await signTurn()
    const capPageMid = await fetch(`${BASE}/i/${capLink.slug}`)
    await signTurn()
    const capPageAfter = await fetch(`${BASE}/i/${capLink.slug}`)
    check(
      'limits: the sign cap counts SERVER-TRUTH turns — live below the cap, 404 at it',
      capPageBefore.status === 200 && capPageMid.status === 200 && capPageAfter.status === 404,
    )
    await fetch(`${BASE}/api/intent-links/${capLink.slug}`, { method: 'DELETE', headers: { cookie: mallorySession } })

    // Expiry: live until the clock passes, then dead everywhere.
    const expMintRes = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: M,
      body: JSON.stringify({ ask: 'Buy $9 of AAPL for the promo', expiresAt: new Date(Date.now() + 1500).toISOString() }),
    })
    const expLink = (await expMintRes.json()) as { slug?: string }
    const expBefore = await fetch(`${BASE}/i/${expLink.slug}`)
    await new Promise((r) => setTimeout(r, 1700))
    const expAfter = await fetch(`${BASE}/i/${expLink.slug}`)
    const expEvent = await fetch(`${BASE}/api/intent-links/${expLink.slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'open' }),
    })
    check(
      'limits: an expired link dies everywhere (page 404, events 404)',
      expMintRes.status === 200 && expBefore.status === 200 && expAfter.status === 404 && expEvent.status === 404,
    )
    await fetch(`${BASE}/api/intent-links/${expLink.slug}`, { method: 'DELETE', headers: { cookie: mallorySession } })

    // cleanup: revoke every link this run minted. Mallory is a fresh wallet
    // each run, so the preamble can't catch leftovers from PRIOR runs — but
    // revoking here means runs stop leaving live links behind at all. The
    // telemetry rows stay (the fee-split checks above need them); the public
    // board excludes harness- sessions server-side regardless.
    const tail = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })
    if (tail.status === 200) {
      const held = ((await tail.json()) as { links?: Array<{ slug: string; revoked: boolean }> }).links ?? []
      await Promise.all(
        held.filter((l) => !l.revoked).map((l) => fetch(`${BASE}/api/intent-links/${l.slug}`, { method: 'DELETE', headers: { cookie: mallorySession } })),
      )
    }
  }

  // ── Organizations (SIWE-only org core + the role matrix) ──────────────────
  console.log('— organizations')
  const MJ = { 'content-type': 'application/json', cookie: mallorySession }

  const bearerOrg = await fetch(`${BASE}/api/orgs`, {
    method: 'POST',
    headers: BJ, // a Bearer key must NOT manage orgs (F2 — SIWE only)
    body: JSON.stringify({ name: 'Bearer Co' }),
  })
  check('Bearer key cannot create an org (SIWE only)', bearerOrg.status === 401)

  const orgRes = await fetch(`${BASE}/api/orgs`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ name: 'Test:API Harness Co' }),
  })
  const org = await orgRes.json()
  check(
    'org created; creator is owner; slug derived',
    orgRes.status === 201 && org.role === 'owner' && /^test-api-harness-co/.test(org.slug ?? ''),
  )

  const myOrgs = await (await fetch(`${BASE}/api/orgs`, { headers: C })).json()
  check(
    'org list carries role + member count',
    myOrgs.some((o: { id: string; role: string; memberCount: number }) => o.id === org.id && o.role === 'owner' && o.memberCount === 1),
  )

  const outsiderRead = await fetch(`${BASE}/api/orgs/${org.id}`, { headers: { cookie: mallorySession } })
  check('non-member read → 404 (existence hidden)', outsiderRead.status === 404)
  const outsiderAdd = await fetch(`${BASE}/api/orgs/${org.id}/members`, {
    method: 'POST',
    headers: MJ,
    body: JSON.stringify({ address: mallory.address }),
  })
  check('non-member cannot add members (404)', outsiderAdd.status === 404)

  const badAddr = await fetch(`${BASE}/api/orgs/${org.id}/members`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ address: 'not-a-wallet' }),
  })
  check('invite validates the wallet address', badAddr.status === 400)

  const invite = await fetch(`${BASE}/api/orgs/${org.id}/members`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ address: mallory.address }),
  })
  check('adding an address IS the invite (lands as member)', invite.status === 201 && (await invite.json()).role === 'member')
  const dupeInvite = await fetch(`${BASE}/api/orgs/${org.id}/members`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ address: mallory.address }),
  })
  check('double-invite → 409', dupeInvite.status === 409)

  const memberRead = await (await fetch(`${BASE}/api/orgs/${org.id}`, { headers: { cookie: mallorySession } })).json()
  check(
    'member reads org detail + member list',
    memberRead.id === org.id && memberRead.role === 'member' && memberRead.members?.length === 2,
  )

  const third = privateKeyToAccount(generatePrivateKey())
  const memberAdd = await fetch(`${BASE}/api/orgs/${org.id}/members`, {
    method: 'POST',
    headers: MJ,
    body: JSON.stringify({ address: third.address }),
  })
  check('member cannot invite (admin+) → 403', memberAdd.status === 403)
  const memberRename = await fetch(`${BASE}/api/orgs/${org.id}`, {
    method: 'PATCH',
    headers: MJ,
    body: JSON.stringify({ name: 'Hijacked' }),
  })
  check('member cannot rename (admin+) → 403', memberRename.status === 403)
  const selfPromote = await fetch(`${BASE}/api/orgs/${org.id}/members/${mallory.address}`, {
    method: 'PATCH',
    headers: MJ,
    body: JSON.stringify({ role: 'admin' }),
  })
  check('member cannot change roles (owner only) → 403', selfPromote.status === 403)

  const promote = await fetch(`${BASE}/api/orgs/${org.id}/members/${mallory.address}`, {
    method: 'PATCH',
    headers: CJ,
    body: JSON.stringify({ role: 'admin' }),
  })
  check('owner promotes member → admin', promote.status === 200 && (await promote.json()).role === 'admin')

  const adminRename = await fetch(`${BASE}/api/orgs/${org.id}`, {
    method: 'PATCH',
    headers: MJ,
    body: JSON.stringify({ name: 'Harness Co (renamed)' }),
  })
  check('admin renames the org', adminRename.status === 200 && (await adminRename.json()).name === 'Harness Co (renamed)')

  const adminDelete = await fetch(`${BASE}/api/orgs/${org.id}`, { method: 'DELETE', headers: { cookie: mallorySession } })
  check('admin cannot delete the org (owner only) → 403', adminDelete.status === 403)

  const transfer = await fetch(`${BASE}/api/orgs/${org.id}/members/${mallory.address}`, {
    method: 'PATCH',
    headers: CJ,
    body: JSON.stringify({ role: 'owner' }),
  })
  const afterTransfer = await (await fetch(`${BASE}/api/orgs/${org.id}`, { headers: { cookie: mallorySession } })).json()
  check(
    'ownership transfer swaps roles atomically',
    transfer.status === 200 &&
      afterTransfer.role === 'owner' &&
      afterTransfer.members.find((m: { address: string }) => m.address === owner.address.toLowerCase())?.role === 'admin',
  )

  const leave = await fetch(`${BASE}/api/orgs/${org.id}/members/${owner.address}`, { method: 'DELETE', headers: C })
  check('a non-owner can leave (self-removal)', leave.status === 200)

  const delOrg = await fetch(`${BASE}/api/orgs/${org.id}`, { method: 'DELETE', headers: { cookie: mallorySession } })
  const orgsAfter = await (await fetch(`${BASE}/api/orgs`, { headers: { cookie: mallorySession } })).json()
  check(
    'owner deletes the org; lists are empty again',
    delOrg.status === 200 && Array.isArray(orgsAfter) && !orgsAfter.some((o: { id: string }) => o.id === org.id),
  )

  // ── Org spending: org keys, org grants, the two-level budget ──────────────
  console.log('— org spending')
  const spendOrg = await (
    await fetch(`${BASE}/api/orgs`, { method: 'POST', headers: CJ, body: JSON.stringify({ name: 'Spend Co' }) })
  ).json()
  await fetch(`${BASE}/api/orgs/${spendOrg.id}/members`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ address: mallory.address }),
  })

  const memberMint = await fetch(`${BASE}/api/keys`, {
    method: 'POST',
    headers: MJ,
    body: JSON.stringify({ label: 'rogue', orgId: spendOrg.id }),
  })
  check('member cannot mint an org key (admin+) → 403', memberMint.status === 403)

  const orgKeyRes = await fetch(`${BASE}/api/keys`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ label: 'org runner', orgId: spendOrg.id }),
  })
  const orgKey = await orgKeyRes.json()
  check('admin mints an org key', orgKeyRes.status === 201 && orgKey.orgId === spendOrg.id && /^yf_/.test(orgKey.secret ?? ''))
  const OB = { authorization: `Bearer ${orgKey.secret}` }
  const OBJ = { 'content-type': 'application/json', ...OB }

  const orgKeysAsMember = await (await fetch(`${BASE}/api/keys?org=${spendOrg.id}`, { headers: { cookie: mallorySession } })).json()
  check('member lists org keys (with mintedBy)', orgKeysAsMember.length === 1 && orgKeysAsMember[0].mintedBy === owner.address.toLowerCase())
  const personalKeys = await (await fetch(`${BASE}/api/keys`, { headers: C })).json()
  check('org key absent from the personal key list (scope isolation)', !personalKeys.some((k: { id: string }) => k.id === orgKey.id))

  // Kill switch on an org key: a member can't pause it (admin+ only); the admin
  // can, and the org key's policy then reports the halt. Resume to leave it live.
  const memberPause = await fetch(`${BASE}/api/keys/${orgKey.id}`, {
    method: 'PATCH',
    headers: MJ,
    body: JSON.stringify({ paused: true }),
  })
  check('member cannot pause an org key (admin+) → 404', memberPause.status === 404)
  const adminPause = await fetch(`${BASE}/api/keys/${orgKey.id}`, {
    method: 'PATCH',
    headers: CJ,
    body: JSON.stringify({ paused: true }),
  })
  const orgKeyHalted = await (await fetch(`${BASE}/api/agent/policy`, { headers: OB })).json()
  check(
    'admin pauses an org key → its policy halts (AGENT_PAUSED)',
    adminPause.status === 200 && orgKeyHalted.halted === true && orgKeyHalted.haltReason === 'AGENT_PAUSED',
  )
  await fetch(`${BASE}/api/keys/${orgKey.id}`, { method: 'PATCH', headers: CJ, body: JSON.stringify({ paused: false }) })

  const memberToggle = await fetch(`${BASE}/api/approvals`, {
    method: 'PUT',
    headers: MJ,
    body: JSON.stringify({ serverId: 'whatever', approved: true, orgId: spendOrg.id }),
  })
  check('member cannot toggle org approvals (admin+) → 403', memberToggle.status === 403)

  const dirServers = await (await fetch(`${BASE}/api/servers`)).json()
  const dirSrv = dirServers.find((s: { callable: boolean }) => s.callable) ?? dirServers[0]
  const orgToggle = await fetch(`${BASE}/api/approvals`, {
    method: 'PUT',
    headers: CJ,
    body: JSON.stringify({ serverId: dirSrv.id, approved: true, orgId: spendOrg.id }),
  })
  const orgToggleBody = await orgToggle.json()
  check('admin org-toggle mints the org expense account', orgToggle.status === 200 && !!orgToggleBody.grant?.id)
  const orgGrantId = orgToggleBody.grant.id as string

  const orgGrants = await (await fetch(`${BASE}/api/grants?org=${spendOrg.id}`, { headers: { cookie: mallorySession } })).json()
  check(
    'member lists org grants; orgId attributed',
    Array.isArray(orgGrants) && orgGrants.some((g: { id: string; orgId: string }) => g.id === orgGrantId && g.orgId === spendOrg.id),
  )
  const personalGrants = await (await fetch(`${BASE}/api/grants`, { headers: C })).json()
  check('org grant absent from the personal grant list (scope isolation)', !personalGrants.some((g: { id: string }) => g.id === orgGrantId))

  const capSet = await fetch(`${BASE}/api/orgs/${spendOrg.id}`, {
    method: 'PATCH',
    headers: CJ,
    body: JSON.stringify({ perDayUsd: 0.05 }),
  })
  check('admin sets the org daily cap', capSet.status === 200 && (await capSet.json()).perDayUsd === 0.05)

  const orgSync1 = await fetch(`${BASE}/api/grants/${orgGrantId}/ledger`, {
    method: 'POST',
    headers: OBJ,
    body: JSON.stringify({ host: 'org.example.test', amountUsd: 0.03, ok: true, serviceName: 'OrgHarness' }),
  })
  const orgSync1Body = await orgSync1.json()
  check(
    'org key syncs to the org grant; echo carries BOTH budget levels',
    orgSync1.status === 201 && orgSync1Body.org?.spentTodayUsd === 0.03 && orgSync1Body.org?.overBudget === false,
  )

  const orgPolicy = await (await fetch(`${BASE}/api/agent/policy`, { headers: OB })).json()
  check(
    "org key's policy = the ORG's standing orders (org grant + org block)",
    orgPolicy.grant?.id === orgGrantId && orgPolicy.org?.perDayUsd === 0.05 && orgPolicy.org?.spentTodayUsd === 0.03,
  )
  const personalPolicy = await (await fetch(`${BASE}/api/agent/policy`, { headers: B })).json()
  check('personal key policy has no org block', personalPolicy.org === null)

  const orgSync2 = await fetch(`${BASE}/api/grants/${orgGrantId}/ledger`, {
    method: 'POST',
    headers: OBJ,
    body: JSON.stringify({ host: 'org.example.test', amountUsd: 0.02, ok: true, serviceName: 'OrgHarness' }),
  })
  check('org cap reached → org overBudget on the sync echo', ((await orgSync2.json()).org?.overBudget) === true)

  // Org-scoped dashboard stats: the org block + the org's grant, member+.
  const orgStats = await (
    await fetch(`${BASE}/api/dashboard/stats?org=${spendOrg.id}`, { headers: { cookie: mallorySession } })
  ).json()
  check(
    'org stats: org budget block + the org grant, readable by a member',
    orgStats.org?.perDayUsd === 0.05 &&
      orgStats.org?.spentTodayUsd === 0.05 &&
      orgStats.org?.overBudget === true &&
      orgStats.org?.role === 'member' &&
      orgStats.grant?.id === orgGrantId &&
      orgStats.agents?.connected === 1,
  )
  const personalStats = await (await fetch(`${BASE}/api/dashboard/stats`, { headers: C })).json()
  check(
    'personal stats: org-free (org null, org keys/grants absent)',
    personalStats.org === null && personalStats.grant?.id !== orgGrantId,
  )

  // The expense report — totals + three breakdowns, member-readable.
  const reportRes = await fetch(`${BASE}/api/orgs/${spendOrg.id}/report`, { headers: { cookie: mallorySession } })
  const report = await reportRes.json()
  check(
    'expense report: totals + per-agent/member/service breakdowns (member+)',
    reportRes.status === 200 &&
      Math.abs(report.totals?.spentUsd - 0.05) < 1e-9 &&
      report.totals?.calls === 2 &&
      report.perAgent?.[0]?.label === 'org runner' &&
      report.perMember?.[0]?.address === owner.address.toLowerCase() &&
      report.perService?.[0]?.service === 'OrgHarness',
  )
  const reportOutsider = await fetch(`${BASE}/api/orgs/${spendOrg.id}/report`, { headers: B })
  const reportBadRange = await fetch(`${BASE}/api/orgs/${spendOrg.id}/report?from=2026-01-02&to=2026-01-01`, {
    headers: C,
  })
  check(
    'expense report: Bearer 401, inverted range 400',
    reportOutsider.status === 401 && reportBadRange.status === 400,
  )

  const crossSync = await fetch(`${BASE}/api/grants/${grant.id}/ledger`, {
    method: 'POST',
    headers: OBJ,
    body: JSON.stringify({ host: 'sneaky.example.test', amountUsd: 0.01, ok: true }),
  })
  check("org key can't sync to a PERSONAL grant (attribution can't lie)", crossSync.status === 404)

  const delSpendOrg = await fetch(`${BASE}/api/orgs/${spendOrg.id}`, { method: 'DELETE', headers: C })
  const orgKeyAfter = await fetch(`${BASE}/api/grants`, { headers: OB })
  check('org delete cascades its keys (org Bearer → 401)', delSpendOrg.status === 200 && orgKeyAfter.status === 401)

  // ── Wallet-mode plan gate (policy enforced BEFORE signature requests) ─────
  console.log('— wallet plan gate')
  // The harness grant's policy was toggled OFF above, so the enforcement tests
  // below opt it back IN first — otherwise the gate short-circuits and nothing
  // is blocked (that bypass is covered above).
  await fetch(`${BASE}/api/grants/${grant.id}`, {
    method: 'PATCH', headers: CJ, body: JSON.stringify({ spendPolicyEnabled: true }),
  })
  const fakeInference = {
    slug: 'fake-inf',
    name: 'Fake Inference',
    kind: 'inference',
    callable: true,
    endpoint: 'https://evil-inf.example.test/api',
    protocol: 'http',
    priceUsd: '0.01',
  }
  const fakeData = {
    slug: 'fake-data',
    name: 'Fake Data',
    kind: 'data',
    callable: true,
    endpoint: 'https://evil-data.example.test/q',
    protocol: 'http',
    queryParam: 'q',
    priceUsd: '0.01',
  }
  // Neither host is in the grant's allowlist: the plan must be refused without
  // a single network probe (the gate runs before getChallenge).
  const gated = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({
      message: 'plan gate probe',
      walletAddress: owner.address,
      activeServers: [fakeInference, fakeData],
    }),
  })
  const gatedBody = await gated.json()
  check(
    'wallet plan: disallowed inference blocked, never asked to sign',
    gated.status === 200 && gatedBody.blocked === true && /NOT_ALLOWED/.test(gatedBody.reply ?? ''),
  )
  check(
    'wallet plan: disallowed data service blocked with a policy note',
    Array.isArray(gatedBody.notes) && gatedBody.notes.some((n: string) => n.includes('Fake Data') && n.includes('NOT_ALLOWED')),
  )
  const detail2 = await (await fetch(`${BASE}/api/grants/${grant.id}`, { headers: C })).json()
  check(
    'wallet plan: denials ledgered ($0, audit trail)',
    detail2.ledger.some((e: { host: string }) => e.host === 'evil-inf.example.test') &&
      detail2.ledger.some((e: { host: string }) => e.host === 'evil-data.example.test'),
  )
  // Positive control: an ALLOWED host passes the gate and reaches the 402
  // probe. The host doesn't resolve, so the probe's fetch throws → 502 —
  // which is exactly the proof that the gate let it through.
  const ungated = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({
      message: 'plan gate positive control',
      walletAddress: owner.address,
      activeServers: [{ ...fakeInference, endpoint: 'https://a.example.test/api' }],
    }),
  })
  check('wallet plan: allowed host passes the gate (reaches network probe)', ungated.status === 502)

  // Kill switch HARD enforcement: freeze the account, and the SAME allowed host
  // is now refused server-side (not advisory) — Yeetful executes this rail, so
  // it can actually stop it. Then unfreeze (resume restores the rail).
  await fetch(`${BASE}/api/grants/${grant.id}`, { method: 'PATCH', headers: CJ, body: JSON.stringify({ paused: true }) })
  const frozen = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({
      message: 'frozen account probe',
      walletAddress: owner.address,
      activeServers: [{ ...fakeInference, endpoint: 'https://a.example.test/api' }],
    }),
  })
  const frozenBody = await frozen.json()
  check(
    'frozen account: allowed host HARD-refused server-side (ACCOUNT_FROZEN)',
    frozen.status === 200 && frozenBody.blocked === true && /ACCOUNT_FROZEN/.test(frozenBody.reply ?? ''),
  )
  const unfreeze = await fetch(`${BASE}/api/grants/${grant.id}`, { method: 'PATCH', headers: CJ, body: JSON.stringify({ paused: false }) })
  const thawed = await (await fetch(`${BASE}/api/agent/policy`, { headers: B })).json()
  check(
    'unfreeze restores the rail (grant.paused false, halt clear)',
    (await unfreeze.json()).paused === false && thawed.halted === false,
  )

  // ── Auto-Router streaming (B2): SSE framing + a trace step + a final reply.
  //    NO spend: the owner's grant allowlist excludes the inference host, so the
  //    engine refuses before paying (the same gate the wallet-plan test uses).
  console.log('— auto-router stream')
  const arRes = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ message: 'what is the capital of France?', autoRouter: true, history: [] }),
  })
  check('auto-router: responds as text/event-stream', (arRes.headers.get('content-type') ?? '').includes('text/event-stream'))
  const arEvents = (await arRes.text())
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b.startsWith('data:'))
    .map((b) => JSON.parse(b.slice(5).trim()) as { type: string; blocked?: boolean; content?: string })
  check('auto-router: emits ≥1 reasoning step', arEvents.some((e) => e.type === 'status'))
  const arReply = arEvents.find((e) => e.type === 'reply')
  check(
    'auto-router: ends with a reply (no spend — policy-blocked or no engine)',
    !!arReply && (arReply.blocked === true || /No live inference/.test(String(arReply.content))),
  )
  check('auto-router: stream terminates with a done event', arEvents.some((e) => e.type === 'done'))

  // B5 — wallet-mode auto-router is gated the same way: a forbidden engine is
  // refused with NO plan + NO signature requests (nothing to sign, no spend).
  const arwRes = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ message: 'find hotels in Tokyo', autoRouter: true, history: [], walletAddress: owner.address }),
  })
  const arwEvents = (await arwRes.text())
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b.startsWith('data:'))
    .map((b) => JSON.parse(b.slice(5).trim()) as { type: string; blocked?: boolean; content?: string })
  const arwReply = arwEvents.find((e) => e.type === 'reply')
  check(
    'auto-router (wallet): policy-forbidden engine → reply blocked, no plan emitted',
    !!arwReply &&
      (arwReply.blocked === true || /No live inference/.test(String(arwReply.content))) &&
      !arwEvents.some((e) => e.type === 'plan'),
  )

  // ── Guest trial lane: /api/chat must stay open to anonymous turns ────────
  // The first-party chat's guest lane (and the keyless embed) both ride the
  // anonymous house-model path — no cookie, no wallet. If someone adds an
  // auth wall to /api/chat, the first-ask funnel dies silently; this guards
  // the contract. (The reply itself may vary — the check is only that the
  // turn is ACCEPTED, not walled.)
  console.log('— guest trial lane (/api/chat anonymous)')
  const guestTurn = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hi', activeServers: [], history: [] }),
  })
  check(
    'guest lane: anonymous chat turn is accepted (no auth wall)',
    guestTurn.status !== 401 && guestTurn.status !== 403,
  )
  check(
    'guest lane: anonymous turn answers with a JSON body',
    (guestTurn.headers.get('content-type') ?? '').includes('application/json') &&
      typeof ((await guestTurn.json()) as { reply?: unknown; error?: unknown }) === 'object',
  )

  // ── Unsigned-turn abuse fence (lib/turn-limits, the #553 follow-up) ──────
  // Pure decision + key shapes; the live trip path is drilled directly
  // against the store (pre-loaded counter → one HTTP turn → the wall).
  console.log('— unsigned-turn fence (lib/turn-limits)')
  check(
    'fence: keys are hashed-ip + lowercased wallet; loopback-no-wallet has none',
    (() => {
      const keys = limitKeysFor(hashIp('203.0.113.9'), '0xABCDEF0123456789abcdef0123456789ABCDEF01')
      return (
        keys.length === 2 &&
        keys[0].startsWith('i:') &&
        !keys[0].includes('203.0.113.9') &&
        keys[1] === 'w:0xabcdef0123456789abcdef0123456789abcdef01' &&
        limitKeysFor(null, undefined).length === 0
      )
    })(),
  )
  check(
    'fence: under-cap passes; wallet cap trips at cap+1; the ip tier outranks',
    decideTurnLimit([{ key: 'i:aa', count: UNSIGNED_IP_HOURLY_CAP }, { key: 'w:0xa', count: UNSIGNED_WALLET_HOURLY_CAP }]) === null &&
      decideTurnLimit([{ key: 'w:0xa', count: UNSIGNED_WALLET_HOURLY_CAP + 1 }]) === 'wallet' &&
      decideTurnLimit([
        { key: 'i:aa', count: UNSIGNED_IP_HOURLY_CAP + 1 },
        { key: 'w:0xa', count: UNSIGNED_WALLET_HOURLY_CAP + 1 },
      ]) === 'ip',
  )
  // A forged platform IP + wallet crosses the fence under-cap: the turn is
  // accepted and carries no rate wall (regression guard for false trips).
  const fencedTurn = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-real-ip': '203.0.113.77' },
    body: JSON.stringify({
      message: 'hi',
      activeServers: [],
      history: [],
      walletAddress: privateKeyToAccount(generatePrivateKey()).address,
    }),
  })
  const fencedBody = (await fencedTurn.json()) as { rateGate?: unknown }
  check('fence: an under-cap unsigned turn passes with no rate wall', fencedTurn.status === 200 && fencedBody.rateGate === undefined)
  // Loopback IS a header value on `next start` (x-forwarded-for: ::1), not
  // an absent one — it must read as "no platform IP" or local dev and this
  // very harness accumulate fence walls across runs in the shared DB (live
  // 2026-07-28: ::1 sat at 169 unsigned turns and walled the run's tail).
  check(
    'fence: loopback header values read as direct traffic (no platform IP)',
    clientIpFrom(new Headers({ 'x-forwarded-for': '::1' })) === null &&
      clientIpFrom(new Headers({ 'x-real-ip': '127.0.0.1' })) === null &&
      clientIpFrom(new Headers({ 'x-forwarded-for': '::ffff:127.0.0.1, 203.0.113.9' })) === null &&
      clientIpFrom(new Headers({ 'x-real-ip': '203.0.113.9' })) === '203.0.113.9' &&
      clientIpFrom(new Headers()) === null,
  )

  // ── Missing-MCP door: venue-worded builds never fall to a planner how-to ──
  // Live 2026-07-27: a default-fleet chat answered "Stake 0.05 ETH with
  // Lido" with a stake.lido.fi walkthrough — the conversion handed away.
  // Without the venue MCP in the set, the native layers answer with the
  // add-the-dapp deep link (prefill, never auto-send). Pre-planner, cheap.
  const lidoDoor = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Stake 0.05 ETH with Lido', activeServers: [], history: [] }),
  })
  const lidoDoorBody = (await lidoDoor.json()) as { reply?: string }
  check(
    'missing-mcp door: a Lido stake ask without the Lido MCP gets the add-Lido deep link, never a DIY how-to',
    lidoDoor.status === 200 &&
      /mcps=lido-free/.test(lidoDoorBody.reply ?? '') &&
      !/stake\.lido\.fi/i.test(lidoDoorBody.reply ?? ''),
  )
  const hlDoor = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Long $12 of HYPE on Hyperliquid', activeServers: [], history: [] }),
  })
  const hlDoorBody = (await hlDoor.json()) as { reply?: string }
  check(
    'missing-mcp door: an HL order ask without the Hyperliquid MCP gets the add door',
    hlDoor.status === 200 && /mcps=hyperliquid-free/.test(hlDoorBody.reply ?? ''),
  )

  // ── Engine-as-service (B9a): the routing engine exposed to API keys ───────
  console.log('— engine-as-service (/api/route)')
  const routeNoAuth = await fetch(`${BASE}/api/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'hi' }),
  })
  check('engine: /api/route without Bearer → 401', routeNoAuth.status === 401)

  // `minted` sits at its per-key daily budget (0.05/0.05 from the agent tests) →
  // the per-key pre-gate refuses before any spend.
  const routeOverBudget = await fetch(`${BASE}/api/route`, {
    method: 'POST',
    headers: BJ,
    body: JSON.stringify({ message: 'what is the price of ETH' }),
  })
  check('engine: /api/route over the per-key budget → 402', routeOverBudget.status === 402 && (await routeOverBudget.json()).overBudget === true)

  // A fresh, no-budget key for the same owner streams the engine — but the
  // owner's grant allowlist excludes the inference host, so it's refused with
  // NO spend (same gate as the chat), proving Bearer→engine end to end.
  const routeKey = await (
    await fetch(`${BASE}/api/keys`, { method: 'POST', headers: CJ, body: JSON.stringify({ label: 'route harness' }) })
  ).json()
  const routeStream = await fetch(`${BASE}/api/route`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: `Bearer ${routeKey.secret}` },
    body: JSON.stringify({ message: 'what is the price of ETH', history: [] }),
  })
  check('engine: /api/route streams text/event-stream', (routeStream.headers.get('content-type') ?? '').includes('text/event-stream'))
  const routeEvents = (await routeStream.text())
    .split('\n\n')
    .map((b) => b.trim())
    .filter((b) => b.startsWith('data:'))
    .map((b) => JSON.parse(b.slice(5).trim()) as { type: string; blocked?: boolean; content?: string })
  const routeReply = routeEvents.find((e) => e.type === 'reply')
  check(
    'engine: /api/route ends with a reply (policy-blocked, no spend)',
    !!routeReply && (routeReply.blocked === true || /No live inference/.test(String(routeReply.content))),
  )
  await fetch(`${BASE}/api/keys/${routeKey.id}`, { method: 'DELETE', headers: C })

  // ── Key revocation (after Bearer use, before cleanup) ─────────────────────
  console.log('— revocation')
  const del = await fetch(`${BASE}/api/keys/${minted.id}`, { method: 'DELETE', headers: C })
  const afterRevoke = await fetch(`${BASE}/api/grants`, { headers: B })
  check('revoked key → immediate 401', del.status === 200 && afterRevoke.status === 401)

  // ── Chat receipts: meta round-trip + share render ─────────────────────────
  console.log('— chat receipts')
  const chat = await (
    await fetch(`${BASE}/api/chats`, {
      method: 'POST',
      headers: CJ,
      body: JSON.stringify({ title: 'test:api receipts', activeServerIds: [] }),
    })
  ).json()
  // The ask that opens the chat — the share page's handoff link carries it.
  await fetch(`${BASE}/api/chats/${chat.id}/messages`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ role: 'user', content: 'Buy $2 of AAPL on Robinhood Chain' }),
  })
  const msg = await (
    await fetch(`${BASE}/api/chats/${chat.id}/messages`, {
      method: 'POST',
      headers: CJ,
      body: JSON.stringify({
        role: 'assistant',
        content: 'Harness reply.',
        meta: {
          payer: 'your wallet',
          receipts: [
            { name: 'Alpha', priceUsd: '0.01', txHash: '0x' + 'ab'.repeat(32), ok: true },
            { name: 'Beta', priceUsd: '0.01', ok: false, note: 'blocked: NOT_ALLOWED' },
            { name: 'Gamma', priceUsd: '0.01', ok: false, note: 'blocked: NOT_ALLOWED', slug: 'gamma-svc' },
          ],
          routeReport: { considered: 12, picked: ['CoinMarketCap'], spentUsd: 0.01, cacheSavedUsd: 0, savedVsPriciestUsd: 0.04 },
          routerTrace: [
            { type: 'shortlist', candidates: [{ service: 'CoinMarketCap', endpoint: 'https://x/quotes', priceUsd: '0.01' }] },
            { type: 'select', service: 'CoinMarketCap', endpoint: 'https://x/quotes', priceUsd: '0.01', reason: 'spot price' },
            { type: 'receipt', receipt: { name: 'CoinMarketCap', priceUsd: '0.01', ok: true, txHash: '0xabc' } },
          ],
        },
      }),
    })
  ).json()
  const loaded = await (await fetch(`${BASE}/api/chats/${chat.id}`, { headers: C })).json()
  const loadedMsg = loaded.messages?.find((m: { id: string }) => m.id === msg.id)
  check('meta.receipts + payer round-trip', loadedMsg?.meta?.payer === 'your wallet' && loadedMsg.meta.receipts.length === 3)
  check('meta.routeReport (B15 value) round-trips', loadedMsg?.meta?.routeReport?.picked?.[0] === 'CoinMarketCap' && loadedMsg.meta.routeReport.savedVsPriciestUsd === 0.04)
  check('meta.routerTrace (B16 replay) round-trips', Array.isArray(loadedMsg?.meta?.routerTrace) && loadedMsg.meta.routerTrace.length === 3 && loadedMsg.meta.routerTrace[0].type === 'shortlist')

  // ── Chat id provenance: local ids never reach the DB routes ──────────────
  // The store gates every /api/chats/<id>/* write on isDbChatId — a SIWE
  // session settling MID-turn otherwise 404s a local chat's history posts
  // (observed live on /i 2026-07-22). The classifier must accept every real
  // row id and reject the client's short random ids; the server side of the
  // contract is that a local-shaped id is a definitive 404, not a 5xx.
  check('chat ids: real DB cuid passes isDbChatId', isDbChatId(chat.id) && isDbChatId(msg.chatId ?? chat.id))
  check(
    'chat ids: local/random ids rejected by isDbChatId',
    !isDbChatId('kt1x9q2z7ab') && !isDbChatId('c3po') && !isDbChatId('') && !isDbChatId('local-abc123'),
  )
  const localPost = await fetch(`${BASE}/api/chats/kt1x9q2z7ab/messages`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ role: 'user', content: 'ghost turn' }),
  })
  check('chat ids: authed message post to a local-shaped id → clean 404', localPost.status === 404)

  const shared = await (
    await fetch(`${BASE}/api/chats/${chat.id}`, {
      method: 'PATCH',
      headers: CJ,
      body: JSON.stringify({ isPublic: true }),
    })
  ).json()
  const html = flat(await (await fetch(`${BASE}/p/${shared.publicSlug}`)).text())
  check(
    'share page renders footnote (total · payer · denial)',
    html.includes('💸') && html.includes('$0.01 over 1 x402 call') && html.includes('· your wallet') && html.includes('blocked: NOT_ALLOWED'),
  )
  check(
    'blocked-for-approval receipt links to /servers/<slug>#approve',
    html.includes('/servers/gamma-svc#approve'),
  )
  // B23 — the stored routing trace (meta.routerTrace) renders read-only on the share page.
  check(
    'share page renders the routing trace (B23)',
    html.includes('Routing trace') && html.includes('shortlisted') && html.includes('selected'),
  )

  // "Run this chat yourself" hands off with the opening ask PREFILLED — the
  // visitor lands on the sentence the page just showed them, not a blank box.
  check(
    'share CTA carries the opening ask as ?prompt=',
    html.includes(`/chat?prompt=${encodeURIComponent('Buy $2 of AAPL on Robinhood Chain')}`),
  )
  check(
    'firstUserPromptOf takes the FIRST user turn, trimmed (assistant turns skipped)',
    firstUserPromptOf([
      { role: 'assistant', content: 'Hello.' },
      { role: 'user', content: '  Buy $2 of AAPL on Robinhood Chain  ' },
      { role: 'user', content: 'and again tomorrow' },
    ]) === 'Buy $2 of AAPL on Robinhood Chain',
  )
  check('firstUserPromptOf: no user turn → null', firstUserPromptOf([{ role: 'assistant', content: 'Hello.' }]) === null)
  check('firstUserPromptOf: blank ask → null', firstUserPromptOf([{ role: 'user', content: '   ' }]) === null)
  check(
    'firstUserPromptOf: a paste over the cap is dropped, never truncated',
    firstUserPromptOf([{ role: 'user', content: 'x'.repeat(401) }]) === null &&
      firstUserPromptOf([{ role: 'user', content: 'x'.repeat(400) }])?.length === 400,
  )

  // Share button — the tweet intent carries the chat's own opening ask.
  check(
    'share page renders the X share button with the pre-written tweet',
    html.includes('twitter.com/intent/tweet?text=Lazy+transactions+are+here') &&
      html.includes(encodeURIComponent('"Buy $2 of AAPL on Robinhood Chain" on @yeetful_ai').replaceAll('%20', '+')),
  )
  {
    const href = shareTweetHrefOf('some-slug', [
      { role: 'assistant', content: 'Hello.' },
      { role: 'user', content: 'Buy $2 of AAPL on Robinhood Chain' },
    ])
    const p = new URL(href).searchParams
    check(
      'shareTweetHrefOf quotes the first user ask and links the share page',
      p.get('text') === 'Lazy transactions are here!\n\n"Buy $2 of AAPL on Robinhood Chain" on @yeetful_ai' &&
        p.get('url')?.endsWith('/p/some-slug') === true,
    )
    const long = new URL(shareTweetHrefOf('s', [{ role: 'user', content: 'y'.repeat(500) }])).searchParams
    const longText = long.get('text') ?? ''
    check(
      'shareTweetHrefOf truncates an over-long ask with an ellipsis (never drops it)',
      longText.includes('…') && longText.length <= 256 && longText.endsWith('on @yeetful_ai'),
    )
    const bare = new URL(shareTweetHrefOf('s', [{ role: 'assistant', content: 'hi' }])).searchParams
    check(
      'shareTweetHrefOf: no user turn → generic tweet, still tagged',
      bare.get('text')?.includes('@yeetful_ai') === true && bare.get('text')?.includes('"') === false,
    )
  }

  // ── Signed-tx log: meta.signed write-back + share render ──────────────────
  console.log('— signed-tx log')
  const sigHashA = '0x' + 'cd'.repeat(32)
  const sigHashB = '0x' + 'ef'.repeat(32)
  const signedAnon = await fetch(`${BASE}/api/chats/${chat.id}/messages/${msg.id}/signed`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ txs: [{ hash: sigHashA, chainId: 8453 }] }),
  })
  check('signed write-back without session → 401', signedAnon.status === 401)
  const signedBad = await fetch(`${BASE}/api/chats/${chat.id}/messages/${msg.id}/signed`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ txs: [{ hash: 'not-a-hash', chainId: 8453 }, { hash: sigHashA }] }),
  })
  check('signed write-back rejects malformed txs → 400', signedBad.status === 400)
  const signedOk = await (
    await fetch(`${BASE}/api/chats/${chat.id}/messages/${msg.id}/signed`, {
      method: 'POST',
      headers: CJ,
      body: JSON.stringify({
        txs: [
          { hash: sigHashA, chainId: 8453, title: 'Approve 1 USDC' },
          { hash: sigHashB, chainId: 4663, title: 'Swap 1 USDC → AAPL' },
        ],
      }),
    })
  ).json()
  // Re-posting the same hash must not duplicate (the chain card can re-fire).
  const signedDupe = await (
    await fetch(`${BASE}/api/chats/${chat.id}/messages/${msg.id}/signed`, {
      method: 'POST',
      headers: CJ,
      body: JSON.stringify({ txs: [{ hash: sigHashA, chainId: 8453, title: 'Approve 1 USDC' }] }),
    })
  ).json()
  check(
    'signed txs merge onto meta.signed (receipts preserved) and dedupe by hash',
    signedOk.signed?.length === 2 && signedDupe.signed?.length === 2,
  )
  const loadedSigned = await (await fetch(`${BASE}/api/chats/${chat.id}`, { headers: C })).json()
  const signedMsg = loadedSigned.messages?.find((m: { id: string }) => m.id === msg.id)
  check(
    'meta.signed round-trips alongside the original receipts',
    signedMsg?.meta?.signed?.length === 2 && signedMsg.meta.receipts?.length === 3,
  )
  const htmlSigned = flat(await (await fetch(`${BASE}/p/${shared.publicSlug}`)).text())
  check(
    'share page renders the signing log with per-chain explorer links',
    htmlSigned.includes('Signed &amp; settled on-chain') &&
      htmlSigned.includes(`https://basescan.org/tx/${sigHashA}`) &&
      htmlSigned.includes(`https://robinhoodchain.blockscout.com/tx/${sigHashB}`),
  )

  // ── Receipt permalinks (/r) + via attribution (the viral loop) ────────────
  console.log('— receipt permalinks + via attribution')

  // Pure layer: via ids + per-kind share content + pre-written copy.
  const ownerVia = viaIdOf(owner.address)
  check(
    'viaIdOf: stable, case-insensitive, matches the accepted shape',
    ownerVia === viaIdOf(owner.address.toUpperCase()) && VIA_RE.test(ownerVia) && !ownerVia.includes(owner.address.slice(2, 8).toLowerCase()),
  )
  const dcaContent = dcaShareContent({ buyUsd: 10, buyToken: 'AAPL', sellToken: 'USDG', cadence: 'week', chainId: 4663, status: 'active' })
  check(
    'dca share content: number-forward headline + runnable ask + standing',
    dcaContent.headline === '$10.00 → AAPL · every week' && dcaContent.ask === 'buy $10 of AAPL weekly' && dcaContent.standing,
  )
  const guardContent = guardianShareContent(
    { coin: 'SYRUP', side: 'long', kind: 'stop_loss', triggerMode: 'price_move_pct', triggerValue: 8, status: 'active' },
    null,
  )
  check(
    'guardian share content: standing protection with the trigger in the headline',
    guardContent.headline.startsWith('Stop-loss standing on SYRUP') && guardContent.standing && !!guardContent.ask?.includes('stop loss'),
  )
  const standingTweet = new URL(receiptTweetHref({ id: 'rid1', headline: dcaContent.headline, ask: dcaContent.ask, standing: true, via: ownerVia }))
  check(
    'standing tweet copy leads with the machine running unattended, url carries via',
    (standingTweet.searchParams.get('text') ?? '').includes('keyboard') &&
      (standingTweet.searchParams.get('url') ?? '').endsWith(`/r/rid1?via=${ownerVia}`),
  )
  const tryHrefUrl = receiptTryHref({ ask: dcaContent.ask, via: ownerVia })
  check(
    'receipt handoff prefills the exact ask and tags the sharer',
    tryHrefUrl === `/chat?prompt=${encodeURIComponent('buy $10 of AAPL weekly')}&via=${ownerVia}`,
  )
  // The #490 finding: the tx path is the ONLY one republishing verbatim user
  // text, and prompts sometimes carry pasted recipient addresses — the
  // persisted snapshot masks every address-shaped token at write time.
  check(
    'maskAddressTokens: hex runs truncate to 0x1234…abcd, prose and short hex untouched',
    maskAddressTokens('send 5 USDC to 0xD980AF077d17BB399681D9C7fCa9E01D2F009d34 on base') === 'send 5 USDC to 0xD980…9d34 on base' &&
      maskAddressTokens('what is 0x123 in decimal') === 'what is 0x123 in decimal' &&
      maskAddressTokens('no addresses here') === 'no addresses here',
  )
  const maskedTx = txShareContent(
    [
      { id: 'u1', role: 'user', content: 'send 5 USDC on base to 0xD980AF077d17BB399681D9C7fCa9E01D2F009d34', meta: null },
      { id: 'a1', role: 'assistant', content: 'done', meta: { signed: [{ hash: `0x${'ab'.repeat(32)}`, chainId: 8453, title: 'USDC transfer' }] } },
    ],
    'a1',
  )
  check(
    'tx share content: the snapshot ask never carries a full address (#490)',
    !!maskedTx && maskedTx.ask === 'send 5 USDC on base to 0xD980…9d34' &&
      !JSON.stringify(maskedTx).includes('0xD980AF077d17BB399681D9C7fCa9E01D2F009d34'),
    JSON.stringify(maskedTx?.ask),
  )

  // API layer: mint from the signed turn created above.
  const shareAnon = await fetch(`${BASE}/api/share/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'tx', chatId: chat.id, messageId: msg.id }),
  })
  check('share mint without session → 401', shareAnon.status === 401)
  const shareBadKind = await fetch(`${BASE}/api/share/receipts`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ kind: 'selfie' }),
  })
  check('share mint with unknown kind → 400', shareBadKind.status === 400)
  const shareForeign = await fetch(`${BASE}/api/share/receipts`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: mallorySession },
    body: JSON.stringify({ kind: 'tx', chatId: chat.id, messageId: msg.id }),
  })
  check("another wallet can't mint from someone else's turn (404)", shareForeign.status === 404)

  const mintRes2 = await fetch(`${BASE}/api/share/receipts`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ kind: 'tx', chatId: chat.id, messageId: msg.id }),
  })
  const mintedShare = await mintRes2.json()
  check(
    'tx receipt mints: 201, /r url carries the sharer via id',
    mintRes2.status === 201 && !!mintedShare.id && mintedShare.via === ownerVia && String(mintedShare.url).endsWith(`/r/${mintedShare.id}?via=${ownerVia}`),
  )
  const mintAgain = await fetch(`${BASE}/api/share/receipts`, {
    method: 'POST',
    headers: CJ,
    body: JSON.stringify({ kind: 'tx', chatId: chat.id, messageId: msg.id }),
  })
  check('re-share is idempotent — same permalink back (200)', mintAgain.status === 200 && (await mintAgain.json()).id === mintedShare.id)

  // Public page: the receipt renders, the ask prefill + via ride the CTA,
  // the wallet appears ONLY truncated.
  const receiptHtml = flat(await (await fetch(`${BASE}/r/${mintedShare.id}`)).text())
  check(
    'receipt page renders the signed story with explorer links',
    receiptHtml.includes(`https://basescan.org/tx/${sigHashA}`) && receiptHtml.includes('only') && receiptHtml.includes('sign'),
  )
  check(
    'receipt CTA prefills the ask and carries ?via=',
    receiptHtml.includes(`via=${ownerVia}`) && receiptHtml.includes(encodeURIComponent('Buy $2 of AAPL on Robinhood Chain').replace(/'/g, '&#x27;')),
  )
  check(
    'receipt page never prints the full wallet',
    !receiptHtml.toLowerCase().includes(owner.address.toLowerCase()),
  )
  // Receipt → mint chip: the viewer can mint their OWN copy of the ask as an
  // intent link (the aha→link loop). Prefill handoff only — nothing auto-runs.
  check(
    'receipt page offers "Mint this as a link" with the ask prefilled',
    receiptHtml.includes('/dashboard/links?ask=') && receiptHtml.includes('Mint this as a link'),
  )
  const ogRes = await fetch(`${BASE}/r/${mintedShare.id}/opengraph-image`)
  check(
    'receipt OG image renders (200, image/png)',
    ogRes.status === 200 && (ogRes.headers.get('content-type') ?? '').startsWith('image/png'),
  )
  const twRes = await fetch(`${BASE}/r/${mintedShare.id}/twitter-image`)
  check(
    'receipt twitter image renders (200, image/png)',
    twRes.status === 200 && (twRes.headers.get('content-type') ?? '').startsWith('image/png'),
  )

  // Revoke: mallory can't, the owner can, the page 404s after.
  const revokeForeign = await fetch(`${BASE}/api/share/receipts/${mintedShare.id}`, { method: 'DELETE', headers: { cookie: mallorySession } })
  check("another wallet can't revoke (404)", revokeForeign.status === 404)
  const revokeOk = await fetch(`${BASE}/api/share/receipts/${mintedShare.id}`, { method: 'DELETE', headers: C })
  check('owner revokes the permalink', revokeOk.status === 200)
  const goneRes = await fetch(`${BASE}/r/${mintedShare.id}`)
  check('revoked receipt page → 404', goneRes.status === 404)

  // /chat ships its own social card (deep links are pasted everywhere).
  const chatHtml = flat(await (await fetch(`${BASE}/chat`)).text())
  check(
    '/chat: twitter summary_large_image + segment og:image',
    /<meta[^>]+name="twitter:card"[^>]+content="summary_large_image"/.test(chatHtml) &&
      /<meta[^>]+property="og:image"[^>]+content="[^"]*\/chat\/opengraph-image/.test(chatHtml),
  )
  const chatOg = await fetch(`${BASE}/chat/opengraph-image`)
  check('/chat OG image renders (200, image/png)', chatOg.status === 200 && (chatOg.headers.get('content-type') ?? '').startsWith('image/png'))

  // /p handoff + tweet now carry the owner's via id.
  const htmlVia = flat(await (await fetch(`${BASE}/p/${shared.publicSlug}`)).text())
  check('/p handoff CTA carries the sharer via id', htmlVia.includes(`via=${ownerVia}`))

  // Arrival stamping: a fresh wallet whose FIRST sign-in carries the via
  // cookie gets one insert-only wallet_arrivals row; later sign-ins with a
  // different via change nothing (first touch wins).
  const visitor = privateKeyToAccount(generatePrivateKey())
  const viaSignIn = async (via: string | null) => {
    const nres = await fetch(`${BASE}/api/auth/nonce`)
    const ncookie = getCookie(nres, 'yf_siwe_nonce')
    const { nonce: vn } = await nres.json()
    const vmsg = createSiweMessage({ address: visitor.address, chainId: 8453, domain: DOMAIN, nonce: vn, uri: BASE, version: '1' })
    const vsig = await visitor.signMessage({ message: vmsg })
    const cookies = [ncookie, ...(via ? [`yf_via=${via}`, 'yf_via_landing=/r/harness'] : [])].filter(Boolean).join('; ')
    const vres = await fetch(`${BASE}/api/auth/verify`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: cookies },
      body: JSON.stringify({ message: vmsg, signature: vsig }),
    })
    return { status: vres.status, body: (await vres.json()) as { address?: string; via?: string } }
  }
  const firstArrival = await viaSignIn(ownerVia)
  check('first sign-in with a via cookie stamps the arrival', firstArrival.status === 200 && firstArrival.body.via === ownerVia)
  const secondArrival = await viaSignIn('zzzz99990000')
  check('later via cookies never overwrite the first arrival', secondArrival.status === 200 && secondArrival.body.via === undefined)
  const badVia = await viaSignIn('NOT VALID $$$')
  check('malformed via cookie is ignored, login unharmed', badVia.status === 200 && badVia.body.via === undefined)

  // ── Blog post fixtures (pure — no server needed) ──────────────────────────
  // A ```figure block naming a composition BlogFigure doesn't have renders
  // NOTHING, silently. Pin every fenced block in every committed post against
  // the component's registry so a rename or a typo fails here instead of
  // shipping a post with a hole where a diagram should be.
  {
    const { POST: linksPost } = await import('./seed-links-post')
    const figureSrc = await readFile(new URL('../components/BlogFigure.tsx', import.meta.url), 'utf8')
    const registered = new Set(
      [...figureSrc.matchAll(/^\s*'([a-z-]+)':\s*\w+,$/gm)].map((m) => m[1]),
    )
    check('BlogFigure registry parsed', registered.size >= 4, `${[...registered].join(',')}`)

    const blocks = [...linksPost.content.matchAll(/```figure\n([\s\S]*?)```/g)].map((m) => m[1])
    check('links post ships figure blocks', blocks.length === 4, `${blocks.length}`)
    const named = blocks.map((b) => {
      try {
        return (JSON.parse(b) as { name?: string }).name ?? ''
      } catch {
        return ''
      }
    })
    check('every figure block is valid JSON with a name', named.every(Boolean), named.join(','))
    check(
      'every figure block names a registered composition',
      named.every((n) => registered.has(n)),
      named.filter((n) => !registered.has(n)).join(',') || 'all present',
    )
    // The cover art dispatches on slug — a renamed slug silently falls back to
    // the generated art, which is the wrong head for a bespoke composition.
    const coverSrc = await readFile(new URL('../components/BlogCoverArt.tsx', import.meta.url), 'utf8')
    check(
      'links post slug has bespoke cover art',
      coverSrc.includes(`slug === '${linksPost.slug}'`),
      linksPost.slug,
    )
    // Cover art is shown through THREE `slice` wells at different ratios, so
    // any text placed outside the safe box gets sliced by one of them (the
    // orchestration stamp used to lose its top on the post hero). Pin that no
    // literal y below the top crop survives in a text anchor.
    check(
      'cover art declares the slice-safe box',
      /const SAFE = \{ x0: 40, x1: 600, y0: 66, y1: 334 \}/.test(coverSrc),
    )
    check(
      'no cover-art text anchors outside the safe box',
      !/<text[\s\S]{0,120}?y="(?:[0-5]?\d|6[0-5]|3[4-9]\d)"/.test(coverSrc),
    )

    // The blog admin allowlist must include the hardcoded owners: ADMIN_WALLETS
    // is unset locally and unverified on Vercel, and a publish gate reading only
    // that env locks the owner out of the publish UI entirely.
    const { adminWallets: blogAdmins } = await import('../lib/blog')
    const { OWNER_WALLETS } = await import('../lib/admin')
    check(
      'blog admin allowlist covers OWNER_WALLETS even with ADMIN_WALLETS unset',
      OWNER_WALLETS.every((w) => blogAdmins().has(w)),
      `${blogAdmins().size} admins`,
    )
    check('blog admin allowlist never empty (publish UI always reachable)', blogAdmins().size > 0)
  }

  // ── Blog admin chrome: the public surface must never leak it ──────────────
  // The publish UI is server-rendered only for an admin session, but the gate
  // that matters is the API. These run unauthenticated on every harness pass.
  {
    const publicIndex = await fetch(`${BASE}/blog`).then((r) => r.text())
    check(
      'anonymous /blog renders no admin chrome',
      !publicIndex.includes('blogdrafts') && !publicIndex.includes('blogadmin'),
    )
    // 403 before 404: an anonymous PATCH must not reveal whether a slug exists.
    const anonPatchMissing = await fetch(`${BASE}/api/blog/no-such-post-xyz`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ published: true }),
    })
    check(
      'anonymous publish is 403 even for an unknown slug (no existence leak)',
      anonPatchMissing.status === 403,
      `${anonPatchMissing.status}`,
    )
  }

  // ── Blog (requires BLOG_ADMIN_PK + matching ADMIN_WALLETS on the server) ──
  const adminPk = process.env.BLOG_ADMIN_PK
  if (!adminPk) {
    console.log('— blog: SKIPPED (set BLOG_ADMIN_PK and start dev with ADMIN_WALLETS=<address>)')
  } else {
    console.log('— blog')
    const adminAcct = privateKeyToAccount(adminPk as `0x${string}`)
    const adminSession = await signIn(adminAcct)
    const AJ = { 'content-type': 'application/json', cookie: adminSession }

    const nonAdmin = await fetch(`${BASE}/api/blog`, {
      method: 'POST',
      headers: CJ, // owner wallet is NOT in ADMIN_WALLETS
      body: JSON.stringify({ title: 'x', description: 'x', content: 'x' }),
    })
    check('non-admin wallet → 403', nonAdmin.status === 403)

    const longDesc = await fetch(`${BASE}/api/blog`, {
      method: 'POST',
      headers: AJ,
      body: JSON.stringify({ title: 'x', description: 'y'.repeat(161), content: 'x' }),
    })
    check('meta description >160 chars → 400 (SEO line held)', longDesc.status === 400)

    const draftRes = await fetch(`${BASE}/api/blog`, {
      method: 'POST',
      headers: AJ,
      body: JSON.stringify({
        title: 'Harness Post: Agents & SEO!',
        description: 'A throwaway harness post.',
        content: '# Hello\n\nBody **markdown**.',
        tags: ['test'],
      }),
    })
    const draft = await draftRes.json()
    check('admin creates draft, slug auto-derived', draftRes.status === 201 && draft.slug === 'harness-post-agents-seo' && draft.published === false)

    const dupe = await fetch(`${BASE}/api/blog`, {
      method: 'POST',
      headers: AJ,
      body: JSON.stringify({ title: 'Harness Post: Agents & SEO!', description: 'd', content: 'c' }),
    })
    check('duplicate slug → 409', dupe.status === 409)

    const anonList = await (await fetch(`${BASE}/api/blog`)).json()
    const anonRead = await fetch(`${BASE}/api/blog/${draft.slug}`)
    check('anon sees no draft (list + 404 read)', !anonList.some((q: { slug: string }) => q.slug === draft.slug) && anonRead.status === 404)
    const draftView = await fetch(`${BASE}/api/blog/${draft.slug}/view`, { method: 'POST' })
    check('view beacon on a draft → 404 (existence undisclosed)', draftView.status === 404)

    const adminDrafts = await (await fetch(`${BASE}/api/blog?drafts=1`, { headers: { cookie: adminSession } })).json()
    check('admin ?drafts=1 lists the draft', adminDrafts.some((q: { slug: string }) => q.slug === draft.slug))

    // Headless publish via Bearer key (the Claude-publishes path).
    const adminKey = await (
      await fetch(`${BASE}/api/keys`, { method: 'POST', headers: AJ, body: JSON.stringify({ label: 'blog harness' }) })
    ).json()
    const pub = await fetch(`${BASE}/api/blog/${draft.slug}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${adminKey.secret}` },
      body: JSON.stringify({ published: true }),
    })
    const pubBody = await pub.json()
    check('Bearer-key admin publishes (headless path)', pub.status === 200 && pubBody.published === true && !!pubBody.publishedAt)

    const unpub = await (await fetch(`${BASE}/api/blog/${draft.slug}`, { method: 'PATCH', headers: AJ, body: JSON.stringify({ published: false }) })).json()
    const repub = await (await fetch(`${BASE}/api/blog/${draft.slug}`, { method: 'PATCH', headers: AJ, body: JSON.stringify({ published: true }) })).json()
    check('publishedAt set exactly once (SEO datePublished stable)', unpub.publishedAt === pubBody.publishedAt && repub.publishedAt === pubBody.publishedAt)

    const anonNow = await fetch(`${BASE}/api/blog/${draft.slug}`)
    check('published post is public', anonNow.status === 200)

    // View beacon: anonymous POST increments, twice means +2, and the bump must
    // NOT touch updated_at (that's the SEO dateModified — a view is not an edit).
    const preViews = await (await fetch(`${BASE}/api/blog/${draft.slug}`)).json()
    const v1 = await (await fetch(`${BASE}/api/blog/${draft.slug}/view`, { method: 'POST' })).json()
    const v2 = await (await fetch(`${BASE}/api/blog/${draft.slug}/view`, { method: 'POST' })).json()
    const postViews = await (await fetch(`${BASE}/api/blog/${draft.slug}`)).json()
    check(
      'view beacon increments views',
      v1.views === preViews.views + 1 && v2.views === preViews.views + 2 && postViews.views === preViews.views + 2,
    )
    check('view beacon leaves updated_at alone (SEO dateModified)', postViews.updatedAt === preViews.updatedAt)
    const vMissing = await fetch(`${BASE}/api/blog/no-such-post-xyz/view`, { method: 'POST' })
    check('view beacon on unknown slug → 404', vMissing.status === 404)

    // Upload route: auth gate + unconfigured-Blob 503 (success path needs
    // BLOB_READ_WRITE_TOKEN — flagged manual until the owner creates a store).
    const upAnon = await fetch(`${BASE}/api/blog/upload`, { method: 'POST' })
    const upNonAdmin = await fetch(`${BASE}/api/blog/upload`, { method: 'POST', headers: C })
    check('upload: anon + non-admin → 403', upAnon.status === 403 && upNonAdmin.status === 403)
    const upAdmin = await fetch(`${BASE}/api/blog/upload`, { method: 'POST', headers: { cookie: adminSession } })
    const upBody = await upAdmin.json()
    if (process.env.BLOB_READ_WRITE_TOKEN) {
      check('upload: admin reaches form validation (token set)', upAdmin.status === 400)
    } else {
      check('upload: admin → 503 naming BLOB_READ_WRITE_TOKEN', upAdmin.status === 503 && String(upBody.error).includes('BLOB_READ_WRITE_TOKEN'))
    }

    const delPost = await fetch(`${BASE}/api/blog/${draft.slug}`, { method: 'DELETE', headers: { cookie: adminSession } })
    const delKey = await fetch(`${BASE}/api/keys/${adminKey.id}`, { method: 'DELETE', headers: { cookie: adminSession } })
    const anonAfter = await (await fetch(`${BASE}/api/blog`)).json()
    check('blog cleanup: post + key deleted', delPost.status === 200 && delKey.status === 200 && !anonAfter.some((q: { slug: string }) => q.slug === draft.slug))

    // ── Intent links: admin cap exemption, wired end-to-end ────────────────
    // The same ADMIN_WALLETS gate that admits this wallet to /api/blog must
    // lift the plan's active-link cap in the mint route: mint one PAST the
    // free cap (4 active) — every mint 200s. Revoked after (rows persist,
    // but only under this dedicated test-admin wallet).
    const adminMints: string[] = []
    let adminMintsOk = true
    for (let i = 0; i < 4; i++) {
      const r = await fetch(`${BASE}/api/intent-links`, { method: 'POST', headers: AJ, body: JSON.stringify({ ask: `Buy $${i + 2} of AAPL` }) })
      adminMintsOk &&= r.status === 200
      const s = ((await r.json()) as { slug?: string }).slug
      if (s) adminMints.push(s)
    }
    check('intent links: admin wallet mints past the free cap (4th mint 200, no 402)', adminMintsOk && adminMints.length === 4)
    await Promise.all(adminMints.map((s) => fetch(`${BASE}/api/intent-links/${s}`, { method: 'DELETE', headers: { cookie: adminSession } })))
  }

  // ── Admin adoption overview (negatives always; 200 path needs an admin PK) ──
  console.log('— admin overview')
  const ovAnon = await fetch(`${BASE}/api/admin/overview`)
  check('overview: no auth → 401', ovAnon.status === 401)
  const ovNonAdmin = await fetch(`${BASE}/api/admin/overview`, { headers: C })
  check('overview: non-admin wallet → 403', ovNonAdmin.status === 403)

  const ovAdminPk = process.env.ADMIN_PK ?? process.env.BLOG_ADMIN_PK
  if (!ovAdminPk) {
    console.log('  ↳ admin 200 path SKIPPED (set ADMIN_PK and start dev with ADMIN_WALLETS=<its address>)')
  } else {
    const ovSession = await signIn(privateKeyToAccount(ovAdminPk as `0x${string}`))
    const ov = await fetch(`${BASE}/api/admin/overview`, { headers: { cookie: ovSession } })
    const o = await ov.json()
    check(
      'overview: admin → 200 with tiles + funnel + roster',
      ov.status === 200 && !!o.tiles && Array.isArray(o.funnel) && Array.isArray(o.roster),
    )
    check(
      'overview: v2 blocks present (activation + recentArrivals + cohorts + recentSignups)',
      !!o.activation &&
        typeof o.activation.count === 'number' &&
        Array.isArray(o.recentArrivals) &&
        Array.isArray(o.cohorts) &&
        Array.isArray(o.recentSignups),
    )
    const f = Object.fromEntries((o.funnel ?? []).map((s: { key: string; value: number }) => [s.key, s.value]))
    check(
      'overview: funnel invariants hold (signedIn ≥ activated/paid ≥ repeat)',
      f.signedIn >= f.activated && f.signedIn >= f.paid && f.paid >= f.repeat,
    )
    const ovExcl = await (
      await fetch(`${BASE}/api/admin/overview?excludeOwners=1`, { headers: { cookie: ovSession } })
    ).json()
    check('overview: ?excludeOwners=1 echoes the flag', ovExcl.excludeOwners === true)

    // A TOGGLE IS NOT AN ARRIVAL. A wallet that only ever curated its agent
    // list and kept no grant must not appear as a signed-in user: that path
    // is exactly what the harness itself walks every run, and counting it
    // inflated the adoption curve with 276 phantom wallets in eleven days.
    const ghost = privateKeyToAccount(generatePrivateKey())
    const ghostSession = await signIn(ghost)
    const GJ = { 'content-type': 'application/json', cookie: ghostSession }
    const ghostDir = await (await fetch(`${BASE}/api/servers`)).json()
    const ghostSrv = ghostDir.find((s: { callable: boolean }) => s.callable) ?? ghostDir[0]
    await fetch(`${BASE}/api/approvals`, { method: 'PUT', headers: GJ, body: JSON.stringify({ serverId: ghostSrv.id, approved: false }) })
    await fetch(`${BASE}/api/approvals`, { method: 'PUT', headers: GJ, body: JSON.stringify({ serverId: ghostSrv.id, approved: true }) })
    for (const g of (await (await fetch(`${BASE}/api/grants`, { headers: { cookie: ghostSession } })).json()) as { id: string }[]) {
      await fetch(`${BASE}/api/grants/${g.id}`, { method: 'DELETE', headers: { cookie: ghostSession } })
    }
    const ovAfter = await (await fetch(`${BASE}/api/admin/overview`, { headers: { cookie: ovSession } })).json()
    const ghostLc = ghost.address.toLowerCase()
    const seenIn = (rows: unknown): boolean =>
      Array.isArray(rows) && rows.some((r) => String((r as { address?: string }).address ?? '').toLowerCase() === ghostLc)
    check(
      'overview: an approvals-only wallet never counts as an arrival (no phantom users from curation)',
      !seenIn(ovAfter.roster) && !seenIn(ovAfter.recentArrivals),
    )
  }

  // ── Email signup (double opt-in) ──────────────────────────────────────────
  console.log('— subscribe')
  // .invalid domain → stored but never emailed (isUndeliverable guard), and the
  // fixed address upserts so re-runs never accumulate rows.
  const subEmail = 'harness-subscribe@yeetful-test.invalid'
  const SJ = { 'content-type': 'application/json' }
  const subBad = await fetch(`${BASE}/api/subscribe`, { method: 'POST', headers: SJ, body: JSON.stringify({ email: 'not-an-email' }) })
  check('subscribe: invalid email → 400', subBad.status === 400)
  const subRes = await fetch(`${BASE}/api/subscribe`, { method: 'POST', headers: SJ, body: JSON.stringify({ email: subEmail }) })
  const subBody = await subRes.json().catch(() => ({}))
  check('subscribe: valid email → 201 pending', subRes.status === 201 && subBody.status === 'pending' && subBody.emailSent === false)
  const subDup = await fetch(`${BASE}/api/subscribe`, { method: 'POST', headers: SJ, body: JSON.stringify({ email: subEmail }) })
  check('subscribe: idempotent on email (re-issues token, no 409)', subDup.status === 201)
  const verBad = await fetch(`${BASE}/api/subscribe/verify?token=bogus-token`, { redirect: 'manual' })
  check(
    'verify: bad token → redirect ?subscribed=invalid',
    verBad.status >= 300 && verBad.status < 400 && (verBad.headers.get('location') ?? '').includes('subscribed=invalid'),
  )

  // ── MCP ownership claim (M5) ──────────────────────────────────────────────
  // Deterministic paths only (no GitHub network / seed coupling): the happy
  // path needs a real repo with .well-known/yeetful-claim.txt and is verified
  // manually. Here: routing, SIWE gate, and slug validation.
  // Claim is verified by signing in with the MCP's x402 payTo (read from its own
  // endpoint). Deterministic paths only; the happy path needs the payee wallet.
  console.log('— mcp ownership claim')
  const claimNoSlug = await fetch(`${BASE}/api/mcp/__nope__/claim`)
  check('claim status: unknown MCP → 404', claimNoSlug.status === 404)

  const claimAnon = await fetch(`${BASE}/api/mcp/__nope__/claim`, { method: 'POST' })
  check('claim without session → 401', claimAnon.status === 401)

  const claimUnknown = await fetch(`${BASE}/api/mcp/__nope__/claim`, { method: 'POST', headers: C })
  check('claim signed-in, unknown MCP → 404 (session accepted)', claimUnknown.status === 404)

  // A non-payee, non-admin wallet can't claim a real MCP (the core of the fix).
  const someServers = (await (await fetch(`${BASE}/api/servers`)).json().catch(() => [])) as { slug?: string }[]
  const someSlug = Array.isArray(someServers) ? someServers.find((s) => s.slug)?.slug : undefined
  if (someSlug) {
    const notPayee = await fetch(`${BASE}/api/mcp/${someSlug}/claim`, { method: 'POST', headers: C })
    check('claim a real MCP as a non-payee wallet → rejected (400)', notPayee.status === 400)
  }

  // ── Cross-chain swap: parse + the SAFETY guardrail on the built transfer ──
  // The guardrail is the load-bearing check — it's what stopped the house
  // model's fabricated deposit address from ever becoming a signable tx.
  {
    const p = parseCrossChainSwap('swap 1 USDC from base to arbitrum')
    check('xchain parse: "from base to arbitrum"', !!p && !('problem' in p) && p.amount === '1' && p.originChain === 'base' && p.destinationChain === 'arbitrum' && p.originToken === 'USDC' && p.destinationToken === 'USDC')
    const p2 = parseCrossChainSwap('swap 1 USDC on base to 1 USDC on arbitrum')
    check('xchain parse: "on base to 1 USDC on arbitrum"', !!p2 && !('problem' in p2) && p2.destinationChain === 'arbitrum')
    const p3 = parseCrossChainSwap('swap 1 USDC on base to ETH on optimism')
    check('xchain parse: second token named', !!p3 && !('problem' in p3) && p3.destinationToken === 'ETH' && p3.destinationChain === 'optimism')
    check('xchain parse: plain Base swap is NOT cross-chain', parseCrossChainSwap('swap 100 USDC for WETH') === null)
    const miss = parseCrossChainSwap('swap 1 USDC from base')
    check('xchain parse: missing destination → problem', !!miss && 'problem' in miss)
    check('xchain chainId map', expectedOriginChainId('base') === 8453 && expectedOriginChainId('arbitrum') === 42161)
    const rh = parseCrossChainSwap('swap 1 USDC from base to robinhood chain')
    check('xchain parse: "to robinhood chain"', !!rh && !('problem' in rh) && rh.destinationChain?.toLowerCase().startsWith('robinhood') === true)
    check('xchain chainId map: robinhood = 4663', expectedOriginChainId('robinhood') === 4663 && expectedOriginChainId('robinhood chain') === 4663)

    // ── Chain lexicon: typo tolerance + honest clarifies (audit 2026-07-22) ──
    // The live dead-end: "swap 1 USDC from base to Etheruem" answered "Say
    // the amount and pair…" — a typo'd chain word must never fall out of the
    // cross-chain layer or gaslight the user about what they already typed.
    const typo = parseCrossChainSwap('swap 1 USDC from base to Etheruem')
    check('lexicon: "to Etheruem" builds base→ethereum (canonical)', !!typo && !('problem' in typo) && typo.destinationChain === 'ethereum' && typo.originChain === 'base')
    check('lexicon: detectCrossChain sees the typo\'d chain', detectCrossChain('swap 1 USDC from base to Etheruem').crossChain === true)
    const fuzz = parseCrossChainSwap('swap 5 USDC from base to Ethereom')
    check('lexicon: uncurated typo resolves via fuzzy (chain slot only)', !!fuzz && !('problem' in fuzz) && fuzz.destinationChain === 'ethereum')
    const dOnly = parseCrossChainSwap('bridge 5 USDC to Arbitrum')
    check('xchain: destination-only bridge asks for the ORIGIN, not "amount and pair"', !!dOnly && 'problem' in dOnly && /come FROM/.test(dOnly.problem))
    const noAmt = parseCrossChainSwap('move my USDC from base to solana')
    check('xchain: amountless move asks for the AMOUNT only', !!noAmt && 'problem' in noAmt && /How much USDC/.test(noAmt.problem))
    check('xchain: wh-questions still fall through to the planner', parseCrossChainSwap("What's the cheapest way to convert USDT from Ethereum to Base?") === null)
    const chainAsBuy = parseSwapIntent('swap 1 USDC to arbitrum')
    check('swap intent: chain in the buy slot → origin clarify, never token "ARBITRUM"', chainAsBuy.isSwap && !!chainAsBuy.problem && /FROM/.test(chainAsBuy.problem))
    const ethBuy = parseSwapIntent('swap 1 USDC to eth')
    check('swap intent: short chain-ish words (eth) stay tokens', ethBuy.isSwap && !ethBuy.problem && ethBuy.buyToken?.toLowerCase() === 'eth')
    const trTypo = parseTransferSegment('send 1 USDC on Aribtrum to 0x1111111111111111111111111111111111111111')
    check('transfer: typo\'d chain word still resolves the chain', !!trTypo && !('problem' in trTypo) && trTypo.chainId === 42161)
    const armLink = parseGuardianArm('Set a stop-loss on my Hyperliquid ETH position at -5%')
    check('guardian: legacy /i/stop-loss link phrasing parses (venue word stripped)', !!armLink && armLink.coin === 'ETH' && armLink.triggerValue === 5)
    const fundTypo = parseRobinhoodFunding('Fund Robbinhood chain with $12 from base')
    check('jobs funding: typo\'d "Robbinhood chain" still compiles', !!fundTypo && fundTypo.fundUsd === 12)
    check('lexicon: ENS names in chain slots are never rewritten', normalizeChainWords('send 1 USDC on arbitrum to polygonn.eth').includes('polygonn.eth'))
    check('lexicon: "a ton of USDC" is not a chain', detectCrossChain('swap a ton of USDC for ETH').chains.length === 0)
    check('lexicon: "based" never fuzzy-matches base', canonicalChainWord('based') === null)

    // ── NFT-buy funding resume (the 2026-07-23 unfunded "buy this NFT") ───
    // The funding offer's chips append this exact follow-up; it must compile
    // as a job whose last steps are the guarded buy + its ownership wait.
    const nftFundResume = compileJobAsk(
      'Swap 5 USDC from base to ETH on base, then buy the nft https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198',
    )
    check(
      'jobs: fund-then-buy-nft resume compiles (cross-chain leg → wait → nft buy → owned wait)',
      !!nftFundResume && !('problem' in nftFundResume) &&
        JSON.stringify(nftFundResume.steps.map((st) => `${st.kind}:${st.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-nft-buy', 'wait:wait']),
      JSON.stringify(nftFundResume),
    )
    const nftFundCap = compileJobAsk(
      'Swap 5 USDC from base to ETH on base, then buy the nft https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198 for up to 0.01 ETH',
    )
    check(
      'jobs: the resume preserves an explicit ETH cap on the buy step',
      !!nftFundCap && !('problem' in nftFundCap) &&
        (nftFundCap.steps.find((st) => st.builder === 'native-nft-buy')?.params as { maxPriceEth?: string | null })?.maxPriceEth === '0.01',
      JSON.stringify(nftFundCap),
    )
    const sameChainPlan = planFundingChips(
      { chainId: 8453, token: 'ETH', amountHuman: 0.0062, followupResume: 'buy the nft https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198', actionLabel: 'the buy' },
      10,
      [
        { chainId: 8453, chainWord: 'base', token: 'USDC', balance: 12, usd: 12 },
        { chainId: 42161, chainWord: 'arbitrum', token: 'USDC', balance: 6, usd: 6 },
      ],
      0,
    )
    check(
      'funding plan: a destination-chain USDC source converts SAME-CHAIN (venue swap leg, ranked first, no bridge)',
      sameChainPlan.kind === 'offer' && /^Swap 10\.?\d* USDC for ETH on base/i.test(sameChainPlan.chips[0].resume),
      JSON.stringify(sameChainPlan).slice(0, 200),
    )
    const sameChainJob = sameChainPlan.kind === 'offer' ? compileJobAsk(sameChainPlan.chips[0].resume) : null
    check(
      'funding plan: the same-chain chip resume round-trips the jobs compiler (native-swap → nft buy)',
      !!sameChainJob && !('problem' in sameChainJob) &&
        JSON.stringify(sameChainJob.steps.map((st) => st.builder)) === JSON.stringify(['native-swap', 'native-nft-buy', 'wait']),
      JSON.stringify(sameChainJob),
    )
    const destTokenExcluded = planFundingChips(
      { chainId: 8453, token: 'ETH', amountHuman: 0.005, followupResume: '', actionLabel: 'the buy' },
      10,
      [{ chainId: 8453, chainWord: 'base', token: 'ETH', balance: 0.01, usd: 19 }],
      0,
    )
    check('funding plan: the needed token on the destination chain is never a source (already counted)', destTokenExcluded.kind === 'short')

    // ── The short-refusal copy (live 2026-07-23: a wallet holding $20 USDC
    // on Base with zero gas ETH hit the HYPE house link four times and was
    // told "I found no movable ETH or USDC" — stranded funds must be NAMED).
    const hlNeed: FundingNeed = { chainId: 42161, token: 'USDC', amountHuman: 5, followupResume: '', actionLabel: 'the Hyperliquid position' }
    const strandedBase: FundingSource = { chainId: 8453, chainWord: 'Base', token: 'USDC', balance: 20, usd: 20 }
    const refusalStranded = shortRefusalCopy({
      chainsRead: 'Base, Arbitrum and Ethereum', need: hlNeed, needUsd: 8, sourceSummary: '', stranded: [strandedBase], movableTotalUsd: 0,
    })
    check(
      'funding refusal: gas-stranded USDC is NAMED with the one-line gas rescue (the HYPE house-link wall)',
      refusalStranded.includes('~$20 of USDC on Base') && /already there/.test(refusalStranded) && /no ETH on Base/.test(refusalStranded) &&
        /Send a little ETH/.test(refusalStranded) && !/found no movable/.test(refusalStranded),
      refusalStranded,
    )
    const refusalEmpty = shortRefusalCopy({
      chainsRead: 'Base, Arbitrum and Ethereum', need: hlNeed, needUsd: 8, sourceSummary: '', stranded: [], movableTotalUsd: 0,
    })
    check(
      'funding refusal: a truly empty wallet keeps the honest "no movable" line',
      /found no movable ETH or USDC/.test(refusalEmpty) && /Top up any of those chains/.test(refusalEmpty),
      refusalEmpty,
    )
    const refusalStillShort = shortRefusalCopy({
      chainsRead: 'Base, Arbitrum and Ethereum', need: hlNeed, needUsd: 40, sourceSummary: '~$3 of ETH on Arbitrum',
      stranded: [strandedBase], movableTotalUsd: 3,
    })
    check(
      'funding refusal: stranded funds that still don\'t cover are named without an "already there" claim',
      refusalStillShort.includes('~$20 of USDC on Base') && /gas ETH on Base/.test(refusalStillShort) && !/already there/.test(refusalStillShort),
      refusalStillShort,
    )
    const refusalDestStranded = shortRefusalCopy({
      chainsRead: 'Base, Arbitrum and Ethereum', need: hlNeed, needUsd: 8, sourceSummary: '',
      stranded: [{ chainId: 42161, chainWord: 'Arbitrum', token: 'USDC', balance: 20, usd: 20 }], movableTotalUsd: 0,
    })
    check(
      'funding refusal: destination-chain same-token stranded is named but never counts as "enough" (already in the shortfall)',
      refusalDestStranded.includes('~$20 of USDC on Arbitrum') && !/already there/.test(refusalDestStranded) && /gas ETH on Arbitrum/.test(refusalDestStranded),
      refusalDestStranded,
    )
    // Sub-reserve ETH (real money under the chain's keep-back) must be named
    // as unusable, never silently dropped and never promised.
    const refusalSubReserve = shortRefusalCopy({
      chainsRead: 'Base, Arbitrum and Ethereum', need: hlNeed, needUsd: 8, sourceSummary: '',
      stranded: [strandedBase, { chainId: 1, chainWord: 'Ethereum', token: 'ETH', balance: 0.001, usd: 2 }], movableTotalUsd: 0,
    })
    check(
      'funding refusal: sub-reserve ETH is named as unusable (never dropped, never promised)',
      refusalSubReserve.includes('~$2 of ETH on Ethereum') && /under what a move from there costs/.test(refusalSubReserve) &&
        /Send a little ETH .* on Base/.test(refusalSubReserve) && !/on Base and Ethereum/.test(refusalSubReserve),
      refusalSubReserve,
    )
    // Short ONLY because a gas-included ETH plan must keep leg 1's own fee
    // back (sourceCapUsd): the visible balance looks big enough, so the copy
    // owes the user the reason and the number it CAN commit — otherwise
    // "~$8.50 of ETH" next to "moves ~$8" reads as a broken product.
    const refusalHeadroom = shortRefusalCopy({
      chainsRead: 'Base, Arbitrum and Ethereum', need: hlNeed, needUsd: 8, sourceSummary: '~$8.50 of ETH on Ethereum',
      stranded: [], movableTotalUsd: 8.5, promisableUsd: 7.5,
    })
    check(
      'funding refusal: an ETH plan short only by its own leg-1 fee explains the two moves and names what it CAN commit',
      refusalHeadroom.includes('~$8.50 of ETH on Ethereum') && /two moves off that one balance/.test(refusalHeadroom) &&
        /only safely commit ~\$7\.50/.test(refusalHeadroom) && !/found no movable/.test(refusalHeadroom),
      refusalHeadroom,
    )

    // The donor-topup rescue: stranded USDC + a movable source elsewhere →
    // one job (topup gas → move → act); the chip resume is the contract.
    const rescue = planStrandedRescue({
      need: hlNeed, needUsd: 6.5, gasUsd: 0,
      sources: [{ chainId: 42161, chainWord: 'Arbitrum', token: 'ETH', balance: 0.0008, usd: 1.6 }],
      stranded: [strandedBase], ethUsd: 2000,
    })
    const rescueJob = rescue ? compileJobAsk(rescue.chips[0].resume) : null
    check(
      'funding rescue: L2 donor + stranded Base USDC → topup chip whose resume compiles (gas → move)',
      !!rescue && rescue.donor.chainWord === 'Arbitrum' && rescue.target.chainWord === 'Base' &&
        !!rescueJob && !('problem' in rescueJob) && rescueJob.steps.length >= 2,
      JSON.stringify({ resume: rescue?.chips[0].resume, steps: rescueJob && 'steps' in rescueJob ? rescueJob.steps.map((st) => st.builder) : null }),
    )
    check(
      'funding rescue: no donor rich enough → null (the named refusal is the honest floor)',
      planStrandedRescue({ need: hlNeed, needUsd: 6.5, gasUsd: 0, sources: [], stranded: [strandedBase], ethUsd: 2000 }) === null,
    )
    check(
      'funding rescue: destination same-token stranded is never a rescue target (already in the shortfall)',
      planStrandedRescue({
        need: hlNeed, needUsd: 6.5, gasUsd: 0,
        sources: [{ chainId: 8453, chainWord: 'Base', token: 'ETH', balance: 0.005, usd: 10 }],
        stranded: [{ chainId: 42161, chainWord: 'Arbitrum', token: 'USDC', balance: 20, usd: 20 }], ethUsd: 2000,
      }) === null,
    )

    // ── Flexible follow-ups (the 2026-07-23 Lido wall): "stake all my ETH"
    // sizes itself to whatever arrives, so a wallet short of the FULL plan
    // still gets a smaller move — never a wall while movable money exists
    // above the priced floor. Fixed-size needs (no flexMinAmountHuman)
    // must be untouched by the branch.
    const flexNeed: FundingNeed = { chainId: 1, token: 'ETH', amountHuman: 0.0371, followupResume: 'stake all my ETH on Lido', actionLabel: 'the stake', flexMinAmountHuman: 0 }
    const flexScan = {
      sources: [{ chainId: 8453, chainWord: 'Base', token: 'USDC' as const, balance: 12, usd: 12 }],
      stranded: [], ethUsd: 2000, readChains: ['Base', 'Ethereum', 'Arbitrum'], failedChains: [],
    }
    const flexDown = decideFundingTurn({ need: flexNeed, needUsd: 83, gasUsd: 0, scan: flexScan, destChainName: 'Ethereum', flexMinUsd: 0 })
    const flexJob = flexDown.kind === 'offer' ? compileJobAsk(flexDown.turn.clarify.options[0].resume) : null
    check(
      'funding flex: short of the full plan → "Move what I\'ve got" chip that compiles (stake sizes itself)',
      flexDown.kind === 'offer' && /^Move what I've got/.test(flexDown.turn.clarify.options[0].label) &&
        flexDown.turn.clarify.options[0].resume.endsWith('then stake all my ETH on Lido') &&
        flexDown.turn.clarify.options.filter((o) => o.label === 'Not now').length === 1 &&
        !!flexJob && !('problem' in flexJob),
      JSON.stringify(flexDown.kind === 'offer' ? flexDown.turn.clarify.options : flexDown),
    )
    const flexFixed = decideFundingTurn({ need: { ...flexNeed, flexMinAmountHuman: undefined }, needUsd: 83, gasUsd: 0, scan: flexScan, destChainName: 'Ethereum' })
    check('funding flex: a fixed-size need never downsizes (refusal unchanged)', flexFixed.kind === 'refusal')
    const flexFloor = decideFundingTurn({ need: flexNeed, needUsd: 83, gasUsd: 0, scan: flexScan, destChainName: 'Ethereum', flexMinUsd: 40 })
    check('funding flex: capacity under the priced floor → the honest refusal stands', flexFloor.kind === 'refusal')

    // Acquisition grammar (live 2026-07-23: "I need $50 of USDG on Robinhood,
    // can you make that happen?" fell to the planner, which called USDG "not
    // a standard token").
    const needUsdg = parseSwapIntent('I need $50 of USDG on Robinhood, can you make that happen?')
    check(
      'swap intent: "I need $50 of USDG on Robinhood" parses as a dollar acquisition (never the planner)',
      needUsdg.isSwap && !needUsdg.problem && needUsdg.sellAmountUsd === '50' && needUsdg.buyToken?.toUpperCase() === 'USDG',
      JSON.stringify(needUsdg),
    )
    const needIn = parseSwapIntent('I need $20 in USDG on robinhood')
    check('swap intent: "$20 in USDG" variant parses too', needIn.isSwap && !needIn.problem && needIn.sellAmountUsd === '20')
    const getMe = parseSwapIntent('get me $20 worth of AAPL')
    check('swap intent: "get me $20 worth of AAPL" rides the dollar-buy shape', getMe.isSwap && !getMe.problem && getMe.sellAmountUsd === '20' && getMe.buyToken?.toUpperCase() === 'AAPL')
    const wantSwap = parseSwapIntent('I want to swap 1 USDC for WETH')
    check('swap intent: "I want to swap 1 USDC for WETH" keeps the market grammar (need-verbs never hijack)', wantSwap.isSwap && wantSwap.sellAmountHuman === '1' && wantSwap.sellToken === 'USDC')
    check('swap intent: "I want to send all my USDC…" is NOT a swap (transfer territory)', parseSwapIntent('I want to send all my USDC on arbitrum to nate.eth').isSwap === false)

    // ── Ask-failure classifier (the wall logger's pure core) ──────────────
    check(
      'ask-failure: money-shaped detector (verb + evidence, questions stay out)',
      moneyShaped('I WOULD LIKE TO BUY THIS NFT  https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198') &&
        moneyShaped('send all my USDC on base to nate.eth') &&
        moneyShaped('I need $50 of USDG on Robinhood, can you make that happen?') &&
        !moneyShaped('what is a swap?') &&
        !moneyShaped('tell me a joke') &&
        !moneyShaped('how do fees work?'),
    )
    check(
      'ask-failure: actionable turns never classify as failures',
      classifyTurn({ reply: 'x', txRequest: {} }).kind === null &&
        classifyTurn({ reply: 'x', txChain: {} }).kind === null &&
        classifyTurn({ reply: 'x', clarify: { question: 'q', options: [] } }).kind === null &&
        classifyTurn({ reply: 'x', jobId: 'j' }).kind === null &&
        classifyTurn({ reply: 'connect first', connectWallet: true }).kind === null,
    )
    check(
      'ask-failure: walls classify by the layer that answered',
      classifyTurn({ reply: 'sorry, no idea' }).kind === 'planner-answer' &&
        classifyTurn({ reply: 'cannot', buildPath: 'native-transfer' }).kind === 'native-wall' &&
        classifyTurn({ reply: 'refused', blocked: true }).kind === 'blocked' &&
        classifyTurn(null).kind === 'error',
    )
    // ── The funds-snapshot assembly (pure): counting rules the funded=1
    // queue depends on. A USDT-only wallet used to log had_funds=false —
    // indistinguishable from an empty one — so USDT demand had no data; and
    // multiple token rows sharing a chain (USDC.e today, spendable ETH rows
    // once the funding scan grows them) must never price that chain's gas
    // ETH more than once.
    {
      const FO = (chainId: number, word: string, usd: number, gasEth: number, token = 'USDC') => ({ chainId, word, token, usd, gasEth })
      const usdcRow = FO(42161, 'Arbitrum', 10, 0.002)
      const usdceRow = FO(42161, 'Arbitrum', 5, 0.002, 'USDC.e')
      const ethRow = { ...FO(8453, 'Base', 100, 0.06, 'ETH'), spendable: true }
      const built = buildFundsDetail(
        { origins: [usdcRow, usdceRow, ethRow], gaslessOrigins: [], allScanned: [usdcRow, usdceRow, ethRow], failedOrigins: ['Ethereum'], usdgAtoms: BigInt(4_800_000) },
        2000,
        [{ symbol: 'USDT', word: 'Ethereum', usd: 50 }],
      )
      check(
        'ask-failure snapshot: gas priced once per chain, ETH rows never double-count, USDT named with its no-path marker',
        // 10 + 5 (stables) + 4 (Arb gas once: 0.002×2000) + 120 (Base gas
        // 0.06×2000 — covers the ETH row, which itself adds nothing) +
        // 4.80 USDG + 50 USDT = 193.80
        built.totalUsd === 193.8 &&
          built.parts.filter((p) => /ETH Arbitrum/.test(p)).length === 1 &&
          !built.parts.some((p) => /\$100 ETH/.test(p)) &&
          built.parts.some((p) => p === '$50 USDT Ethereum (no funding path yet)') &&
          built.parts.some((p) => /unscanned: Ethereum/.test(p)),
        JSON.stringify(built),
      )
      const bare = buildFundsDetail({ origins: [], gaslessOrigins: [], allScanned: [], failedOrigins: [], usdgAtoms: BigInt(0) }, null, [{ symbol: 'USDT', word: 'Base', usd: 7.25 }])
      check(
        'ask-failure snapshot: a USDT-only wallet now measures as funded (the demand signal)',
        bare.totalUsd === 7.25 && bare.parts.length === 1 && /USDT Base \(no funding path yet\)/.test(bare.parts[0]),
        JSON.stringify(bare),
      )
      check(
        'ask-failure snapshot: probe tokens stay 6-dec on the three funding origins (registry sanity)',
        [1, 8453, 42161].every((id) => (FAILURE_PROBE_TOKENS[id] ?? []).every((t) => t.decimals === 6 && /^0x[0-9a-fA-F]{40}$/.test(t.address) && t.symbol === 'USDT')),
      )
    }

    const DEPOSIT = '0x7ff0D96c9f0528f0FF8dd948b2D316806fE3c7f2'
    const USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const goodData = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEPOSIT as `0x${string}`, BigInt(1000000)] })
    const goodBuild = {
      kind: 'swap_ready',
      quote: { sell: { amountAtoms: '1000000' }, summary: 'Swap 1 USDC Base → Arbitrum' },
      deposit: { address: DEPOSIT, addressExpires: '2026-07-12T00:00:00Z' },
      steps: [{ action: 'send_transaction', summary: 'deposit', tx: { to: USDC_BASE, data: goodData, value: '0', chainId: 8453 } }],
    }
    const g = guardCrossChainBuild(goodBuild, { chainId: 8453 })
    check('xchain guard: correct transfer PASSES', g.ok && g.tx?.to === USDC_BASE && g.depositAddress === DEPOSIT)

    // Wrong recipient (the fabricated-address class of bug) MUST be refused.
    const evilData = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: ['0x000000000000000000000000000000000000dEaD' as `0x${string}`, BigInt(1000000)] })
    const evilBuild = { ...goodBuild, steps: [{ action: 'send_transaction', tx: { to: USDC_BASE, data: evilData, value: '0', chainId: 8453 } }] }
    check('xchain guard: transfer to a DIFFERENT address is refused', !guardCrossChainBuild(evilBuild, { chainId: 8453 }).ok)

    // Wrong amount refused.
    const wrongAmt = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [DEPOSIT as `0x${string}`, BigInt(5000000)] })
    const wrongAmtBuild = { ...goodBuild, steps: [{ action: 'send_transaction', tx: { to: USDC_BASE, data: wrongAmt, value: '0', chainId: 8453 } }] }
    check('xchain guard: wrong transfer amount is refused', !guardCrossChainBuild(wrongAmtBuild, { chainId: 8453 }).ok)

    // Wrong chain refused.
    check('xchain guard: wrong chainId is refused', !guardCrossChainBuild({ ...goodBuild, steps: [{ action: 'send_transaction', tx: { to: USDC_BASE, data: goodData, value: '0', chainId: 1 } }] }, { chainId: 8453 }).ok)

    // No deposit address at all → refused (never fabricate one).
    check('xchain guard: missing deposit address is refused', !guardCrossChainBuild({ ...goodBuild, deposit: { address: undefined } }, { chainId: 8453 }).ok)

    // Native transfer path.
    const nativeBuild = { kind: 'swap_ready', quote: { sell: { amountAtoms: '1000000000000000000' } }, deposit: { address: DEPOSIT }, steps: [{ action: 'send_transaction', tx: { to: DEPOSIT, data: '0x', value: '1000000000000000000', chainId: 8453 } }] }
    check('xchain guard: native transfer to deposit address PASSES', guardCrossChainBuild(nativeBuild, { chainId: 8453 }).ok)

    // ── The venue fee (1Click appFees) ──────────────────────────────────────
    // It rides the quote, so the DEPOSIT is identical with or without it —
    // the guard's job is only to police who the fee pays.
    const ONECLICK_SHARE = '5880ad2b362620fadf759cbceb1cd5737ce8c6ed7fb8e9942881e6731f9247dd'
    const feeExpect = { recipient: TREASURY_ADDRESS, bps: CROSS_CHAIN_FEE_BPS }
    const feeSplit = [
      { recipient: TREASURY_ADDRESS, fee: CROSS_CHAIN_NET_FEE_BPS },
      { recipient: ONECLICK_SHARE, fee: CROSS_CHAIN_NET_FEE_BPS },
    ]
    const feeBuild = { ...goodBuild, appFee: { requested: [{ recipient: TREASURY_ADDRESS, fee: CROSS_CHAIN_FEE_BPS }], applied: feeSplit } }
    const feeGuard = guardCrossChainBuild(feeBuild, { chainId: 8453, fee: feeExpect })
    check(
      'xchain fee: the pinned treasury split PASSES and the deposit is untouched',
      feeGuard.ok && feeGuard.tx?.to === USDC_BASE && feeGuard.feeBps === CROSS_CHAIN_FEE_BPS && (feeGuard.feeNotes ?? []).length === 0,
    )
    check(
      'xchain fee: an app fee paid to an address we did not pin is REFUSED',
      !guardCrossChainBuild(
        { ...goodBuild, appFee: { applied: [{ recipient: '0x000000000000000000000000000000000000dEaD', fee: 10 }, { recipient: ONECLICK_SHARE, fee: 10 }] } },
        { chainId: 8453, fee: feeExpect },
      ).ok,
    )
    check(
      'xchain fee: a fee larger than we requested is REFUSED',
      !guardCrossChainBuild(
        { ...goodBuild, appFee: { applied: [{ recipient: TREASURY_ADDRESS, fee: 400 }, { recipient: ONECLICK_SHARE, fee: 400 }] } },
        { chainId: 8453, fee: feeExpect },
      ).ok,
    )
    check(
      'xchain fee: an UNREQUESTED app fee is REFUSED (job/funding legs stay fee-free)',
      !guardCrossChainBuild({ ...goodBuild, appFee: { applied: feeSplit } }, { chainId: 8453, fee: null }).ok &&
        guardCrossChainBuild(goodBuild, { chainId: 8453, fee: null }).ok,
    )
    const notApplied = guardCrossChainBuild(goodBuild, { chainId: 8453, fee: feeExpect })
    check(
      'xchain fee: a venue that did not apply the fee still SIGNS, quietly (operator note, no user warning, no fee claimed)',
      notApplied.ok && notApplied.feeBps === 0 && (notApplied.feeNotes ?? []).length === 1 && notApplied.warnings.length === 0,
    )
    // The earnings rate is the NET half — 1Click keeps the rest.
    check(
      'xchain fee: creator earnings use the per-path NET rate (cross-chain earns half a uniswap dollar)',
      netFeeBpsFor('native-cross-chain') === CROSS_CHAIN_NET_FEE_BPS &&
        netFeeBpsFor('native-swap-uniswap') === CROSS_CHAIN_FEE_BPS &&
        netFeeBpsFor('native-nft-transfer') === 0 &&
        FEE_BEARING_BUILD_PATHS.has('native-cross-chain') &&
        Math.abs(creatorEarningsUsd(1000, netFeeBpsFor('native-cross-chain')) - 0.5) < 1e-9 &&
        Math.abs(creatorEarningsUsd(1000, netFeeBpsFor('native-swap-uniswap')) - 1) < 1e-9,
    )

    // Follow-ups.
    const pend = { kind: 'xchain', data: { amount: '1', originToken: 'USDC', originChain: 'base', destinationToken: 'USDC', destinationChain: 'arbitrum', depositAddress: DEPOSIT } }
    check('xchain follow-up: "cancel" drops it', parseCrossChainFollowUp('cancel', pend)?.kind === 'cancel')
    check('xchain follow-up: "confirm" is a noop (button already there)', parseCrossChainFollowUp('confirm', pend)?.kind === 'noop')
    const amend = parseCrossChainFollowUp('make it 2', pend)
    check('xchain follow-up: "make it 2" re-amount', amend?.kind === 'amend' && amend.params.amount === '2' && amend.params.originChain === 'base')

    // Pricing: the quote's own USD figure must ride guardrails.valueUsd — a
    // signed cross-chain turn with null value never counts as money moved
    // and never ranks on the intent-links board (Nate's live 2026-07-22
    // signed link claim was invisible for exactly this reason).
    check('xchain value: quote sell.usd → valueUsd', crossChainValueUsd({ ...goodBuild, quote: { sell: { amountAtoms: '1000000', usd: '0.9998' } } }) === 1)
    check('xchain value: missing usd → null (fail-soft, never guessed)', crossChainValueUsd(goodBuild) === null)
    check('xchain value: junk usd → null', crossChainValueUsd({ ...goodBuild, quote: { sell: { usd: 'n/a' } } }) === null && crossChainValueUsd({ ...goodBuild, quote: { sell: { usd: '0' } } }) === null)
  }

  // ── Uniswap v4 fallback: the calldata guard on the Universal Router build ─
  // The v4 layer serves the pairs v3 can't fill (Robinhood's tokenized-stock
  // pools). Everything the user signs is decoded and verified against pinned
  // addresses + exact amounts — any mutation must refuse, fail closed.
  console.log('— uniswap v4 (calldata guard)')
  {
    const UR = '0x8876789976decbfcbbbe364623c63652db8c0904' as `0x${string}`
    const PERMIT2 = '0x000000000022d473030f116ddee9f6b43ac78ba3' as `0x${string}`
    const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168' as `0x${string}` // currency0 (sorts below AAPL)
    const AAPL = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9' as `0x${string}`
    const amountIn = BigInt(100_000_000) // 100 USDG (6 dec)
    const minOut = BigInt('313643149919096180') // ~0.3136 AAPL
    const now = Math.floor(Date.now() / 1000)
    const deadline = now + 600
    const permit2Expiration = deadline + 3600
    const poolKey: V4PoolKey = { currency0: USDG, currency1: AAPL, fee: 3000, tickSpacing: 60, hooks: '0x0000000000000000000000000000000000000000' }
    const exp: V4GuardExpectations = { chainId: 4663, universalRouter: UR, permit2: PERMIT2, sellToken: USDG, buyToken: AAPL, amountIn, minOut, poolKey, permit2Expiration }
    const swapData = encodeV4SwapCalldata({ poolKey, zeroForOne: true, amountIn, minOut, deadline })
    const erc20ApproveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PERMIT2, amountIn] })
    const permit2Abi = [{ name: 'approve', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'token', type: 'address' }, { name: 'spender', type: 'address' }, { name: 'amount', type: 'uint160' }, { name: 'expiration', type: 'uint48' }], outputs: [] }] as const
    const permit2ApproveData = encodeFunctionData({ abi: permit2Abi, functionName: 'approve', args: [USDG, UR, amountIn, permit2Expiration] })
    const goodSteps: V4BuiltStep[] = [
      { label: 'approve', title: 'Approve USDG to Permit2', tx: { to: USDG, data: erc20ApproveData, value: '0', chainId: 4663, action: 'approve' } },
      { label: 'permit', title: 'Permit2 grant', tx: { to: PERMIT2, data: permit2ApproveData, value: '0', chainId: 4663, action: 'approve' } },
      { label: 'swap', title: 'Swap 100 USDG → AAPL', tx: { to: UR, data: swapData, value: '0', chainId: 4663, action: 'swap' } },
    ]
    check('v4 guard: well-formed 3-step chain PASSES', guardUniswapV4Build(goodSteps, exp).ok)
    check('v4 guard: swap-only chain PASSES (allowances in place)', guardUniswapV4Build([goodSteps[2]], exp).ok)

    // TxChainStep.validUntil rides through the meta narrower — SendTxChain's
    // deadline watch (re-quote before the calldata dies) reads it from here.
    const parsedChain = txChainOf({
      txChain: {
        summary: 's',
        steps: [
          { label: 'approve', title: 't', tx: goodSteps[0].tx },
          { label: 'swap', title: 't', tx: goodSteps[2].tx, validUntil: deadline },
        ],
      },
    })
    check(
      'tx layer: txChainOf carries validUntil on the deadline-bearing step only',
      parsedChain?.steps[1].validUntil === deadline && parsedChain?.steps[0].validUntil === undefined,
    )
    const junkChain = txChainOf({ txChain: { summary: 's', steps: [{ label: 'swap', title: 't', tx: goodSteps[2].tx, validUntil: 'soon' }] } })
    check('tx layer: txChainOf drops a non-numeric validUntil', junkChain?.steps[0].validUntil === undefined)

    // Allowances-in-place swaps now ship as ONE-step chains (refresh stepIndex
    // 0) so SendTxChain's deadline watch covers them — a bare txRequest has no
    // re-quote recipe and dies at the deadline (the 2026-07-14 AAPL incident).
    const oneStep = txChainOf({
      txChain: {
        summary: 's',
        steps: [{ label: 'swap', title: 't', tx: goodSteps[2].tx, validUntil: deadline }],
        refresh: { kind: 'uniswap-v4-swap', stepIndex: 0, params: { sellToken: 'USDG', buyToken: 'AAPL', amountHuman: '100', chainId: '4663' } },
      },
    })
    check(
      'tx layer: txChainOf keeps a 1-step chain with refresh stepIndex 0 + validUntil',
      oneStep?.steps.length === 1 && oneStep.refresh?.stepIndex === 0 && oneStep.refresh.kind === 'uniswap-v4-swap' && oneStep.steps[0].validUntil === deadline,
    )

    const withSwap = (tx: Partial<V4BuiltStep['tx']>): V4BuiltStep[] => [goodSteps[0], goodSteps[1], { ...goodSteps[2], tx: { ...goodSteps[2].tx, ...tx } }]
    check('v4 guard: swap to a NON-pinned router is refused', !guardUniswapV4Build(withSwap({ to: '0x000000000000000000000000000000000000dEaD' }), exp).ok)
    check('v4 guard: wrong chainId is refused', !guardUniswapV4Build(withSwap({ chainId: 8453 }), exp).ok)
    check('v4 guard: nonzero native value is refused', !guardUniswapV4Build(withSwap({ value: '1' }), exp).ok)
    check('v4 guard: opaque calldata is refused', !guardUniswapV4Build(withSwap({ data: '0xdeadbeef' }), exp).ok)

    const wrongAmt = encodeV4SwapCalldata({ poolKey, zeroForOne: true, amountIn: amountIn * BigInt(2), minOut, deadline })
    check('v4 guard: amountIn drift is refused', !guardUniswapV4Build(withSwap({ data: wrongAmt }), exp).ok)
    const wrongMin = encodeV4SwapCalldata({ poolKey, zeroForOne: true, amountIn, minOut: BigInt(1), deadline })
    check('v4 guard: weakened minimum-out is refused', !guardUniswapV4Build(withSwap({ data: wrongMin }), exp).ok)
    const wrongDir = encodeV4SwapCalldata({ poolKey, zeroForOne: false, amountIn, minOut, deadline })
    check('v4 guard: flipped swap direction is refused', !guardUniswapV4Build(withSwap({ data: wrongDir }), exp).ok)
    const hooked = encodeV4SwapCalldata({ poolKey: { ...poolKey, hooks: '0x000000000000000000000000000000000000dEaD' }, zeroForOne: true, amountIn, minOut, deadline })
    check('v4 guard: hooked pool is refused', !guardUniswapV4Build(withSwap({ data: hooked }), exp).ok)
    const wrongPool = encodeV4SwapCalldata({ poolKey: { ...poolKey, fee: 10000, tickSpacing: 200 }, zeroForOne: true, amountIn, minOut, deadline })
    check('v4 guard: un-quoted pool key is refused', !guardUniswapV4Build(withSwap({ data: wrongPool }), exp).ok)
    const stale = encodeV4SwapCalldata({ poolKey, zeroForOne: true, amountIn, minOut, deadline: now - 10 })
    check('v4 guard: expired deadline is refused', !guardUniswapV4Build(withSwap({ data: stale }), exp).ok)

    const evilErc20 = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: ['0x000000000000000000000000000000000000dEaD' as `0x${string}`, amountIn] })
    check('v4 guard: token approval to a non-Permit2 spender is refused', !guardUniswapV4Build([{ ...goodSteps[0], tx: { ...goodSteps[0].tx, data: evilErc20 } }, goodSteps[1], goodSteps[2]], exp).ok)
    const overApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [PERMIT2, amountIn * BigInt(1000)] })
    check('v4 guard: over-sized token approval is refused', !guardUniswapV4Build([{ ...goodSteps[0], tx: { ...goodSteps[0].tx, data: overApprove } }, goodSteps[1], goodSteps[2]], exp).ok)
    const evilPermit = encodeFunctionData({ abi: permit2Abi, functionName: 'approve', args: [USDG, '0x000000000000000000000000000000000000dEaD' as `0x${string}`, amountIn, permit2Expiration] })
    check('v4 guard: Permit2 grant to a non-router spender is refused', !guardUniswapV4Build([goodSteps[0], { ...goodSteps[1], tx: { ...goodSteps[1].tx, data: evilPermit } }, goodSteps[2]], exp).ok)
    const approveToStranger = { ...goodSteps[0], tx: { ...goodSteps[0].tx, to: '0x000000000000000000000000000000000000dEaD' } }
    check('v4 guard: approval step to an unknown contract is refused', !guardUniswapV4Build([approveToStranger, goodSteps[1], goodSteps[2]], exp).ok)
  }

  // ── LiFi settlement venue: fee math + the pinning guard ───────────────────
  // Serves the pools v4 QUOTES but can't EXECUTE (Robinhood's venue-gated
  // stock pools — every real fill settles through the chain's own backend-
  // signed aggregator, which LiFi wraps). The inner calldata is opaque, so
  // the guard pins everything around it: allowlisted router, exact-amount
  // approval, decodable fee transfer to the treasury — any mutation refuses.
  console.log('— lifi settlement venue (fee math + guard)')
  {
    const ROUTER = '0xB477751B76CF82d00a686A1232f5fCD772414Af3'
    const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
    const AAPL = '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9'
    const USER = '0x1111111111111111111111111111111111111111'

    // Fee math (lib/fees.ts): 20 bps default, floor division, dust → 0.
    check('fees: default rate is 20 bps (below Uniswap’s 25 bps interface fee)', SWAP_FEE_BPS === 20)
    check('fees: 20 bps of 100 USDG (6 dec) = 0.2 USDG', swapFeeAtoms(BigInt(100_000_000)) === BigInt(200_000))
    check('fees: floor division favors the user', swapFeeAtoms(BigInt(9_999)) === BigInt(19)) // 9999*20/10000 = 19.998 → 19
    check('fees: dust rounds to a ZERO fee (no fee step)', swapFeeAtoms(BigInt(400)) === BigInt(0))
    check('fees: zero/negative input never charges', swapFeeAtoms(BigInt(0)) === BigInt(0) && swapFeeAtoms(BigInt(-5)) === BigInt(0))
    check('fees: treasury address is pinned', /^0x[0-9a-fA-F]{40}$/.test(TREASURY_ADDRESS))
    check('lifi: Robinhood Chain router allowlisted by default', lifiRoutersFor(4663).some((r) => r.toLowerCase() === ROUTER.toLowerCase()))
    check('lifi: unknown chain has NO allowlist (fails closed)', lifiRoutersFor(999999).length === 0)

    const totalAtoms = BigInt(100_000_000) // 100 USDG asked
    const feeAtoms = swapFeeAtoms(totalAtoms) // 0.2 USDG
    const swapAtoms = totalAtoms - feeAtoms // 99.8 USDG into the venue
    const exp: LifiGuardExpectations = {
      chainId: 4663,
      routers: [ROUTER],
      approvalAddress: ROUTER,
      sellToken: USDG,
      swapAtoms,
      feeAtoms,
      treasury: TREASURY_ADDRESS,
    }
    const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTER as `0x${string}`, swapAtoms] })
    const feeData = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [TREASURY_ADDRESS, feeAtoms] })
    const goodSteps: LifiBuiltStep[] = [
      { label: 'approve', title: 'Approve USDG to LiFi', tx: { to: USDG, data: approveData, value: '0', chainId: 4663, action: 'approve' } },
      { label: 'swap', title: 'Swap 99.8 USDG → AAPL', tx: { to: ROUTER, data: '0x5fd9ae2e' + 'ab'.repeat(200), value: '0', chainId: 4663, action: 'swap' }, validUntil: Math.floor(Date.now() / 1000) + 90 },
      { label: 'fee', title: 'Yeetful fee', tx: { to: USDG, data: feeData, value: '0', chainId: 4663, action: 'transfer' } },
    ]
    check('lifi guard: well-formed approve→swap→fee chain PASSES', guardLifiBuild(goodSteps, exp).ok)
    check('lifi guard: swap+fee (allowance in place) PASSES', guardLifiBuild([goodSteps[1], goodSteps[2]], exp).ok)
    check('lifi guard: zero-fee build needs NO fee step', guardLifiBuild([goodSteps[0], goodSteps[1]], { ...exp, feeAtoms: BigInt(0) }).ok)
    check('lifi guard: fee expected but step missing is refused', !guardLifiBuild([goodSteps[0], goodSteps[1]], exp).ok)
    check('lifi guard: swap to a NON-pinned router is refused', !guardLifiBuild([goodSteps[0], { ...goodSteps[1], tx: { ...goodSteps[1].tx, to: '0x000000000000000000000000000000000000dEaD' } }, goodSteps[2]], exp).ok)
    check('lifi guard: empty router allowlist fails closed', !guardLifiBuild(goodSteps, { ...exp, routers: [] }).ok)
    check('lifi guard: approvalAddress OFF the allowlist is refused', !guardLifiBuild(goodSteps, { ...exp, approvalAddress: '0x000000000000000000000000000000000000dEaD' }).ok)
    check('lifi guard: wrong chainId is refused', !guardLifiBuild([goodSteps[0], { ...goodSteps[1], tx: { ...goodSteps[1].tx, chainId: 8453 } }, goodSteps[2]], exp).ok)
    check('lifi guard: nonzero native value is refused', !guardLifiBuild([goodSteps[0], { ...goodSteps[1], tx: { ...goodSteps[1].tx, value: '1' } }, goodSteps[2]], exp).ok)
    const overApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTER as `0x${string}`, swapAtoms * BigInt(1000)] })
    check('lifi guard: over-sized approval is refused (exact-amount only)', !guardLifiBuild([{ ...goodSteps[0], tx: { ...goodSteps[0].tx, data: overApprove } }, goodSteps[1], goodSteps[2]], exp).ok)
    const evilApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: ['0x000000000000000000000000000000000000dEaD' as `0x${string}`, swapAtoms] })
    check('lifi guard: approval to a stranger spender is refused', !guardLifiBuild([{ ...goodSteps[0], tx: { ...goodSteps[0].tx, data: evilApprove } }, goodSteps[1], goodSteps[2]], exp).ok)
    const evilFee = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: ['0x000000000000000000000000000000000000dEaD' as `0x${string}`, feeAtoms] })
    check('lifi guard: fee transfer to a NON-treasury address is refused', !guardLifiBuild([goodSteps[0], goodSteps[1], { ...goodSteps[2], tx: { ...goodSteps[2].tx, data: evilFee } }], exp).ok)
    const wrongFeeAmt = encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [TREASURY_ADDRESS, feeAtoms * BigInt(10)] })
    check('lifi guard: inflated fee amount is refused', !guardLifiBuild([goodSteps[0], goodSteps[1], { ...goodSteps[2], tx: { ...goodSteps[2].tx, data: wrongFeeAmt } }], exp).ok)
    check('lifi guard: opaque fee calldata is refused', !guardLifiBuild([goodSteps[0], goodSteps[1], { ...goodSteps[2], tx: { ...goodSteps[2].tx, data: '0xdeadbeef' } }], exp).ok)

    // Quote echo: the LiFi response must restate the parsed intent exactly.
    const echoQuote = {
      tool: 'fly',
      action: {
        fromToken: { address: USDG, decimals: 6 },
        toToken: { address: AAPL, decimals: 18 },
        fromAmount: swapAtoms.toString(),
        fromChainId: 4663,
        toChainId: 4663,
        fromAddress: USER,
        toAddress: USER,
      },
      estimate: { approvalAddress: ROUTER, toAmount: '313000000000000000', toAmountMin: '311000000000000000', fromAmount: swapAtoms.toString() },
      transactionRequest: { to: ROUTER, data: '0x5fd9ae2e', value: '0x0', chainId: 4663 },
    } as LifiQuote
    const echoExp = { chainId: 4663, sellToken: USDG, buyToken: AAPL, swapAtoms, from: USER }
    check('lifi echo: exact echo PASSES', verifyLifiQuoteEcho(echoQuote, echoExp).length === 0)
    check('lifi echo: different sell token refused', verifyLifiQuoteEcho({ ...echoQuote, action: { ...echoQuote.action, fromToken: { address: AAPL, decimals: 18 } } }, echoExp).length > 0)
    check('lifi echo: amount drift refused', verifyLifiQuoteEcho({ ...echoQuote, action: { ...echoQuote.action, fromAmount: totalAtoms.toString() } }, echoExp).length > 0)
    check('lifi echo: cross-chain route refused (same-chain venue only)', verifyLifiQuoteEcho({ ...echoQuote, action: { ...echoQuote.action, toChainId: 42161 } }, echoExp).length > 0)
    check('lifi echo: proceeds to a stranger refused', verifyLifiQuoteEcho({ ...echoQuote, action: { ...echoQuote.action, toAddress: '0x000000000000000000000000000000000000dEaD' } }, echoExp).length > 0)
    check('lifi echo: native value on the swap refused', verifyLifiQuoteEcho({ ...echoQuote, transactionRequest: { ...echoQuote.transactionRequest, value: '0xde0b6b3a7640000' } }, echoExp).length > 0)

    // Independent price sanity: LiFi may pay ≤2% below our own quote, no more.
    const ours = BigInt(1_000_000_000)
    check('lifi price: equal fill accepted', lifiPriceAcceptable(ours, ours))
    check('lifi price: 1% below accepted (venue fees are real)', lifiPriceAcceptable(BigInt(990_000_000), ours))
    check('lifi price: exactly 2% below accepted (boundary)', lifiPriceAcceptable(BigInt(980_000_000), ours))
    check('lifi price: 3% below REFUSED (bad or hostile fill)', !lifiPriceAcceptable(BigInt(970_000_000), ours))
    check('lifi price: paying MORE than our quote accepted', lifiPriceAcceptable(ours * BigInt(2), ours))
  }

  // ── LiFi funding bridge: cross-chain guard + the funding-plan compile ─────
  // The layer behind "buy $10 of AAPL" from a wallet whose money lives on
  // Base: two guarded Base legs (gas ETH + USDG) delivered to the SENDER's
  // own address on Robinhood Chain, compiled with the buy into one job.
  console.log('— lifi funding bridge (cross-chain guard + funding plan)')
  {
    const DIAMOND = '0x1231DEB6f5749EF6cE6943a275A1D3E7486F4EaE'
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const USDG = '0x5fc5360D0400a0Fd4f2af552ADD042D716F1d168'
    const USER = '0x1111111111111111111111111111111111111111'
    const STRANGER = '0x000000000000000000000000000000000000dEaD'

    check('bridge: Base LiFi diamond allowlisted by default', lifiBridgeRoutersFor(8453).some((r) => r.toLowerCase() === DIAMOND.toLowerCase()))
    check('bridge: unknown origin chain has NO allowlist (fails closed)', lifiBridgeRoutersFor(999999).length === 0)

    check('bridge: funding need = buy + 4% margin + gas leg, rounded to $0.50', fundingNeedUsd(10, true) === 12 && fundingNeedUsd(10, false) === 10.5)

    const sellAtoms = BigInt(10_500_000) // $10.50 USDC
    const bexp: LifiBridgeExpectations = {
      originChainId: 8453,
      destinationChainId: 4663,
      routers: [DIAMOND],
      approvalAddress: DIAMOND,
      sellToken: USDC,
      sellAtoms,
      destinationToken: USDG,
      from: USER,
    }
    const bridgeApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [DIAMOND as `0x${string}`, sellAtoms] })
    const goodLegs: LifiBridgeStep[] = [
      { label: 'approve', title: 'Approve USDC to LiFi', tx: { to: USDC, data: bridgeApprove, value: '0', chainId: 8453, action: 'approve' } },
      { label: 'bridge', title: 'Bridge USDC → USDG on Robinhood Chain', tx: { to: DIAMOND, data: '0x5fd9ae2e' + 'cd'.repeat(200), value: '0', chainId: 8453, action: 'bridge' }, validUntil: Math.floor(Date.now() / 1000) + 90 },
    ]
    check('bridge guard: approve→bridge chain PASSES', guardLifiBridgeBuild(goodLegs, bexp).ok)
    check('bridge guard: bridge-only (allowance in place) PASSES', guardLifiBridgeBuild([goodLegs[1]], bexp).ok)
    check('bridge guard: bridge to a NON-pinned router refused', !guardLifiBridgeBuild([goodLegs[0], { ...goodLegs[1], tx: { ...goodLegs[1].tx, to: STRANGER } }], bexp).ok)
    check('bridge guard: empty allowlist fails closed', !guardLifiBridgeBuild(goodLegs, { ...bexp, routers: [] }).ok)
    check('bridge guard: approvalAddress OFF the allowlist refused', !guardLifiBridgeBuild(goodLegs, { ...bexp, approvalAddress: STRANGER }).ok)
    check('bridge guard: wrong-chain step refused', !guardLifiBridgeBuild([goodLegs[0], { ...goodLegs[1], tx: { ...goodLegs[1].tx, chainId: 4663 } }], bexp).ok)
    check('bridge guard: nonzero native value refused', !guardLifiBridgeBuild([goodLegs[0], { ...goodLegs[1], tx: { ...goodLegs[1].tx, value: '1' } }], bexp).ok)
    const bridgeOver = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [DIAMOND as `0x${string}`, sellAtoms * BigInt(1000)] })
    check('bridge guard: over-sized approval refused (exact-amount only)', !guardLifiBridgeBuild([{ ...goodLegs[0], tx: { ...goodLegs[0].tx, data: bridgeOver } }, goodLegs[1]], bexp).ok)
    const bridgeEvil = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [STRANGER as `0x${string}`, sellAtoms] })
    check('bridge guard: approval to a stranger spender refused', !guardLifiBridgeBuild([{ ...goodLegs[0], tx: { ...goodLegs[0].tx, data: bridgeEvil } }, goodLegs[1]], bexp).ok)

    // Quote echo, cross-chain edition: the route must go Base → Robinhood
    // Chain with OUR tokens and atoms, delivered to the sender's own address.
    const bridgeQuote = {
      action: { fromToken: { address: USDC }, toToken: { address: USDG }, fromAmount: sellAtoms.toString(), fromChainId: 8453, toChainId: 4663, toAddress: USER },
      estimate: { fromAmount: sellAtoms.toString() },
      transactionRequest: { chainId: 8453, value: '0x0' },
    }
    check('bridge echo: exact echo PASSES', verifyLifiBridgeEcho(bridgeQuote, bexp).length === 0)
    check('bridge echo: wrong destination chain refused', verifyLifiBridgeEcho({ ...bridgeQuote, action: { ...bridgeQuote.action, toChainId: 42161 } }, bexp).length > 0)
    check('bridge echo: delivery to a STRANGER refused', verifyLifiBridgeEcho({ ...bridgeQuote, action: { ...bridgeQuote.action, toAddress: STRANGER } }, bexp).length > 0)
    check('bridge echo: amount drift refused', verifyLifiBridgeEcho({ ...bridgeQuote, action: { ...bridgeQuote.action, fromAmount: '999' } }, bexp).length > 0)
    check('bridge echo: native value on an ERC-20 input refused', verifyLifiBridgeEcho({ ...bridgeQuote, transactionRequest: { chainId: 8453, value: '0xde0b6b3a7640000' } }, bexp).length > 0)

    // ── Native-ETH sell mode (2026-07-28): the value IS the input — the
    // single bridge step must carry exactly the sold atoms, and no approval
    // may exist (there is no ERC-20 to approve).
    const ETH_ATOMS = BigInt('4000000000000000') // 0.004 ETH
    const ZERO = '0x0000000000000000000000000000000000000000'
    const nexp: LifiBridgeExpectations = { ...bexp, sellToken: ZERO, sellAtoms: ETH_ATOMS, nativeSellAtoms: ETH_ATOMS }
    const nativeBridge: LifiBridgeStep = {
      label: 'bridge',
      title: 'Bridge ETH → USDG on Robinhood Chain',
      tx: { to: DIAMOND, data: '0x5fd9ae2e' + 'cd'.repeat(200), value: ETH_ATOMS.toString(), chainId: 8453, action: 'bridge' },
      validUntil: Math.floor(Date.now() / 1000) + 90,
    }
    check('bridge guard (native): single value-carrying bridge step PASSES', guardLifiBridgeBuild([nativeBridge], nexp).ok)
    check('bridge guard (native): a zero-value bridge step refused (the ETH must ride as msg.value)', !guardLifiBridgeBuild([{ ...nativeBridge, tx: { ...nativeBridge.tx, value: '0' } }], nexp).ok)
    check('bridge guard (native): value drift refused (exactly the sold atoms)', !guardLifiBridgeBuild([{ ...nativeBridge, tx: { ...nativeBridge.tx, value: (ETH_ATOMS + BigInt(1)).toString() } }], nexp).ok)
    check('bridge guard (native): an approval step in a native leg refused', !guardLifiBridgeBuild([goodLegs[0], nativeBridge], nexp).ok)
    const nativeQuote = {
      action: { fromToken: { address: ZERO }, toToken: { address: USDG }, fromAmount: ETH_ATOMS.toString(), fromChainId: 8453, toChainId: 4663, toAddress: USER },
      estimate: { fromAmount: ETH_ATOMS.toString() },
      transactionRequest: { chainId: 8453, value: '0x' + ETH_ATOMS.toString(16) },
    }
    check('bridge echo (native): value = fromAmount PASSES (the live 2026-07-28 probe shape)', verifyLifiBridgeEcho(nativeQuote, nexp).length === 0)
    check('bridge echo (native): a zero-value native quote refused', verifyLifiBridgeEcho({ ...nativeQuote, transactionRequest: { chainId: 8453, value: '0x0' } }, nexp).length > 0)

    // The funding-plan parse + compile — the chips' resume string is the
    // contract, so the exact phrasing must compile deterministically.
    const fp = parseRobinhoodFunding('Fund robinhood chain with $12 from base including gas')
    check('funding parse: "$12 from base including gas"', !!fp && fp.fundUsd === 12 && fp.gasIncluded && fp.originChainId === 8453 && fp.originWord === 'Base')
    const fpNoGas = parseRobinhoodFunding('fund robinhood with 18 from base')
    check('funding parse: no-gas variant', !!fpNoGas && fpNoGas.fundUsd === 18 && !fpNoGas.gasIncluded)
    check('funding parse: unrelated messages → null', parseRobinhoodFunding('fund my hyperliquid account with $12') === null && parseRobinhoodFunding('bridge 0.01 eth to robinhood') === null)
    // Ethereum + Arbitrum origins — the 2026-07-17 extension: $15 of
    // Ethereum USDC was invisible to a Base-only scan and a $5 buy walled.
    const fpEth = parseRobinhoodFunding('Fund robinhood chain with $7 from ethereum including gas')
    const fpArb = parseRobinhoodFunding('fund robinhood with $9.5 from arbitrum')
    const fpMain = parseRobinhoodFunding('fund robinhood chain with $4 from mainnet')
    const fpArbShort = parseRobinhoodFunding('fund robinhood chain with $4 from arb')
    check(
      'funding parse: ethereum/arbitrum/mainnet/arb origins resolve',
      !!fpEth && fpEth.originChainId === 1 && fpEth.originWord === 'Ethereum' && fpEth.gasIncluded &&
        !!fpArb && fpArb.originChainId === 42161 && fpArb.originWord === 'Arbitrum' && fpArb.fundUsd === 9.5 &&
        !!fpMain && fpMain.originChainId === 1 &&
        !!fpArbShort && fpArbShort.originChainId === 42161,
    )
    check('funding parse: an unknown origin chain → null (never guesses)', parseRobinhoodFunding('fund robinhood chain with $12 from solana') === null)
    // Bridged USDC.e (2026-07-21 follow-up: a wallet holding only Arbitrum
    // USDC.e read as "no USDC on Arbitrum") — the "using usdc.e" clause
    // picks the variant; absent = native USDC, exactly as before.
    check(
      'funding alt-USDC: registry cross-check (Arbitrum only, address in lib/chains stables)',
      fundingAltUsdcFor(42161)?.symbol === 'USDC.e' &&
        fundingAltUsdcFor(42161)?.address === FUNDING_ALT_USDC[42161].address &&
        fundingAltUsdcFor(8453) === null && fundingAltUsdcFor(1) === null,
    )
    const fpUsdce = parseRobinhoodFunding('Fund robinhood chain with $12 from arbitrum using usdc.e including gas')
    const fpUsdceNoDot = parseRobinhoodFunding('fund robinhood with $9 from arb using usdce')
    check(
      'funding parse: "using usdc.e" picks the variant, default stays USDC',
      !!fpUsdce && fpUsdce.token === 'USDC.e' && fpUsdce.originChainId === 42161 && fpUsdce.gasIncluded &&
        !!fpUsdceNoDot && fpUsdceNoDot.token === 'USDC.e' && !fpUsdceNoDot.gasIncluded &&
        parseRobinhoodFunding('fund robinhood with $9 from arbitrum')?.token === 'USDC',
    )
    check('bridge: Ethereum + Arbitrum LiFi diamonds allowlisted by default', lifiBridgeRoutersFor(1).length === 1 && lifiBridgeRoutersFor(42161).length === 1 && lifiBridgeRoutersFor(1)[0].toLowerCase() === DIAMOND.toLowerCase())

    const fundJob = compileJobAsk('Fund robinhood chain with $12 from base including gas, then buy $10 of AAPL')
    check(
      'funding compile: gas leg + USDG leg + arrival wait + buy',
      !!fundJob &&
        !('problem' in fundJob) &&
        fundJob.steps.length === 4 &&
        fundJob.steps[0].builder === 'native-lifi-fund' &&
        (fundJob.steps[0].params as { leg?: string }).leg === 'gas' &&
        fundJob.steps[1].builder === 'native-lifi-fund' &&
        (fundJob.steps[1].params as { leg?: string; usd?: number }).leg === 'usdg' &&
        (fundJob.steps[1].params as { usd?: number }).usd === 10.5 &&
        fundJob.steps[2].kind === 'wait' &&
        JSON.stringify(fundJob.steps[2].waitPredicate) === JSON.stringify({ kind: 'chain-arrival', fromSteps: [0, 1] }) &&
        fundJob.steps[3].builder === 'native-lifi-swap' &&
        (fundJob.steps[3].params as { buyUsd?: number; buyToken?: string }).buyUsd === 10 &&
        (fundJob.steps[3].params as { buyToken?: string }).buyToken === 'AAPL',
    )
    const fundJobNoGas = compileJobAsk('Fund robinhood chain with $10.5 from base, then buy $10 of TSLA')
    check(
      'funding compile: gas-covered variant skips the gas leg',
      !!fundJobNoGas &&
        !('problem' in fundJobNoGas) &&
        fundJobNoGas.steps.length === 3 &&
        (fundJobNoGas.steps[0].params as { leg?: string }).leg === 'usdg' &&
        JSON.stringify(fundJobNoGas.steps[1].waitPredicate) === JSON.stringify({ kind: 'chain-arrival', fromSteps: [0] }),
    )
    check('funding compile: a bare "buy $10 of AAPL" never lands in the jobs layer', compileJobAsk('buy $10 of AAPL, then buy $10 of TSLA') === null)
    const dust = compileJobAsk('Fund robinhood chain with $1 from base including gas, then buy $10 of AAPL')
    check('funding compile: amount below the gas leg refuses honestly', !!dust && 'problem' in dust)

    // Origin flows into the step params — the runner passes it to
    // buildLifiBridgeLeg, the refresh recipe re-quotes from the right chain.
    const ethJob = compileJobAsk('Fund robinhood chain with $7 from ethereum including gas, then buy $5 of NVDA')
    check(
      'funding compile: ethereum origin lands in every leg\'s params',
      !!ethJob && !('problem' in ethJob) && ethJob.steps.length === 4 &&
        (ethJob.steps[0].params as { origin?: number }).origin === 1 &&
        (ethJob.steps[1].params as { origin?: number; leg?: string }).origin === 1 &&
        (ethJob.steps[1].params as { leg?: string }).leg === 'usdg' &&
        (ethJob.steps[1].params as { usd?: number }).usd === 5.5,
    )
    // A combined two-origin ask: each fund segment gets its own legs +
    // arrival wait; the gas leg rides ONLY the first segment.
    const comboJob = compileJobAsk('Fund robinhood chain with $5 from ethereum including gas, then fund robinhood chain with $2.5 from base, then buy $5 of NVDA')
    check(
      'funding compile: combined origins → per-segment legs + waits, gas on the first only',
      !!comboJob && !('problem' in comboJob) &&
        JSON.stringify(comboJob.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-lifi-fund', 'sign:native-lifi-fund', 'wait:wait', 'sign:native-lifi-fund', 'wait:wait', 'sign:native-lifi-swap']) &&
        (comboJob.steps[0].params as { leg?: string; origin?: number }).leg === 'gas' &&
        (comboJob.steps[0].params as { origin?: number }).origin === 1 &&
        (comboJob.steps[3].params as { leg?: string; origin?: number }).leg === 'usdg' &&
        (comboJob.steps[3].params as { origin?: number }).origin === 8453,
      comboJob && 'problem' in comboJob ? comboJob.problem : JSON.stringify(comboJob?.steps.map((s) => s.params)),
    )
    // A LONE funding segment compiles (the MCP-fallback's bridge-only chips
    // carry no follow-up) — but a lone anything-else still returns null.
    const lone = compileJobAsk('Fund robinhood chain with $7 from ethereum including gas')
    check(
      'funding compile: a lone funding segment is a job (bridge-only chips)',
      !!lone && !('problem' in lone) && lone.steps.length === 3 && lone.steps[2].kind === 'wait' &&
        compileJobAsk('buy $10 of AAPL') === null,
    )

    // The chip planner: multi-origin ranking, and every resume string is
    // the contract — each must round-trip through compileJobAsk.
    const O = (chainId: number, word: string, usd: number, gasEth = 0.01, token = 'USDC'): FundingOrigin => ({ chainId, word, token, usd, gasEth })
    const chipOrigins = [O(1, 'Ethereum', 15), O(8453, 'Base', 3)]
    const chips = planRobinhoodFundingChips({ origins: chipOrigins, needUsd: 7, gasIncluded: true, followup: 'buy $5 of NVDA' })
    check(
      'funding chips: richest covering origin leads and every resume compiles',
      !!chips && chips.length >= 2 && /Ethereum/.test(chips[0].label) && /~\$7/.test(chips[0].label) &&
        chips.every((c) => {
          const j = compileJobAsk(c.resume)
          return !!j && !('problem' in j)
        }),
      JSON.stringify(chips),
    )
    const altChips = planRobinhoodFundingChips({ origins: [O(8453, 'Base', 20), O(1, 'Ethereum', 10)], needUsd: 7, gasIncluded: false, followup: 'buy $5 of NVDA' })
    check(
      'funding chips: a second covering origin gets an "instead" chip',
      !!altChips && altChips.some((c) => /Use Ethereum instead/.test(c.label)),
      JSON.stringify(altChips),
    )
    const comboChips = planRobinhoodFundingChips({ origins: [O(1, 'Ethereum', 5), O(8453, 'Base', 4)], needUsd: 8.5, gasIncluded: true, followup: 'buy $5 of NVDA' })
    const comboChipJob = comboChips ? compileJobAsk(comboChips[0].resume) : null
    check(
      'funding chips: no single origin covers → one combined chip that compiles (gas on leg 1)',
      !!comboChips && comboChips.length === 1 && /Combine Ethereum \+ Base/.test(comboChips[0].label) &&
        !!comboChipJob && !('problem' in comboChipJob) &&
        (comboChipJob.steps[0].params as { leg?: string; origin?: number }).leg === 'gas' &&
        (comboChipJob.steps[0].params as { origin?: number }).origin === 1 &&
        (comboChipJob.steps[3].params as { origin?: number }).origin === 8453,
      JSON.stringify({ comboChips, steps: comboChipJob && !('problem' in comboChipJob) ? comboChipJob.steps.map((s) => s.params) : comboChipJob }),
    )
    check('funding chips: the whole wallet short → null (caller writes the honest refusal)', planRobinhoodFundingChips({ origins: [O(1, 'Ethereum', 3)], needUsd: 12, gasIncluded: true, followup: '' }) === null)
    // The 10× sanity cap (live 2026-07-17: a whale scan offered a $7.5k
    // half-balance chip against a $7 need).
    const whaleChips = planRobinhoodFundingChips({ origins: [O(8453, 'Base', 15112), O(1, 'Ethereum', 142)], needUsd: 7, gasIncluded: true, followup: 'buy $5 of NVDA' })
    check(
      'funding chips: a whale balance skips half/all (10× cap) but keeps the alternative origin',
      !!whaleChips && !whaleChips.some((c) => /Half|All/.test(c.label)) && whaleChips.some((c) => /Use Ethereum instead/.test(c.label)),
      JSON.stringify(whaleChips),
    )
    const bridgeOnlyChips = planRobinhoodFundingChips({ origins: chipOrigins, needUsd: 7, gasIncluded: true, followup: '' })
    check(
      'funding chips: bridge-only resumes (no follow-up) still compile as jobs',
      !!bridgeOnlyChips && bridgeOnlyChips.every((c) => {
        const j = compileJobAsk(c.resume)
        return !!j && !('problem' in j)
      }),
      JSON.stringify(bridgeOnlyChips),
    )

    // ── The advice planner (live 2026-07-21): $12 of freshly-bridged USDC on
    // Arbitrum was reported as "none on Base, Ethereum, or Arbitrum" because
    // the wallet's last origin gas went into the bridge signatures — the
    // gasless origin was silently dropped, and the planner then invented a
    // NEAR Intents bridge to Robinhood Chain (a chain NEAR can't reach).
    const covered = planRobinhoodFundingAdvice({
      scan: { origins: chipOrigins, gaslessOrigins: [], allScanned: chipOrigins, failedOrigins: [] },
      needUsd: 7, gasIncluded: true, followup: 'buy $5 of NVDA',
    })
    check('funding advice: signable USDC covers → the chips outcome (unchanged behavior)', covered.kind === 'chips' && covered.chips.length >= 2)
    const stranded = O(42161, 'Arbitrum', 12, 0)
    const donorScan = { origins: [], gaslessOrigins: [stranded], allScanned: [stranded, O(8453, 'Base', 0, 0.01)], failedOrigins: [] }
    const rescue = planRobinhoodFundingAdvice({ scan: donorScan, needUsd: 11, gasIncluded: true, followup: 'buy $10 of GOOGL' })
    const rescueJob = rescue.kind === 'gas-stranded' && rescue.chips ? compileJobAsk(rescue.chips[0].resume) : null
    check(
      'funding advice: gas-stranded + donor → topup chip whose resume compiles (bridge gas → wait → fund → wait → buy)',
      rescue.kind === 'gas-stranded' && rescue.stranded.word === 'Arbitrum' && rescue.donor?.word === 'Base' &&
        !!rescue.chips && rescue.chips[0].resume.includes(`swap ${GAS_TOPUP_ETH} ETH from base to arbitrum`) &&
        !!rescueJob && !('problem' in rescueJob) &&
        rescueJob.steps[0].builder === 'native-cross-chain' && rescueJob.steps[1].kind === 'wait' &&
        rescueJob.steps.some((s) => s.builder === 'native-lifi-fund') && rescueJob.steps.some((s) => s.builder === 'native-lifi-swap'),
      JSON.stringify({ rescue, steps: rescueJob && !('problem' in rescueJob) ? rescueJob.steps.map((s) => `${s.kind}:${s.builder}`) : rescueJob }),
    )
    const noDonor = planRobinhoodFundingAdvice({
      scan: { origins: [], gaslessOrigins: [stranded], allScanned: [stranded], failedOrigins: [] },
      needUsd: 11, gasIncluded: true, followup: 'buy $10 of GOOGL',
    })
    check(
      'funding advice: gas-stranded, no donor → honest copy naming the stranded chain, no chips',
      noDonor.kind === 'gas-stranded' && noDonor.donor === null && noDonor.chips === null && /\$12 of USDC on \*\*Arbitrum\*\*/.test(noDonor.copy) && /no ETH on Arbitrum/.test(noDonor.copy),
      JSON.stringify(noDonor),
    )
    // A gasless origin that can't cover the need must still be NAMED in the
    // refusal — money the user owns is never invisible.
    const under = planRobinhoodFundingAdvice({
      scan: { origins: [O(8453, 'Base', 1)], gaslessOrigins: [O(42161, 'Arbitrum', 4, 0)], allScanned: [O(8453, 'Base', 1), O(42161, 'Arbitrum', 4, 0)], failedOrigins: ['Ethereum'] },
      needUsd: 20, gasIncluded: true, followup: '',
    })
    check(
      'funding advice: nothing covers → per-chain accounting names gasless holdings and failed reads',
      under.kind === 'none' && /\$4 of USDC on Arbitrum \(no ETH there to sign with\)/.test(under.copy) && /couldn't check Ethereum/.test(under.copy),
      JSON.stringify(under),
    )

    // ── THE 2026-07-27 WALL: "Buy $12 of AAPL" with $12 of movable Base
    // USDC + $0.48 of USDG already held. Buys ignored the held USDG, so the
    // plan demanded ~$12.5 and refused a wallet that covered it — three
    // retries on the flagship ask. The held USDG is part of what the buy
    // spends; the need subtracts it, and the exact live wallet gets chips.
    check('funding need: a buy subtracts the USDG already held (the 2026-07-27 wall)', robinhoodBuyNeedUsd(12, 0.48, false) === 12 && robinhoodBuyNeedUsd(12, 0, false) === 12.5)
    const july27 = planRobinhoodFundingAdvice({
      scan: { origins: [O(8453, 'Base', 12, 0.001)], gaslessOrigins: [], allScanned: [O(8453, 'Base', 12, 0.001)], failedOrigins: [] },
      needUsd: robinhoodBuyNeedUsd(12, 0.48, false), gasIncluded: false, followup: 'buy $12 of AAPL',
    })
    check('funding advice: the exact 2026-07-27 wallet now gets chips, not a wall', july27.kind === 'chips' && /~\$12 from Base/.test(july27.chips[0].label))

    // ── The near-miss downsize: when nothing covers the ASKED size, offer
    // the buy the wallet CAN fund — the chip resume stays a compiling
    // contract, lowballs and non-downsizes return null.
    const downsized = planDownsizedRobinhoodBuy({
      scan: { origins: [O(8453, 'Base', 10)] }, buyUsd: 12, holdingUsd: 0, includeGas: false, buySym: 'AAPL', acquiring: false,
    })
    const downsizedJob = downsized ? compileJobAsk(downsized.chips[0].resume) : null
    check(
      'funding downsize: $10 movable vs a $12 ask → a smaller buy whose resume compiles',
      !!downsized && downsized.buyUsd === 9.5 && /Buy \$9\.5 of AAPL instead/.test(downsized.chips[0].label) &&
        downsized.chips[0].resume.endsWith('then buy $9.5 of AAPL') &&
        !!downsizedJob && !('problem' in downsizedJob),
      JSON.stringify({ downsized, job: downsizedJob && !('problem' in downsizedJob) ? downsizedJob.steps.map((s) => `${s.kind}:${s.builder}`) : downsizedJob }),
    )
    const downsizedAcq = planDownsizedRobinhoodBuy({
      scan: { origins: [O(8453, 'Base', 10)] }, buyUsd: 50, holdingUsd: 5, includeGas: true, buySym: 'USDG', acquiring: true,
    })
    const downsizedAcqJob = downsizedAcq ? compileJobAsk(downsizedAcq.chips[0].resume) : null
    check(
      'funding downsize: an acquisition counts the held USDG and compiles bridge-only',
      !!downsizedAcq && downsizedAcq.buyUsd === 13 && /Land \$13 of it instead/.test(downsizedAcq.chips[0].label) &&
        !/then buy/.test(downsizedAcq.chips[0].resume) && !!downsizedAcqJob && !('problem' in downsizedAcqJob),
      JSON.stringify(downsizedAcq),
    )
    check(
      'funding downsize: a lowball counter-offer is null (a $100 ask over a $2 wallet)',
      planDownsizedRobinhoodBuy({ scan: { origins: [O(8453, 'Base', 2)] }, buyUsd: 100, holdingUsd: 0, includeGas: false, buySym: 'AAPL', acquiring: false }) === null,
    )
    check(
      'funding downsize: a wallet that covers the ask is null (not a downsize)',
      planDownsizedRobinhoodBuy({ scan: { origins: [O(8453, 'Base', 50)] }, buyUsd: 12, holdingUsd: 0, includeGas: false, buySym: 'AAPL', acquiring: false }) === null,
    )

    // ── Bridged USDC.e as a funding source: chips name the token, resumes
    // carry the "using usdc.e" clause, and every one compiles with the
    // token in BOTH legs' params (the gas leg sells the same origin token —
    // a USDC.e-only wallet has no native USDC to pay the gas leg with).
    const usdceOrigin = O(42161, 'Arbitrum', 12, 0.01, 'USDC.e')
    const usdceChips = planRobinhoodFundingChips({ origins: [usdceOrigin], needUsd: 7, gasIncluded: true, followup: 'buy $5 of NVDA' })
    const usdceJob = usdceChips ? compileJobAsk(usdceChips[0].resume) : null
    check(
      'funding chips: a USDC.e origin is offered, named, and compiles with the token in both legs',
      !!usdceChips && usdceChips.every((c) => /USDC\.e/i.test(c.label) || /usdc\.e/.test(c.resume)) &&
        !!usdceJob && !('problem' in usdceJob) &&
        (usdceJob.steps[0].params as { leg?: string; token?: string }).leg === 'gas' &&
        (usdceJob.steps[0].params as { token?: string }).token === 'USDC.e' &&
        (usdceJob.steps[1].params as { leg?: string; token?: string }).leg === 'usdg' &&
        (usdceJob.steps[1].params as { token?: string }).token === 'USDC.e' &&
        (usdceJob.steps[1].params as { origin?: number }).origin === 42161 &&
        usdceChips.every((c) => {
          const j = compileJobAsk(c.resume)
          return !!j && !('problem' in j)
        }),
      JSON.stringify({ usdceChips, steps: usdceJob && !('problem' in usdceJob) ? usdceJob.steps.map((s) => s.params) : usdceJob }),
    )
    // Native-USDC flows are untouched: no "using" clause, no token surprise.
    const usdcJob = compileJobAsk('Fund robinhood chain with $7 from arbitrum including gas, then buy $5 of NVDA')
    check(
      'funding compile: a plain arbitrum ask still sells native USDC',
      !!usdcJob && !('problem' in usdcJob) && (usdcJob.steps[0].params as { token?: string }).token === 'USDC' && (usdcJob.steps[1].params as { token?: string }).token === 'USDC',
    )
    // "using usdc.e" where the registry knows no variant refuses at compile
    // time — never a job whose every build fails.
    const usdceWrongChain = compileJobAsk('Fund robinhood chain with $7 from base using usdc.e including gas, then buy $5 of NVDA')
    check('funding compile: "using usdc.e" off Arbitrum refuses honestly', !!usdceWrongChain && 'problem' in usdceWrongChain && /USDC\.e/.test(usdceWrongChain.problem))
    // Gas-stranded USDC.e: the rescue names the actual token and the topup
    // resume compiles (bridge gas → wait → fund USDC.e → wait → buy).
    const strandedUsdce = O(42161, 'Arbitrum', 12, 0, 'USDC.e')
    const usdceRescue = planRobinhoodFundingAdvice({
      scan: { origins: [], gaslessOrigins: [strandedUsdce], allScanned: [strandedUsdce, O(8453, 'Base', 0, 0.01)], failedOrigins: [] },
      needUsd: 11, gasIncluded: true, followup: 'buy $10 of GOOGL',
    })
    const usdceRescueJob = usdceRescue.kind === 'gas-stranded' && usdceRescue.chips ? compileJobAsk(usdceRescue.chips[0].resume) : null
    check(
      'funding advice: gas-stranded USDC.e is named and its topup resume compiles',
      usdceRescue.kind === 'gas-stranded' && usdceRescue.stranded.token === 'USDC.e' && /USDC\.e/.test(usdceRescue.copy) &&
        !!usdceRescueJob && !('problem' in usdceRescueJob) &&
        usdceRescueJob.steps.some((s) => (s.params as { token?: string }).token === 'USDC.e'),
      JSON.stringify(usdceRescue),
    )
    // The honest refusal names USDC.e holdings too — money is never invisible.
    const usdceUnder = planRobinhoodFundingAdvice({
      scan: { origins: [], gaslessOrigins: [O(42161, 'Arbitrum', 4, 0, 'USDC.e')], allScanned: [O(42161, 'Arbitrum', 4, 0, 'USDC.e')], failedOrigins: [] },
      needUsd: 20, gasIncluded: true, followup: '',
    })
    check(
      'funding advice: the per-chain accounting names USDC.e',
      usdceUnder.kind === 'none' && /\$4 of USDC\.e on Arbitrum \(no ETH there to sign with\)/.test(usdceUnder.copy),
      JSON.stringify(usdceUnder),
    )
    check('rh-funding follow-up: "I have $10 USDC.e on arbitrum" → recheck', parseRhFundingFollowUp('I have $10 USDC.e on arbitrum')?.kind === 'recheck')

    // ── Native ETH as a funding source (2026-07-28): the most common
    // stranger wallet — ETH, no stables — used to wall the flagship stock
    // buy with "no USDC on Base, Ethereum, or Arbitrum". ETH origin rows
    // now ride the same chips/advice path: resumes carry "using eth" and
    // compile with the token in BOTH legs.
    const fpEthTok = parseRobinhoodFunding('Fund robinhood chain with $13.5 from base using eth including gas')
    check('funding parse: "using eth" picks native ETH', !!fpEthTok && fpEthTok.token === 'ETH' && fpEthTok.gasIncluded && fpEthTok.originChainId === 8453)
    const ethAnyOrigin = compileJobAsk('Fund robinhood chain with $7 from ethereum using eth, then buy $5 of NVDA')
    check(
      'funding compile: "using eth" compiles from every origin (native ETH needs no registry variant)',
      !!ethAnyOrigin && !('problem' in ethAnyOrigin) && (ethAnyOrigin.steps[0].params as { token?: string }).token === 'ETH',
    )
    const ethOnly = O(8453, 'Base', 480, 0.2, 'ETH')
    const ethChips = planRobinhoodFundingChips({ origins: [ethOnly], needUsd: 13.5, gasIncluded: true, followup: 'buy $12 of AAPL' })
    const ethOnlyJob = ethChips ? compileJobAsk(ethChips[0].resume) : null
    check(
      'funding chips: an ETH-only wallet gets chips whose resumes compile with token ETH in both legs',
      !!ethChips && /Base ETH/.test(ethChips[0].label) && /using eth/.test(ethChips[0].resume) &&
        !!ethOnlyJob && !('problem' in ethOnlyJob) &&
        (ethOnlyJob.steps[0].params as { leg?: string; token?: string }).leg === 'gas' &&
        (ethOnlyJob.steps[0].params as { token?: string }).token === 'ETH' &&
        (ethOnlyJob.steps[1].params as { token?: string }).token === 'ETH' &&
        ethChips.every((c) => {
          const j = compileJobAsk(c.resume)
          return !!j && !('problem' in j)
        }),
      JSON.stringify({ ethChips, steps: ethOnlyJob && !('problem' in ethOnlyJob) ? ethOnlyJob.steps.map((s) => s.params) : ethOnlyJob }),
    )
    // Stables lead, but the FIRST COVERING origin wins: dust USDC must not
    // force a combine past an ETH balance that covers the plan alone.
    const dustPlusEth = planRobinhoodFundingChips({ origins: [O(8453, 'Base', 3), ethOnly], needUsd: 13.5, gasIncluded: false, followup: 'buy $12 of AAPL' })
    check(
      'funding chips: dust USDC + covering ETH → the ETH origin leads (no forced combine)',
      !!dustPlusEth && /from Base ETH/.test(dustPlusEth[0].label),
      JSON.stringify(dustPlusEth),
    )
    // A covering stable still leads; covering ETH becomes the "instead" chip.
    const bothCover = planRobinhoodFundingChips({ origins: [O(8453, 'Base', 20), ethOnly], needUsd: 13.5, gasIncluded: false, followup: 'buy $12 of AAPL' })
    check(
      'funding chips: covering USDC leads, covering ETH offered as "Use Base ETH instead"',
      !!bothCover && /~\$13\.5 from Base\)/.test(bothCover[0].label) && bothCover.some((c) => /Use Base ETH instead/.test(c.label)),
      JSON.stringify(bothCover),
    )
    // Sub-keep-back ETH is NAMED but never planned and never "rescued" —
    // it IS the missing gas, so a gas-topup rescue would be nonsense.
    const dustEth = { ...O(1, 'Ethereum', 2, 0.0011, 'ETH'), spendable: false }
    const ethUnder = planRobinhoodFundingAdvice({
      scan: { origins: [], gaslessOrigins: [dustEth], allScanned: [dustEth], failedOrigins: [] },
      needUsd: 2, gasIncluded: true, followup: '',
    })
    check(
      'funding advice: sub-keep-back ETH → named with the honest parenthetical, never a gas-stranded rescue',
      ethUnder.kind === 'none' && /\$2 of ETH on Ethereum \(under what a move from there costs\)/.test(ethUnder.copy),
      JSON.stringify(ethUnder),
    )
    const emptyAdvice = planRobinhoodFundingAdvice({ scan: { origins: [], gaslessOrigins: [], allScanned: [], failedOrigins: [] }, needUsd: 5, gasIncluded: true, followup: '' })
    check(
      'funding advice: an empty wallet names both scanned tokens',
      emptyAdvice.kind === 'none' && /no USDC or ETH on Base, Ethereum, or Arbitrum/.test(emptyAdvice.copy),
      JSON.stringify(emptyAdvice),
    )

    // ── ETH two-leg headroom (live 2026-07-28): "~$8 from Ethereum ETH"
    // compiled a $1.5 gas leg + $6.5 value leg off the SAME balance — leg 1's
    // own L1 fee came out of the keep-back leg 2 re-checks in full, and the
    // job died mid-flight with $1.5 already bridged. A gas-included plan may
    // only promise an ETH row's capacity MINUS the per-chain headroom.
    const ethTight = O(1, 'Ethereum', 8, 0.0063, 'ETH')
    check(
      'funding chips: a gas-included plan never promises an ETH row\'s whole movable balance (two legs, one balance)',
      planRobinhoodFundingChips({ origins: [ethTight], needUsd: 8, gasIncluded: true, followup: 'buy $6.25 of AAPL' }) === null,
    )
    check(
      'funding chips: the same ETH row still covers a single-leg (gas-free) plan at full size',
      planRobinhoodFundingChips({ origins: [ethTight], needUsd: 8, gasIncluded: false, followup: 'buy $6.25 of AAPL' }) !== null,
    )
    const ethDownsized = planDownsizedRobinhoodBuy({ scan: { origins: [ethTight] }, buyUsd: 12, holdingUsd: 0, includeGas: true, buySym: 'AAPL', acquiring: false })
    const ethDownJob = ethDownsized ? compileJobAsk(ethDownsized.chips[0].resume) : null
    check(
      'funding downsize: the live wallet shape ($8 Ethereum ETH, gas leg) sizes under the headroom and compiles',
      !!ethDownsized && ethDownsized.needUsd <= 7 && ethDownsized.buyUsd <= 5.25 &&
        !!ethDownJob && !('problem' in ethDownJob),
      JSON.stringify(ethDownsized),
    )
    const ethAllChips = planRobinhoodFundingChips({ origins: [O(8453, 'Base', 20, 0.011, 'ETH')], needUsd: 13.5, gasIncluded: true, followup: 'buy $12 of AAPL' })
    check(
      'funding chips: "All my ETH" caps at the promisable capacity, not the raw row',
      !!ethAllChips && ethAllChips.some((c) => /^All my Base ETH \(\$19\.9\)/.test(c.label) && /with \$19\.9 from base using eth/.test(c.resume)),
      JSON.stringify(ethAllChips),
    )
    // The mid-flight clamp (pure core): the exact live numbers — a $6.5 leg
    // (0.003463 ETH at the day's mark) against the wallet's 0.005429 ETH
    // after leg 1's fee → clamps to movable (keep-back preserved); fully
    // funded stays untouched; really short still refuses (null).
    const wei = (s: string) => BigInt(s)
    check(
      'native clamp: a marginal mid-flight shortfall clamps to the movable balance',
      clampNativeSellAtoms(wei('3463000000000000'), wei('5429000000000000'), wei('2000000000000000')) === wei('3429000000000000'),
    )
    check(
      'native clamp: a funded leg sells exactly the ask',
      clampNativeSellAtoms(wei('3463000000000000'), wei('9000000000000000'), wei('2000000000000000')) === wei('3463000000000000'),
    )
    check(
      'native clamp: a real shortfall (past tolerance) still refuses',
      clampNativeSellAtoms(wei('3463000000000000'), wei('3000000000000000'), wei('2000000000000000')) === null,
    )

    // ── The rh-funding follow-up parser: the typed continuations that must
    // re-enter the funding layer instead of falling to the planner.
    check('rh-funding follow-up: "I have $10 USDC on arbitrum" → recheck', parseRhFundingFollowUp('I have $10 USDC on arbitrum')?.kind === 'recheck')
    check('rh-funding follow-up: "just sent the ETH" → recheck', parseRhFundingFollowUp('just sent the ETH')?.kind === 'recheck')
    check('rh-funding follow-up: "topped up gas on base" → recheck', parseRhFundingFollowUp('topped up gas on base')?.kind === 'recheck')
    check('rh-funding follow-up: "check again" → recheck', parseRhFundingFollowUp('check again')?.kind === 'recheck')
    check('rh-funding follow-up: "done" → recheck', parseRhFundingFollowUp('done')?.kind === 'recheck')
    check('rh-funding follow-up: "never mind" → cancel', parseRhFundingFollowUp('never mind, leave it')?.kind === 'cancel')
    check('rh-funding follow-up: a question never claims the turn', parseRhFundingFollowUp('what do I have on arbitrum?') === null && parseRhFundingFollowUp('do i have any USDC') === null)
    check('rh-funding follow-up: an unrelated ask never claims the turn', parseRhFundingFollowUp('buy $5 of NVDA') === null && parseRhFundingFollowUp('show my portfolio') === null && parseRhFundingFollowUp('swap 1 USDC for WETH on base') === null)

    // ── In-flight settlement awareness (live 2026-07-21): a funding scan run
    // ~60s after the user signed a NEAR Intents deposit toward Arbitrum saw
    // an empty destination and asserted "none on Base, Ethereum, or
    // Arbitrum". The refusal must NAME the in-flight transfer instead —
    // detection reads the echoed pending (xchain, or the facts forwarded on
    // rh-funding), the one-click status maps to a claim, and every branch
    // routes the user to "check again" (the deterministic re-scan).
    const DEPOSIT = '0x1111111111111111111111111111111111111111'
    const xp = crossChainPending(
      { amount: '12', originToken: 'USDC', originChain: 'base', destinationToken: 'USDC', destinationChain: 'arb' },
      DEPOSIT,
      'x',
    )
    const dep = inflightDepositFromPending(xp)
    check(
      'inflight: the xchain pending (the real producer) → deposit toward a funding origin, words normalized',
      !!dep && dep.depositAddress === DEPOSIT && dep.token === 'USDC' && dep.originChain === 'Base' && dep.destinationChain === 'Arbitrum' && dep.amount === '12',
      JSON.stringify(dep),
    )
    check(
      'inflight: a deposit toward a NON-funding-origin chain never produces a note',
      inflightDepositFromPending(crossChainPending({ amount: '1', originToken: 'USDC', originChain: 'base', destinationToken: 'USDC', destinationChain: 'solana' }, DEPOSIT, 'x')) === null,
    )
    check(
      'inflight: an invalid deposit address → null (the address only ever comes from the tool)',
      inflightDepositFromPending({ kind: 'xchain', data: { amount: '1', originToken: 'USDC', originChain: 'base', destinationChain: 'arbitrum', depositAddress: 'not-an-address' } }) === null,
    )
    check(
      'inflight: unrelated pending kinds and no pending → null',
      inflightDepositFromPending({ kind: 'aave-supply', data: {} }) === null && inflightDepositFromPending(undefined) === null,
    )
    // The forward-carry loop: a refusal REPLACES the xchain pending with
    // rh-funding — the deposit's facts must survive that swap AND the
    // client-echo sanitizer, or the awareness dies after one turn.
    const forwarded = rhFundingPending(10, 'AAPL', inflightPendingData(dep!))
    const echoed = sanitizeWorkingContext({ v: 1, age: 1, pending: forwarded })
    check(
      'inflight: rh-funding forward-carry round-trips through sanitizeWorkingContext',
      !!echoed?.pending && JSON.stringify(inflightDepositFromPending(echoed.pending)) === JSON.stringify(dep),
      JSON.stringify(echoed?.pending),
    )
    check('inflight: rhFundingPending without a deposit keeps its plain shape', Object.keys(rhFundingPending(10, 'AAPL').data).join(',') === 'buyUsd,buySym')
    check(
      'inflight: pending expiry bounds the awareness window (age > 2 → gone)',
      !sanitizeWorkingContext({ v: 1, age: 3, pending: forwarded })?.pending,
    )
    // Status → claim mapping (the jobs runner's oneclick buckets).
    check(
      'inflight status: one-click states map to the right claims',
      classifyOneclickStatus('{"status":"SUCCESS"}') === 'settled' &&
        classifyOneclickStatus('REFUNDED') === 'refunded' &&
        classifyOneclickStatus('KNOWN_DEPOSIT_TX') === 'settling' &&
        classifyOneclickStatus('PROCESSING') === 'settling' &&
        classifyOneclickStatus('PENDING_DEPOSIT') === 'awaiting-deposit' &&
        classifyOneclickStatus('something unrecognized') === 'unknown',
    )
    const settling = inflightSettlingNote(dep!, 'settling')
    check('inflight copy: settling names the route and routes to “check again”', /12 USDC Base → Arbitrum/.test(settling) && /still settling/.test(settling) && /check again/.test(settling), settling)
    check('inflight copy: awaiting-deposit hedges the unsigned case', /never signed/.test(inflightSettlingNote(dep!, 'awaiting-deposit')))
    check('inflight copy: refunded says where the money went back to', /refunded/.test(inflightSettlingNote(dep!, 'refunded')) && /back on Base/.test(inflightSettlingNote(dep!, 'refunded')))
    check('inflight copy: unknown never asserts — conditional phrasing only', /if you signed it/.test(inflightSettlingNote(dep!, 'unknown')))
  }

  // ── Aave supply: parse + reserve pick + the SAFETY guard on the build ─────
  // The guard is the load-bearing check — the planner path once sent the
  // SYMBOL to an address-validated param (-32602) and the house model
  // fabricated wallet balances; the native path verifies every step it
  // offers: exact amount, official spoke, deposit credits the user.
  console.log('— aave native supply (parse + guard)')
  {
    const p = parseAaveSupply('add 1 USDC to an Aave pool on Ethereum')
    check('aave parse: "add 1 USDC to an Aave pool"', !!p && !('problem' in p) && p.amount === '1' && p.token === 'USDC' && p.explicitAave && p.otherChain === null)
    const p2 = parseAaveSupply('can we add 1 USDC to a pool on etheraum')
    check('aave parse: generic "a pool" + typo chain (implicit aave)', !!p2 && !('problem' in p2) && p2.amount === '1' && !p2.explicitAave && p2.otherChain === null)
    const p3 = parseAaveSupply('supply 25 USDC to aave on base')
    check('aave parse: non-Ethereum chain surfaces', !!p3 && !('problem' in p3) && p3.otherChain === 'base')
    check('aave parse: other venue named → null', parseAaveSupply('add 1 USDC to a uniswap pool') === null)
    check('aave parse: plain question → null', parseAaveSupply('what is the best APY on aave?') === null)
    check('aave parse: swap ask → null', parseAaveSupply('swap 100 USDC for WETH') === null)
    const noAmt = parseAaveSupply('deposit USDC into aave')
    check('aave parse: missing amount → problem (the one real clarify)', !!noAmt && 'problem' in noAmt)

    // Bare imperative + filler — the LIVE 2026-07-13 miss: "can I supply 1
    // more USDC" (context = the previous Aave turn) fell through to the
    // planner, which sent the SYMBOL to build_supply's address regex → -32602.
    const bare = parseAaveSupply('can I supply 1 more USDC')
    check('aave parse: bare "can I supply 1 more USDC" (filler + no aave word)', !!bare && !('problem' in bare) && bare.amount === '1' && bare.token === 'USDC' && !bare.explicitAave && bare.otherChain === null)
    const filler = parseAaveSupply('supply 5 extra USDC to aave')
    check('aave parse: "5 extra USDC" filler with aave named', !!filler && !('problem' in filler) && filler.amount === '5' && filler.token === 'USDC')
    check('aave parse: bare filler with NO token ("supply 1 more") → null', parseAaveSupply('supply 1 more') === null)
    check('aave parse: bare lending verb is NOT weak', !!bare && !('problem' in bare) && !bare.weak)
    const weakAdd = parseAaveSupply('add 1 USDC')
    check('aave parse: bare generic verb ("add 1 USDC") → WEAK (set decides)', !!weakAdd && !('problem' in weakAdd) && weakAdd.weak === true && weakAdd.amount === '1')
    const weakDep = parseAaveSupply('deposit 5 USDC')
    check('aave parse: bare "deposit 5 USDC" → WEAK (hyperliquid takes deposits too)', !!weakDep && !('problem' in weakDep) && weakDep.weak === true)
    check('aave parse: bare with a non-Aave destination → null', parseAaveSupply('deposit 5 USDC to hyperliquid') === null)
    check('aave parse: bare with an unknown destination → null', parseAaveSupply('supply 5 USDC to my savings account') === null)
    check('aave parse: bare question form ("should I…") → null', parseAaveSupply('should i supply 100 USDC') === null)
    // Set-aware disambiguation for weak verbs.
    check('aave rival: hyperliquid in the set → named', competingVenueOf([{ slug: 'aave', name: 'Aave' }, { slug: 'hyperliquid-free', name: 'Hyperliquid (Free)' }]) === 'Hyperliquid (Free)')
    check('aave rival: wallet+aave only → null (Aave is the only venue)', competingVenueOf([{ slug: 'aave', name: 'Aave' }, { slug: 'yeetful-tool-wallet', name: 'Yeetful Wallet' }]) === null)

    // Reserve pick — Main (deepest + collateral-enabled) wins; shapes from a
    // live reserves probe 2026-07-10.
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const SPOKE = '0x94e7A5dCbE816e498b89aB752661904E2F56c485'
    const USER = '0x28C6c06298d514Db089934071355E5743bf21d60'
    // base64("1::<spoke>::7") — the Main-spoke USDC reserveId shape.
    const reserveId = Buffer.from(`1::${SPOKE}::7`).toString('base64')
    const rows = [
      { reserveId: 'x', spoke: 'Frozen', spokeAddress: SPOKE, asset: { symbol: 'USDC', address: USDC, decimals: 6 }, canSupply: true, active: false },
      { reserveId, spoke: 'Main', spokeAddress: SPOKE, asset: { symbol: 'USDC', address: USDC, decimals: 6 }, canSupply: true, canUseAsCollateral: true, active: true, supplied: '6232610.63', suppliedUsd: '$6,231,860.29', supplyApyPct: 2.55 },
      { reserveId: 'y', spoke: 'Other', spokeAddress: SPOKE, asset: { symbol: 'WETH', address: USDC, decimals: 18 }, canSupply: true, active: true },
    ]
    const picked = pickSupplyReserve(rows, 'usdc')
    check('aave pick: active+collateral Main reserve, decoded onChainId', !!picked && picked.spokeName === 'Main' && picked.decimals === 6 && picked.onChainId === BigInt(7) && !!picked.priceUsd && Math.abs(picked.priceUsd - 1) < 0.01)

    // The guard vs the LIVE-probed plan shape: approve(spoke, atoms) on the
    // token, then supply(onChainId, atoms, user) on the spoke.
    const atoms = BigInt(1000000)
    const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SPOKE as `0x${string}`, atoms] })
    const word = (v: bigint | string) => (typeof v === 'bigint' ? v.toString(16) : v.toLowerCase().replace(/^0x/, '')).padStart(64, '0')
    const supplyData = `0x852a56a5${word(BigInt(7))}${word(atoms)}${word(USER)}`
    const goodPlan = {
      operation: 'supply',
      steps: [
        { action: 'send_transaction', label: 'approve', summary: 'Approve 1 USDC', tx: { to: USDC, data: approveData, value: '0', chainId: 1 } },
        { action: 'send_transaction', label: 'supply', summary: 'Supply 1 USDC', tx: { to: SPOKE, data: supplyData, value: '0', chainId: 1 } },
      ],
    }
    const exp = { chainId: 1, atoms, currency: USDC, spoke: SPOKE, user: USER, onChainId: BigInt(7) }
    const g = guardAaveSupplyBuild(goodPlan, exp)
    check('aave guard: correct approve→supply PASSES', g.ok && g.steps?.length === 2 && g.steps[1].tx.to === SPOKE)
    check('aave guard: wrong supply amount is refused', !guardAaveSupplyBuild({ ...goodPlan, steps: [goodPlan.steps[0], { ...goodPlan.steps[1], tx: { ...goodPlan.steps[1].tx, data: `0x852a56a5${word(BigInt(7))}${word(BigInt(2000000))}${word(USER)}` } }] }, exp).ok)
    check('aave guard: deposit crediting a DIFFERENT address is refused', !guardAaveSupplyBuild({ ...goodPlan, steps: [goodPlan.steps[0], { ...goodPlan.steps[1], tx: { ...goodPlan.steps[1].tx, data: `0x852a56a5${word(BigInt(7))}${word(atoms)}${word('0x000000000000000000000000000000000000dEaD')}` } }] }, exp).ok)
    check('aave guard: supply to an unresolved spoke is refused', !guardAaveSupplyBuild({ ...goodPlan, steps: [goodPlan.steps[0], { ...goodPlan.steps[1], tx: { ...goodPlan.steps[1].tx, to: USER } }] }, exp).ok)
    const evilApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: ['0x000000000000000000000000000000000000dEaD' as `0x${string}`, atoms] })
    check('aave guard: approval to a non-spoke spender is refused', !guardAaveSupplyBuild({ ...goodPlan, steps: [{ ...goodPlan.steps[0], tx: { ...goodPlan.steps[0].tx, data: evilApprove } }, goodPlan.steps[1]] }, exp).ok)
    check('aave guard: wrong chain is refused', !guardAaveSupplyBuild({ ...goodPlan, steps: goodPlan.steps.map((s) => ({ ...s, tx: { ...s.tx, chainId: 8453 } })) }, exp).ok)
    check('aave guard: no-approve single-step plan PASSES', guardAaveSupplyBuild({ operation: 'supply', steps: [goodPlan.steps[1]] }, exp).ok)

    // Follow-ups.
    const apend = { kind: 'aave-supply', data: { amount: '1', token: 'USDC', spoke: 'Main' } }
    check('aave follow-up: "cancel" drops it', parseAaveSupplyFollowUp('cancel', apend)?.kind === 'cancel')
    check('aave follow-up: "yes" is a noop (card already there)', parseAaveSupplyFollowUp('yes', apend)?.kind === 'noop')
    const aamend = parseAaveSupplyFollowUp('make it 5', apend)
    check('aave follow-up: "make it 5" re-amount', aamend?.kind === 'amend' && aamend.params.amount === '5' && aamend.params.token === 'USDC')
  }

  // ── Aave withdraw / borrow / repay: parse + position pick + the op guard ──
  // Same safety property as supply, per-op: pinned selectors + calldata
  // layouts from a LIVE probe 2026-07-10 (withdraw 0x0ad58d2f / borrow
  // 0xd6bda0c0 / repay 0xb1e8f8ef, all (reserve, amount, user); withdraw max
  // = the 2^255−1 sentinel, repay max = quoted debt + ~1% interest buffer).
  console.log('— aave native ops (withdraw/borrow/repay: parse + guard)')
  {
    // Parse.
    const w = parseAaveOp('withdraw 0.5 WETH from aave')
    check('aave ops parse: "withdraw 0.5 WETH from aave"', !!w && !('problem' in w) && w.op === 'withdraw' && w.amount === '0.5' && w.token === 'WETH' && !w.max)
    const wmax = parseAaveOp('withdraw all my USDC from the pool')
    check('aave ops parse: "withdraw all my USDC" → max (implicit aave, poolish)', !!wmax && !('problem' in wmax) && wmax.op === 'withdraw' && wmax.max && wmax.token === 'USDC' && !wmax.explicitAave)
    const wbare = parseAaveOp('withdraw 100 USDC')
    check('aave ops parse: bare "withdraw 100 USDC" → WEAK (set decides the venue)', !!wbare && !('problem' in wbare) && wbare.op === 'withdraw' && wbare.weak === true && wbare.amount === '100')
    check('aave ops parse: bare withdraw with a non-Aave source → null', parseAaveOp('withdraw 100 USDC from binance') === null)
    check('aave ops parse: bare withdraw "to my wallet" stays WEAK-parsed', (() => { const p = parseAaveOp('withdraw 100 USDC to my wallet'); return !!p && !('problem' in p) && p.weak === true })())
    const b = parseAaveOp('borrow 100 USDC on aave')
    check('aave ops parse: "borrow 100 USDC on aave"', !!b && !('problem' in b) && b.op === 'borrow' && b.amount === '100' && !b.max)
    const b2 = parseAaveOp('can we borrow 250 usdt against my collateral')
    check('aave ops parse: bare borrow verb (implicit aave)', !!b2 && !('problem' in b2) && b2.op === 'borrow' && b2.token === 'usdt' && !b2.explicitAave)
    const r = parseAaveOp('repay 100 USDT on aave')
    check('aave ops parse: "repay 100 USDT"', !!r && !('problem' in r) && r.op === 'repay' && r.amount === '100' && !r.max)
    const rmax = parseAaveOp('pay off my USDT debt on aave')
    check('aave ops parse: "pay off my USDT debt" → full repay', !!rmax && !('problem' in rmax) && rmax.op === 'repay' && rmax.max && rmax.token === 'USDT')
    const rall = parseAaveOp('repay all my USDC debt')
    check('aave ops parse: "repay all my USDC debt" → max', !!rall && !('problem' in rall) && rall.op === 'repay' && rall.max)
    const wchain = parseAaveOp('withdraw 5 USDC from aave on base')
    check('aave ops parse: non-Ethereum chain surfaces', !!wchain && !('problem' in wchain) && wchain.otherChain === 'base')
    check('aave ops parse: other venue named → null', parseAaveOp('withdraw 100 USDC from my compound position') === null)
    check('aave ops parse: question → null', parseAaveOp('should I repay my USDT debt on aave?') === null)
    check('aave ops parse: swap ask → null', parseAaveOp('swap 100 USDC for WETH') === null)
    const wna = parseAaveOp('withdraw my USDC from aave')
    check('aave ops parse: missing amount → problem', !!wna && 'problem' in wna && wna.op === 'withdraw')
    const bna = parseAaveOp('borrow USDC from aave')
    check('aave ops parse: borrow missing amount → problem', !!bna && 'problem' in bna && bna.op === 'borrow')
    // Filler between amount and token — same live bug class as supply.
    const wmore = parseAaveOp('withdraw 5 more USDC from aave')
    check('aave ops parse: "withdraw 5 more USDC" filler', !!wmore && !('problem' in wmore) && wmore.op === 'withdraw' && wmore.amount === '5' && wmore.token === 'USDC')
    const bmore = parseAaveOp('can we borrow 100 more USDC against my collateral')
    check('aave ops parse: "borrow 100 more USDC" filler', !!bmore && !('problem' in bmore) && bmore.op === 'borrow' && bmore.amount === '100' && bmore.token === 'USDC')
    check('aave ops parse: filler with NO token ("borrow 5 more" + aave) → null', parseAaveOp('borrow 5 more on aave') === null)
    check('aave ops parse: hyperliquid destination → null (venue list)', parseAaveOp('withdraw 100 USDC from hyperliquid') === null)

    // Position pick — anchored to the user's own portfolio rows.
    const SPOKE = '0x94e7A5dCbE816e498b89aB752661904E2F56c485'
    const SPOKE2 = '0x973a023A77420ba610f06b3858aD991Df6d85A08'
    const USDC = '0xA0b86991c6218b36c1d19D4a2e9Eb0cE3606eB48'
    const USER = '0x71F12a5b0E60d2Ff8A87FD34E7dcff3c10c914b0'
    const supplies = [
      { spoke: 'Bluechip', spokeAddress: SPOKE2, token: { symbol: 'USDC', address: USDC, decimals: 6 }, withdrawable: '50', balanceUsd: '$50.00' },
      { spoke: 'Main', spokeAddress: SPOKE, token: { symbol: 'USDC', address: USDC, decimals: 6 }, withdrawable: '1500', balanceUsd: '$1,500.00' },
    ]
    const wpos = pickWithdrawPosition(supplies, 'usdc')
    check('aave ops pick: withdraw anchors to the LARGEST position spoke', !!wpos && wpos.spoke === 'Main' && wpos.withdrawable === '1500')
    const borrows = [
      { spoke: 'Main', spokeAddress: SPOKE, token: { symbol: 'USDT', address: '0xdAC17F958D2ee523a2206206994597C13D831ec7', decimals: 6 }, debt: '156079.464951', debtUsd: '$155,946.32' },
    ]
    const rpos = pickRepayPosition(borrows, 'USDT')
    check('aave ops pick: repay anchors to the debt spoke', !!rpos && rpos.spoke === 'Main')
    check('aave ops pick: no position → null', pickWithdrawPosition(supplies, 'WETH') === null && pickRepayPosition(borrows, 'USDC') === null)

    // The same asset can be listed as separate supply-leg / borrow-leg rows
    // on one spoke with DIFFERENT on-chain ids — the op picks its leg.
    const legRows = [
      { reserveId: Buffer.from(`1::${SPOKE}::7`).toString('base64'), spoke: 'Main', spokeAddress: SPOKE, asset: { symbol: 'USDC', address: USDC, decimals: 6 }, canSupply: true, canBorrow: false, active: true, supplied: '100', suppliedUsd: '$100.00' },
      { reserveId: Buffer.from(`1::${SPOKE}::9`).toString('base64'), spoke: 'Main', spokeAddress: SPOKE, asset: { symbol: 'USDC', address: USDC, decimals: 6 }, canSupply: false, canBorrow: true, active: true, supplied: '100', suppliedUsd: '$100.00', borrowApyPct: 3.44 },
    ]
    const supplyLeg = reserveForOp(legRows, 'USDC', SPOKE, 'supply')
    const borrowLeg = reserveForOp(legRows, 'USDC', SPOKE, 'borrow')
    check('aave ops reserve: op picks its leg (different onChainId)', supplyLeg?.onChainId === BigInt(7) && borrowLeg?.onChainId === BigInt(9) && borrowLeg.borrowApyPct === 3.44)
    const positions = [
      { spoke: 'Gold', spokeAddress: '0x65407b940966954b23dfA3caA5C0702bB42984DC', remainingBorrowingPowerUsd: '$19,241.92' },
      { spoke: 'Main', spokeAddress: SPOKE, remainingBorrowingPowerUsd: '$123,375.34' },
    ]
    const bpick = pickBorrowReserve(legRows, 'USDC', positions)
    check('aave ops pick: borrow uses the most-powered spoke listing the token', !!bpick && bpick.picked.onChainId === BigInt(9) && bpick.position.spoke === 'Main')
    check('aave ops pick: borrow with zero borrowing power → null', pickBorrowReserve(legRows, 'USDC', [{ spokeAddress: SPOKE, remainingBorrowingPowerUsd: '$0.00' }]) === null)

    // The op guard vs the LIVE-probed layouts. Selectors are pinned — one
    // op's calldata can never verify as another's.
    const word = (v: bigint | string) => (typeof v === 'bigint' ? v.toString(16) : v.toLowerCase().replace(/^0x/, '')).padStart(64, '0')
    const atoms = BigInt(500000)
    const step = (to: string, data: string, label = 'op') => ({ action: 'send_transaction', label, summary: label, tx: { to, data, value: '0', chainId: 1 } })
    const wexp = { op: 'withdraw' as const, chainId: 1, amount: { kind: 'exact' as const, atoms }, currency: USDC, spoke: SPOKE, user: USER, onChainIds: [BigInt(7)] }
    const wdata = `0x0ad58d2f${word(BigInt(7))}${word(atoms)}${word(USER)}`
    check('aave op guard: correct single-step withdraw PASSES', guardAaveOpBuild({ operation: 'withdraw', steps: [step(SPOKE, wdata, 'withdraw')] }, wexp).ok)
    check('aave op guard: withdraw sending funds ELSEWHERE is refused', !guardAaveOpBuild({ operation: 'withdraw', steps: [step(SPOKE, `0x0ad58d2f${word(BigInt(7))}${word(atoms)}${word('0x000000000000000000000000000000000000dEaD')}`, 'withdraw')] }, wexp).ok)
    check('aave op guard: cross-op calldata (supply sel on a withdraw) is refused', !guardAaveOpBuild({ operation: 'withdraw', steps: [step(SPOKE, `0x852a56a5${word(BigInt(7))}${word(atoms)}${word(USER)}`, 'withdraw')] }, wexp).ok)
    const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SPOKE as `0x${string}`, atoms] })
    check('aave op guard: a withdraw growing an approve step is refused', !guardAaveOpBuild({ operation: 'withdraw', steps: [step(USDC, approveData, 'approve'), step(SPOKE, wdata, 'withdraw')] }, wexp).ok)
    const wmaxExp = { ...wexp, amount: { kind: 'withdraw-max' as const } }
    check('aave op guard: withdraw-max sentinel PASSES', guardAaveOpBuild({ operation: 'withdraw', steps: [step(SPOKE, `0x0ad58d2f${word(BigInt(7))}${word(WITHDRAW_MAX_SENTINEL)}${word(USER)}`, 'withdraw')] }, wmaxExp).ok)
    check('aave op guard: withdraw-max WITHOUT the sentinel is refused', !guardAaveOpBuild({ operation: 'withdraw', steps: [step(SPOKE, wdata, 'withdraw')] }, wmaxExp).ok)

    const bexp = { ...wexp, op: 'borrow' as const, onChainIds: [BigInt(4), BigInt(9)] } // two borrow legs on one spoke (live: Bluechip USDC)
    check('aave op guard: correct borrow PASSES', guardAaveOpBuild({ operation: 'borrow', steps: [step(SPOKE, `0xd6bda0c0${word(BigInt(9))}${word(atoms)}${word(USER)}`, 'borrow')] }, bexp).ok)
    check('aave op guard: the OTHER leg of the same asset+spoke also PASSES', guardAaveOpBuild({ operation: 'borrow', steps: [step(SPOKE, `0xd6bda0c0${word(BigInt(4))}${word(atoms)}${word(USER)}`, 'borrow')] }, bexp).ok)
    check('aave op guard: a FOREIGN reserve id is refused', !guardAaveOpBuild({ operation: 'borrow', steps: [step(SPOKE, `0xd6bda0c0${word(BigInt(5))}${word(atoms)}${word(USER)}`, 'borrow')] }, bexp).ok)
    check('aave ops reserve: leg-id set for the guard', JSON.stringify(reserveLegIds(legRows, 'USDC', SPOKE, 'borrow').map(String)) === '["9"]' && JSON.stringify(reserveLegIds(legRows, 'USDC', SPOKE, 'supply').map(String)) === '["7"]')
    check('aave op guard: borrow amount mismatch is refused', !guardAaveOpBuild({ operation: 'borrow', steps: [step(SPOKE, `0xd6bda0c0${word(BigInt(9))}${word(atoms * BigInt(2))}${word(USER)}`, 'borrow')] }, bexp).ok)
    check('aave op guard: wrong chain is refused', !guardAaveOpBuild({ operation: 'borrow', steps: [{ ...step(SPOKE, `0xd6bda0c0${word(BigInt(9))}${word(atoms)}${word(USER)}`, 'borrow'), tx: { to: SPOKE, data: `0xd6bda0c0${word(BigInt(9))}${word(atoms)}${word(USER)}`, value: '0', chainId: 8453 } }] }, bexp).ok)

    // Repay: approve→repay, and the live-probed max encoding (quoted debt +
    // ~1% buffer — NOT a sentinel), bounded by the portfolio's debt read.
    const rexp = { op: 'repay' as const, chainId: 1, amount: { kind: 'exact' as const, atoms }, currency: USDC, spoke: SPOKE, user: USER, onChainIds: [BigInt(9)] }
    const rdata = `0xb1e8f8ef${word(BigInt(9))}${word(atoms)}${word(USER)}`
    check('aave op guard: approve→repay PASSES', guardAaveOpBuild({ operation: 'repay', steps: [step(USDC, approveData, 'approve'), step(SPOKE, rdata, 'repay')] }, rexp).ok)
    const debtAtoms = BigInt(92899677)
    const quoted = BigInt(93828673) // live probe: debt 92.899677 → quote 93.828673
    const rmaxExp = { ...rexp, amount: { kind: 'repay-max' as const, debtAtoms } }
    const rmaxApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [SPOKE as `0x${string}`, quoted] })
    check('aave op guard: repay-max within the interest buffer PASSES', guardAaveOpBuild({ operation: 'repay', steps: [step(USDC, rmaxApprove, 'approve'), step(SPOKE, `0xb1e8f8ef${word(BigInt(9))}${word(quoted)}${word(USER)}`, 'repay')] }, rmaxExp).ok)
    check('aave op guard: repay-max far OVER the debt is refused', !guardAaveOpBuild({ operation: 'repay', steps: [step(SPOKE, `0xb1e8f8ef${word(BigInt(9))}${word(debtAtoms * BigInt(2))}${word(USER)}`, 'repay')] }, rmaxExp).ok)
    check('aave op guard: repay-max BELOW the read debt is refused', !guardAaveOpBuild({ operation: 'repay', steps: [step(SPOKE, `0xb1e8f8ef${word(BigInt(9))}${word(debtAtoms - BigInt(1))}${word(USER)}`, 'repay')] }, rmaxExp).ok)
    const evilApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: ['0x000000000000000000000000000000000000dEaD' as `0x${string}`, atoms] })
    check('aave op guard: repay approval to a non-spoke spender is refused', !guardAaveOpBuild({ operation: 'repay', steps: [step(USDC, evilApprove, 'approve'), step(SPOKE, rdata, 'repay')] }, rexp).ok)

    // Follow-ups.
    const wpend = { kind: 'aave-withdraw', data: { op: 'withdraw', amount: '0.5', token: 'WETH', spoke: 'Main' } }
    check('aave ops follow-up: "cancel" drops it', parseAaveOpFollowUp('cancel', wpend)?.kind === 'cancel')
    check('aave ops follow-up: "yes" is a noop (card already there)', parseAaveOpFollowUp('yes', wpend)?.kind === 'noop')
    const wamend = parseAaveOpFollowUp('make it 2', wpend)
    check('aave ops follow-up: "make it 2" re-amount keeps the op', wamend?.kind === 'amend' && wamend.params.op === 'withdraw' && wamend.params.amount === '2' && wamend.params.token === 'WETH')
    check('aave ops follow-up: supply pending is not ours', parseAaveOpFollowUp('cancel', { kind: 'aave-supply', data: {} }) === null)
  }

  // ── Add-MCP (custom rows): callable row + idempotent re-add ───────────────
  // Discovery runs against the LIVE first-party wallet MCP (free, no key) —
  // proves the whole modal path: tools discovered, endpoint/protocol set ON
  // the server row (the cross-chain guard reads s.endpoint), and re-adding
  // the same base UPDATES the row instead of minting a duplicate slug.
  console.log('— add-MCP (custom rows)')
  {
    const WALLET_BASE = 'https://wallet-mcp.yeetful.com/mcp'
    const addBody = (name: string) => ({
      method: 'POST' as const,
      headers: { 'content-type': 'application/json', ...C },
      body: JSON.stringify({ name, description: 'test-api custom add', category: 'Custom', mcpUrl: WALLET_BASE, featuredTools: ['portfolio'] }),
    })
    const first = await fetch(`${BASE}/api/servers`, addBody('Test Custom Wallet'))
    const firstRow = (await first.json().catch(() => null)) as { id?: string; slug?: string; endpoint?: string | null; protocol?: string | null; endpointCount?: number; updated?: boolean } | null
    check('add-MCP: created with discovered tools', first.ok && (firstRow?.endpointCount ?? 0) >= 6)
    check('add-MCP: server row is CALLABLE (endpoint + protocol set)', firstRow?.endpoint === WALLET_BASE && firstRow?.protocol === 'mcp')
    const again = await fetch(`${BASE}/api/servers`, addBody('Test Custom Wallet Renamed'))
    const againRow = (await again.json().catch(() => null)) as { id?: string; slug?: string; name?: string; updated?: boolean } | null
    check('add-MCP: re-adding the same base UPDATES the row (no duplicate)', again.ok && againRow?.updated === true && againRow?.id === firstRow?.id)
    check('add-MCP: re-add keeps the original slug, refreshes metadata', againRow?.slug === firstRow?.slug && againRow?.name === 'Test Custom Wallet Renamed')
    if (firstRow?.id) {
      const del = await fetch(`${BASE}/api/servers?id=${firstRow.id}`, { method: 'DELETE', headers: C })
      check('add-MCP: test row cleaned up', del.ok)
    }
  }

  // ── Launch token (link an on-chain launch to the directory) ───────────────
  console.log('— launch token')
  const launchAnon = await fetch(`${BASE}/api/mcp/__nope__/launch`, { method: 'POST' })
  check('launch without session → 401', launchAnon.status === 401)
  const launchUnknown = await fetch(`${BASE}/api/mcp/__nope__/launch`, { method: 'POST', headers: C })
  check('launch signed-in, unknown MCP → 404', launchUnknown.status === 404)
  if (someSlug) {
    const launchUnclaimed = await fetch(`${BASE}/api/mcp/${someSlug}/launch`, { method: 'POST', headers: C })
    check('launch an unclaimed MCP → 403 (claim first)', launchUnclaimed.status === 403)
  }

  // ── Auto-Router engine (B1): pure routing brain — candidate menu, the
  //    routing-decision parser, and inference-engine selection. No DB query,
  //    no real inference, no spend (mirrors how the suite avoids paid calls);
  //    the live house-paid route is exercised over the streaming endpoint (B2)
  //    and as a manual owner pass. ───────────────────────────────────────────
  console.log('— auto-router engine')
  const routerEps: PlannableEndpoint[] = [
    {
      id: 'ep-trip-search', serverSlug: 'tripadvisor', serverName: 'TripAdvisor', method: 'GET',
      url: 'https://trip.example.test/search', description: 'Search places', priceUsd: '0.01',
      parameters: [{ group: 'query', name: 'q', type: 'string', required: true }],
      reliability: { settled: 5, recent: true },
    },
    {
      id: 'ep-trip-detail', serverSlug: 'tripadvisor', serverName: 'TripAdvisor', method: 'GET',
      url: 'https://trip.example.test/detail/:id', description: 'Place detail', priceUsd: '0.02',
      parameters: [{ group: 'path', name: 'id', type: 'string', required: true }],
    },
    {
      id: 'ep-wolfram', serverSlug: 'wolfram', serverName: 'Wolfram', method: 'GET',
      url: 'https://wolfram.example.test/compute', description: 'Compute', priceUsd: '0.005',
      parameters: [{ group: 'query', name: 'input', type: 'string', required: true }],
    },
  ]

  const routerPromptText = routerPrompt('hotels in Paris', routerEps)
  check(
    'router prompt: lists candidate ids + prices across services',
    routerPromptText.includes('ep-trip-search') && routerPromptText.includes('[$0.01]') && routerPromptText.includes('ep-wolfram'),
  )
  check(
    'router prompt: asks for intent/needs/picks JSON',
    routerPromptText.includes('"intent"') && routerPromptText.includes('"needs"') && routerPromptText.includes('"picks"'),
  )
  check('router prompt: surfaces the proven tag to the model', routerPromptText.includes('✓proven'))

  const goodReply = JSON.stringify({
    intent: 'Find hotels in Paris',
    needs: ['live travel listings'],
    picks: [
      { endpointId: 'ep-trip-search', params: { q: 'Paris hotels' }, reason: 'travel search', score: 0.9 },
      { endpointId: 'ep-trip-detail', params: { id: '123' }, reason: 'second pick, same service', score: 0.5 },
      { endpointId: 'ep-does-not-exist', params: {}, reason: 'unknown', score: 1 },
    ],
  })
  const dec = parseRouterDecision(goodReply, routerEps)
  check('router parse: intent + needs extracted', dec.intent === 'Find hotels in Paris' && dec.needs[0] === 'live travel listings')
  check(
    'router parse: ≤1 pick/service + unknown ids dropped',
    dec.picks.length === 1 && dec.picks[0].endpointId === 'ep-trip-search',
  )
  check('router parse: reason + clamped score threaded onto the pick', dec.picks[0].reason === 'travel search' && dec.picks[0].score === 0.9)
  check('router parse: garbage reply → empty decision', parseRouterDecision('not json', routerEps).picks.length === 0)

  type RouterSrv = Parameters<typeof selectInferenceProvider>[0][number]
  const claude = { slug: 'yeetful-claude', name: 'Yeetful · Claude', kind: 'inference', callable: true, endpoint: 'https://c.test', protocol: 'mcp', priceUsd: '0.005' } as unknown as RouterSrv
  const gpt = { slug: 'chatgpt', name: 'ChatGPT', kind: 'inference', callable: true, endpoint: 'https://g.test', protocol: 'http', priceUsd: '0.001' } as unknown as RouterSrv
  const pricey = { slug: 'pricey', name: 'Pricey', kind: 'inference', callable: true, endpoint: 'https://p.test', protocol: 'http', priceUsd: '0.02' } as unknown as RouterSrv
  const dataOnly = { slug: 'd', name: 'D', kind: 'data', callable: true, endpoint: 'https://d.test', protocol: 'http', priceUsd: '0.01' } as unknown as RouterSrv
  check('router select: prefers Yeetful · Claude as the answer engine', selectInferenceProvider([gpt, claude])?.slug === 'yeetful-claude')
  check('router select: falls back to cheapest inference (no Claude)', selectInferenceProvider([pricey, gpt])?.slug === 'chatgpt')
  check('router select: no callable inference → null', selectInferenceProvider([dataOnly]) === null)

  // B6 — schema-less query params: a planner-supplied param the endpoint doesn't
  // list (e.g. CoinMarketCap quotes/latest has no schema) must still be routed
  // into the GET query, so schema-poor endpoints become usable (?symbol=ETH).
  const schemaLessEp: PlannableEndpoint = {
    id: 'ep-cmc-quotes', serverSlug: 'coinmarketcap', serverName: 'CoinMarketCap', method: 'GET',
    url: 'https://pro-api.coinmarketcap.com/x402/v3/cryptocurrency/quotes/latest',
    description: 'Latest cryptocurrency quote data', priceUsd: '0.01', parameters: [],
  }
  const builtSchemaLess = buildSmartRequest(schemaLessEp, { symbol: 'ETH' })
  check(
    'router build: schema-less GET routes inferred param into the query (?symbol=ETH)',
    'request' in builtSchemaLess && builtSchemaLess.request.url.includes('symbol=ETH'),
  )
  // A POST routes an inferred param into the JSON body, not the query.
  const builtPost = buildSmartRequest({ ...schemaLessEp, method: 'POST' }, { symbol: 'ETH' })
  check(
    'router build: schema-less POST routes inferred param into the body',
    'request' in builtPost && !builtPost.request.url.includes('symbol=') && (builtPost.request.body ?? '').includes('ETH'),
  )

  // B7 — multi-step resolver loop: the engine resolves an id with a lookup, sees
  // the result, then makes the data call with it — chaining across steps. Driven
  // by a scripted inference + a stub executeCall (no DB / no spend).
  const loopEndpoints: PlannableEndpoint[] = [
    { id: 'ep-dao-search', serverSlug: 'gov', serverName: 'Gov', method: 'GET', url: 'https://gov.test/search', description: 'find a DAO by name', priceUsd: '0.01', parameters: [{ group: 'query', name: 'q', required: true }] },
    { id: 'ep-dao-proposals', serverSlug: 'gov', serverName: 'Gov', method: 'GET', url: 'https://gov.test/proposals', description: 'list proposals for a DAO id', priceUsd: '0.01', parameters: [{ group: 'query', name: 'daoId', required: true }] },
  ]
  const claudeSrv = { slug: 'yeetful-claude', name: 'Yeetful · Claude', kind: 'inference', callable: true, endpoint: 'https://c.test', protocol: 'mcp', priceUsd: '0.005' } as unknown as Parameters<typeof selectInferenceProvider>[0][number]
  const scripts = [
    JSON.stringify({ intent: 'open proposals on Nate DAO', needs: ['DAO id', 'proposals'], picks: [{ endpointId: 'ep-dao-search', params: { q: 'Nate' }, reason: 'resolve the DAO id first', score: 0.9 }] }),
    JSON.stringify({ intent: '', needs: [], picks: [{ endpointId: 'ep-dao-proposals', params: { daoId: 'nate.eth' }, reason: 'list with the resolved id', score: 0.95 }] }),
    JSON.stringify({ intent: '', needs: [], picks: [] }),
  ]
  let infCall = 0
  const stubInference = async () => ({ text: scripts[Math.min(infCall++, scripts.length - 1)] })
  const executed: string[] = []
  const stubExecute = async (pick: { endpointId: string }) => {
    executed.push(pick.endpointId)
    return pick.endpointId === 'ep-dao-search' ? { data: { daoId: 'nate.eth' } } : { data: { proposals: ['p1', 'p2'] } }
  }
  const loopDec = await routeMessage({
    message: 'what are the open proposals on Nate DAO',
    catalog: [claudeSrv],
    endpoints: loopEndpoints,
    runInference: stubInference,
    executeCall: stubExecute,
  })
  check('router loop: chains resolve→fetch (2 calls, in order)', executed.length === 2 && executed[0] === 'ep-dao-search' && executed[1] === 'ep-dao-proposals')
  check('router loop: gathers context from each successful step', loopDec.context.length === 2 && loopDec.context.some((c) => c.includes('proposals')))

  // Dedup + cap guard: a model that keeps re-picking the same call must not loop
  // forever — the same endpoint is only executed once, then the loop ends.
  const repeatExecuted: string[] = []
  const repeatDec = await routeMessage({
    message: 'find a dao and its proposals', // on-topic so the shortlist keeps the fixtures
    catalog: [claudeSrv],
    endpoints: loopEndpoints,
    maxSteps: 5,
    runInference: async () => ({ text: JSON.stringify({ intent: 'x', needs: [], picks: [{ endpointId: 'ep-dao-search', params: { q: 'a' }, reason: 'r', score: 1 }] }) }),
    executeCall: async (pick: { endpointId: string }) => { repeatExecuted.push(pick.endpointId); return { data: { ok: true } } },
  })
  check('router loop: dedups repeated picks (no runaway)', repeatExecuted.length === 1 && repeatDec.context.length === 1)

  // B8 — transaction layer: a tool's return becomes a signable artifact (the
  // action half). Vote (EIP-712) is wired; a raw EVM tx is structured.
  const voteResult = {
    action: 'sign_vote',
    summary: 'Vote For on Test Proposal',
    proposal: { id: '0x' + 'a'.repeat(64), title: 'Test Proposal', type: 'single-choice', choices: ['For', 'Against'], space: 'test.eth' },
    choice: 1,
    typedData: {
      domain: { name: 'snapshot', version: '0.1.4' },
      types: { Vote: [{ name: 'choice', type: 'uint32' }] },
      message: { from: '0x0', space: 'test.eth', timestamp: 1, proposal: '0x' + 'a'.repeat(64), choice: 1, reason: '', app: '', metadata: '' },
    },
  }
  const voteArt = buildSignableArtifact(voteResult)
  check('tx layer: sign_vote → eip712-vote artifact', voteArt?.kind === 'eip712-vote' && voteArt.vote.proposal.title === 'Test Proposal')
  const txArt = buildSignableArtifact({ action: 'send_transaction', label: 'swap', summary: 'Swap 1 ETH→USDC', tx: { to: '0xabc', data: '0xdead', value: '1000000000000000000', chainId: 8453 } })
  check('tx layer: send_transaction → evm-tx artifact', txArt?.kind === 'evm-tx' && txArt.tx.to === '0xabc' && txArt.tx.action === 'swap')
  check('tx layer: plain data → no artifact', buildSignableArtifact({ price: 3000 }) === null)
  check(
    'tx layer: isActionIntent flags actions, not reads',
    isActionIntent('vote For on this') && isActionIntent('swap 1 ETH to USDC') && !isActionIntent('what is the price of ETH'),
  )

  // CoW swap → eip712-order artifact (A2). Pure builders; no network here — the
  // live quote fetch is a manual/route smoke (needs the CoW API).
  const cowFixture: CowQuoteResult = {
    chainId: 8453,
    from: '0x1111111111111111111111111111111111111111',
    quoteId: 42,
    order: {
      sellToken: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913',
      buyToken: '0x4200000000000000000000000000000000000006',
      receiver: '0x1111111111111111111111111111111111111111',
      sellAmount: '100000000', buyAmount: '25000000000000000',
      // Yeetful's real appData hash — the app-data guard block-refuses
      // anything else (fee stripping / hook injection).
      validTo: 1893456000, appData: keccak256(stringToBytes(COW_APP_DATA_JSON)), feeAmount: '250000',
      kind: 'sell', partiallyFillable: false, sellTokenBalance: 'erc20', buyTokenBalance: 'erc20',
    },
  }
  check('cow: resolveToken maps a Base symbol', resolveToken('USDC') === '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913')
  check('cow: resolveToken passes 0x addresses through', resolveToken('0xABcd00000000000000000000000000000000abCD') === '0xabcd00000000000000000000000000000000abcd')
  check('cow: resolveToken rejects nonsense', resolveToken('NOTATOKEN') === null)

  // Token-name resolution (the "swap USDG for NVIDIA" fix) — prime the
  // dynamic list from a fixture (same indexer as the network load) so these
  // stay offline. Real chain-4663 NVDA address from tokens.uniswap.org.
  const nvdaAddr = '0xd0601ce157db5bdc3162bbac2a2c8af5320d9eec'
  primeTokenList(4663, [
    { tokens: [
      { chainId: 4663, address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', symbol: 'NVDA', decimals: 18, name: 'NVIDIA' },
      { chainId: 4663, address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', symbol: 'AAPL', decimals: 18, name: 'Apple' },
      { chainId: 4663, address: '0x1111111111111111111111111111111111111111', symbol: 'DUPE1', decimals: 18, name: 'Same Name Co' },
      { chainId: 4663, address: '0x2222222222222222222222222222222222222222', symbol: 'DUPE2', decimals: 18, name: 'Same Name Co' },
      { chainId: 4663, address: '0x3333333333333333333333333333333333333333', symbol: 'SHADOW', decimals: 18, name: 'AAPL' },
    ] },
  ])
  check('token names: exact full name resolves ("NVIDIA" → NVDA addr)', resolveToken('NVIDIA', 4663) === nvdaAddr)
  check('token names: case/whitespace tolerant', resolveToken('  nvidia ', 4663) === nvdaAddr)
  check('token names: ticker path unchanged', resolveToken('NVDA', 4663) === nvdaAddr)
  check('token names: symbol always beats a name ("AAPL" is SHADOW\'s name but AAPL\'s ticker)', resolveToken('AAPL', 4663) === '0xaf3d76f1834a1d425780943c99ea8a608f8a93f9')
  check('token names: ambiguous name (two addresses) resolves to nothing', resolveToken('Same Name Co', 4663) === null)
  check('token names: decimals resolve via name', tokenDecimals('NVIDIA', 4663) === 18)
  check('token names: label shows the ticker, not the typed name', tokenLabel('NVIDIA', 4663) === 'NVDA')

  // ── Stock pairing (lib/stock-pairing.ts) ── the 2026-07-21 "GOOGLe"/"AAPLE"
  // incidents: obvious brand/company names pair silently, suspected typos ASK
  // (clarify at parse/compile time — never at job-run time, after money moved).
  // Re-prime with a SUPERSET fixture (all rows above kept) + real-roster rows.
  primeTokenList(4663, [
    { tokens: [
      { chainId: 4663, address: '0xd0601CE157Db5bdC3162BbaC2a2C8aF5320D9EEC', symbol: 'NVDA', decimals: 18, name: 'NVIDIA' },
      { chainId: 4663, address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', symbol: 'AAPL', decimals: 18, name: 'Apple' },
      { chainId: 4663, address: '0x1111111111111111111111111111111111111111', symbol: 'DUPE1', decimals: 18, name: 'Same Name Co' },
      { chainId: 4663, address: '0x2222222222222222222222222222222222222222', symbol: 'DUPE2', decimals: 18, name: 'Same Name Co' },
      { chainId: 4663, address: '0x3333333333333333333333333333333333333333', symbol: 'SHADOW', decimals: 18, name: 'AAPL' },
      { chainId: 4663, address: '0x4444444444444444444444444444444444444444', symbol: 'GOOGL', decimals: 18, name: 'Alphabet Class A' },
      { chainId: 4663, address: '0x5555555555555555555555555555555555555555', symbol: 'META', decimals: 18, name: 'Meta Platforms' },
      { chainId: 4663, address: '0x6666666666666666666666666666666666666666', symbol: 'TSLA', decimals: 18, name: 'Tesla' },
      { chainId: 4663, address: '0x7777777777777777777777777777777777777777', symbol: 'AMAT', decimals: 18, name: 'Applied Materials' },
      { chainId: 4663, address: '0x8888888888888888888888888888888888888888', symbol: 'APLD', decimals: 18, name: 'Applied Digital' },
      { chainId: 4663, address: '0x9999999999999999999999999999999999999999', symbol: 'AAOI', decimals: 18, name: 'Applied Optoelectronics' },
      { chainId: 4663, address: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', symbol: 'PLTR', decimals: 18, name: 'Palantir Technologies' },
      { chainId: 4663, address: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb', symbol: 'RKLB', decimals: 18, name: 'Rocket Lab Corporation' },
      { chainId: 4663, address: '0xcccccccccccccccccccccccccccccccccccccccc', symbol: 'SPCX', decimals: 18, name: 'Space Exploration Technologies Corp' },
      { chainId: 4663, address: '0xdddddddddddddddddddddddddddddddddddddddd', symbol: 'MU', decimals: 18, name: 'Micron Technology' },
      { chainId: 4663, address: '0xeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeeee', symbol: 'F', decimals: 18, name: 'Ford Motor' },
    ] },
  ])
  const pairKind = (input: string, chainId = 4663) => pairStockToken(input, chainId).kind
  const pairedSym = (input: string) => {
    const p = pairStockToken(input, 4663)
    return p.kind === 'paired' ? p.symbol : null
  }
  check('stock pairing: a real ticker passes untouched', pairKind('AAPL') === 'ok' && pairKind('NVDA') === 'ok')
  check('stock pairing: an exact company name passes untouched (name ladder owns it)', pairKind('Tesla') === 'ok')
  check('stock pairing: brand alias pairs "GOOGLe"/"google" → GOOGL', pairedSym('GOOGLe') === 'GOOGL' && pairedSym('google') === 'GOOGL')
  check('stock pairing: brand aliases Facebook → META, SpaceX → SPCX, Alphabet → GOOGL', pairedSym('Facebook') === 'META' && pairedSym('SpaceX') === 'SPCX' && pairedSym('Alphabet') === 'GOOGL')
  check('stock pairing: unique company-name prefix pairs (Palantir → PLTR, Rocket Lab → RKLB, Micron → MU)', pairedSym('Palantir') === 'PLTR' && pairedSym('Rocket Lab') === 'RKLB' && pairedSym('Micron') === 'MU')
  const applied = pairStockToken('Applied', 4663)
  check('stock pairing: multi-hit name prefix ASKS ("Applied" → 3 candidates)', applied.kind === 'suggest' && applied.candidates.length === 3 && applied.candidates.map((c) => c.symbol).sort().join(',') === 'AAOI,AMAT,APLD')
  const aaple = pairStockToken('AAPLE', 4663)
  check('stock pairing: a near-miss ticker ASKS, never rewrites ("AAPLE" → suggest AAPL first)', aaple.kind === 'suggest' && aaple.candidates[0].symbol === 'AAPL')
  const teslla = pairStockToken('TESLLA', 4663)
  check('stock pairing: a near-miss name ASKS ("TESLLA" → suggest TSLA)', teslla.kind === 'suggest' && teslla.candidates.some((c) => c.symbol === 'TSLA'))
  check('stock pairing: short inputs never fuzz (F and MU live on this list)', pairKind('MUU') === 'unknown' && pairKind('FRD') === 'unknown')
  check('stock pairing: nothing close is unknown (honest refusal upstream)', pairKind('ZZZZQQ') === 'unknown')
  check('stock pairing: gated OFF every other chain (Base long-tail lists carry impostor names)', pairKind('Google', 8453) === 'ok' && pairKind('AAPLE', 1) === 'ok')
  check('stock pairing: chip label reads "AAPL (Apple)"', stockChipLabel({ symbol: 'AAPL', name: 'Apple' }) === 'AAPL (Apple)')

  // Compile-time pairing in the jobs compiler — the "AAPLE" job must ask
  // BEFORE it exists, and the chip's resume must round-trip to a clean job.
  const aapleJob = compileJobAskFull('Fund robinhood chain with $12 from base including gas, then buy $15 of AAPLE')
  check('jobs pairing: a typo\'d fund-buy ASKS before compiling (clarify, no job)', !!aapleJob && 'clarify' in aapleJob && aapleJob.clarify.options[0].label.startsWith('AAPL'))
  const aapleResume = aapleJob && 'clarify' in aapleJob ? aapleJob.clarify.options[0].resume : ''
  const aapleRetry = compileJobAskFull(aapleResume)
  check(
    'jobs pairing: the clarify chip round-trips into the corrected job',
    aapleResume === 'Fund robinhood chain with $12 from base including gas, then buy $15 of AAPL' &&
      !!aapleRetry && !('problem' in aapleRetry) && !('clarify' in aapleRetry) &&
      (aapleRetry.steps[3].params as { buyToken?: string }).buyToken === 'AAPL',
  )
  const googleJob = compileJobAskFull('Fund robinhood chain with $12 from base, then buy $10 of google')
  check(
    'jobs pairing: an obvious brand name compiles straight through as the ticker',
    !!googleJob && !('problem' in googleJob) && !('clarify' in googleJob) &&
      (googleJob.steps[googleJob.steps.length - 1].params as { buyToken?: string }).buyToken === 'GOOGL',
  )
  const gibberishJob = compileJobAskFull('Fund robinhood chain with $12 from base, then buy $10 of ZZZZQQ')
  check('jobs pairing: nothing close refuses at compile time (never at run time)', !!gibberishJob && 'problem' in gibberishJob && /doesn't list "ZZZZQQ"/.test(gibberishJob.problem))
  const segSwapPaired = compileJobAskFull('fund robinhood chain with $12 from base, then swap 10 USDG for GOOGLE on robinhood')
  check(
    'jobs pairing: same-chain Robinhood swap segments pair too',
    !!segSwapPaired && !('problem' in segSwapPaired) && !('clarify' in segSwapPaired) &&
      (segSwapPaired.steps[segSwapPaired.steps.length - 1].params as { buyToken?: string }).buyToken === 'GOOGL',
  )
  const segSwapTypo = compileJobAskFull('fund robinhood chain with $12 from base, then swap 10 USDG for TESLLA on robinhood')
  check('jobs pairing: a typo\'d same-chain swap segment ASKS', !!segSwapTypo && 'clarify' in segSwapTypo)
  const td = buildCowOrderTypedData(cowFixture)
  check(
    'cow: typed data has the GPv2 domain + Order type',
    td.domain.name === 'Gnosis Protocol' && td.domain.version === 'v2' &&
      td.domain.chainId === 8453 && td.domain.verifyingContract === GPV2_SETTLEMENT &&
      td.primaryType === 'Order' && td.types.Order.length === 12,
  )
  check('cow: typed-data message carries the quote order', (td.message as { buyAmount: string }).buyAmount === '25000000000000000')
  const cowArt = buildSignableArtifact(cowOrderAction({ ...cowFixture, appDataJson: COW_APP_DATA_JSON }, 'Swap 100 USDC → WETH'))
  check(
    'tx layer: sign_order → eip712-order artifact (CoW)',
    cowArt?.kind === 'eip712-order' && cowArt.order.protocol === 'cow' &&
      cowArt.order.submitUrl === 'https://api.cow.fi/base/api/v1/orders' && cowArt.order.chainId === 8453,
  )
  check(
    'tx layer: eip712-order carries submission extras (appData JSON + quoteId)',
    cowArt?.kind === 'eip712-order' && cowArt.order.appDataJson === COW_APP_DATA_JSON && cowArt.order.quoteId === 42,
  )

  // Human formatting — the approval summary must show token units, never atoms.
  check('cow: formatAtoms 100000000 @6 → 100', formatAtoms('100000000', 6) === '100')
  check('cow: formatAtoms trims trailing zeros', formatAtoms('63600000000000000', 18) === '0.0636')
  check('cow: formatAtoms never renders tiny-nonzero as 0', formatAtoms('1', 18) === '<0.000001')
  check('cow: tokenDecimals via symbol + address', tokenDecimals('usdc') === 6 && tokenDecimals('0x4200000000000000000000000000000000000006') === 18)
  check('cow: describeAmount labels unknown tokens as atoms', describeAmount('123', '0x9999999999999999999999999999999999999999') === '123 atoms of 0x9999…9999')
  const swapSummary = describeCowOrder(cowFixture, 'swap')
  check('cow: describeCowOrder is human-readable (units, not atoms)', swapSummary === 'Swap 100 USDC → ~0.025 WETH via CoW on Base')

  // Limit orders (pure builder — no quote, user names the price).
  const limit = buildCowLimitOrder({
    sellToken: 'WETH', buyToken: 'USDC',
    sellAmount: '500000000000000000', buyAmountAtLeast: '1750000000',
    from: '0x1111111111111111111111111111111111111111',
  })
  check(
    'cow: limit order — fee 0, partially fillable, sell kind',
    limit.order.feeAmount === '0' && limit.order.partiallyFillable === true && limit.order.kind === 'sell',
  )
  check(
    'cow: limit order carries the named price + resolves tokens',
    limit.order.buyAmount === '1750000000' && limit.order.sellToken === '0x4200000000000000000000000000000000000006',
  )
  check(
    'cow: limit order appData hash matches the shipped JSON',
    limit.order.appData === keccak256(stringToBytes(COW_APP_DATA_JSON)) && limit.appDataJson === COW_APP_DATA_JSON,
  )
  check('cow: limit order validTo is in the future', limit.order.validTo > Math.floor(Date.now() / 1000))
  check(
    'cow: limit order summary names the floor',
    describeCowOrder(limit, 'limit') === 'Limit order via CoW on Base: sell 0.5 WETH for at least 1750 USDC',
  )
  check('cow: limit order rejects a same-token pair', (() => {
    try { buildCowLimitOrder({ sellToken: 'ETH', buyToken: 'WETH', sellAmount: '1', buyAmountAtLeast: '1', from: '0x1111111111111111111111111111111111111111' }); return false }
    catch { return true }
  })())
  const limitTd = buildCowOrderTypedData(limit)
  check('cow: limit order signs with the same GPv2 domain', limitTd.domain.verifyingContract === GPV2_SETTLEMENT && limitTd.types.Order.length === 12)

  // A3 — safe-build guardrails: pure checks + policy gate + slippage (no
  // network here; chainChecks is covered by the route smoke).
  const gFrom = '0x1111111111111111111111111111111111111111'
  const gNow = 1893450000
  const okChecks = pureChecks({ ...cowFixture, order: { ...cowFixture.order, validTo: gNow + 1200 } }, gFrom, gNow)
  check('guardrails: clean order passes all block-level checks', buildReport(null, okChecks.filter((c) => c.level === 'block' || c.id === 'fee')).ok)
  const wrongRecipient = pureChecks(
    { ...cowFixture, order: { ...cowFixture.order, receiver: '0x2222222222222222222222222222222222222222', validTo: gNow + 1200 } },
    gFrom, gNow,
  )
  check('guardrails: recipient mismatch BLOCKS', !buildReport(null, wrongRecipient).ok && wrongRecipient.find((c) => c.id === 'recipient')?.ok === false)
  const expired = pureChecks({ ...cowFixture, order: { ...cowFixture.order, validTo: gNow - 10 } }, gFrom, gNow)
  check('guardrails: expired order BLOCKS', !buildReport(null, expired).ok)
  const foreverOrder = pureChecks({ ...cowFixture, order: { ...cowFixture.order, validTo: gNow + 400 * 24 * 3600 } }, gFrom, gNow)
  check('guardrails: never-expiring order BLOCKS', !buildReport(null, foreverOrder).ok)
  const absurdFee = pureChecks(
    { ...cowFixture, order: { ...cowFixture.order, feeAmount: '10000000', validTo: gNow + 1200 } }, // 10% of 100 USDC
    gFrom, gNow,
  )
  check('guardrails: >5% fee BLOCKS', !buildReport(null, absurdFee).ok)
  check(
    'guardrails: orderValueUsd prices the stable sell side incl. fee',
    orderValueUsd({ ...cowFixture.order, feeAmount: '250000' }) === 100.25,
  )
  check(
    'guardrails: orderValueUsd null for stable-less pairs',
    orderValueUsd({ ...cowFixture.order, sellToken: '0x4200000000000000000000000000000000000006', buyToken: '0x2ae3f1ec7f1f5012cfeab0185bfc7aa3cf0dec22' }) === null,
  )
  const gPolicy: GrantPolicy = {
    id: 'g-guard', allow: ['api.cow.fi'], perCallUsd: 50, perDayUsd: 100,
    expiresAt: new Date(Date.now() + 86400_000), status: 'active', spendPolicyEnabled: true,
  }
  check('guardrails: policy over per-call cap BLOCKS', policyCheck(100.25, gPolicy, 0, 'api.cow.fi').violation === 'OVER_PER_CALL')
  check('guardrails: policy within caps passes', policyCheck(10, gPolicy, 0, 'api.cow.fi').check.ok && policyCheck(10, gPolicy, 0, 'api.cow.fi').violation === null)
  check('guardrails: unpriceable order under an ON policy BLOCKS', policyCheck(null, gPolicy, 0, 'api.cow.fi').violation === 'VALUE_UNKNOWN')
  check('guardrails: unpriceable order with policy OFF passes', policyCheck(null, { ...gPolicy, spendPolicyEnabled: false }, 0, 'api.cow.fi').violation === null)
  check('guardrails: no grant at all → warn only, not gated', policyCheck(50, null, 0, 'api.cow.fi').check.ok)
  // Self-signed exemption: the owner's wallet signature IS the consent, so
  // the caps (which govern un-supervised agent spend) never refuse a build
  // the owner signs per-action — the first-timer "demo a $250 swap" wall.
  const selfOpts = { selfSigned: true } as const
  check(
    'guardrails: self-signed build over per-call cap PASSES (signature is the consent)',
    policyCheck(100.25, gPolicy, 0, 'api.cow.fi', 0, selfOpts).violation === null &&
      policyCheck(100.25, gPolicy, 0, 'api.cow.fi', 0, selfOpts).check.ok,
  )
  check(
    'guardrails: self-signed build over the daily budget PASSES',
    policyCheck(10, gPolicy, 95, 'api.cow.fi', 0, selfOpts).violation === null,
  )
  check(
    'guardrails: self-signed unpriceable build passes as a warn, not VALUE_UNKNOWN',
    policyCheck(null, gPolicy, 0, 'api.cow.fi', 0, selfOpts).violation === null,
  )
  check(
    'guardrails: self-signed still refuses an off-allowlist host',
    policyCheck(10, gPolicy, 0, 'evil.example.test', 0, selfOpts).violation === 'NOT_ALLOWED',
  )
  check(
    'guardrails: self-signed still honors the kill switch (frozen)',
    policyCheck(10, { ...gPolicy, paused: true }, 0, 'api.cow.fi', 0, selfOpts).violation === 'ACCOUNT_FROZEN',
  )
  check(
    'guardrails: self-signed still honors revocation',
    policyCheck(10, { ...gPolicy, status: 'revoked' }, 0, 'api.cow.fi', 0, selfOpts).violation === 'REVOKED',
  )
  // The core is venue-neutral: the same gate refuses a host outside the
  // allowlist — what Uniswap's adapter (A10) plugs into unchanged.
  check('guardrails: core policyCheck gates by HOST (venue-neutral)', policyCheck(10, gPolicy, 0, 'uniswap.yeetful.com').violation === 'NOT_ALLOWED')
  // A refusal must be actionable: NOT_ALLOWED names the host it refused, and
  // buildReport carries the structured policyBlock the fix-it UI reads.
  check(
    'guardrails: NOT_ALLOWED note names the refused host',
    /uniswap\.yeetful\.com isn't on your allowlist/.test(policyCheck(10, gPolicy, 0, 'uniswap.yeetful.com').check.note),
  )
  const pbReport = buildReport(
    10,
    [policyCheck(10, gPolicy, 0, 'uniswap.yeetful.com').check],
    { violation: 'NOT_ALLOWED', valueUsd: 10, host: 'uniswap.yeetful.com' },
  )
  check(
    'guardrails: buildReport attaches the structured policyBlock',
    !pbReport.ok && pbReport.policyBlock?.violation === 'NOT_ALLOWED' && pbReport.policyBlock.host === 'uniswap.yeetful.com',
  )
  check('guardrails: no policyBlock key when the policy passed', !('policyBlock' in buildReport(10, [policyCheck(10, gPolicy, 0, 'api.cow.fi').check])))
  const slipped = applySlippage(cowFixture, 100) // 1%
  check(
    'guardrails: applySlippage lowers the signed min-buy by bps',
    slipped.order.buyAmount === '24750000000000000' && cowFixture.order.buyAmount === '25000000000000000',
  )
  check('guardrails: applySlippage rejects out-of-range bps', (() => {
    try { applySlippage(cowFixture, 20000); return false } catch { return true }
  })())

  // ── 2026-07-20 guardrail audit — fail-closed invariants ────────────────────
  console.log('— guardrail audit (fail-closed invariants)')
  // The gate itself breaking must REFUSE, never authorize. A policy row whose
  // expiresAt deserialized as a string used to crash checkGrant → grantViolation
  // swallowed the TypeError and returned null = authorized-by-crash.
  const brokenPolicy = { ...gPolicy, expiresAt: 'not-a-date' as unknown as Date }
  check('audit: a broken policy row refuses (POLICY_ERROR), never authorizes', grantViolation(brokenPolicy, 'api.cow.fi', 1, 0) === 'POLICY_ERROR')
  check(
    'audit: self-signed does NOT bypass POLICY_ERROR (only caps are exempt)',
    policyCheck(10, brokenPolicy, 0, 'api.cow.fi', 0, selfOpts).violation === 'POLICY_ERROR' &&
      !policyCheck(10, brokenPolicy, 0, 'api.cow.fi', 0, selfOpts).check.ok,
  )
  // Kill-switch precedence: frozen is checked BEFORE the caps, so a frozen
  // account combined with an over-cap value can never surface as the
  // (self-signed-exempt) OVER_PER_CALL code.
  check(
    'audit: frozen + over-cap self-signed → ACCOUNT_FROZEN wins (no cap-code masking)',
    policyCheck(500, { ...gPolicy, paused: true }, 0, 'api.cow.fi', 0, selfOpts).violation === 'ACCOUNT_FROZEN',
  )
  // Venue-neutral core checks: recipient + validity window.
  const nowSec = Math.floor(Date.now() / 1000)
  check('audit: recipientCheck refuses proceeds to a third party', !recipientCheck(mallory.address, owner.address).ok)
  check('audit: recipientCheck passes self (case-insensitive)', recipientCheck(owner.address.toUpperCase().replace('0X', '0x'), owner.address).ok)
  check('audit: validityCheck refuses expired calldata', !validityCheck(nowSec - 10, nowSec).ok)
  check('audit: validityCheck refuses a standing (>31d) liability', !validityCheck(nowSec + MAX_VALID_SEC + 60, nowSec).ok)
  check('audit: validityCheck passes a sane window', validityCheck(nowSec + 600, nowSec).ok)

  // Planner-artifact guard — the generic MCP passthrough (buildSignableArtifact)
  // used to surface tool-returned calldata VERBATIM. Every drain shape refuses.
  const mkTx = (tx: Record<string, unknown>) =>
    buildSignableArtifact({ action: 'send_transaction', label: 'swap', summary: 's', tx })!
  const auditMe = owner.address
  const pctx = { from: auditMe }
  const thirdPartyTransfer = mkTx({
    to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [mallory.address as `0x${string}`, BigInt(5_000_000)] }),
    value: '0',
    chainId: 8453,
  })
  check('planner guard: ERC-20 transfer to a third party REFUSES', !guardPlannerArtifact(thirdPartyTransfer, pctx).ok)
  const selfTransfer = mkTx({
    to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [auditMe as `0x${string}`, BigInt(5_000_000)] }),
    value: '0',
    chainId: 8453,
  })
  check('planner guard: ERC-20 transfer back to the signer passes', guardPlannerArtifact(selfTransfer, pctx).ok)
  check(
    'planner guard: transfer refuses when the signer is UNKNOWN (fail closed)',
    !guardPlannerArtifact(selfTransfer, { from: null }).ok,
  )
  const unlimitedApprove = mkTx({
    to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [mallory.address as `0x${string}`, (BigInt(1) << BigInt(256)) - BigInt(1)] }),
    value: '0',
    chainId: 8453,
  })
  check('planner guard: UNLIMITED approve REFUSES (standing drain authorization)', !guardPlannerArtifact(unlimitedApprove, pctx).ok)
  const boundedApprove = mkTx({
    to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [mallory.address as `0x${string}`, BigInt(1_000_000)] }),
    value: '0',
    chainId: 8453,
  })
  const boundedVerdict = guardPlannerArtifact(boundedApprove, pctx)
  check('planner guard: bounded approve passes WITH a warning', boundedVerdict.ok && boundedVerdict.warnings.length > 0)
  const transferFrom = mkTx({
    to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
    data: encodeFunctionData({ abi: erc20Abi, functionName: 'transferFrom', args: [auditMe as `0x${string}`, mallory.address as `0x${string}`, BigInt(1)] }),
    value: '0',
    chainId: 8453,
  })
  check('planner guard: transferFrom-family calldata REFUSES', !guardPlannerArtifact(transferFrom, pctx).ok)
  const setApprovalForAll = mkTx({
    to: '0x8a90CAb2b38dba80c64b7734e58Ee1dB38B8992e',
    data: `0xa22cb465${mallory.address.slice(2).toLowerCase().padStart(64, '0')}${'1'.padStart(64, '0')}`,
    value: '0',
    chainId: 8453,
  })
  check('planner guard: setApprovalForAll (whole-collection operator) REFUSES', !guardPlannerArtifact(setApprovalForAll, pctx).ok)
  const bareSend = mkTx({ to: mallory.address, value: '1000000000000000000', chainId: 8453 })
  check('planner guard: bare native send to a third party REFUSES', !guardPlannerArtifact(bareSend, pctx).ok)
  const permit2Call = mkTx({ to: PERMIT2_ADDRESS, data: '0x87517c45' + 'ab'.repeat(128), value: '0', chainId: 8453 })
  check('planner guard: any Permit2 call REFUSES', !guardPlannerArtifact(permit2Call, pctx).ok)
  const offRegistryChain = mkTx({ to: mallory.address, data: '0x12345678' + 'ab'.repeat(64), value: '0', chainId: 10 })
  check('planner guard: off-registry chainId REFUSES', !guardPlannerArtifact(offRegistryChain, pctx).ok)
  const noChain = mkTx({ to: mallory.address, data: '0x12345678' + 'ab'.repeat(64), value: '0' })
  check('planner guard: missing chainId REFUSES', !guardPlannerArtifact(noChain, pctx).ok)
  const plainCall = mkTx({ to: '0x2626664c2603336E57B271c5C0b26F421741e481', data: '0x5ae401dc' + 'ab'.repeat(200), value: '0', chainId: 8453 })
  check('planner guard: an ordinary contract call on an app chain still passes', guardPlannerArtifact(plainCall, pctx).ok)
  // A chain is only as safe as its worst step.
  const poisonedChain = buildSignableArtifact({
    summary: 'approve + swap',
    steps: [
      { action: 'send_transaction', label: 'approve', summary: 'a', tx: { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [mallory.address as `0x${string}`, BigInt(100)] }), value: '0', chainId: 8453 } },
      { action: 'send_transaction', label: 'swap', summary: 'b', tx: { to: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', data: encodeFunctionData({ abi: erc20Abi, functionName: 'transfer', args: [mallory.address as `0x${string}`, BigInt(100)] }), value: '0', chainId: 8453 } },
    ],
  })!
  check('planner guard: one drain-shaped step poisons the whole chain', poisonedChain.kind === 'evm-tx-chain' && !guardPlannerArtifact(poisonedChain, pctx).ok)
  // Generic EIP-712 orders: only a CoW order verifying against the pinned
  // settlement contract and paying the signer survives the passthrough.
  const mkOrder = (protocol: string, typedData: unknown) => buildSignableArtifact({ action: 'sign_order', protocol, typedData, summary: 'o' })!
  check('planner guard: generic non-CoW order REFUSES', !guardPlannerArtifact(mkOrder('mystery', { domain: {}, message: {} }), pctx).ok)
  check(
    'planner guard: CoW order against a fake settlement contract REFUSES',
    !guardPlannerArtifact(mkOrder('cow', { domain: { verifyingContract: mallory.address }, message: { receiver: auditMe } }), pctx).ok,
  )
  check(
    'planner guard: CoW order paying a third party REFUSES',
    !guardPlannerArtifact(mkOrder('cow', { domain: { verifyingContract: GPV2_SETTLEMENT }, message: { receiver: mallory.address } }), pctx).ok,
  )
  check(
    'planner guard: pinned CoW order paying the signer passes',
    guardPlannerArtifact(mkOrder('cow', { domain: { verifyingContract: GPV2_SETTLEMENT }, message: { receiver: auditMe } }), pctx).ok,
  )
  check(
    'planner guard: votes pass (no economic outflow)',
    voteArt !== null && guardPlannerArtifact(voteArt, pctx).ok,
  )

  // /api/cow/quote refusal shape: a blocked build must withhold the RAW order
  // struct too — guardrails verdict only, never a hand-signable payload.
  {
    const blockedQuote = await fetch(`${BASE}/api/cow/quote`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        mode: 'limit',
        chainId: 8453,
        sellToken: 'USDC',
        buyToken: 'WETH',
        sellAmount: '1000000',
        buyAmountAtLeast: '1',
        from: owner.address,
        receiver: mallory.address, // third-party proceeds → recipient check blocks
      }),
    })
    const bq = (await blockedQuote.json()) as { blocked?: boolean; quote?: unknown; quoteId?: unknown; artifact?: unknown }
    check(
      'audit: /api/cow/quote refusal withholds the raw order struct (not just the artifact)',
      blockedQuote.status === 200 && bq.blocked === true && bq.quote == null && bq.quoteId == null && bq.artifact == null,
      `blocked=${bq.blocked} quote=${bq.quote == null ? 'withheld' : 'LEAKED'}`,
    )
  }

  // A2c — swap intent parsing (pure) + atoms conversion.
  const si = parseSwapIntent('swap 100 USDC for WETH')
  check('swap intent: market parse', si.isSwap && si.mode === 'swap' && si.sellAmountHuman === '100' && si.sellToken === 'USDC' && si.buyToken === 'WETH')
  const si2 = parseSwapIntent('please trade 0.5 weth into usdc now')
  check('swap intent: trade/into synonyms + decimals', si2.isSwap && si2.mode === 'swap' && si2.sellAmountHuman === '0.5' && si2.sellToken === 'weth')
  const li = parseSwapIntent('limit order: sell 0.5 WETH for at least 1750 USDC')
  check('swap intent: limit parse carries the named price', li.isSwap && li.mode === 'limit' && li.buyAmountAtLeastHuman === '1750' && li.buyToken === 'USDC')
  const li2 = parseSwapIntent('limit: sell 1 WETH when it hits 3500 USDC')
  check('swap intent: "when it hits" limit phrasing', li2.isSwap && li2.mode === 'limit' && li2.buyAmountAtLeastHuman === '3500')
  check('swap intent: pair without amount clarifies', parseSwapIntent('swap USDC for WETH').problem !== undefined)
  check('swap intent: plain question falls through', parseSwapIntent('what is a swap?').isSwap === false)
  check('swap intent: price question falls through', parseSwapIntent('what is the price of ETH').isSwap === false)
  // Dollar-denominated asks (the 2026-07-14 live dead-end): "$X worth of Y"
  // parses to sellAmountUsd; the route prices it via lib/usd-probe.
  const du = parseSwapIntent('can i swap about $1 worth of ETH for USDG?')
  check('swap intent: "$1 worth of ETH" parses with filler', du.isSwap && du.mode === 'swap' && du.sellAmountUsd === '1' && du.sellToken === 'ETH' && du.buyToken === 'USDG' && !du.problem)
  const du2 = parseSwapIntent('sell $50 of AAPL into USDG')
  check('swap intent: "$50 of AAPL" sell-side dollar', du2.isSwap && du2.sellAmountUsd === '50' && du2.sellToken === 'AAPL' && du2.buyToken === 'USDG')
  const du3 = parseSwapIntent('trade 20 dollars of eth for usdg')
  check('swap intent: "20 dollars of eth" word form', du3.isSwap && du3.sellAmountUsd === '20' && du3.sellToken === 'eth')
  const db = parseSwapIntent('buy $5 of TSLA with USDG')
  check('swap intent: "buy $5 of TSLA with USDG"', db.isSwap && db.sellAmountUsd === '5' && db.buyToken === 'TSLA' && db.sellToken === 'USDG')
  const db2 = parseSwapIntent('buy $5 worth of AAPL')
  check('swap intent: "buy $5 of AAPL" leaves spend token to the chain stable', db2.isSwap && db2.sellAmountUsd === '5' && db2.buyToken === 'AAPL' && db2.sellToken === undefined)
  check('swap intent: dollar perp ask is NOT hijacked', parseSwapIntent('buy $12 of ETH on hyperliquid').isSwap === false)
  check('swap intent: token-amount parse unchanged by dollar support', parseSwapIntent('swap 100 USDC for WETH').sellAmountUsd === undefined)
  // Shares phrasing (live 2026-07-22: "I want to buy $20 shares of APPL"
  // missed the grammar and fell to the planner's quote-then-confirm detour).
  const sh = parseSwapIntent('I want to buy $20 shares of APPL')
  check('swap intent: "$20 shares of APPL" parses as a dollar buy', sh.isSwap && sh.sellAmountUsd === '20' && sh.buyToken === 'APPL' && !sh.problem)
  const sh2 = parseSwapIntent('buy $20 worth of shares of AAPL')
  check('swap intent: "worth of shares of" variant', sh2.isSwap && sh2.sellAmountUsd === '20' && sh2.buyToken === 'AAPL')
  const sh3 = parseSwapIntent('buy 5 shares of AAPL')
  check('swap intent: share-COUNT buy clarifies toward dollars (no planner fall-through)', sh3.isSwap && sh3.problem !== undefined && sh3.problem.includes('$') && sh3.problem.includes('AAPL'))
  // Bare sells with no buy side (live 2026-07-28: the chart overlay's
  // "Sell $50 of ETH" chip earned the prose clarify, then two planner turns
  // and an invalid CoW chain enum — nothing built). The parse carries the
  // sell side alone; the route buys the chain's primary stable.
  const bs = parseSwapIntent('Sell $50 of ETH')
  check('swap intent: "Sell $50 of ETH" parses, buy side left to the route', bs.isSwap && bs.sellAmountUsd === '50' && bs.sellToken === 'ETH' && bs.buyToken === undefined && !bs.problem)
  const bs2 = parseSwapIntent('sell 0.25 ETH')
  check('swap intent: "sell 0.25 ETH" unit sell with no buy side', bs2.isSwap && bs2.sellAmountHuman === '0.25' && bs2.sellToken === 'ETH' && bs2.buyToken === undefined && !bs2.problem)
  check('swap intent: stop-words never claim the bare-token slot', parseSwapIntent('sell 2 of my NFTs').sellToken === undefined)
  check('swap intent: chain words never claim the bare-token slot', parseSwapIntent('sell 5 arbitrum').sellToken === undefined)
  check('swap intent: bare perp sells stay off the spot venue', parseSwapIntent('sell $50 of ETH on hyperliquid').sellToken === undefined)
  const pn = parseSwapIntent('swap USDC for WETH')
  check('swap intent: pair-no-amount carries the pair for chips (problem stays set)', !!pn.problem && pn.sellToken === 'USDC' && pn.buyToken === 'WETH')
  // Chip-bearing clarifies — every resume is a COMPLETE ask that round-trips
  // this parser (the chip is the contract, same as funding/DCA chips).
  const cc1 = swapClarify(parseSwapIntent('swap USDC for WETH'))
  check(
    'swap clarify: pair without amount → preset $ chips that round-trip',
    !!cc1 && cc1.options.length >= 2 && cc1.options.every((o) => { const r = parseSwapIntent(o.resume); return r.isSwap && !r.problem && r.sellToken === 'USDC' && r.buyToken === 'WETH' && !!r.sellAmountUsd }),
  )
  const cc2 = swapClarify(parseSwapIntent('buy 5 shares of AAPL'))
  check(
    'swap clarify: share-count buy → dollar preset chips that round-trip',
    !!cc2 && cc2.options.length >= 2 && cc2.options.every((o) => { const r = parseSwapIntent(o.resume); return r.isSwap && !r.problem && r.buyToken === 'AAPL' && !!r.sellAmountUsd }),
  )
  const cc3 = swapClarify(parseSwapIntent('sell $50 of USDC'), { targets: ['ETH', 'CBETH'] })
  check(
    'swap clarify: stable sell with no target → target chips that round-trip',
    !!cc3 && cc3.options.length === 2 && cc3.options.every((o) => { const r = parseSwapIntent(o.resume); return r.isSwap && !r.problem && r.sellToken === 'USDC' && !!r.buyToken }),
  )
  check(
    'swap clarify: complete asks never chip-clarify',
    swapClarify(parseSwapIntent('swap 100 USDC for WETH')) === null && swapClarify(parseSwapIntent('Sell $50 of ETH')) === null,
  )
  // usd→token conversion (pure): bounded by token decimals, honest nulls.
  check(
    'usd probe: $1 at $3241.55/ETH ≈ 0.00030849 ETH',
    usdToTokenAmount(1, 3241.55, 18) === '0.00030849' &&
      usdToTokenAmount(5, 1, 6) === '5' &&
      usdToTokenAmount(0, 100, 6) === null &&
      usdToTokenAmount(1, 0, 6) === null &&
      usdToTokenAmount(1, Number.NaN, 6) === null,
  )
  // Dollar ask reaches the native layer (deterministic path: no wallet →
  // connect prompt, not the old "say the amount and pair" dead-end).
  const dollarNoWallet = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'can i swap about $1 worth of ETH for USDC?', activeServers: [] }),
  }).then((r) => r.json())
  check('native swap: dollar ask asks to connect (not a dead-end clarify)', dollarNoWallet.connectWallet === true, JSON.stringify(dollarNoWallet).slice(0, 200))

  // Native Robinhood bridge layer (pure parse + guard). The planner once
  // invented Stargate/Across chips for these asks (live 2026-07-14) — the
  // native layer claims them: canonical bridge or an honest answer.
  const br = parseRobinhoodBridge('can i bridge 0.000561 ETH to robinhood from ethereum?')
  check('bridge parse: ETH deposit ask (the live dead-end)', !!br && !('problem' in br) && br.kind === 'deposit' && br.amount === '0.000561')
  const brArb = parseRobinhoodBridge('Can I bridge 0.000561 ETH from Arbitrum to Robinhood Chain?')
  check('bridge parse: foreign origin → honest Ethereum-only answer, no options', !!brArb && 'problem' in brArb && /Ethereum/.test(brArb.problem))
  const brW = parseRobinhoodBridge('withdraw 0.01 eth from robinhood to ethereum')
  check('bridge parse: withdrawal direction', !!brW && !('problem' in brW) && brW.kind === 'withdraw' && brW.amount === '0.01')
  const brErc = parseRobinhoodBridge('bridge 100 USDG to robinhood')
  check('bridge parse: ERC-20 → bridge UI pointer, never built', !!brErc && 'problem' in brErc && /portal\.arbitrum\.io/.test(brErc.problem))
  const brNoAmt = parseRobinhoodBridge('bridge eth to robinhood')
  check('bridge parse: missing amount clarifies', !!brNoAmt && 'problem' in brNoAmt && /How much/i.test(brNoAmt.problem))
  check(
    'bridge parse: non-bridge robinhood asks fall through',
    parseRobinhoodBridge('show my portfolio on robinhood') === null &&
      parseRobinhoodBridge('what is robinhood chain?') === null &&
      parseRobinhoodBridge('swap 1 usdc for weth') === null,
  )
  // Guard fails CLOSED: exact wei, pinned contracts, signer-pinned destination.
  const me = '0x1111111111111111111111111111111111111111'
  const depositData = keccak256(stringToBytes('depositEth()')).slice(0, 10)
  const withdrawData = (keccak256(stringToBytes('withdrawEth(address)')).slice(0, 10) + '000000000000000000000000' + me.slice(2)) as string
  check(
    'bridge guard: valid deposit/withdraw pass, tampers refuse',
    guardRobinhoodBridge({ to: RH_L1_INBOX, data: depositData, value: '1000', chainId: 1, action: 'bridge-deposit' }, { kind: 'deposit', wei: BigInt(1000), user: me }).ok === true &&
      guardRobinhoodBridge({ to: RH_L1_INBOX, data: depositData, value: '999', chainId: 1, action: 'bridge-deposit' }, { kind: 'deposit', wei: BigInt(1000), user: me }).ok === false &&
      guardRobinhoodBridge({ to: me, data: depositData, value: '1000', chainId: 1, action: 'bridge-deposit' }, { kind: 'deposit', wei: BigInt(1000), user: me }).ok === false &&
      guardRobinhoodBridge({ to: ARB_SYS, data: withdrawData, value: '1000', chainId: 4663, action: 'bridge-withdraw' }, { kind: 'withdraw', wei: BigInt(1000), user: me }).ok === true &&
      guardRobinhoodBridge({ to: ARB_SYS, data: withdrawData, value: '1000', chainId: 4663, action: 'bridge-withdraw' }, { kind: 'withdraw', wei: BigInt(1000), user: '0x2222222222222222222222222222222222222222' }).ok === false,
  )
  // Deterministic route paths: the native layer claims the turn (no planner).
  const bridgeNoWallet = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'can i bridge 0.000561 ETH to robinhood from ethereum?', activeServers: [] }),
  }).then((r) => r.json())
  check('native bridge: deposit ask asks to connect (not planner options)', bridgeNoWallet.connectWallet === true, JSON.stringify(bridgeNoWallet).slice(0, 200))
  const bridgeArb = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'Can I bridge 0.000561 ETH from Arbitrum to Robinhood Chain?', activeServers: [] }),
  }).then((r) => r.json())
  check('native bridge: foreign origin answered honestly (no invented venues)', typeof bridgeArb.reply === 'string' && /Ethereum/.test(bridgeArb.reply) && !/stargate|across/i.test(bridgeArb.reply), JSON.stringify(bridgeArb).slice(0, 200))
  // ── Native NFT layer (pure parse + guards + Seaport order math) ────────────
  // Claims only NFT-marked turns; "sell 1 ETH for USDC" must never land here.
  const nftSell = parseNftAsk('sell my Pudgy Penguin #2489 for 4.2 ETH')
  check(
    'nft parse: sell ask (name + #id + price)',
    !!nftSell && nftSell.kind === 'sell' && /pudgy penguin/i.test(nftSell.ref) && nftSell.tokenId === '2489' && nftSell.priceEth === '4.2',
    JSON.stringify(nftSell),
  )
  const nftSellChain = parseNftAsk('Sell my Edition 77 NFT on base for 0.5 ETH')
  check('nft parse: chain hint scopes the resolve', !!nftSellChain && nftSellChain.kind === 'sell' && nftSellChain.chainId === 8453, JSON.stringify(nftSellChain))
  const nftXfer = parseNftAsk('send my Pudgy Penguin #2489 to 0x2222222222222222222222222222222222222222')
  check(
    'nft parse: transfer ask (0x recipient)',
    !!nftXfer && nftXfer.kind === 'transfer' && nftXfer.tokenId === '2489' && nftXfer.to === '0x2222222222222222222222222222222222222222',
    JSON.stringify(nftXfer),
  )
  const nftEns = parseNftAsk('transfer my Cool Cat NFT to vitalik.eth')
  check('nft parse: ENS recipient rides through', !!nftEns && nftEns.kind === 'transfer' && nftEns.to === 'vitalik.eth', JSON.stringify(nftEns))
  const nftNoPrice = parseNftAsk('sell my Pudgy Penguin #2489 nft')
  check('nft parse: sell without a price clarifies (never guesses)', !!nftNoPrice && nftNoPrice.kind === 'problem' && /price/i.test(nftNoPrice.problem), JSON.stringify(nftNoPrice))
  const nftNoTo = parseNftAsk('transfer my pudgy penguin #2489 nft')
  check('nft parse: transfer without a recipient clarifies', !!nftNoTo && nftNoTo.kind === 'problem' && /recipient|go|0x/i.test(nftNoTo.problem), JSON.stringify(nftNoTo))
  // ── Transfer continuity. "Where should it go?" is a QUESTION, so its answer
  // is a bare address — which names no NFT. Without a memory that turn fell to
  // the planner, which "confirmed" the transfer and then invented a failed
  // ownership lookup for an NFT it had been handed two turns earlier (live
  // 2026-07-28, from the gallery's Transfer chip).
  const nftOpen = parseNftAsk('Transfer my Mintbase #42 NFT on Ethereum')
  check(
    'nft parse: a recipient-less transfer KEEPS the NFT it parsed',
    !!nftOpen && nftOpen.kind === 'problem' && nftOpen.awaiting === 'recipient' && nftOpen.partial?.ref === 'Mintbase #42' && nftOpen.partial?.tokenId === '42' && nftOpen.partial?.chainId === 1,
    JSON.stringify(nftOpen),
  )
  // The chip that caused it shipped a dangling "…to " for the user to finish;
  // chips auto-send, so it fired half-written. Old links still carry it.
  const nftOpenLegacy = parseNftAsk('Send my Mintbase #42 NFT on Ethereum to ')
  check(
    'nft parse: the legacy dangling-"to" chip still parks its NFT',
    !!nftOpenLegacy && nftOpenLegacy.kind === 'problem' && nftOpenLegacy.partial?.ref === 'Mintbase #42',
    JSON.stringify(nftOpenLegacy),
  )
  check(
    'nft follow-up: a bare address (or ENS) answers the pending transfer',
    (() => {
      const bare = parseNftTransferFollowUp('0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0')
      const worded = parseNftTransferFollowUp('send it to vitalik.eth')
      return bare?.kind === 'recipient' && bare.to === '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0' && worded?.kind === 'recipient' && worded.to === 'vitalik.eth'
    })(),
  )
  check(
    'nft follow-up: fresh asks, questions, and chatter never become a recipient',
    parseNftTransferFollowUp('what NFTs do I own?') === null &&
      parseNftTransferFollowUp('sell my Cool Cat #7 for 1 eth') === null &&
      parseNftTransferFollowUp('how do I do that') === null &&
      parseNftTransferFollowUp('never mind')?.kind === 'cancel',
  )
  // The round trip: park it, answer it, get a buildable transfer back.
  check(
    'nft follow-up: parked NFT + pasted address rebuild the full transfer ask',
    (() => {
      const open = parseNftAsk('Transfer my Pudgy Penguin #2489 NFT on Base')
      if (!open || open.kind !== 'problem' || !open.partial) return false
      const parked = nftTransferPending(open.partial)
      const resumed = nftAskFromPending(parked.data, '0x2222222222222222222222222222222222222222')
      return (
        parked.kind === 'nft-transfer' &&
        Object.keys(parked.data).length <= 8 &&
        !!resumed &&
        resumed.ref === 'Pudgy Penguin #2489' &&
        resumed.tokenId === '2489' &&
        resumed.chainId === 8453 &&
        resumed.to === '0x2222222222222222222222222222222222222222'
      )
    })(),
  )
  check('nft follow-up: a parked payload with no ref never builds on a guess', nftAskFromPending({ amount: '1' }, '0x2222222222222222222222222222222222222222') === null)
  // The gallery's own Transfer chip must round-trip its OWN flow: complete ask
  // in, parked NFT out (a chip that auto-sends can never be half-written).
  check(
    'nft gallery: the Transfer chip is a complete ask that parks its NFT',
    (() => {
      const chip = nftRowActions({ name: 'Pudgy Penguin', identifier: '2489' }, 'Base', null)[1]
      if (/\bto\s*$/i.test(chip.prompt)) return false
      const open = parseNftAsk(chip.prompt)
      return !!open && open.kind === 'problem' && open.awaiting === 'recipient' && open.partial?.tokenId === '2489' && open.partial?.chainId === 8453
    })(),
  )
  // The live seam: refusal carries the pending, the address completes it.
  const nftXferOpen = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
    body: JSON.stringify({ message: 'Transfer my Pudgy Penguin #2489 NFT on Base', activeServers: [], walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }),
  }).then((r) => r.json())
  check(
    'nft transfer turn: the "where should it go?" refusal parks the NFT',
    nftXferOpen.workingContext?.pending?.kind === 'nft-transfer' && /Pudgy Penguin #2489/.test(nftXferOpen.workingContext?.pending?.summary ?? ''),
    JSON.stringify(nftXferOpen).slice(0, 220),
  )
  const nftXferResume = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
    body: JSON.stringify({
      message: '0x2222222222222222222222222222222222222222',
      activeServers: [],
      walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045',
      workingContext: nftXferOpen.workingContext,
    }),
  }).then((r) => r.json())
  check(
    'nft transfer turn: the pasted address resumes THAT NFT (never the planner)',
    typeof nftXferResume.reply === 'string' && /pudgy penguin|#2489/i.test(nftXferResume.reply) && !/could\s*n[o']t verify|double-check/i.test(nftXferResume.reply),
    JSON.stringify(nftXferResume).slice(0, 260),
  )
  check(
    'nft parse: token swaps + stock sells + bare sends fall through',
    parseNftAsk('sell 1 ETH for USDC') === null &&
      parseNftAsk('swap 100 usdc for weth') === null &&
      parseNftAsk('Sell AAPL on Robinhood Chain') === null &&
      parseNftAsk('send 0.1 eth to 0x2222222222222222222222222222222222222222') === null,
  )
  const nftRh = parseNftAsk('sell my pudgy penguin #2489 nft on robinhood chain for 1 eth')
  check('nft parse: robinhood-chain NFT ask answered honestly', !!nftRh && nftRh.kind === 'problem' && /Ethereum, Base/i.test(nftRh.problem), JSON.stringify(nftRh))
  // ── The gallery READ ("show my NFTs"). Before this layer the house link
  // /i/my-nfts answered with a planner "visit OpenSea" pointer — the funnel
  // handing away its own conversion. The gate is deliberately narrow: a
  // possessive, UNSPECIFIC NFT question and nothing else.
  check(
    'nft gallery parse: the wallet-gallery shapes are claimed',
    ['Show my NFTs', 'show the NFTs in my wallet', 'what NFTs do I own?', 'which nfts do i have', 'list my nfts', 'my collectibles'].every(
      (m) => parseNftListAsk(m) !== null,
    ),
  )
  const nftListChain = parseNftListAsk('show my nfts on base')
  check('nft gallery parse: a named chain scopes the read', !!nftListChain && nftListChain.chainId === 8453, JSON.stringify(nftListChain))
  check(
    'nft gallery parse: build asks + market questions + non-NFT asks fall through',
    parseNftListAsk('sell my Pudgy Penguin #2489 for 4.2 ETH') === null &&
      parseNftListAsk('send my Cool Cat NFT to vitalik.eth') === null &&
      parseNftListAsk('buy the cheapest milady nft') === null &&
      parseNftListAsk('list my nfts for sale') === null &&
      parseNftListAsk('What are my NFTs worth right now — check the floor prices of my collections on OpenSea?') === null &&
      parseNftListAsk('Are there any offers on the NFTs I own?') === null &&
      parseNftListAsk('show my portfolio') === null &&
      parseNftListAsk('what tokens do I own?') === null,
  )
  // The gallery answer and the sell/transfer builds share one row shape, so a
  // row's own chip must come back as a buildable ask — the round-trip that
  // keeps the card a doorway instead of a dead end.
  const galleryRow = nftRowActions({ name: 'Pudgy Penguin', identifier: '2489' }, 'Base', 4.2)
  const galleryResume = parseNftAsk(galleryRow[0].prompt)
  check(
    'nft gallery: a row Sell chip round-trips parseNftAsk (name + chain + price)',
    !!galleryResume && galleryResume.kind === 'sell' && galleryResume.tokenId === '2489' && galleryResume.chainId === 8453 && galleryResume.priceEth === '4.2',
    JSON.stringify(galleryResume),
  )
  check(
    'nft gallery: an unpriced row still sells (the layer asks for the price)',
    (() => {
      const noFloor = parseNftAsk(nftRowActions({ name: 'Cool Cat', identifier: '77' }, 'Ethereum', null)[0].prompt)
      return !!noFloor && noFloor.kind === 'problem' && /price/i.test(noFloor.problem)
    })(),
  )
  // The chain picker scopes the read; a picker parked off OpenSea's coverage
  // has nothing to scan (the caller says so rather than silently scanning).
  check(
    'nft gallery: chain scoping follows the picker (robinhood → empty scope)',
    nftGalleryChains(null).length === 3 &&
      nftGalleryChains(chainById(8453)).map((c) => c.label).join() === 'Base' &&
      nftGalleryChains(chainById(4663)).length === 0,
  )
  // A gallery payload survives the meta round-trip the chat message makes.
  const galleryDisplay = nftGalleryOf({
    nfts: { owner: '0x1111111111111111111111111111111111111111', chains: ['Base'], failedChains: [], found: 3, nfts: [{ name: 'Pudgy #1', contract: '0xabc', tokenId: '1', chain: 'Base' }] },
  })
  check(
    'nft gallery: the display contract reads back off message meta',
    !!galleryDisplay && galleryDisplay.nfts.length === 1 && galleryDisplay.found === 3 && nftGalleryOf({ nfts: { owner: 1 } }) === null,
    JSON.stringify(galleryDisplay),
  )
  // The turn itself: the ask must never come back a bare planner reply.
  const nftGalleryTurn = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
    body: JSON.stringify({ message: 'Show my NFTs', activeServers: [], walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }),
  }).then((r) => r.json())
  check(
    'nft gallery turn: "Show my NFTs" answers with the read, never a visit-OpenSea pointer',
    !!nftGalleryTurn.nfts &&
      typeof nftGalleryTurn.nfts.owner === 'string' &&
      Array.isArray(nftGalleryTurn.nfts.nfts) &&
      nftGalleryTurn.buildPath === 'native-nft-gallery' &&
      !/visit\s+opensea|opensea\.io|can't\s+query/i.test(nftGalleryTurn.reply ?? ''),
    JSON.stringify(nftGalleryTurn).slice(0, 220),
  )
  const nftGalleryNoWallet = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
    body: JSON.stringify({ message: 'Show my NFTs', activeServers: [] }),
  }).then((r) => r.json())
  check(
    'nft gallery turn: no wallet asks to connect (never a planner shrug)',
    nftGalleryNoWallet.connectWallet === true && nftGalleryNoWallet.buildPath === 'native-nft-gallery',
    JSON.stringify(nftGalleryNoWallet).slice(0, 200),
  )
  check(
    'nft gallery turn: the read counts as actionable (never logged as a wall)',
    classifyTurn({ reply: 'x', nfts: { owner: '0x1', nfts: [] }, buildPath: 'native-nft-gallery' }).kind === null,
  )
  // ── The MARKET reads. The gallery gate refuses market questions so it
  // never answers the wrong one — which left the OpenSea splash tile's own
  // two chips falling to the planner ("I can't check real-time floor
  // prices"). Both halves of that split are pinned here.
  const nftWorthAsk = parseNftMarketAsk('What are my NFTs worth right now — check the floor prices of my collections on OpenSea?')
  const nftOffersAsk = parseNftMarketAsk('Are there any offers on the NFTs I own?')
  check(
    'nft market parse: BOTH OpenSea splash chips are claimed, each by the right read',
    !!nftWorthAsk && nftWorthAsk.kind === 'worth' && !!nftOffersAsk && nftOffersAsk.kind === 'offers',
    JSON.stringify({ nftWorthAsk, nftOffersAsk }),
  )
  // The two gates share one vocabulary: every word the gallery refuses as
  // "market" must land in the market gate. A word in neither is exactly how
  // these asks reached the planner, so the coverage is checked word by word.
  const marketWords = ['offer', 'offers', 'bid', 'bids', 'floor', 'floors', 'worth', 'price', 'prices', 'value', 'valuation']
  check(
    'nft market parse: no market word falls between the gallery gate and this one',
    marketWords.every((w) => {
      const m = `what is the ${w} of my nfts`
      return parseNftListAsk(m) === null && parseNftMarketAsk(m) !== null
    }),
    marketWords.filter((w) => parseNftMarketAsk(`what is the ${w} of my nfts`) === null).join(',') || 'all covered',
  )
  check(
    'nft market parse: an explicit bid word wins over a co-occurring "worth"',
    parseNftMarketAsk('what are my NFTs worth — are there any offers?')?.kind === 'offers',
  )
  const nftWorthChain = parseNftMarketAsk('what are my nfts worth on base?')
  check('nft market parse: a named chain scopes the read', !!nftWorthChain && nftWorthChain.chainId === 8453, JSON.stringify(nftWorthChain))
  check(
    'nft market parse: build asks, ONE named NFT, and non-NFT asks fall through',
    parseNftMarketAsk('sell my Pudgy Penguin #2489 for 4.2 ETH') === null &&
      parseNftMarketAsk('what is my Pudgy Penguin #2489 worth?') === null &&
      parseNftMarketAsk('what is the floor price of pudgy penguins?') === null &&
      parseNftMarketAsk('buy the cheapest milady nft') === null &&
      parseNftMarketAsk('what is my portfolio worth?') === null &&
      parseNftMarketAsk('what are my tokens worth right now?') === null,
  )
  // The valuation math: only what we actually priced lands in the total, and
  // a collection with no floor is COUNTED as unpriced rather than as zero.
  const marketSample = (collection: string, chainLabel: string, identifier: string) => ({
    collection,
    chainLabel,
    chainId: chainLabel === 'Base' ? 8453 : 1,
    identifier,
    contract: '0x3333333333333333333333333333333333333333',
    name: 'Pudgy Penguin',
    token_standard: 'erc721',
  })
  const worthGroups = groupCollections([
    marketSample('pudgy-penguins', 'Ethereum', '1'),
    marketSample('pudgy-penguins', 'Ethereum', '2'),
    marketSample('pudgy-penguins', 'Base', '3'),
    marketSample('unlisted-thing', 'Ethereum', '9'),
  ] as never)
  check(
    'nft worth: grouping is per collection PER CHAIN (different markets, different floors)',
    worthGroups.length === 3 && worthGroups[0].count === 2 && worthGroups[0].chainLabel === 'Ethereum',
    JSON.stringify(worthGroups.map((g) => `${g.key}=${g.count}`)),
  )
  check(
    'nft worth: ties break deterministically (the lookup cap must pick the SAME collections twice)',
    (() => {
      const shuffled = groupCollections([
        marketSample('unlisted-thing', 'Ethereum', '9'),
        marketSample('pudgy-penguins', 'Base', '3'),
        marketSample('pudgy-penguins', 'Ethereum', '1'),
        marketSample('pudgy-penguins', 'Ethereum', '2'),
      ] as never)
      return shuffled.map((g) => g.key).join() === worthGroups.map((g) => g.key).join()
    })(),
    JSON.stringify(worthGroups.map((g) => g.key)),
  )
  const worthDisplay = valuationDisplay({
    owner: '0x1111111111111111111111111111111111111111',
    chains: ['Ethereum', 'Base'],
    failedChains: [],
    groups: worthGroups,
    floors: new Map([
      ['Ethereum:pudgy-penguins', 4],
      ['Base:pudgy-penguins', 1.5],
      ['Ethereum:unlisted-thing', null],
    ]),
    ethUsd: 3000,
    found: 4,
    collectionsFound: 3,
  })
  check(
    'nft worth: the total sums ONLY priced collections (2×4 + 1×1.5), unpriced counted not zeroed',
    worthDisplay.total === '≈ 9.5 ETH' && worthDisplay.unpriced === 1 && /28\.5K|\$28/.test(worthDisplay.totalNote ?? ''),
    JSON.stringify({ total: worthDisplay.total, note: worthDisplay.totalNote, unpriced: worthDisplay.unpriced }),
  )
  check(
    'nft worth: an unpriced collection still renders, and says it is out of the total',
    worthDisplay.rows.length === 3 &&
      worthDisplay.rows.every((r) => typeof r.value === 'string') &&
      /not counted/i.test(worthDisplay.rows.find((r) => r.name === 'unlisted thing')?.note ?? ''),
    JSON.stringify(worthDisplay.rows.map((r) => `${r.name}:${r.value}`)),
  )
  // Every value leaves the reader PRE-FORMATTED (the splash tile contract —
  // a raw number where a string was expected once crashed /chat).
  check(
    'nft worth: a row Sell chip round-trips parseNftAsk at the collection floor',
    (() => {
      const resume = parseNftAsk(worthDisplay.rows[0].actions?.[0].prompt ?? '')
      return !!resume && resume.kind === 'sell' && resume.priceEth === '4' && resume.chainId === 1
    })(),
    JSON.stringify(worthDisplay.rows[0].actions),
  )
  check(
    'nft worth: the Sell label stays short (a collection name in it wrecked the row layout)',
    worthDisplay.rows.every((r) => (r.actions?.[0].label.length ?? 0) <= 10),
    JSON.stringify(worthDisplay.rows.map((r) => r.actions?.[0].label)),
  )
  check(
    'nft worth: an all-unpriced wallet gets NO total (never a fabricated zero)',
    (() => {
      const none = valuationDisplay({
        owner: '0x1', chains: ['Ethereum'], failedChains: [], groups: worthGroups.slice(2),
        floors: new Map([['Ethereum:unlisted-thing', null]]), ethUsd: 3000, found: 1, collectionsFound: 1,
      })
      return none.total === null && none.totalNote === null && none.unpriced === 1
    })(),
  )
  // Offers: the normalizer is fail-closed on the LIVE payload shape (probed
  // 2026-07-28 — collection bids are WETH-priced criteria orders whose NFT
  // leg sits in the consideration).
  const rawOffer = {
    order_hash: '0x079fe4ba',
    chain: 'ethereum',
    protocol_address: SEAPORT_1_6.toLowerCase(),
    price: { currency: 'WETH', decimals: 18, value: '100000000000000' },
    asset: { identifier: null, contract: '0x22c1f6050e56d2876009903609a2cc3fef83b415' },
    criteria: { contract: { address: '0x22c1f6050e56d2876009903609a2cc3fef83b415' }, encoded_token_ids: '*' },
    protocol_data: { parameters: { endTime: '1785224495', consideration: [{ itemType: 4, token: '0x22c1f6050e56d2876009903609a2cc3fef83b415', identifierOrCriteria: '0' }] } },
  }
  const offer = normalizeOpenseaOffer(rawOffer)
  check(
    'nft offers: a live WETH collection bid normalizes (and is marked collection-wide)',
    !!offer && offer.priceWei === BigInt('100000000000000') && offer.collectionWide === true && offer.tokenId === null && offer.chainId === 1,
    JSON.stringify(offer, (_k, v) => (typeof v === 'bigint' ? v.toString() : v)),
  )
  check(
    'nft offers: the normalizer fails closed (wrong protocol, zero price, no contract)',
    normalizeOpenseaOffer({ ...rawOffer, protocol_address: '0x000000000000000000000000000000000000dead' }) === null &&
      normalizeOpenseaOffer({ ...rawOffer, price: { currency: 'WETH', decimals: 18, value: '0' } }) === null &&
      normalizeOpenseaOffer({ ...rawOffer, price: { currency: 'USDC', decimals: 6, value: '100' } }) === null &&
      normalizeOpenseaOffer({ ...rawOffer, criteria: undefined, asset: undefined, protocol_data: undefined }) === null &&
      normalizeOpenseaOffer(null) === null,
  )
  const offersDisp = offersDisplay({
    owner: '0x1111111111111111111111111111111111111111',
    chains: ['Ethereum'],
    failedChains: [],
    checked: [
      { group: groupCollections([marketSample('quiet-thing', 'Ethereum', '2489')] as never)[0], offer: null },
      { group: groupCollections([marketSample('pudgy-penguins', 'Ethereum', '77')] as never)[0], offer: { ...offer!, priceWei: BigInt('300000000000000000') } },
    ],
    ethUsd: 3000,
    found: 9,
    collectionsFound: 5,
  })
  check(
    'nft offers: bids lead, the best one is the headline, un-bid collections counted not hidden',
    offersDisp.total === 'best 0.3 ETH' &&
      offersDisp.rows.length === 2 &&
      offersDisp.rows[0].value === '0.3 ETH' &&
      offersDisp.rows[1].value === 'no bids' &&
      offersDisp.unpriced === 1 &&
      offersDisp.found === 9 &&
      // a CAPPED read never reads as a complete one
      offersDisp.scanned === '9 NFTs · 2 of 5 collections',
    JSON.stringify({ total: offersDisp.total, rows: offersDisp.rows.map((r) => `${r.name}:${r.value}`), unpriced: offersDisp.unpriced }),
  )
  check(
    'nft offers: only a bid row gets an action, and it lists AT the bid (round-trips parseNftAsk)',
    (() => {
      const resume = parseNftAsk(offersDisp.rows[0].actions?.[0].prompt ?? '')
      return !!resume && resume.kind === 'sell' && resume.priceEth === '0.3' && (offersDisp.rows[1].actions ?? []).length === 0
    })(),
    JSON.stringify(offersDisp.rows[0].actions),
  )
  // The reply SENTENCE makes claims about money, so every variant is pinned
  // here rather than left inline in the route where nothing can reach it.
  check(
    'nft market copy: the worth sentence carries the total and names what is NOT in it',
    (() => {
      const s = marketReplyCopy(worthDisplay, 'Ethereum and Base', '', '')
      return s.includes('≈ 9.5 ETH') && /1 collection has no floor/.test(s) && /not a bid/.test(s)
    })(),
    marketReplyCopy(worthDisplay, 'Ethereum and Base', '', ''),
  )
  check(
    'nft market copy: nothing priced → NO number, and it points at the read that can give one',
    (() => {
      const none = { ...worthDisplay, total: null, totalNote: null, unpriced: 3, found: 7 }
      const s = marketReplyCopy(none, 'Ethereum', '', '')
      return !/ETH/.test(s) && /7 NFTs/.test(s) && /offers/i.test(s)
    })(),
    marketReplyCopy({ ...worthDisplay, total: null, totalNote: null, unpriced: 3, found: 7 }, 'Ethereum', '', ''),
  )
  check(
    'nft market copy: an all-failed read says UNKNOWN, never "you have none"',
    (() => {
      const dead = { ...worthDisplay, rows: [], chains: ['Ethereum', 'Base'], failedChains: ['Ethereum', 'Base'] }
      const s = marketReplyCopy(dead, 'Ethereum and Base', '', 'Ethereum or Base')
      return /didn't answer/.test(s) && !/No NFTs/.test(s)
    })(),
    marketReplyCopy({ ...worthDisplay, rows: [], chains: ['Ethereum', 'Base'], failedChains: ['Ethereum', 'Base'] }, 'Ethereum and Base', '', 'Ethereum or Base'),
  )
  check(
    'nft market copy: the offers sentence agrees with the count and admits we cannot accept a bid',
    (() => {
      const one = marketReplyCopy(offersDisp, 'Ethereum', '', '')
      const zero = marketReplyCopy({ ...offersDisp, total: null, unpriced: 2 }, 'Ethereum', '', '')
      return /1 of the 2 collections you hold on Ethereum has a live bid/.test(one) && /can't accept a bid/.test(one) && /No live bids/.test(zero)
    })(),
    marketReplyCopy(offersDisp, 'Ethereum', '', ''),
  )
  // A market payload survives the meta round-trip the chat message makes.
  check(
    'nft market: the display contract reads back off message meta (and rejects malformed)',
    (() => {
      const back = nftMarketOf({ nftMarket: worthDisplay })
      return (
        !!back &&
        back.kind === 'worth' &&
        back.rows.length === 3 &&
        nftMarketOf({ nftMarket: { owner: '0x1', rows: [], kind: 'nope' } }) === null &&
        // values are STRINGS by contract — a raw number is a producer bug
        nftMarketOf({ nftMarket: { owner: '0x1', kind: 'worth', rows: [{ name: 'x', detail: 'y', value: 12 }] } })?.rows.length === 0
      )
    })(),
  )
  // The turns themselves: BOTH chips must come back with the read attached —
  // the exact repro that opened this lane (a bare "I can't browse OpenSea").
  for (const [label, ask, kind] of [
    ['worth', 'What are my NFTs worth right now — check the floor prices of my collections on OpenSea?', 'native-nft-worth'],
    ['offers', 'Are there any offers on the NFTs I own?', 'native-nft-offers'],
  ] as const) {
    const turn = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ message: ask, activeServers: [], walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }),
    }).then((r) => r.json())
    check(
      `nft market turn: the "${label}" splash chip answers with the read, never a planner shrug`,
      !!turn.nftMarket &&
        Array.isArray(turn.nftMarket.rows) &&
        turn.nftMarket.rows.length > 0 &&
        turn.buildPath === kind &&
        !/can't\s+(?:browse|check|query)|visit\s+opensea/i.test(turn.reply ?? ''),
      JSON.stringify({ buildPath: turn.buildPath, reply: (turn.reply ?? '').slice(0, 160), rows: turn.nftMarket?.rows?.length }),
    )
  }
  const nftMarketNoWallet = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
    body: JSON.stringify({ message: 'Are there any offers on the NFTs I own?', activeServers: [] }),
  }).then((r) => r.json())
  check(
    'nft market turn: no wallet asks to connect (never a planner shrug)',
    nftMarketNoWallet.connectWallet === true && nftMarketNoWallet.buildPath === 'native-nft-offers',
    JSON.stringify(nftMarketNoWallet).slice(0, 200),
  )
  check(
    'nft market turn: the read counts as actionable (never logged as a wall)',
    classifyTurn({ reply: 'x', nftMarket: { owner: '0x1', rows: [] }, buildPath: 'native-nft-worth' }).kind === null,
  )
  // Buy asks: resolve against live listings; the grammar reads #id targets,
  // "cheapest" collection buys, and an explicit ETH cap — and never claims
  // token/stock buys (no NFT marker).
  const nftBuy = parseNftAsk('buy pudgy penguin #2489')
  check(
    'nft parse: buy ask (name + #id)',
    !!nftBuy && nftBuy.kind === 'buy' && /pudgy penguin/i.test(nftBuy.ref) && nftBuy.tokenId === '2489' && nftBuy.maxPriceEth === null,
    JSON.stringify(nftBuy),
  )
  const nftBuyCap = parseNftAsk('buy the cheapest milady nft for up to 1.5 eth')
  check(
    'nft parse: cheapest-collection buy with an ETH cap',
    !!nftBuyCap && nftBuyCap.kind === 'buy' && /milady/i.test(nftBuyCap.ref) && nftBuyCap.tokenId === null && nftBuyCap.maxPriceEth === '1.5',
    JSON.stringify(nftBuyCap),
  )
  const nftBuyAddr = parseNftAsk('buy 0x3333333333333333333333333333333333333333 #7 nft on base')
  check(
    'nft parse: address#id buy carries contract + chain',
    !!nftBuyAddr && nftBuyAddr.kind === 'buy' && nftBuyAddr.contract === '0x3333333333333333333333333333333333333333' && nftBuyAddr.tokenId === '7' && nftBuyAddr.chainId === 8453,
    JSON.stringify(nftBuyAddr),
  )
  check(
    'nft parse: token/stock buys never land in the NFT layer',
    parseNftAsk('buy $10 of AAPL') === null && parseNftAsk('buy 20 USDC on base') === null,
  )
  const nftBuyRh = parseNftAsk('buy a milady nft on robinhood chain')
  check('nft parse: robinhood-chain buy answered honestly', !!nftBuyRh && nftBuyRh.kind === 'problem' && /Ethereum, Base/i.test(nftBuyRh.problem), JSON.stringify(nftBuyRh))
  // Pasted OpenSea item links: chain + contract + token id read straight off
  // the URL (Nate's live repro 2026-07-23 — the layer asked "which token?"
  // with the id sitting in the link).
  const osUrl = parseOpenSeaItemUrl('https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198')
  const osUrlLegacy = parseOpenSeaItemUrl('opensea.io/assets/ethereum/0x3333333333333333333333333333333333333333/42 please')
  const osUrlAlien = parseOpenSeaItemUrl('https://opensea.io/item/matic/0x3333333333333333333333333333333333333333/9')
  check(
    'nft parse: OpenSea item URL → chain/contract/id (item + legacy assets forms; unsupported slug → null chain)',
    !!osUrl && osUrl.chainId === 8453 && osUrl.contract === '0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0' && osUrl.tokenId === '198' &&
      !!osUrlLegacy && osUrlLegacy.chainId === 1 && osUrlLegacy.tokenId === '42' &&
      !!osUrlAlien && osUrlAlien.chainId === null && osUrlAlien.chainSlug === 'matic',
    JSON.stringify({ osUrl, osUrlLegacy, osUrlAlien }),
  )
  const nftBuyUrl = parseNftAsk('I want to buy this NFT on base https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198')
  check(
    'nft parse: buy with a pasted item link never asks "which token?" — id + contract + chain from the URL',
    !!nftBuyUrl && nftBuyUrl.kind === 'buy' && nftBuyUrl.contract === '0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0' && nftBuyUrl.tokenId === '198' && nftBuyUrl.chainId === 8453 && nftBuyUrl.maxPriceEth === null,
    JSON.stringify(nftBuyUrl),
  )
  const nftBuyUrlCap = parseNftAsk('buy https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198 for up to 0.2 eth')
  check(
    'nft parse: link buy still reads an explicit ETH cap',
    !!nftBuyUrlCap && nftBuyUrlCap.kind === 'buy' && nftBuyUrlCap.tokenId === '198' && nftBuyUrlCap.maxPriceEth === '0.2',
    JSON.stringify(nftBuyUrlCap),
  )
  const nftBuyUrlAlien = parseNftAsk('buy this nft https://opensea.io/item/matic/0x3333333333333333333333333333333333333333/9')
  check(
    'nft parse: link on an unsupported chain answered honestly (names the slug)',
    !!nftBuyUrlAlien && nftBuyUrlAlien.kind === 'problem' && /matic/.test(nftBuyUrlAlien.problem) && /Ethereum, Base/.test(nftBuyUrlAlien.problem),
    JSON.stringify(nftBuyUrlAlien),
  )
  const nftXferUrl = parseNftAsk('send https://opensea.io/item/base/0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0/198 nft to 0x2222222222222222222222222222222222222222')
  check(
    'nft parse: transfers read pasted item links too',
    !!nftXferUrl && nftXferUrl.kind === 'transfer' && nftXferUrl.contract === '0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0' && nftXferUrl.tokenId === '198' && nftXferUrl.chainId === 8453,
    JSON.stringify(nftXferUrl),
  )
  // The onward-chip resume ("buy the cheapest 0x… nft on base") round-trips
  // the grammar — chip IS the contract.
  const nftChipResume = parseNftAsk('buy the cheapest 0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0 nft on base')
  check(
    'nft parse: cheapest-at-contract chip resume round-trips (cheapest flag, no token id)',
    !!nftChipResume && nftChipResume.kind === 'buy' && nftChipResume.contract === '0x6cf64997bcfcec770e231aba2ba9ea38ff9511a0' && nftChipResume.tokenId === null && nftChipResume.cheapest === true && nftChipResume.chainId === 8453,
    JSON.stringify(nftChipResume),
  )
  // Transfer guard fails CLOSED: exact contract/chain/sender/recipient/id/amount.
  const nftMe = '0x1111111111111111111111111111111111111111'
  const nftYou = '0x2222222222222222222222222222222222222222'
  const nftContract = '0x3333333333333333333333333333333333333333'
  const xfer721 = encodeFunctionData({ abi: NFT_ERC721_ABI, functionName: 'safeTransferFrom', args: [nftMe, nftYou, BigInt(2489)] })
  const xfer1155 = encodeFunctionData({ abi: NFT_ERC1155_ABI, functionName: 'safeTransferFrom', args: [nftMe, nftYou, BigInt(77), BigInt(3), '0x'] })
  const exp721 = { contract: nftContract, chainId: 1, standard: 'erc721' as const, from: nftMe, to: nftYou, tokenId: '2489', amount: BigInt(1) }
  check(
    'nft transfer guard: valid 721/1155 pass, tampers refuse',
    guardNftTransfer({ to: nftContract, data: xfer721, value: '0', chainId: 1 }, exp721).ok === true &&
      guardNftTransfer({ to: nftContract, data: xfer721, value: '0', chainId: 8453 }, exp721).ok === false &&
      guardNftTransfer({ to: nftContract, data: xfer721, value: '0', chainId: 1 }, { ...exp721, to: nftMe }).ok === false &&
      guardNftTransfer({ to: nftContract, data: xfer721, value: '0', chainId: 1 }, { ...exp721, tokenId: '9' }).ok === false &&
      guardNftTransfer({ to: nftContract, data: xfer1155, value: '0', chainId: 1 }, { ...exp721, standard: 'erc1155', tokenId: '77', amount: BigInt(3) }).ok === true &&
      guardNftTransfer({ to: nftContract, data: xfer1155, value: '0', chainId: 1 }, { ...exp721, standard: 'erc1155', tokenId: '77', amount: BigInt(2) }).ok === false,
  )
  // Brand marks: the first-party `yeetful-tool-*` internal MCPs carry Yeetful's
  // own mark (rail + server pages), while `yeetful-claude` KEEPS its Anthropic
  // icon (resolved via ICON_SLUG, not a protocol mark). getProtocolMark is the
  // step-1 winner in BrandIcon, so this is what decides which glyph shows.
  check(
    'brand mark: yeetful-tool-* MCPs resolve to the Yeetful mark',
    getProtocolMark(undefined, 'yeetful-tool-wallet', 'yeetful-tool-wallet', 'Yeetful Wallet') === YeetfulMark &&
      getProtocolMark(undefined, 'yeetful-tool-funding', 'yeetful-tool-funding', 'Yeetful Funding Planner') === YeetfulMark,
  )
  check(
    'brand mark: yeetful-claude is NOT captured (keeps its Anthropic icon)',
    getProtocolMark('anthropic', 'yeetful-claude', 'yeetful-claude', 'Yeetful · Claude') === null,
  )
  // Seaport order math: fee splits sum exactly; the independent guard refuses
  // payouts outside offerer + published fee recipients.
  const osFees = [
    { fee: 1.0, recipient: '0x0000a26b00c1f0Df003000390027140000fAa719', required: true },
    { fee: 5.0, recipient: '0x4444444444444444444444444444444444444444', required: false },
  ]
  const oneEth = BigInt('1000000000000000000')
  const split = splitListingPrice(oneEth, osFees, false)
  check(
    'seaport split: required fee only, seller keeps the exact remainder',
    split.splits.length === 1 && split.sellerWei + split.splits[0].amountWei === oneEth && split.splits[0].amountWei === oneEth / BigInt(100),
  )
  const osOrder = buildListingComponents({
    offerer: nftMe, token: nftContract, identifier: '2489', standard: 'erc721', amount: '1',
    priceWei: oneEth, fees: osFees, requiredZone: null, counter: '0', startTime: 1_784_000_000, endTime: 1_784_600_000, salt: '12345',
  })
  const osExp = { offerer: nftMe, token: nftContract, identifier: '2489', priceWei: oneEth, feeRecipients: osFees.map((f) => f.recipient), requiredZone: null }
  const osTampered = JSON.parse(JSON.stringify(osOrder)) as typeof osOrder
  osTampered.consideration[1].recipient = nftYou
  const osWrongConduit = JSON.parse(JSON.stringify(osOrder)) as typeof osOrder
  osWrongConduit.conduitKey = `0x${'00'.repeat(32)}`
  check(
    'seaport guard: clean order passes, tampered recipient/conduit refuse',
    guardListingComponents(osOrder, osExp).ok === true &&
      guardListingComponents(osTampered, osExp).ok === false &&
      guardListingComponents(osWrongConduit, osExp).ok === false,
  )
  // Buy guard fails CLOSED: pinned Seaport target, fulfill* function only,
  // never above the quoted price or the user's cap, contract referenced.
  const fulfillOkay = { functionSig: 'fulfillBasicOrder_efficient_6GL6yc((address,uint256))', to: SEAPORT_1_6, valueWei: oneEth, inputData: { parameters: { considerationToken: nftContract } } }
  check(
    'nft buy guard: clean fulfillment passes, tampered target/price/function refuse',
    guardBuyFulfillment(fulfillOkay, { priceWei: oneEth, maxWei: null, contract: nftContract }).ok === true &&
      guardBuyFulfillment({ ...fulfillOkay, to: nftYou }, { priceWei: oneEth, maxWei: null, contract: nftContract }).ok === false &&
      guardBuyFulfillment({ ...fulfillOkay, functionSig: 'transferFrom(address,address,uint256)' }, { priceWei: oneEth, maxWei: null, contract: nftContract }).ok === false &&
      guardBuyFulfillment({ ...fulfillOkay, valueWei: oneEth * BigInt(2) }, { priceWei: oneEth, maxWei: null, contract: nftContract }).ok === false &&
      guardBuyFulfillment(fulfillOkay, { priceWei: oneEth, maxWei: oneEth / BigInt(2), contract: nftContract }).ok === false &&
      guardBuyFulfillment({ ...fulfillOkay, valueWei: BigInt(0) }, { priceWei: oneEth, maxWei: null, contract: nftContract }).ok === false &&
      guardBuyFulfillment(fulfillOkay, { priceWei: oneEth, maxWei: null, contract: nftMe }).ok === false,
  )
  // Fulfillment re-encode: named input objects → positional ABI values,
  // locally encoded (never forwarded opaque). Round-trips through viem.
  const reencoded = fulfillmentToCalldata('fulfillTest((address,uint256) item, address recipient)', {
    item: { token: nftContract, identifier: '2489' },
    recipient: nftYou,
  })
  const redecoded = decodeFunctionData({ abi: parseAbi(['function fulfillTest((address,uint256) item, address recipient)']), data: reencoded })
  check(
    'nft buy: fulfillment re-encodes locally and round-trips through viem',
    redecoded.functionName === 'fulfillTest' &&
      (redecoded.args[0] as unknown as [string, bigint])[1] === BigInt(2489) &&
      (redecoded.args[1] as string).toLowerCase() === nftYou.toLowerCase(),
    reencoded.slice(0, 40),
  )
  check(
    'nft buy: listing normalizer pins Seaport 1.6 + native ETH, slug candidates cover plural/singular',
    normalizeOpenseaListing({
      order_hash: `0x${'ab'.repeat(32)}`, chain: 'base', protocol_address: SEAPORT_1_6,
      price: { current: { currency: 'ETH', decimals: 18, value: '1000000000000000000' } },
      protocol_data: { parameters: { offer: [{ token: nftContract, identifierOrCriteria: '7' }] } },
    })?.priceWei === oneEth &&
      normalizeOpenseaListing({
        order_hash: `0x${'ab'.repeat(32)}`, chain: 'base', protocol_address: nftYou,
        price: { current: { currency: 'ETH', decimals: 18, value: '1' } },
        protocol_data: { parameters: { offer: [{ token: nftContract, identifierOrCriteria: '7' }] } },
      }) === null &&
      normalizeOpenseaListing({
        order_hash: `0x${'ab'.repeat(32)}`, chain: 'base', protocol_address: SEAPORT_1_6,
        price: { current: { currency: 'WETH', decimals: 18, value: '1' } },
        protocol_data: { parameters: { offer: [{ token: nftContract, identifierOrCriteria: '7' }] } },
      }) === null &&
      JSON.stringify(collectionSlugCandidates('Pudgy Penguins')) === JSON.stringify(['pudgy-penguins', 'pudgy-penguin', 'pudgypenguins', 'pudgypenguin']) &&
      JSON.stringify(collectionSlugCandidates('Milady')) === JSON.stringify(['milady', 'miladys']),
  )
  // Splash ⓘ links: every NFT row must resolve an OpenSea item page even when
  // the API response omitted opensea_url, and holding rows resolve explorer
  // token pages by the human chain label they carry — never for natives.
  check(
    'splash info links: openseaAssetUrl covers the three OpenSea chains, refuses the rest',
    openseaAssetUrl(1, nftContract, '2489') === `https://opensea.io/assets/ethereum/${nftContract}/2489` &&
      openseaAssetUrl(8453, nftContract, '1') === `https://opensea.io/assets/base/${nftContract}/1` &&
      openseaAssetUrl(42161, nftContract, '7') === `https://opensea.io/assets/arbitrum/${nftContract}/7` &&
      openseaAssetUrl(4663, nftContract, '1') === null &&
      openseaAssetUrl(1, 'not-an-address', '1') === null,
  )
  check(
    'splash info links: explorerTokenUrl maps labels/ids to token pages, nulls natives',
    explorerTokenUrl('Ethereum', nftContract) === `https://etherscan.io/token/${nftContract}` &&
      explorerTokenUrl('Base', nftContract) === `https://basescan.org/token/${nftContract}` &&
      explorerTokenUrl(42161, nftContract) === `https://arbiscan.io/token/${nftContract}` &&
      explorerTokenUrl('Robinhood Chain', nftContract) === `https://robinhoodchain.blockscout.com/token/${nftContract}` &&
      explorerTokenUrl('Ethereum', '0x0000000000000000000000000000000000000000') === null &&
      explorerTokenUrl('Solana', nftContract) === null,
  )
  // orderRequest meta round-trip carries the opensea approval prereq.
  const osMeta = orderRequestOf({
    orderRequest: {
      protocol: 'opensea', typedData: { domain: {}, primaryType: 'OrderComponents', types: {}, message: osOrder },
      submitUrl: '/api/opensea/submit', chainId: 1,
      prereqTx: { to: nftContract, data: '0x', value: '0', chainId: 1, action: 'approve-opensea' }, prereqTitle: 'Approve OpenSea',
    },
  })
  check('orderRequestOf: opensea order + prereqTx round-trip', !!osMeta && osMeta.protocol === 'opensea' && osMeta.prereqTx?.to === nftContract && osMeta.prereqTitle === 'Approve OpenSea')
  // Deterministic route paths: the native NFT layer claims the turn.
  const nftNoWallet = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'sell my Pudgy Penguin #2489 for 4.2 ETH', activeServers: [] }),
  }).then((r) => r.json())
  check('native nft: sell ask asks to connect (not the swap layer, not planner)', nftNoWallet.connectWallet === true, JSON.stringify(nftNoWallet).slice(0, 200))
  const nftRhHttp = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'sell my pudgy penguin #2489 nft on robinhood chain for 1 eth', activeServers: [] }),
  }).then((r) => r.json())
  check('native nft: robinhood-chain ask answered honestly (no build)', typeof nftRhHttp.reply === 'string' && /Ethereum, Base/i.test(nftRhHttp.reply), JSON.stringify(nftRhHttp).slice(0, 200))

  // Native swap tool: fires with NO service shortlisted (Nate 2026-07-02 —
  // swap building is Yeetful's own tool, not gated on CoW being active).
  // Deterministic paths only (clarify + connect-wallet); the live build is a
  // manual smoke (real CoW quote).
  const nativeClarify = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'swap USDC for WETH', activeServers: [], walletAddress: '0x1111111111111111111111111111111111111111' }),
  }).then((r) => r.json())
  check(
    'native swap: clarifies with zero services active (preset-amount chips since 2026-07-28)',
    typeof nativeClarify.reply === 'string' && /how much usdc/i.test(nativeClarify.reply) &&
      Array.isArray((nativeClarify.clarify as { options?: unknown[] } | undefined)?.options) && (nativeClarify.clarify as { options: unknown[] }).options.length >= 2,
    JSON.stringify(nativeClarify).slice(0, 200),
  )
  const nativeNoWallet = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'swap 2 USDC for WETH', activeServers: [] }),
  }).then((r) => r.json())
  check('native swap: asks to connect a wallet (not a Claude lecture)', typeof nativeNoWallet.reply === 'string' && /connect your wallet/i.test(nativeNoWallet.reply))
  // Spot guardian gate: claims BEFORE the HL guardian (whose loose coin slot
  // would read "spot" as a coin) and asks to connect — never a planner fall.
  const spotGate = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
    body: JSON.stringify({ message: 'Protect my spot ETH with a 10% stop loss', activeServers: [] }),
  }).then((r) => r.json())
  check(
    'spot guardian: gate claims the spot ask and asks to connect',
    typeof spotGate.reply === 'string' && /arm spot protection/i.test(spotGate.reply) && spotGate.buildPath === 'native-spot-guard',
    JSON.stringify(spotGate).slice(0, 160),
  )

  check('atoms: humanToAtoms whole + fraction', humanToAtoms('100', 6) === '100000000' && humanToAtoms('0.5', 18) === '500000000000000000')
  check('atoms: humanToAtoms refuses excess precision', humanToAtoms('0.1234567', 6) === null)
  check('atoms: humanToAtoms refuses zero + junk', humanToAtoms('0', 6) === null && humanToAtoms('1e5', 6) === null)

  // A4 — sign + submit (wallet path). Pure body builder + meta reader + the
  // submit route's REFUSAL paths (no signed order is ever placed from tests).
  const sig132 = '0x' + 'ab'.repeat(65)
  const submitBody = buildCowSubmitBody(cowFixture.order, sig132, cowFixture.from, COW_APP_DATA_JSON, 42)
  check(
    'cow submit: body carries signature, appData JSON + hash, quoteId',
    submitBody.signature === sig132 && submitBody.appData === COW_APP_DATA_JSON &&
      submitBody.appDataHash === cowFixture.order.appData && submitBody.quoteId === 42 &&
      submitBody.signingScheme === 'eip712' && submitBody.from === cowFixture.from,
  )
  const metaOrder = orderRequestOf({ orderRequest: { protocol: 'cow', typedData: { domain: {}, message: {} }, chainId: 8453, appDataJson: COW_APP_DATA_JSON, quoteId: 7 } })
  check('cow submit: orderRequestOf reads persisted meta', metaOrder?.protocol === 'cow' && metaOrder.quoteId === 7)
  check('cow submit: orderRequestOf rejects junk meta', orderRequestOf({ orderRequest: { typedData: {} } }) === null && orderRequestOf(null) === null)
  const metaTx = txRequestOf({ txRequest: { to: '0x2626664c2603336E57B271c5C0b26F421741e481', data: '0xdead', value: '0', chainId: 8453, action: 'swap' } })
  check('tx layer: txRequestOf reads a persisted evm-tx', metaTx?.to === '0x2626664c2603336E57B271c5C0b26F421741e481' && metaTx.action === 'swap' && metaTx.chainId === 8453)
  check('tx layer: txRequestOf rejects junk meta', txRequestOf({ txRequest: { to: 'not-an-address' } }) === null && txRequestOf({}) === null)
  const submitRes1 = await fetch(`${BASE}/api/cow/submit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order: cowFixture.order, signature: '0xshort', from: cowFixture.from }),
  })
  check('cow submit: rejects a malformed signature (400)', submitRes1.status === 400)
  const submitRes2 = await fetch(`${BASE}/api/cow/submit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      order: { ...cowFixture.order, receiver: '0x2222222222222222222222222222222222222222', validTo: Math.floor(Date.now() / 1000) + 1200 },
      signature: sig132, from: cowFixture.from,
    }),
  })
  check('cow submit: refuses an order paying someone else (403)', submitRes2.status === 403)
  const submitRes3 = await fetch(`${BASE}/api/cow/submit`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ order: { ...cowFixture.order, validTo: 1000 }, signature: sig132, from: cowFixture.from }),
  })
  check('cow submit: refuses an expired order (400)', submitRes3.status === 400)

  // The loop surfaces a tool-returned vote as a signable artifact (and stops).
  const artDec = await routeMessage({
    message: 'vote For on proposal X',
    catalog: [claudeSrv],
    endpoints: [{ id: 'ep-vote', serverSlug: 'snap', serverName: 'Snapshot', method: 'POST', url: 'https://snap.test/vote', description: 'prepare a vote', priceUsd: '0.01', parameters: [{ group: 'body', name: 'choice', required: true }] }],
    runInference: async () => ({ text: JSON.stringify({ intent: 'vote', needs: [], picks: [{ endpointId: 'ep-vote', params: { choice: 1 }, reason: 'prepare the vote', score: 0.9 }] }) }),
    executeCall: async () => ({ data: voteResult }),
  })
  check('router loop: a tool-returned vote becomes decision.artifact', artDec.artifact?.kind === 'eip712-vote')

  // B10 — retrieve→plan shortlist: narrow the catalog by relevance so the model
  // reliably picks. (Pure ranking, no DB/spend.)
  const shortlistCatalog: PlannableEndpoint[] = [
    { id: 'cmc-q', serverSlug: 'coinmarketcap', serverName: 'CoinMarketCap', method: 'GET', url: 'https://x/quotes/latest', description: 'Crypto spot price, value & quote by symbol — current price of ETH, BTC', priceUsd: '0.01', parameters: [{ group: 'query', name: 'symbol', required: true }] },
    { id: 'trip-s', serverSlug: 'tripadvisor', serverName: 'TripAdvisor', method: 'GET', url: 'https://t/search', description: 'Search hotels, restaurants and attractions', priceUsd: '0.01', parameters: [{ group: 'query', name: 'q', required: true }] },
    { id: 'wolf-c', serverSlug: 'wolfram', serverName: 'Wolfram', method: 'GET', url: 'https://w/compute', description: 'Compute math and science answers', priceUsd: '0.005', parameters: [{ group: 'query', name: 'input', required: true }] },
    { id: 'noise', serverSlug: 'misc', serverName: 'Misc', method: 'GET', url: 'https://m/list', description: 'List all teams', priceUsd: '0.01', parameters: [] },
  ]
  const priceShort = shortlistEndpoints('what is the current price of ETH', shortlistCatalog, 5)
  check('shortlist: price query ranks CoinMarketCap first', priceShort[0]?.serverSlug === 'coinmarketcap')
  const travelShort = shortlistEndpoints('find me hotels in Paris', shortlistCatalog, 5)
  check('shortlist: travel query ranks TripAdvisor first', travelShort[0]?.serverSlug === 'tripadvisor')
  check('shortlist: irrelevant question shortlists nothing', shortlistEndpoints('write me a haiku about clouds', shortlistCatalog, 5).length === 0)

  // Multi-select: the engine can call 2+ services in one turn, then ONE inference
  // synthesizes — driven by a scripted multi-pick (no DB/spend).
  const multiEndpoints: PlannableEndpoint[] = [
    { id: 'ep-price', serverSlug: 'cmc', serverName: 'CMC', method: 'GET', url: 'https://x/price', description: 'crypto price by symbol ETH BTC', priceUsd: '0.01', parameters: [{ group: 'query', name: 'symbol', required: true }] },
    { id: 'ep-news', serverSlug: 'news', serverName: 'News', method: 'GET', url: 'https://n/news', description: 'latest crypto news headlines for a token ETH', priceUsd: '0.01', parameters: [{ group: 'query', name: 'q', required: true }] },
  ]
  let mc = 0
  const multiScripts = [
    JSON.stringify({ intent: 'price + news for ETH', needs: [], picks: [
      { endpointId: 'ep-price', params: { symbol: 'ETH' }, reason: 'price', score: 0.9 },
      { endpointId: 'ep-news', params: { q: 'ETH' }, reason: 'news', score: 0.8 },
    ] }),
    JSON.stringify({ intent: '', needs: [], picks: [] }),
  ]
  const multiExec: string[] = []
  const multiDec = await routeMessage({
    message: 'price and news for ETH',
    catalog: [claudeSrv],
    endpoints: multiEndpoints,
    runInference: async () => ({ text: multiScripts[Math.min(mc++, 1)] }),
    executeCall: async (p: { serverSlug: string }) => { multiExec.push(p.serverSlug); return { data: { for: p.serverSlug } } },
  })
  check(
    'router: selects multiple services in one turn (2 data calls), always 1 inference',
    multiExec.length === 2 && multiDec.context.length === 2 && multiDec.picks.filter((p) => p.role === 'inference').length === 1,
  )

  // B11 — reputation rating (usage-driven) + one-provider-per-need.
  check('rating: higher success rate ranks higher', computeRating({ settled: 10, failed: 0, recent: true }) > computeRating({ settled: 10, failed: 10, recent: true }))
  check('rating: more volume ranks higher (same success)', computeRating({ settled: 20, failed: 0, recent: true }) > computeRating({ settled: 2, failed: 0, recent: true }))
  check('rating: recent ranks higher than stale', computeRating({ settled: 10, failed: 0, recent: true }) > computeRating({ settled: 10, failed: 0, recent: false }))
  check('rating: no history → 0 (cold start not penalized to negative)', computeRating({ settled: 0, failed: 0, recent: false }) === 0)

  const ratedA: PlannableEndpoint = { id: 'a', serverSlug: 'a', serverName: 'A', method: 'GET', url: 'https://a/price', description: 'crypto price by symbol', priceUsd: '0.01', parameters: [{ group: 'query', name: 'symbol', required: true }], reliability: { settled: 50, failed: 0, recent: true, successRate: 1, rating: computeRating({ settled: 50, failed: 0, recent: true }) } }
  const ratedB: PlannableEndpoint = { id: 'b', serverSlug: 'b', serverName: 'B', method: 'GET', url: 'https://b/price', description: 'crypto price by symbol', priceUsd: '0.01', parameters: [{ group: 'query', name: 'symbol', required: true }], reliability: { settled: 2, failed: 8, recent: false, successRate: 0.2, rating: computeRating({ settled: 2, failed: 8, recent: false }) } }
  const ratedShort = shortlistEndpoints('crypto price', [ratedB, ratedA], 5)
  check('shortlist: higher-rated equivalent ranks first', ratedShort[0]?.serverSlug === 'a')
  check(
    'router prompt: one-provider-per-need rule present',
    routerPrompt('x', routerEps).includes('NEVER call two services that return the SAME'),
  )

  // B12 — per-turn cost ceiling: a multi-pick turn can't overspend. Two $0.01
  // picks under a $0.015 ceiling → first runs, second is skipped + noted.
  let ceilExec = 0
  const ceilDec = await routeMessage({
    message: 'price and news for ETH',
    catalog: [claudeSrv],
    endpoints: multiEndpoints,
    maxTurnUsd: 0.015,
    runInference: async () => ({ text: JSON.stringify({ intent: 'x', needs: [], picks: [
      { endpointId: 'ep-price', params: { symbol: 'ETH' }, reason: 'p', score: 0.9 },
      { endpointId: 'ep-news', params: { q: 'ETH' }, reason: 'n', score: 0.8 },
    ] }) }),
    executeCall: async () => { ceilExec++; return { data: { ok: true } } },
  })
  check(
    'router: per-turn cost ceiling stops overspend (1 of 2 runs, rest noted)',
    ceilExec === 1 && ceilDec.context.length === 1 && ceilDec.notes.some((n) => /per-turn budget/.test(n)),
  )

  // B21 — same-capability dedup: two crypto-price picks → only one is paid.
  const dupEndpoints: PlannableEndpoint[] = [
    { id: 'cmc2', serverSlug: 'cmc', serverName: 'CMC', method: 'GET', url: 'https://cmc.test/q', description: 'crypto spot price by symbol', priceUsd: '0.01', parameters: [{ group: 'query', name: 'symbol', required: true }] },
    { id: 'cg2', serverSlug: 'cg', serverName: 'CoinGecko', method: 'GET', url: 'https://cg.test/p', description: 'crypto token price', priceUsd: '0.01', parameters: [{ group: 'query', name: 'symbol', required: true }] },
  ]
  const dupExec: string[] = []
  const dupDec = await routeMessage({
    message: 'price of ETH',
    catalog: [claudeSrv],
    endpoints: dupEndpoints,
    runInference: async () => ({ text: JSON.stringify({ intent: 'price', needs: [], picks: [
      { endpointId: 'cmc2', params: { symbol: 'ETH' }, reason: 'p', score: 0.9 },
      { endpointId: 'cg2', params: { symbol: 'ETH' }, reason: 'p2', score: 0.8 },
    ] }) }),
    executeCall: async (p: { serverSlug: string }) => { dupExec.push(p.serverSlug); return { data: {} } },
  })
  check(
    'router: same-capability picks deduped (one provider paid, rest noted)',
    dupExec.length === 1 && dupExec[0] === 'cmc' && dupDec.notes.some((n) => /same capability/.test(n)),
  )

  // B13 — response cache (pure; no DB/spend).
  clearRouteCache()
  check(
    'cache: key ignores query-param order',
    routeCacheKey({ method: 'GET', url: 'https://x/p?b=2&a=1' }) === routeCacheKey({ method: 'GET', url: 'https://x/p?a=1&b=2' }),
  )
  check('cache: GET cacheable, POST not', isCacheable({ method: 'GET' }) && !isCacheable({ method: 'POST' }))
  const ck = routeCacheKey({ method: 'GET', url: 'https://x/p?a=1' })
  setCached(ck, { v: 1 })
  check('cache: hit returns the stored value', (getCached(ck) as { v?: number } | undefined)?.v === 1)
  check('cache: miss returns undefined', getCached('GET https://nope/') === undefined)
  setCached('ttlkey', { v: 9 }, 100, 1_000) // expires at 1100
  check('cache: served within TTL', (getCached('ttlkey', 1_050) as { v?: number } | undefined)?.v === 9)
  check('cache: expired after TTL → miss', getCached('ttlkey', 1_200) === undefined)
  clearRouteCache()

  // B15 — value proof: savings vs naive routing (pure).
  const sv1 = routeSavings({ shortlistPrices: [0.01, 0.05, 0.02], pickPrices: [0.01], cacheSavedUsd: 0 })
  check('value: saved vs the priciest relevant tool (picked cheaper)', Math.abs(sv1.savedVsPriciestUsd - 0.04) < 1e-9 && Math.abs(sv1.totalUsd - 0.04) < 1e-9)
  const sv2 = routeSavings({ shortlistPrices: [0.01], pickPrices: [0.01], cacheSavedUsd: 0.01 })
  check('value: cache savings counted in the total', Math.abs(sv2.cacheSavedUsd - 0.01) < 1e-9 && Math.abs(sv2.totalUsd - 0.01) < 1e-9)
  check('value: no shortlist → no savings claimed', routeSavings({ shortlistPrices: [], pickPrices: [], cacheSavedUsd: 0 }).totalUsd === 0)

  // Display layer — portfolio card detection + meta narrowing (pure).
  const goodPortfolio = {
    kind: 'portfolio',
    owner: '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0',
    totalUsd: 7.45,
    chains: [{ chain: 'Base', usd: 6.91, holdings: 3 }],
    holdings: [{ symbol: 'USDC', chain: 'Base', balance: '4.86', priceUsd: 1, valueUsd: 4.86, address: '0x833589fcd6edb6e08f4c7c32d4f71b54bda02913' }],
    hiddenDust: 2,
    updatedAt: '2026-07-09T00:00:00.000Z',
  }
  const detected = portfolioFromToolResult(goodPortfolio)
  check('portfolio: wallet-MCP shape detected', detected !== null && detected.totalUsd === 7.45 && detected.holdings[0].symbol === 'USDC')
  check('portfolio: hiddenDust + chains survive', detected?.hiddenDust === 2 && detected?.chains[0].chain === 'Base')
  check('portfolio: non-portfolio tool results ignored', portfolioFromToolResult({ kind: 'activity', owner: '0x', holdings: [] }) === null && portfolioFromToolResult('a string result') === null)
  check('portfolio: malformed holdings rejected', portfolioFromToolResult({ ...goodPortfolio, holdings: [{ nope: true }] }) === null)
  check('portfolio: meta round-trip (portfolioOf reads what buildMeta stores)', portfolioOf({ portfolio: detected })?.owner === goodPortfolio.owner)
  check('portfolio: empty meta → null', portfolioOf({}) === null && portfolioOf(undefined) === null)

  // Cross-chain swap detection — the native Base-only venue layer must never
  // hijack these (they route to a cross-chain agent instead). Pure.
  check('cross-chain: "from base to arbitum" detected (live typo)', detectCrossChain('can I swap 1 USDC from base to arbitum').crossChain === true)
  check('cross-chain: chains named in order', JSON.stringify(detectCrossChain('swap 1 USDC from base to arbitrum').chains) === '["base","arbitrum"]')
  check('cross-chain: plain Base swap NOT flagged', detectCrossChain('swap 100 USDC for WETH').crossChain === false)
  check('cross-chain: "a ton of" is not the TON chain', detectCrossChain('swap a ton of USDC for WETH on base').crossChain === false)
  check('cross-chain: robinhood chain detected', detectCrossChain('swap 1 USDC from base to robinhood chain').crossChain === true && detectCrossChain('swap 1 USDC from base to robinhood chain').chains.includes('robinhood'))
  check('cross-chain: bridge verb + one chain counts', detectCrossChain('bridge 5 USDC to solana').crossChain === true)
  check('cross-chain: explicit phrase counts', detectCrossChain('do a cross-chain swap of 2 USDC').crossChain === true)

  // Cross-chain agent resolution — an add-MCP shell (endpoint:null, no tools)
  // must read as present-but-unusable, never routed at (live 2026-07-09: the
  // planner hallucinated 1inch/Across/Stargate venue chips for a shell row).
  const shellRow = { slug: 'near-intents-mcp-yeetful', name: 'NEAR Intents MCP · Yeetful', description: null, endpoint: null }
  const seededRow = { slug: 'near-intents-free', name: 'NEAR Intents (Free)', description: 'Cross-chain swaps…', endpoint: 'https://near-intents.yeetful.com/mcp' }
  check('cross-chain agent: shell row detected but NOT usable', (() => { const r = crossChainAgentOf([shellRow]); return r.agent === shellRow && r.usable === false })())
  check('cross-chain agent: seeded row usable', (() => { const r = crossChainAgentOf([seededRow]); return r.agent === seededRow && r.usable === true })())
  check('cross-chain agent: none in set', crossChainAgentOf([{ slug: 'uniswap-free', name: 'Uniswap (Free)', description: null, endpoint: 'https://uniswap-mcp.yeetful.com/mcp' }]).agent === undefined)

  // ── Chain registry + picker (lib/chains) ──────────────────────────────────
  // The registry is the single source of truth for the picker, splash scoping,
  // and per-chain swap builds — every entry must be complete enough to build.
  check('chains: registry carries base/ethereum/arbitrum/robinhood', JSON.stringify(APP_CHAINS.map((c) => c.key).sort()) === '["arbitrum","base","ethereum","robinhood"]')
  check('chains: every entry is build-complete (router+quoter, wrapped native, explorer, alchemy net)', APP_CHAINS.every((c) => !!c.uniswap?.swapRouter02 && !!c.uniswap?.quoterV2 && /^0x[0-9a-fA-F]{40}$/.test(c.wrappedNative) && c.explorerTx.startsWith('https://') && !!c.alchemyNet && c.viem.id === c.id))
  check('chains: base keeps the original router constants', chainById(8453)?.uniswap?.swapRouter02 === '0x2626664c2603336E57B271c5C0b26F421741e481' && chainById(8453)?.uniswap?.quoterV2 === '0x3d4e44Eb1374240CE5F1B871ab261CD16335B76a')
  check('chains: v4 fallback pinned ONLY on Robinhood (quoter + Universal Router + Permit2)', chainById(4663)?.uniswapV4?.quoter === '0x8dc178efb8111bb0973dd9d722ebeff267c98f94' && chainById(4663)?.uniswapV4?.universalRouter === '0x8876789976decbfcbbbe364623c63652db8c0904' && chainById(4663)?.uniswapV4?.permit2 === '0x000000000022d473030f116ddee9f6b43ac78ba3' && APP_CHAINS.every((c) => c.id === 4663 || c.uniswapV4 === null))
  check('chains: robinhood has no CoW, has USDG stable', chainById(4663)?.cow === false && Object.keys(chainById(4663)?.stables ?? {}).length >= 1 && !!chainById(4663)?.tokens.USDG)
  check('chains: sanitizeChainId only passes registry ids', sanitizeChainId(8453) === 8453 && sanitizeChainId(4663) === 4663 && sanitizeChainId(137) === null && sanitizeChainId('8453') === null && sanitizeChainId(null) === null)
  check('chains: chainNamedIn reads "on robinhood" + the arbitrum typo', chainNamedIn('swap 1 USDC for USDG on robinhood')?.id === 4663 && chainNamedIn('swap 1 usdc for weth on arbitum')?.id === 42161 && chainNamedIn('swap 1 usdc for weth') === null)
  check('chains: per-chain token maps resolve (USDC differs by chain; USDG robinhood-only)', resolveToken('USDC', 1) === '0xa0b86991c6218b36c1d19d4a2e9eb0ce3606eb48' && resolveToken('USDC', 42161) === '0xaf88d065e77c8cc2239327c5edb3a432268e5831' && resolveToken('USDG', 4663) === '0x5fc5360d0400a0fd4f2af552add042d716f1d168' && resolveToken('USDG', 8453) === null)
  check('chains: tokenDecimals is per-chain (USDG 6 on robinhood, unknown on base)', tokenDecimals('USDG', 4663) === 6 && tokenDecimals('USDG', 8453) === null && tokenDecimals('USDC', 1) === 6)
  check('chains: swapWorkingContext pins chainId on non-Base pendings only', (() => {
    const arb = swapWorkingContext({ isSwap: true, mode: 'swap', sellAmountHuman: '1', sellToken: 'USDC', buyToken: 'WETH' }, 'uniswap', undefined, 42161)
    const basePending = swapWorkingContext({ isSwap: true, mode: 'swap', sellAmountHuman: '1', sellToken: 'USDC', buyToken: 'WETH' }, 'cow', undefined, 8453)
    return arb.pending?.data.chainId === '42161' && basePending.pending?.data.chainId === undefined
  })())

  // ── HL guardian (pure guard + route auth) ────────────────────────────────
  console.log('— hl guardian')
  {
    // Arming into an existing policy: paused resumes (never the old
    // "already armed — pause it first" contradiction), live rows refuse
    // with copy that matches their actual state.
    const dupePaused = planForExistingPolicy('paused', 'stop_loss', 'SYRUP')
    const dupeActive = planForExistingPolicy('active', 'stop_loss', 'SYRUP')
    const dupeFiring = planForExistingPolicy('triggered', 'take_profit', 'ETH')
    check(
      'guardian: paused dupe RESUMES; active refuses as "armed and watching"; mid-fire names execution',
      dupePaused.action === 'resume' &&
        dupeActive.action === 'refuse' && /already armed and watching — pause or remove/.test(dupeActive.message) &&
        dupeFiring.action === 'refuse' && /take profit on ETH is executing right now/.test(dupeFiring.message),
    )
    const sl: GuardianPolicyParams = { coin: 'SYRUP', side: 'long', kind: 'stop_loss', triggerMode: 'price_move_pct', triggerValue: 10 }
    const pos: GuardianPosition = { coin: 'SYRUP', szi: 700, entryPx: 0.14175 }
    check(
      'guardian: stop-loss fires DOWN only (long 10% from entry)',
      !evaluatePolicy(sl, pos, 0.12876).fired && evaluatePolicy(sl, pos, 0.1275).fired && !evaluatePolicy(sl, pos, 0.15).fired,
    )
    check(
      'guardian: take-profit fires UP; short logic mirrors',
      evaluatePolicy({ ...sl, kind: 'take_profit', triggerValue: 25 }, pos, 0.1772).fired &&
        !evaluatePolicy({ ...sl, kind: 'take_profit', triggerValue: 25 }, pos, 0.177).fired &&
        evaluatePolicy({ ...sl, side: 'short' }, { ...pos, szi: -700 }, 0.156).fired &&
        !evaluatePolicy({ ...sl, side: 'short' }, { ...pos, szi: -700 }, 0.155).fired,
    )
    check(
      'guardian: absolute-price mode crosses in the right direction',
      evaluatePolicy({ ...sl, triggerMode: 'price', triggerValue: 0.12 }, pos, 0.119).fired &&
        !evaluatePolicy({ ...sl, triggerMode: 'price', triggerValue: 0.12 }, pos, 0.121).fired,
    )
    check('guardian: px/sz formatting (5 sig figs, szDecimals, floor)', formatPx(0.12811499, 0) === '0.12811' && formatPx(123456, 0) === '123460' && formatSz(1234.5678, 2) === '1234.56' && formatSz(700, 0) === '700')

    const mark = 0.1275
    const action = buildGuardianClose(sl, pos, 42, mark, 0)
    const ctx = { delegationStatus: 'active', delegationExpiresAt: new Date(Date.now() + 86_400_000), killSwitchPaused: false, policyFlipWon: true, markPx: mark, assetIndex: 42, szDecimals: 0 }
    const good = guardGuardianClose(sl, pos, action, ctx)
    check('guardian: built close passes the guard (reduce-only IOC sell, sized to position)', good.ok && action.orders[0].r === true && action.orders[0].b === false && action.orders[0].s === '700' && Math.abs((good.valueUsd ?? 0) - 700 * mark) < 0.01, JSON.stringify(good.checks.filter((c) => !c.ok)))
    const tampered = (patch: Partial<typeof action.orders[0]>) => guardGuardianClose(sl, pos, { orders: [{ ...action.orders[0], ...patch }], grouping: 'na' }, ctx)
    check(
      'guardian: guard fails CLOSED on any tamper (not-reduce-only / wrong asset / oversize / wrong side / stray price)',
      !tampered({ r: false }).ok && !tampered({ a: 7 }).ok && !tampered({ s: '701' }).ok && !tampered({ b: true }).ok && !tampered({ p: formatPx(mark * 0.97, 0) }).ok,
    )
    check(
      'guardian: guard refuses without delegation / with kill switch / on a lost flip / when the trigger is no longer true',
      !guardGuardianClose(sl, pos, action, { ...ctx, delegationStatus: 'revoked' }).ok &&
        !guardGuardianClose(sl, pos, action, { ...ctx, killSwitchPaused: true }).ok &&
        !guardGuardianClose(sl, pos, action, { ...ctx, policyFlipWon: false }).ok &&
        !guardGuardianClose(sl, pos, action, { ...ctx, markPx: 0.15 }).ok,
    )

    const artifacts = approveAgentArtifacts({ agentAddress: '0x' + 'ab'.repeat(20), nonce: 1752440000000, validUntil: 1760216000000, signatureChainId: 8453, isTestnet: false })
    check(
      'guardian: approveAgent typed data + action derive from ONE builder (chain hex, valid_until name, Mainnet)',
      artifacts.typedData.primaryType === 'HyperliquidTransaction:ApproveAgent' &&
        artifacts.action.signatureChainId === '0x2105' &&
        String(artifacts.action.agentName).includes('valid_until 1760216000000') &&
        artifacts.action.hyperliquidChain === 'Mainnet' &&
        (artifacts.typedData.message as { nonce: number }).nonce === 1752440000000,
    )
    const sig = `0x${'11'.repeat(32)}${'22'.repeat(32)}1c`
    const split = splitSignature(sig)
    check('guardian: signature splits to r/s/v (v normalized to 27/28)', split.r === `0x${'11'.repeat(32)}` && split.s === `0x${'22'.repeat(32)}` && split.v === 28)

    // Route surface: auth gates + validation (no delegation is created here —
    // the signing flow needs a human wallet; the cron sweep is covered by the
    // pure checks above plus the secret gate below).
    const anonState = await fetch(`${BASE}/api/guardian`)
    check('guardian: state read without session → 401', anonState.status === 401)
    const stateRes = await fetch(`${BASE}/api/guardian`, { headers: C })
    const stateBody = await stateRes.json()
    check('guardian: fresh wallet state is empty', stateRes.status === 200 && stateBody.delegation === null && Array.isArray(stateBody.policies) && stateBody.policies.length === 0)
    const noDelegation = await fetch(`${BASE}/api/guardian/policies`, { method: 'POST', headers: CJ, body: JSON.stringify({ coin: 'SYRUP', kind: 'stop_loss', triggerMode: 'price_move_pct', triggerValue: 10 }) })
    check('guardian: arming without a delegation → 409', noDelegation.status === 409)
    // The rail's lean list (jobs-tab Protections section reads this).
    const listAnon = await fetch(`${BASE}/api/guardian/policies`)
    check('guardian: policy list without session → 401', listAnon.status === 401)
    const listRes = await fetch(`${BASE}/api/guardian/policies`, { headers: C })
    const listBody = await listRes.json()
    check('guardian: fresh wallet policy list is empty', listRes.status === 200 && Array.isArray(listBody.policies) && listBody.policies.length === 0)
    const badDelegation = await fetch(`${BASE}/api/guardian/delegation`, { method: 'POST', headers: CJ, body: JSON.stringify({}) })
    check('guardian: delegation without signatureChainId → 400', badDelegation.status === 400)
    const cronAnon = await fetch(`${BASE}/api/cron/hl-guardian`)
    const cronWrong = await fetch(`${BASE}/api/cron/hl-guardian`, { headers: { authorization: 'Bearer wrong' } })
    check('guardian: cron refuses without/with wrong secret', cronAnon.status === 401 && cronWrong.status === 401)
    if (process.env.CRON_SECRET) {
      const cronOk = await fetch(`${BASE}/api/cron/hl-guardian`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })
      const summary = await cronOk.json()
      check('guardian: authorized sweep runs and reports', cronOk.status === 200 && typeof summary.checked === 'number', JSON.stringify(summary))
    } else {
      console.log('  ⚪ guardian: CRON_SECRET not in harness env — live sweep check skipped')
    }
  }

  // ── Multi-step jobs (compiler + runner auth) ──────────────────────────────
  console.log('— jobs')
  {
    const compiled = compileJobAsk(
      'swap 25 usdc from base to arbitrum, then deposit 24 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop',
    )
    check(
      'jobs: canonical 4-segment ask compiles to 6 steps (sign/wait pairs + order + auto arm)',
      !!compiled && !('problem' in compiled) && compiled.steps.length === 6 &&
        JSON.stringify(compiled.steps.map((s) => s.kind)) === JSON.stringify(['sign', 'wait', 'sign', 'wait', 'sign', 'auto']) &&
        compiled.steps[0].builder === 'native-cross-chain' && compiled.steps[2].builder === 'native-hl-exec' && compiled.steps[5].builder === 'native-hl-guardian' &&
        (compiled.steps[1].waitPredicate as { kind?: string }).kind === 'oneclick' && (compiled.steps[3].waitPredicate as { kind?: string }).kind === 'hl-credit',
      compiled && !('problem' in compiled) ? compiled.steps.map((s) => `${s.kind}:${s.builder}`).join(',') : JSON.stringify(compiled),
    )
    check(
      'jobs: single asks and non-job compounds stay with the native layers (null)',
      compileJobAsk('swap 1 usdc for eth') === null && compileJobAsk('tell me a joke then sing a song') === null && compileJobAsk('what is hyperliquid?') === null,
    )
    const partial = compileJobAsk('deposit 20 usdc to hyperliquid then tell me a joke')
    check('jobs: a compiled-then-unparseable segment refuses HONESTLY (problem, not a guess)', !!partial && 'problem' in partial && /step 2/i.test(partial.problem))
    check(
      'jobs: refusal copy lists itself from the segment registry (never stale)',
      !!partial && 'problem' in partial && partial.problem.includes('token sends') && partial.problem.includes('NFT buys/transfers/listings') && partial.problem.includes('guardian protection'),
      partial && 'problem' in partial ? partial.problem : '',
    )
    check(
      'jobs: registry entries all carry an id + parse (the extension contract)',
      JOB_SEGMENT_PARSERS.length >= 11 && JOB_SEGMENT_PARSERS.every((p) => !!p.id && typeof p.parse === 'function'),
    )

    // ── Compound-ask precedence (the 2026-07-28 incident): a multi-clause
    // ask whose clauses each match a single-venue parser must compile as ONE
    // job — parseAaveSupply once matched "…then supply 840 USDC to aave"
    // inside a compound message and answered the add-Aave door, dropping the
    // other three steps. The jobs gate now runs before both Aave gates.
    const compoundAave = compileJobAsk(
      'Swap 0.10583 ETH from Base to ETH on Ethereum, then Swap 175.73 USDC from Base to USDC on Ethereum, then supply 840.42 USDC to aave, then stake 0.55214 eth on lido',
    )
    check(
      'jobs: the aave+lido compound compiles to 6 steps (bridges + waits + supply + stake)',
      !!compoundAave && !('problem' in compoundAave) && compoundAave.steps.length === 6 &&
        compoundAave.steps[4].builder === 'native-aave-supply' && compoundAave.steps[5].builder === 'native-lido',
      compoundAave && !('problem' in compoundAave) ? compoundAave.steps.map((s) => `${s.kind}:${s.builder}`).join(',') : JSON.stringify(compoundAave),
    )
    const compoundLive = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ message: 'Swap 0.1 ETH from Base to ETH on Ethereum, then supply 5 USDC to aave, then stake 0.01 eth on lido', activeServers: [] }),
    }).then((r) => r.json())
    check(
      'jobs ladder: a compound ask reaches the jobs gate BEFORE the Aave door steals it',
      typeof compoundLive.reply === 'string' && /chains multiple money steps/i.test(compoundLive.reply) && !/needs the \*\*Aave\*\*|Add Aave with this ask ready/.test(compoundLive.reply),
      JSON.stringify(compoundLive).slice(0, 220),
    )
    const aaveDoor = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ message: 'supply 20 USDC to aave', activeServers: [] }),
    }).then((r) => r.json())
    check(
      'aave door: a lone supply without the agent deep-links the add with the ask ready',
      typeof aaveDoor.reply === 'string' && aaveDoor.reply.includes('Add Aave with this ask ready](/chat?mcps=aave-free&prompt='),
      JSON.stringify(aaveDoor).slice(0, 220),
    )

    // ── Transfer segments (the "swap … then send …" chaining ask) ──────────
    const sendTo = '0x6F93fa8B383E51D59DDfC87988AFC964d6ffb5Da'
    const tSeg = parseTransferSegment(`send the 1 USDC on arbitrum to ${sendTo}`)
    check(
      'transfer parse: "send the 1 USDC on arbitrum to 0x…" → amount/token/chain/recipient',
      !!tSeg && !('problem' in tSeg) && tSeg.amountHuman === '1' && tSeg.token === 'USDC' && tSeg.chainId === 42161 && tSeg.to === sendTo,
      JSON.stringify(tSeg),
    )
    const tTail = parseTransferSegment(`transfer 0.5 ETH to ${sendTo} on base`)
    check('transfer parse: chain-after-recipient variant + native ETH', !!tTail && !('problem' in tTail) && tTail.chainId === 8453 && tTail.token === 'ETH')
    const tEns = parseTransferSegment('send 2 USDC on base to nate.eth')
    check('transfer parse: ENS recipient accepted', !!tEns && !('problem' in tEns) && tEns.to === 'nate.eth')
    const tNoChain = parseTransferSegment(`send 1 USDC to ${sendTo}`)
    check('transfer parse: missing chain word → honest problem (never guess the chain)', !!tNoChain && 'problem' in tNoChain && /chain/i.test(tNoChain.problem))
    check(
      'transfer parse: NFT sends, HL deposits, and non-sends stay out',
      parseTransferSegment(`send my Pudgy Penguin #2489 to ${sendTo}`) === null &&
        parseTransferSegment('deposit 20 usdc to hyperliquid') === null &&
        parseTransferSegment('swap 1 usdc for eth on base') === null,
    )

    // ── Multi-clause sends + all-sizing (the 2026-07-23 two-chain ask) ────
    const multiTo = '0x2055Fa9E99565181A8509B81cBD0aa3D73be8d56'
    const multiAsk = `I want to send all my USDC on arbitrum and an additional 5 USDC on base to ${multiTo}`
    const multi = parseMultiSendSegments(multiAsk)
    check(
      'multi-send parse: "all my USDC on arbitrum and an additional 5 USDC on base to 0x…" → two clauses, shared recipient',
      Array.isArray(multi) && multi.length === 2 &&
        multi[0].amountHuman === 'all' && multi[0].chainId === 42161 &&
        multi[1].amountHuman === '5' && multi[1].chainId === 8453 &&
        multi.every((t) => t.to === multiTo && t.token === 'USDC'),
      JSON.stringify(multi),
    )
    const multiJob = compileJobAsk(multiAsk)
    check(
      'jobs: a multi-clause send compiles as ONE job — two native-transfer sign steps, no "then" needed',
      !!multiJob && !('problem' in multiJob) &&
        JSON.stringify(multiJob.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-transfer', 'sign:native-transfer']) &&
        (multiJob.steps[0].params as { chainId?: number }).chainId === 42161 && (multiJob.steps[1].params as { chainId?: number }).chainId === 8453,
      JSON.stringify(multiJob),
    )
    const multiNoChain = parseMultiSendSegments(`send all my USDC and 5 USDC on base to ${multiTo}`)
    check(
      'multi-send parse: a chainless clause refuses honestly (each part names its own chain)',
      !!multiNoChain && 'problem' in multiNoChain && /chain/i.test(multiNoChain.problem),
      JSON.stringify(multiNoChain),
    )
    check(
      'multi-send parse: single sends and non-sends stay out (null)',
      parseMultiSendSegments(`send 1 USDC on base to ${multiTo}`) === null && parseMultiSendSegments('swap 1 usdc for eth on base') === null,
    )
    const allSingle = parseTransferSegment(`send all my USDC on base to ${multiTo}`)
    check(
      "transfer parse: \"all my USDC\" → the 'all' sentinel (sized from the live balance at build time)",
      !!allSingle && !('problem' in allSingle) && allSingle.amountHuman === 'all' && allSingle.chainId === 8453,
      JSON.stringify(allSingle),
    )
    const entire = parseTransferSegment(`transfer my entire USDC balance on arbitrum to ${multiTo}`)
    check('transfer parse: "my entire USDC balance" reads as an all-send', !!entire && !('problem' in entire) && entire.amountHuman === 'all' && entire.chainId === 42161)
    const allTypo = parseMultiSendSegments(`send all my USDC on Aribtrum and 5 USDC on base to ${multiTo}`)
    check('multi-send parse: chain typos canonicalize per clause (shared lexicon)', Array.isArray(allTypo) && allTypo[0].chainId === 42161, JSON.stringify(allTypo))
    const chainThenSend = compileJobAsk(`can you swap 1 USDC from base to Arbitrum then send the 1 USDC on arbitrum to ${sendTo}`)
    check(
      'jobs: bridge-then-send compiles (the screenshot ask) — cross-chain + wait + native-transfer',
      !!chainThenSend && !('problem' in chainThenSend) &&
        JSON.stringify(chainThenSend.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-transfer']),
      chainThenSend && !('problem' in chainThenSend) ? chainThenSend.steps.map((s) => `${s.kind}:${s.builder}`).join(',') : JSON.stringify(chainThenSend),
    )
    const bridgeSwapStake = compileJobAsk('swap 20 USDC from base to ethereum, then swap 10 USDC for WETH on ethereum, then stake 0.002 eth on lido')
    check(
      'jobs: bridge → swap → lido stake chains end to end',
      !!bridgeSwapStake && !('problem' in bridgeSwapStake) &&
        JSON.stringify(bridgeSwapStake.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-swap', 'sign:native-lido']),
      bridgeSwapStake && !('problem' in bridgeSwapStake) ? bridgeSwapStake.steps.map((s) => `${s.kind}:${s.builder}`).join(',') : JSON.stringify(bridgeSwapStake),
    )
    // Wait predicates rebase onto ABSOLUTE step indices whatever the entry's
    // position — a send BEFORE the bridge must not corrupt the oneclick pointer.
    const sendThenBridge = compileJobAsk(`send 1 USDC on base to ${sendTo}, then swap 5 USDC from base to arbitrum`)
    check(
      'jobs: wait predicates rebase when the entry is not first',
      !!sendThenBridge && !('problem' in sendThenBridge) &&
        (sendThenBridge.steps[2].waitPredicate as { fromStep?: number }).fromStep === 1,
      sendThenBridge && !('problem' in sendThenBridge) ? JSON.stringify(sendThenBridge.steps.map((s) => s.waitPredicate ?? null)) : JSON.stringify(sendThenBridge),
    )
    const nftChain = compileJobAsk(`send my Pudgy Penguin #2489 nft to ${sendTo}, then swap 20 USDC for WETH on Arbitrum`)
    check(
      'jobs: NFT transfer chains as a native-nft-transfer step',
      !!nftChain && !('problem' in nftChain) &&
        JSON.stringify(nftChain.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-nft-transfer', 'sign:native-swap']),
      nftChain && !('problem' in nftChain) ? nftChain.steps.map((s) => `${s.kind}:${s.builder}`).join(',') : JSON.stringify(nftChain),
    )
    const nftListChain = compileJobAsk('list my Pudgy Penguin #2489 nft for 4.2 eth, then send 1 USDC on base to nate.eth')
    check(
      'jobs: NFT listing chains as a native-nft-list step (Seaport EIP-712 artifact)',
      !!nftListChain && !('problem' in nftListChain) &&
        nftListChain.steps[0].builder === 'native-nft-list' && nftListChain.steps[1].builder === 'native-transfer',
      nftListChain && !('problem' in nftListChain) ? nftListChain.steps.map((s) => `${s.kind}:${s.builder}`).join(',') : JSON.stringify(nftListChain),
    )
    // Buy → own-wait → pronoun send: THE registry ask this entry exists for.
    const nftBuyChain = compileJobAsk(`buy pudgy penguin #2489 then send it to ${sendTo}`)
    check(
      'jobs: "buy X then send it to Y" compiles — buy + nft-owned wait + nft-transfer',
      !!nftBuyChain && !('problem' in nftBuyChain) &&
        JSON.stringify(nftBuyChain.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-nft-buy', 'wait:wait', 'sign:native-nft-transfer']) &&
        (nftBuyChain.steps[1].waitPredicate as { kind?: string; fromStep?: number }).kind === 'nft-owned' &&
        (nftBuyChain.steps[1].waitPredicate as { fromStep?: number }).fromStep === 0,
      nftBuyChain && !('problem' in nftBuyChain) ? JSON.stringify(nftBuyChain.steps.map((s) => [s.builder, s.waitPredicate ?? null])) : JSON.stringify(nftBuyChain),
    )
    check(
      'jobs: the pronoun send inherits the bought NFT (ref + #id) and pins the recipient',
      !!nftBuyChain && !('problem' in nftBuyChain) &&
        (nftBuyChain.steps[2].params as { ref?: string; tokenId?: string; to?: string; kind?: string }).kind === 'transfer' &&
        /pudgy penguin/i.test(String((nftBuyChain.steps[2].params as { ref?: string }).ref)) &&
        (nftBuyChain.steps[2].params as { tokenId?: string }).tokenId === '2489' &&
        (nftBuyChain.steps[2].params as { to?: string }).to === sendTo,
      nftBuyChain && !('problem' in nftBuyChain) ? JSON.stringify(nftBuyChain.steps[2].params) : JSON.stringify(nftBuyChain),
    )
    // A buy followed by an explicit TOKEN send must not be stolen by the
    // pronoun grammar — the fungible transfer entry still owns it.
    const nftBuyTokenSend = compileJobAsk(`buy milady #77 nft then send 1 USDC on base to ${sendTo}`)
    check(
      'jobs: buy + explicit token send keeps the fungible transfer entry',
      !!nftBuyTokenSend && !('problem' in nftBuyTokenSend) &&
        JSON.stringify(nftBuyTokenSend.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-nft-buy', 'wait:wait', 'sign:native-transfer']),
      nftBuyTokenSend && !('problem' in nftBuyTokenSend) ? nftBuyTokenSend.steps.map((s) => `${s.kind}:${s.builder}`).join(',') : JSON.stringify(nftBuyTokenSend),
    )
    // Without prior NFT context a pronoun send never compiles — nothing to
    // resolve "it" against, so the whole ask falls back to the native layers.
    check(
      'jobs: "send it to 0x…" without a prior NFT segment never compiles',
      compileJobAsk(`send it to ${sendTo}, then swap 20 USDC for WETH on Arbitrum`) === null,
    )
    // The buy's own wait rebases when the entry is not first.
    const swapThenBuy = compileJobAsk(`swap 5 USDC for WETH on base then buy milady #77 nft`)
    check(
      'jobs: nft-owned wait rebases onto absolute indices when the buy is not first',
      !!swapThenBuy && !('problem' in swapThenBuy) &&
        JSON.stringify(swapThenBuy.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-swap', 'sign:native-nft-buy', 'wait:wait']) &&
        (swapThenBuy.steps[2].waitPredicate as { fromStep?: number }).fromStep === 1,
      swapThenBuy && !('problem' in swapThenBuy) ? JSON.stringify(swapThenBuy.steps.map((s) => s.waitPredicate ?? null)) : JSON.stringify(swapThenBuy),
    )
    const sendNoChainJob = compileJobAsk(`swap 5 USDC for WETH on base then send 1 USDC to ${sendTo}`)
    check(
      'jobs: a send segment without a chain word refuses honestly (Step 2 problem)',
      !!sendNoChainJob && 'problem' in sendNoChainJob && /Step 2/.test(sendNoChainJob.problem) && /chain/i.test(sendNoChainJob.problem),
      sendNoChainJob ? JSON.stringify(sendNoChainJob) : 'null',
    )
    // Chip round-trips: the EXACT strings the splash action chips send must
    // parse under their native layers — a chip that routes to the planner is
    // a suggested prompt in disguise (the thing these replaced).
    check(
      'chips: splash action-chip strings round-trip through the native parsers',
      parseGuardianArm('Protect my SYRUP long with a 10% stop loss')?.coin === 'SYRUP' &&
        parseHlIntent('Close my ETH long on Hyperliquid')?.kind === 'close' &&
        parseHlIntent('Deposit 10 USDC to Hyperliquid')?.kind === 'deposit' &&
        parseHlIntent('Long $12 of ETH on Hyperliquid')?.kind === 'open' &&
        parseSwapIntent('Swap 33 USDC for ETH on Base').isSwap &&
        parseSwapIntent('Swap 0.0032 ETH for USDC on Base').isSwap &&
        (() => {
          const job = compileJobAsk('Deposit 12 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop')
          return !!job && !('problem' in job) && job.steps.length === 4
        })() &&
        !!parseAaveOp('Repay all my USDC on Aave') &&
        !!parseAaveOp('Withdraw all my USDC from Aave') &&
        !!parseAaveSupply('Supply 10 USDC to Aave on Ethereum'),
    )

    // ── HL explicit leverage (the 2X landing ask) ──────────────────────────
    // Never decorative: an ask that names leverage either parses it into the
    // intent (→ guarded updateLeverage pre-step) or the guard refuses.
    const lev2 = parseHlIntent('I want a 2X Long $12 of HYPE on Hyperliquid') as HlOrderIntent
    const levTrail = parseHlIntent('long $12 of hype on hyperliquid with 3x leverage') as HlOrderIntent
    const levAt = parseHlIntent('short $50 of btc on hl at 5x') as HlOrderIntent
    const levNone = parseHlIntent('Long $12 of HYPE on Hyperliquid') as HlOrderIntent
    check(
      'hl leverage: leading "2X Long", trailing "with 3x leverage" and "at 5x" all parse; leverage-less asks stay clean',
      lev2?.kind === 'open' && lev2.leverage === 2 && lev2.notionalUsd === 12 && lev2.coin === 'HYPE' &&
        levTrail?.leverage === 3 && levAt?.leverage === 5 && levAt.isBuy === false &&
        levNone?.kind === 'open' && levNone.leverage === undefined,
      JSON.stringify({ lev2, levTrail, levAt }),
    )
    const levSnap = { assetIndex: 7, szDecimals: 2, markPx: 40, positionSzi: 0, maxLeverage: 3, accountLeverage: null }
    const levAction = buildHlLeverageAction(lev2, levSnap)
    check(
      'hl leverage: the updateLeverage action pins asset + cross + the asked multiple, and guards green in range',
      levAction.type === 'updateLeverage' && levAction.asset === 7 && levAction.isCross === true && levAction.leverage === 2 &&
        guardHlLeverageBuild(lev2, levAction, { assetIndex: 7, maxLeverage: 3 }).ok,
    )
    check(
      'hl leverage: guard fails closed — over the venue max, non-integer, and asset drift all block',
      !guardHlLeverageBuild(lev2, { ...levAction, leverage: 4 }, { assetIndex: 7, maxLeverage: 3 }).ok &&
        !guardHlLeverageBuild({ ...lev2, leverage: 2.5 }, { ...levAction, leverage: 2.5 }, { assetIndex: 7, maxLeverage: 3 }).ok &&
        !guardHlLeverageBuild(lev2, levAction, { assetIndex: 9, maxLeverage: 3 }).ok,
    )
    // The typed data derives from the leverage action exactly like an order's
    // (same phantom-agent domain) — the relay recovers the signer from it.
    const levTd = hlActionTypedData(levAction, 1234567890)
    check(
      'hl leverage: typed data is the phantom-agent payload over the leverage action',
      (levTd.domain as { name?: string }).name === 'Exchange' && levTd.primaryType === 'Agent' && typeof (levTd.message as { connectionId?: string }).connectionId === 'string',
    )

    const jobsAnon = await fetch(`${BASE}/api/jobs/nonexistent`)
    const jobsCronAnon = await fetch(`${BASE}/api/cron/jobs`)
    check('jobs: job read unauth → 401; cron unauth → 401', jobsAnon.status === 401 && jobsCronAnon.status === 401)
    if (process.env.CRON_SECRET) {
      const cronOk = await fetch(`${BASE}/api/cron/jobs`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}` } })
      const body = await cronOk.json()
      check('jobs: authorized runner tick reports', cronOk.status === 200 && typeof body.touched === 'number', JSON.stringify(body))
    }

    // ── Jobs API: the external-agent door (POST /api/jobs + dryRun) ────────
    const jobsPostAnon = await fetch(`${BASE}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ ask: 'x', dryRun: true }) })
    const jobsListAnon = await fetch(`${BASE}/api/jobs`)
    check('jobs api: POST and GET unauth → 401', jobsPostAnon.status === 401 && jobsListAnon.status === 401)

    const jobsNoAsk = await fetch(`${BASE}/api/jobs`, { method: 'POST', headers: CJ, body: '{}' })
    check('jobs api: missing ask → 400', jobsNoAsk.status === 400)

    const notCompound = await fetch(`${BASE}/api/jobs`, { method: 'POST', headers: CJ, body: JSON.stringify({ ask: 'swap 1 usdc for eth', dryRun: true }) })
    const notCompoundBody = await notCompound.json()
    check('jobs api: non-compound ask → 400 with "then" guidance', notCompound.status === 400 && /compound/i.test(notCompoundBody.error ?? ''))

    const problemAsk = await fetch(`${BASE}/api/jobs`, { method: 'POST', headers: CJ, body: JSON.stringify({ ask: 'deposit 20 usdc to hyperliquid then tell me a joke', dryRun: true }) })
    const problemBody = await problemAsk.json()
    check('jobs api: unparseable segment → 400 problem passthrough (honest refusal)', problemAsk.status === 400 && /step 2/i.test(problemBody.error ?? ''))

    const jobsBefore = await (await fetch(`${BASE}/api/jobs`, { headers: C })).json()
    const CANON_ASK = 'deposit 12 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop'
    const dry = await fetch(`${BASE}/api/jobs`, { method: 'POST', headers: CJ, body: JSON.stringify({ ask: CANON_ASK, dryRun: true }) })
    const dryBody = await dry.json()
    check(
      'jobs api: dryRun compiles the canonical ask — full plan + step-1 live build (artifact or honest refusal) + note',
      dry.status === 200 && dryBody.dryRun === true && Array.isArray(dryBody.steps) && dryBody.steps.length === 4 &&
        dryBody.steps[0].builder === 'native-hl-exec' && dryBody.steps[3].kind === 'auto' &&
        dryBody.firstSignPreview?.step === 0 && ('artifact' in dryBody.firstSignPreview || 'refused' in dryBody.firstSignPreview) &&
        /nothing was created/i.test(dryBody.note ?? ''),
      JSON.stringify({ status: dry.status, title: dryBody.title, preview: Object.keys(dryBody.firstSignPreview ?? {}) }),
    )
    const jobsAfter = await (await fetch(`${BASE}/api/jobs`, { headers: C })).json()
    check(
      'jobs api: dryRun created NOTHING (job list unchanged)',
      Array.isArray(jobsAfter.jobs) && jobsAfter.jobs.length === (jobsBefore.jobs?.length ?? -1),
    )

    // Bearer parity: a yf_ key walks through the same door with the same
    // view. Mint fresh — the harness revoked the first key back in the
    // key-lifecycle section.
    const jobsKey = await (await fetch(`${BASE}/api/keys`, { method: 'POST', headers: CJ, body: JSON.stringify({ label: 'test:api jobs' }) })).json()
    const JB = { authorization: `Bearer ${jobsKey.secret}` }
    const dryBearer = await fetch(`${BASE}/api/jobs`, { method: 'POST', headers: { 'content-type': 'application/json', ...JB }, body: JSON.stringify({ ask: CANON_ASK, dryRun: true }) })
    const dryBearerBody = await dryBearer.json()
    check(
      'jobs api: Bearer yf_ dryRun parity (same compile, same shape)',
      dryBearer.status === 200 && dryBearerBody.dryRun === true && dryBearerBody.title === dryBody.title && dryBearerBody.steps?.length === 4,
    )
    const listBearer = await fetch(`${BASE}/api/jobs`, { headers: JB })
    const listBearerBody = await listBearer.json()
    check(
      'jobs api: Bearer GET /api/jobs parity (same list as the SIWE session)',
      listBearer.status === 200 && Array.isArray(listBearerBody.jobs) && listBearerBody.jobs.length === jobsAfter.jobs.length,
    )
    await fetch(`${BASE}/api/keys/${jobsKey.id}`, { method: 'DELETE', headers: C }) // leave the cleanup sweep nothing to find

    // ── Job capability tokens (the embed JobCard's session-less auth) ──────
    // The harness signs with the SAME SESSION_SECRET the server uses (read
    // fail-soft from .env.local when not in the env), so a valid token for a
    // NONEXISTENT id must get past the 401 gate and 404 on the lookup — the
    // whole path proven without creating a single row.
    const sessionSecret =
      process.env.SESSION_SECRET ??
      (await import('node:fs')
        .then((fs) => fs.readFileSync('.env.local', 'utf8').match(/^SESSION_SECRET=(.+)$/m)?.[1]?.trim())
        .catch(() => undefined))
    if (sessionSecret) {
      process.env.SESSION_SECRET = sessionSecret
      const tok = signJobToken('job-token-probe')
      check(
        'job token: HMAC round-trip verifies; wrong id and garbage refuse',
        verifyJobToken('job-token-probe', tok) && !verifyJobToken('another-id', tok) && !verifyJobToken('job-token-probe', 'f'.repeat(64)) && !verifyJobToken('job-token-probe', 'nope'),
      )
      const tokenRead = await fetch(`${BASE}/api/jobs/job-token-probe?t=${tok}`)
      const badTokenRead = await fetch(`${BASE}/api/jobs/job-token-probe?t=${'f'.repeat(64)}`)
      check(
        'job token: valid token passes the auth gate (404 on missing job); bad token stays 401',
        tokenRead.status === 404 && badTokenRead.status === 401,
        `got ${tokenRead.status}/${badTokenRead.status}`,
      )
    } else {
      console.log('  ⚪ job token: SESSION_SECRET not available to the harness — token checks skipped')
    }

    // ── Job context (the rail detail card's position/PnL block) ────────────
    // Same auth contract as the job poll: owner or capability token.
    const ctxAnon = await fetch(`${BASE}/api/jobs/nonexistent/context`)
    const ctxOwner = await fetch(`${BASE}/api/jobs/nonexistent/context`, { headers: C })
    check('job context: unauth → 401; owner + missing job → 404', ctxAnon.status === 401 && ctxOwner.status === 404, `got ${ctxAnon.status}/${ctxOwner.status}`)
    if (sessionSecret) {
      const ctxTok = await fetch(`${BASE}/api/jobs/job-token-probe/context?t=${signJobToken('job-token-probe')}`)
      check('job context: capability token passes the gate (404 on missing job)', ctxTok.status === 404, `got ${ctxTok.status}`)
    }
    // The pure derivation: no venue builders → no network, but the generic
    // rows and the needs-you note always land (values are formatted strings).
    const genericCtx = await jobContextFor({
      wallet: '0x0000000000000000000000000000000000000001',
      status: 'waiting_signature',
      currentStep: 0,
      valueUsd: 12.5,
      failReason: null,
      steps: [{ builder: 'wait', params: {} }],
    })
    check(
      'job context: generic derivation — money-moved row formatted, signature note present',
      genericCtx.rows.some((r) => r.value === '$12.50') && /signature/i.test(genericCtx.note ?? ''),
      JSON.stringify(genericCtx),
    )
  }

  // ── Lido staking layer (parse + guided moment + guard + job step) ─────────
  console.log('— lido')
  {
    const explicit = parseLidoStake('Stake 0.05 ETH on Lido')
    const wst = parseLidoStake('stake 0.5 eth on lido as wstETH')
    const max = parseLidoStake('stake all my eth on lido')
    const swapped = parseLidoStake('then stake the swapped ETH on Lido')
    check(
      'lido parse: explicit / wstETH / all-my / the-swapped forms (venue word demanded)',
      !!explicit && !('problem' in explicit) && explicit.amount === '0.05' && explicit.receive === 'stETH' &&
        !!wst && !('problem' in wst) && wst.receive === 'wstETH' &&
        !!max && !('problem' in max) && max.amount === 'max' &&
        !!swapped && !('problem' in swapped) && swapped.amount === 'max',
    )
    const bare = parseLidoStake('stake some eth on lido')
    check(
      'lido parse: amountless ask → honest problem; no venue word / staking elsewhere → null',
      !!bare && 'problem' in bare &&
        parseLidoStake('stake 5 eth') === null &&
        parseLidoStake('stake 5 eth on rocketpool') === null &&
        parseLidoStake('what is lido?') === null,
    )
    check(
      'lido guided: help-shaped asks detected, build asks and questions are not',
      isLidoGuidedAsk('Help me stake on Lido') &&
        isLidoGuidedAsk('how do i stake on lido?') &&
        isLidoGuidedAsk('stake on lido') &&
        !isLidoGuidedAsk('Stake 0.05 ETH on Lido') &&
        !isLidoGuidedAsk('stake all my eth on lido') &&
        !isLidoGuidedAsk('what is lido?'),
    )

    // The guided moment's compound proposal must COMPILE — the chip is a job.
    const guidedJob = compileJobAsk('Swap 5 USDC from Base to ETH on Ethereum, then stake all my ETH on Lido')
    check(
      'lido job step: the guided chip round-trips through the compiler (bridge → wait → stake)',
      !!guidedJob && !('problem' in guidedJob) && guidedJob.steps.length === 3 &&
        JSON.stringify(guidedJob.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-lido']),
      guidedJob && !('problem' in guidedJob) ? guidedJob.steps.map((s) => s.builder).join(',') : JSON.stringify(guidedJob),
    )
    check('lido helper: suggested stake sizes from a live balance minus the gas buffer', suggestedStakeEth('0.0517') === '0.0497' && suggestedStakeEth('0.004') === null && suggestedStakeEth(undefined) === null)

    // Guard: the artifact must be mainnet, exact-value, canonical-recipient.
    const SUBMIT_ABI = [{ type: 'function', name: 'submit', stateMutability: 'payable', inputs: [{ name: '_referral', type: 'address' }], outputs: [{ type: 'uint256' }] }] as const
    const submitData = encodeFunctionData({ abi: SUBMIT_ABI, functionName: 'submit', args: ['0x0000000000000000000000000000000000000000'] })
    const goodStake: LidoBuiltStake = {
      operation: 'stake',
      steps: [{ action: 'send_transaction', label: 'stake', summary: 'Stake 0.05 ETH with Lido', tx: { to: LIDO_STETH_MAINNET, data: submitData, value: '50000000000000000', chainId: 1 } }],
    }
    check('lido guard: canonical stETH submit() build passes', guardLidoStakeBuild(goodStake, { amountEth: '0.05', receive: 'stETH' }).ok)
    const tamper = (mut: (b: LidoBuiltStake) => void): boolean => {
      const b = JSON.parse(JSON.stringify(goodStake)) as LidoBuiltStake
      mut(b)
      return guardLidoStakeBuild(b, { amountEth: '0.05', receive: 'stETH' }).ok
    }
    check(
      'lido guard: fails CLOSED on tamper (recipient / value / chain / opaque data / extra steps)',
      !tamper((b) => (b.steps![0].tx!.to = '0x000000000000000000000000000000000000dEaD')) &&
        !tamper((b) => (b.steps![0].tx!.value = '51000000000000000')) &&
        !tamper((b) => (b.steps![0].tx!.chainId = 8453)) &&
        !tamper((b) => (b.steps![0].tx!.data = '0xdeadbeef')) &&
        !tamper((b) => b.steps!.push(b.steps![0])),
    )
    const goodWrap: LidoBuiltStake = {
      operation: 'stake',
      steps: [{ action: 'send_transaction', label: 'stake', summary: 'Stake 0.05 ETH → wstETH', tx: { to: LIDO_WSTETH_MAINNET, data: '0x', value: '50000000000000000', chainId: 1 } }],
    }
    check(
      'lido guard: wstETH = plain transfer to canonical wstETH; calldata or wrong target refuses',
      guardLidoStakeBuild(goodWrap, { amountEth: '0.05', receive: 'wstETH' }).ok &&
        !guardLidoStakeBuild({ ...goodWrap, steps: [{ ...goodWrap.steps![0], tx: { ...goodWrap.steps![0].tx!, data: submitData } }] }, { amountEth: '0.05', receive: 'wstETH' }).ok &&
        !guardLidoStakeBuild(goodStake, { amountEth: '0.05', receive: 'wstETH' }).ok,
    )
  }

  // ── Universal funding plan (scan ranking + chip round-trips) ──────────────
  console.log('— funding plan')
  {
    const need: FundingNeed = { chainId: 1, token: 'ETH', amountHuman: 0.005, followupResume: 'stake all my ETH on Lido', actionLabel: 'the stake' }
    const src = (chainId: number, chainWord: string, token: 'ETH' | 'USDC', usd: number, balance = token === 'USDC' ? usd : usd / 3500): FundingSource => ({ chainId, chainWord, token, balance, usd })

    check('funding plan: need = shortfall × price + 10% + $1 flat, $0.50-rounded, $2 floor', fundingPlanUsd(0.005, 3500) === 20.5 && fundingPlanUsd(0.2, 1) === 2)

    // Ranking: same token beats stables beats ETH; richest chain first.
    const ranked = rankFundingSources(need, [src(8453, 'Base', 'USDC', 50), src(42161, 'Arbitrum', 'ETH', 40), src(8453, 'Base', 'ETH', 90)])
    check(
      'funding plan: same-token sources outrank stables, richest first',
      ranked.map((s) => `${s.token}:${s.chainWord}`).join(',') === 'ETH:Base,ETH:Arbitrum,USDC:Base',
    )

    // Single source covers → just-enough + all-of-it + Not now; the chip is a JOB.
    const offer = planFundingChips(need, 20.5, [src(8453, 'Base', 'USDC', 60)])
    check('funding plan: covering source offers just-enough / all / not-now chips', offer.kind === 'offer' && offer.chips.length === 3 && offer.chips[2].label === 'Not now')
    const chipJob = offer.kind === 'offer' ? compileJobAsk(offer.chips[0].resume) : null
    check(
      'funding plan: the lido chip round-trips through the compiler (bridge → wait → stake)',
      !!chipJob && !('problem' in chipJob) &&
        JSON.stringify(chipJob.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-lido']),
      offer.kind === 'offer' ? offer.chips[0].resume : offer.kind,
    )

    // wstETH survives the round trip.
    const wstOffer = planFundingChips({ ...need, followupResume: 'stake all my ETH on Lido as wstETH' }, 20.5, [src(8453, 'Base', 'USDC', 60)])
    const wstJob = wstOffer.kind === 'offer' ? compileJobAsk(wstOffer.chips[0].resume) : null
    check(
      'funding plan: wstETH variant compiles and keeps the receive token',
      !!wstJob && !('problem' in wstJob) && (wstJob.steps[2].params as { receive?: string }).receive === 'wstETH',
    )

    // A whale balance never gets an all-in chip (moving $15k to cover $20 is absurd).
    const whale = planFundingChips(need, 20.5, [src(8453, 'Base', 'USDC', 15_000)])
    check('funding plan: all-of-it chip capped at 10× the need', whale.kind === 'offer' && whale.chips.length === 2)

    // Destination-chain balances of a DIFFERENT token are same-chain
    // conversion sources (venue swap leg, no bridge) — re-pinned 2026-07-23,
    // the live NFT-buy gap: $12 of Base USDC was invisible to a Base ETH need.
    const sameChain = planFundingChips(need, 20.5, [src(1, 'Ethereum', 'USDC', 60)])
    const sameChainLegJob = sameChain.kind === 'offer' ? compileJobAsk(sameChain.chips[0].resume) : null
    check(
      'funding plan: a destination-chain USDC source converts same-chain and compiles (venue swap → stake)',
      sameChain.kind === 'offer' && /^Swap [\d.]+ USDC for ETH on ethereum/i.test(sameChain.chips[0].resume) &&
        !!sameChainLegJob && !('problem' in sameChainLegJob) &&
        JSON.stringify(sameChainLegJob.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-swap', 'sign:native-lido']),
      sameChain.kind === 'offer' ? sameChain.chips[0].resume : sameChain.kind,
    )

    // No single source covers, combined does → one combined chip, one leg per chain.
    const combined = planFundingChips(need, 20.5, [src(8453, 'Base', 'USDC', 12), src(42161, 'Arbitrum', 'USDC', 11)])
    const combinedJob = combined.kind === 'offer' ? compileJobAsk(combined.chips[0].resume) : null
    check(
      'funding plan: combined multi-chain plan compiles (leg → wait, per chain, then stake)',
      combined.kind === 'offer' && combined.chips.length === 2 && !!combinedJob && !('problem' in combinedJob) &&
        JSON.stringify(combinedJob.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-cross-chain', 'wait:wait', 'sign:native-lido']),
      combined.kind === 'offer' ? combined.chips[0].resume : combined.kind,
    )

    // The whole wallet can't cover it → honest shortfall, dust ignored.
    const short = planFundingChips(need, 20.5, [src(8453, 'Base', 'USDC', 3), src(42161, 'Arbitrum', 'ETH', 0.3)])
    check('funding plan: uncoverable need reports the honest shortfall (dust ignored)', short.kind === 'short' && short.needUsd === 20.5 && short.totalUsd === 3)

    // Gas-only plans (needUsd 0): the token need is already covered on the
    // destination but the follow-up is gas-stranded there — ONE ETH leg,
    // never a zero-amount token leg (the live 2026-07-23 wall: 12.99 USDC on
    // Arbitrum, zero Arbitrum ETH, and "covers it" offered a stranded job).
    const hlGasNeed: FundingNeed = {
      chainId: 42161,
      token: 'USDC',
      amountHuman: 0,
      followupResume: 'deposit 5 USDC to Hyperliquid, then Long $12 of HYPE on Hyperliquid, then protect my HYPE long with a 5% stop',
      actionLabel: 'the Hyperliquid position',
    }
    const gasOnly = planFundingChips(hlGasNeed, 0, [src(8453, 'Base', 'USDC', 6)], 1.5)
    check(
      'funding plan: gas-only plan emits one ETH leg then the follow-up',
      gasOnly.kind === 'offer' && /^Swap [\d.]+ USDC from Base to ETH on arbitrum, then deposit 5 USDC/i.test(gasOnly.chips[0].resume),
      gasOnly.kind === 'offer' ? gasOnly.chips[0].resume : gasOnly.kind,
    )
    const gasOnlyJob = gasOnly.kind === 'offer' ? compileJobAsk(gasOnly.chips[0].resume) : null
    check(
      'funding plan: the gas-only HL chip compiles gas-leg → wait → deposit → wait → open → arm',
      !!gasOnlyJob && !('problem' in gasOnlyJob) &&
        JSON.stringify(gasOnlyJob.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-hl-exec', 'wait:wait', 'sign:native-hl-exec', 'auto:native-hl-guardian']),
      gasOnly.kind === 'offer' ? gasOnly.chips[0].resume : undefined,
    )
    check('funding plan: nothing-to-move (needUsd 0, gasUsd 0) never emits a chip', planFundingChips(hlGasNeed, 0, [src(8453, 'Base', 'USDC', 6)], 0).kind === 'short')

    // Aave job segments: explicit supply/repay compile; weak verbs stay chat-only.
    const aaveSupJob = compileJobAsk('Swap 25 USDC from Base to USDC on Ethereum, then supply 20 USDC to aave')
    check(
      'funding plan: aave supply chip round-trips (bridge → wait → supply)',
      !!aaveSupJob && !('problem' in aaveSupJob) &&
        JSON.stringify(aaveSupJob.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-aave-supply']) &&
        (aaveSupJob.steps[2].params as { amount?: string }).amount === '20',
      aaveSupJob && 'problem' in aaveSupJob ? aaveSupJob.problem : undefined,
    )
    const aaveRepayJob = compileJobAsk('Swap 25 USDC from Base to USDC on Ethereum, then repay all my USDC debt on aave')
    check(
      'funding plan: aave max-repay chip round-trips with max:true',
      !!aaveRepayJob && !('problem' in aaveRepayJob) &&
        JSON.stringify(aaveRepayJob.steps.map((s) => `${s.kind}:${s.builder}`)) === JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-aave-repay']) &&
        (aaveRepayJob.steps[2].params as { max?: boolean }).max === true,
      aaveRepayJob && 'problem' in aaveRepayJob ? aaveRepayJob.problem : undefined,
    )
    const aaveWeak = compileJobAsk('Swap 25 USDC from Base to USDC on Ethereum, then deposit 20 USDC into the pool')
    check('funding plan: weak/venue-less aave verbs never compile as job steps', !!aaveWeak && 'problem' in aaveWeak)
    const aaveWrongChain = compileJobAsk('Swap 25 USDC from Base to USDC on Ethereum, then supply 20 USDC to aave on polygon')
    check(
      'funding plan: aave segment on another chain refuses honestly (v4 = Ethereum)',
      !!aaveWrongChain && 'problem' in aaveWrongChain && /Ethereum/.test(aaveWrongChain.problem),
    )
    const aaveNeed: FundingNeed = { chainId: 1, token: 'USDC', amountHuman: 17, followupResume: 'supply 20 USDC to Aave', actionLabel: 'the Aave supply' }
    const aaveOffer = planFundingChips(aaveNeed, fundingPlanUsd(17, 1), [src(8453, 'Base', 'USDC', 60)])
    const aaveOfferJob = aaveOffer.kind === 'offer' ? compileJobAsk(aaveOffer.chips[0].resume) : null
    check(
      'funding plan: the aave funding offer chip compiles end-to-end',
      !!aaveOfferJob && !('problem' in aaveOfferJob) && aaveOfferJob.steps.length === 3 && aaveOfferJob.steps[2].builder === 'native-aave-supply',
      aaveOffer.kind === 'offer' ? aaveOffer.chips[0].resume : aaveOffer.kind,
    )

    // Destination gas leg: when the wallet can't pay for the follow-up action,
    // every chip leads with a source → native-ETH leg (the $2-bridge-then-
    // unstakeable failure, live 2026-07-16).
    const gasNeed: FundingNeed = { chainId: 1, token: 'USDC', amountHuman: 17, followupResume: 'supply 20 USDC to Aave', actionLabel: 'the Aave supply' }
    const gasOffer = planFundingChips(gasNeed, 20, [src(8453, 'Base', 'USDC', 60)], 7)
    const gasJob = gasOffer.kind === 'offer' ? compileJobAsk(gasOffer.chips[0].resume) : null
    check(
      'funding plan: destination gas leg rides first (gas → wait → tokens → wait → act)',
      gasOffer.kind === 'offer' && /~\$27/.test(gasOffer.chips[0].label) && !!gasJob && !('problem' in gasJob) &&
        JSON.stringify(gasJob.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-cross-chain', 'wait:wait', 'sign:native-aave-supply']) &&
        (gasJob.steps[0].params as { destinationToken?: string }).destinationToken?.toUpperCase() === 'ETH',
      gasOffer.kind === 'offer' ? gasOffer.chips[0].resume : gasOffer.kind,
    )
    const gasShort = planFundingChips(gasNeed, 20, [src(8453, 'Base', 'USDC', 22)], 7)
    check('funding plan: a source covering the tokens but not the gas leg is honestly short', gasShort.kind === 'short' && gasShort.needUsd === 27)

    // ── ETH sources fund their OWN legs (the #590 pattern, generic path) ────
    // A gas-included plan runs TWO legs off one ETH balance and leg 1's fee
    // comes out of the very reserve leg 2 spends against — so an ETH row may
    // only promise sourceCapUsd, never its whole movable balance. Stables are
    // untouched (their legs' fees are paid in ETH).
    const hlEthNeed: FundingNeed = { chainId: 42161, token: 'USDC', amountHuman: 5, followupResume: 'deposit 5 USDC to Hyperliquid', actionLabel: 'the Hyperliquid deposit' }
    const ethBarely = planFundingChips(hlEthNeed, 6.5, [src(1, 'Ethereum', 'ETH', 8.5)], 1.5)
    check(
      'funding plan: an ETH row that only covers a gas-included plan by spending its whole balance is short, not a mid-job wall',
      ethBarely.kind === 'short' && ethBarely.needUsd === 8 && ethBarely.totalUsd === 8.5,
      ethBarely.kind,
    )
    const ethClears = planFundingChips(hlEthNeed, 6.5, [src(1, 'Ethereum', 'ETH', 9.5)], 1.5)
    check(
      'funding plan: the same ETH row one headroom richer still funds the plan (no blanket ETH refusal)',
      ethClears.kind === 'offer' && /~\$8 of ETH on Ethereum/.test(ethClears.chips[0].label),
      ethClears.kind === 'offer' ? ethClears.chips[0].label : ethClears.kind,
    )
    const stableUnchanged = planFundingChips(hlEthNeed, 6.5, [src(8453, 'Base', 'USDC', 8)], 1.5)
    check('funding plan: a stable row still spends in full — its legs pay fees in ETH, not in itself', stableUnchanged.kind === 'offer')
    // "All my ETH" promises the capped figure, and the capped chip still compiles.
    const ethAllIn = planFundingChips(hlEthNeed, 6.5, [src(1, 'Ethereum', 'ETH', 30)], 1.5)
    const ethAllInChip = ethAllIn.kind === 'offer' ? ethAllIn.chips.find((c) => c.label.startsWith('All my')) : undefined
    const ethAllInJob = ethAllInChip ? compileJobAsk(ethAllInChip.resume) : null
    check(
      'funding plan: the all-in ETH chip promises the capped balance (~$29 of $30) and still compiles',
      !!ethAllInChip && /~\$29\b/.test(ethAllInChip.label) && !/~\$30\b/.test(ethAllInChip.label) &&
        !!ethAllInJob && !('problem' in ethAllInJob) &&
        JSON.stringify(ethAllInJob.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-cross-chain', 'wait:wait', 'sign:native-hl-exec', 'wait:wait']),
      ethAllInChip?.label,
    )
    // Gas-FREE plans still spend the whole row: one leg, no fee to keep back.
    const ethNoGas = planFundingChips(need, 20.5, [src(8453, 'Base', 'ETH', 60)])
    const ethNoGasChip = ethNoGas.kind === 'offer' ? ethNoGas.chips.find((c) => c.label.startsWith('All my')) : undefined
    check(
      'funding plan: a single-leg (gas-free) ETH plan still spends the full movable row',
      !!ethNoGasChip && /~\$60\b/.test(ethNoGasChip.label),
      ethNoGasChip?.label,
    )
    // Combine: only the gas-BEARING source pays the headroom, and its legs
    // must sum to the capped figure ($4 of a $5 row), not the whole row.
    const ethCombine = planFundingChips(hlEthNeed, 6.5, [src(1, 'Ethereum', 'ETH', 5), src(8453, 'Base', 'USDC', 4)], 1.5)
    const ethFromMainnet = (ethCombine.kind === 'offer' ? ethCombine.chips[0].resume : '')
      .split(', then ')
      .filter((leg) => /ETH from Ethereum/.test(leg))
      .reduce((a, leg) => a + Number(leg.match(/Swap ([\d.]+) ETH/)?.[1] ?? 0) * 3500, 0)
    check(
      'funding plan: in a combined plan only the gas-bearing ETH source pays the headroom (~$4 of a $5 row)',
      ethCombine.kind === 'offer' && ethFromMainnet > 3.9 && ethFromMainnet <= 4.01,
      `${ethFromMainnet.toFixed(2)} — ${ethCombine.kind === 'offer' ? ethCombine.chips[0].resume : ethCombine.kind}`,
    )
    check(
      'funding plan: promisable capacity = best capped single source, or the set combined (only the richest pays it)',
      promisableCapacityUsd([src(1, 'Ethereum', 'ETH', 9)], true) === 8 &&
        promisableCapacityUsd([src(1, 'Ethereum', 'ETH', 9)], false) === 9 &&
        promisableCapacityUsd([src(1, 'Ethereum', 'ETH', 9), src(8453, 'Base', 'USDC', 4)], true) === 12 &&
        promisableCapacityUsd([], true) === 0,
    )

    // The generic fallback: balance refusals from ANY MCP become detectable
    // shortfalls, and bridge-only chips (empty followup) still round-trip —
    // one leg = a plain cross-chain ask, several legs = a pure-bridge job.
    const detAave = detectBalanceShortfall('AaveKit API error (HTTP 400): "Insufficient balance: this needs 200.000000 USDC but the wallet holds 142.244500 USDC on Ethereum. Nothing was built."')
    const detLido = detectBalanceShortfall('Insufficient ETH: staking 0.0002 ETH but the wallet holds 0 ETH on Ethereum. Nothing was built.')
    const detGeneric = detectBalanceShortfall('not enough USDC on Arbitrum: needs 20 USDC but you have 3 USDC')
    check(
      'funding fallback: detects balance refusals (aave-shape / lido-shape / generic)',
      !!detAave && detAave.token === 'USDC' && detAave.chainId === 1 && Math.abs(detAave.shortfall - 57.7555) < 0.001 &&
        !!detLido && detLido.token === 'ETH' && detLido.chainId === 1 && detLido.shortfall === 0.0002 &&
        !!detGeneric && detGeneric.chainId === 42161 && detGeneric.shortfall === 17,
      JSON.stringify({ detAave, detLido, detGeneric }),
    )
    check(
      'funding fallback: no chain / no trigger / covered balance → null (never guesses)',
      detectBalanceShortfall('Insufficient balance: needs 20 USDC but holds 3 USDC') === null &&
        detectBalanceShortfall('the wallet holds 20 USDC on Base') === null &&
        detectBalanceShortfall('insufficient: needs 3 USDC on Base but the wallet holds 5 USDC') === null,
    )
    // Robinhood Chain shortfalls ARE detectable now (they ride the LiFi
    // funding plan, not NEAR Intents): a named chain works, and a bare
    // "Insufficient USDG" implies 4663 — USDG exists nowhere else. The
    // EXACT live 2026-07-17 refusal shape is the fixture.
    const detRhNamed = detectBalanceShortfall('Insufficient USDG on Robinhood Chain: needs 20 USDG')
    const detRhLive = detectBalanceShortfall('Insufficient USDG: swapping 5 but the wallet holds 0.473742. Nothing was built.')
    check(
      'funding fallback: USDG shortfalls resolve to Robinhood Chain (named + bare live shape)',
      !!detRhNamed && detRhNamed.chainId === 4663 && detRhNamed.token === 'USDG' && detRhNamed.shortfall === 20 &&
        !!detRhLive && detRhLive.chainId === 4663 && detRhLive.token === 'USDG' && Math.abs(detRhLive.shortfall - 4.526258) < 1e-9,
      JSON.stringify({ detRhNamed, detRhLive }),
    )
    check(
      'funding fallback: the bare-amount form never fires without a trigger-named token',
      detectBalanceShortfall('insufficient: swapping 5 but the wallet holds 0.4 on Base') === null,
    )
    // Tone (live 2026-07-22): "TOOL CALL FAILED … tell the user it failed"
    // next to a funding plan made the model headline the turn "❌ Swap
    // failed". The claimed failure's block softens to pre-flight framing —
    // the error text stays, the failure directive goes.
    {
      const failedBlock = `### Robinhood Chain (Free) — TOOL CALL FAILED\nInsufficient USDG: swapping 20 but the wallet holds 18.547709. Nothing was built.\nThis call did NOT succeed; nothing was executed or submitted. Tell the user it failed — never claim the action happened.`
      const blocks = ['### something else\nfine', failedBlock]
      softenClaimedFailureBlock(blocks, { claimed: 'Robinhood Chain (Free)', offer: null, contextBlock: '' })
      check(
        'funding fallback: claimed failure block softens to pre-flight framing (error text kept, "it failed" dropped)',
        blocks[1].includes('pre-flight funds check') &&
          blocks[1].includes('Insufficient USDG: swapping 20') &&
          !blocks[1].includes('Tell the user it failed') &&
          blocks[0] === '### something else\nfine',
        blocks[1],
      )
      const untouched = [failedBlock]
      softenClaimedFailureBlock(untouched, { claimed: 'Some Other MCP', offer: null, contextBlock: '' })
      softenClaimedFailureBlock(untouched, null)
      check('funding fallback: softener never touches unclaimed failures', untouched[0] === failedBlock)
    }
    const bridgeOnly = planFundingChips({ chainId: 42161, token: 'USDC', amountHuman: 17, followupResume: '', actionLabel: 'the custom action' }, 20, [src(8453, 'Base', 'USDC', 60)])
    check(
      'funding fallback: bridge-only chip is a plain cross-chain ask (native layer owns it)',
      bridgeOnly.kind === 'offer' && bridgeOnly.chips[0].resume === 'Swap 20 USDC from Base to USDC on Arbitrum' &&
        compileJobAsk(bridgeOnly.chips[0].resume) === null &&
        !!parseCrossChainSwap(bridgeOnly.chips[0].resume) && !('problem' in parseCrossChainSwap(bridgeOnly.chips[0].resume)!),
      bridgeOnly.kind === 'offer' ? bridgeOnly.chips[0].resume : bridgeOnly.kind,
    )
    const bridgeOnlyGas = planFundingChips({ chainId: 1, token: 'USDC', amountHuman: 17, followupResume: '', actionLabel: 'the custom action' }, 20, [src(8453, 'Base', 'USDC', 60)], 7)
    const bridgeOnlyGasJob = bridgeOnlyGas.kind === 'offer' ? compileJobAsk(bridgeOnlyGas.chips[0].resume) : null
    check(
      'funding fallback: bridge-only with a gas leg compiles as a pure-bridge job',
      !!bridgeOnlyGasJob && !('problem' in bridgeOnlyGasJob) &&
        JSON.stringify(bridgeOnlyGasJob.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-cross-chain', 'wait:wait']),
      bridgeOnlyGas.kind === 'offer' ? bridgeOnlyGas.chips[0].resume : bridgeOnlyGas.kind,
    )

    // Same-chain swap segments: the funding follow-up for sell-token
    // shortfalls — disjoint from the cross-chain grammar, chain word demanded.
    const seg = parseSameChainSwapSegment('swap 20 USDC for WETH on Arbitrum')
    check(
      'funding plan: same-chain swap segment parses (chain word demanded, cc grammar untouched)',
      !!seg && seg.chainId === 42161 && seg.sellToken === 'USDC' && seg.buyToken === 'WETH' && seg.amountHuman === '20' &&
        parseSameChainSwapSegment('swap 20 USDC for WETH') === null &&
        parseSameChainSwapSegment('swap 1 USDC from Base to Arbitrum') === null &&
        !!parseCrossChainSwap('swap 1 USDC from Base to Arbitrum'),
    )
    const swapChipNeed: FundingNeed = { chainId: 42161, token: 'USDC', amountHuman: 17, followupResume: 'swap 20 USDC for WETH on Arbitrum', actionLabel: 'the swap' }
    const swapChip = planFundingChips(swapChipNeed, 20, [src(8453, 'Base', 'USDC', 60)])
    const swapChipJob = swapChip.kind === 'offer' ? compileJobAsk(swapChip.chips[0].resume) : null
    check(
      'funding plan: the swap chip round-trips (bridge → wait → same-chain swap)',
      !!swapChipJob && !('problem' in swapChipJob) &&
        JSON.stringify(swapChipJob.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-swap']) &&
        (swapChipJob.steps[2].params as { chainId?: number }).chainId === 42161,
      swapChip.kind === 'offer' ? swapChip.chips[0].resume : swapChip.kind,
    )

    // The Hyperliquid variant: USDC on Arbitrum funded from Base, deposit follows.
    const hlNeed: FundingNeed = { chainId: 42161, token: 'USDC', amountHuman: 17, followupResume: 'deposit 20 USDC to Hyperliquid', actionLabel: 'the Hyperliquid deposit' }
    const hlOffer = planFundingChips(hlNeed, fundingPlanUsd(17, 1), [src(8453, 'Base', 'USDC', 60)])
    const hlJob = hlOffer.kind === 'offer' ? compileJobAsk(hlOffer.chips[0].resume) : null
    check(
      'funding plan: the hyperliquid chip round-trips (bridge → wait → deposit → credit wait)',
      !!hlJob && !('problem' in hlJob) &&
        JSON.stringify(hlJob.steps.map((s) => `${s.kind}:${s.builder}`)) ===
          JSON.stringify(['sign:native-cross-chain', 'wait:wait', 'sign:native-hl-exec', 'wait:wait']),
      hlOffer.kind === 'offer' ? hlOffer.chips[0].resume : hlOffer.kind,
    )
  }

  // ── DCA — recurring buys (grammar + period math + the chip contract) ─────
  console.log('— dca schedules')
  {
    // The Jobs rail's schedule list: wallet-scoped, so it must never answer
    // anonymously (anyone could otherwise enumerate a wallet's standing buys).
    const dcaAnon = await fetch(`${BASE}/api/dca`)
    check('dca: GET /api/dca without auth → 401', dcaAnon.status === 401)
    const dcaRes = await fetch(`${BASE}/api/dca`, { headers: C })
    const dcaBody = await dcaRes.json()
    check('dca: GET /api/dca returns the schedules array', dcaRes.status === 200 && Array.isArray(dcaBody.schedules))

    // The recurring-buy detail card's context: owner-only (schedules have no
    // capability tokens), and resolution goes through the wallet-fenced list
    // so another wallet's schedule id can only ever 404.
    const dcaCtxAnon = await fetch(`${BASE}/api/dca/nonexistent/context`)
    const dcaCtxOwner = await fetch(`${BASE}/api/dca/nonexistent/context`, { headers: C })
    check('dca context: unauth → 401; owner + missing schedule → 404', dcaCtxAnon.status === 401 && dcaCtxOwner.status === 404, `got ${dcaCtxAnon.status}/${dcaCtxOwner.status}`)
  }
  {
    const create = parseDcaCreate('buy $10 of AAPL every week on robinhood')
    check(
      'dca: create parses (dollar amount + cadence + chain word)',
      !!create && !('problem' in create) && create.buyUsd === 10 && create.buyToken === 'AAPL' && create.cadence === 'week' && create.chainId === 4663,
    )
    const noChain = parseDcaCreate('dca $25 into ETH daily')
    check(
      'dca: chainless create parses — chain left to the turn resolver (message > picker > token list)',
      !!noChain && !('problem' in noChain) && noChain.buyUsd === 25 && noChain.buyToken === 'ETH' && noChain.cadence === 'day' && noChain.chainId === null,
    )
    const monthly = parseDcaCreate('dollar cost average $50 into WETH every month')
    check('dca: dollar-cost-average verb + monthly cadence parse', !!monthly && !('problem' in monthly) && monthly.cadence === 'month' && monthly.buyUsd === 50)
    check(
      'dca: cadence-less buys never claim (the swap layer owns one-shots)',
      parseDcaCreate('buy $10 of AAPL') === null && parseDcaCreate('buy $10 of AAPL on robinhood') === null,
    )
    const units = parseDcaCreate('buy 10 AAPL every week')
    check('dca: token-unit sizing refuses honestly (recurring buys are dollar-sized)', !!units && 'problem' in units && /dollars/.test(units.problem))
    const stableBuy = parseDcaCreate('dca $10 into USDC weekly')
    const capped = parseDcaCreate('buy $20000 of ETH every day')
    check('dca: stable-for-stable and above-cap asks refuse honestly', !!stableBuy && 'problem' in stableBuy && !!capped && 'problem' in capped)

    // The chip contract: the due-period chip's resume string round-trips.
    const chip = dcaRunChip({ id: 'clx0dcatest0001', buyUsd: 10, buyToken: 'AAPL', cadence: 'week' })
    const run = parseDcaRun(chip.prompt)
    check('dca: due-period chip resume round-trips (the chip is the contract)', !!run && run.scheduleId === 'clx0dcatest0001', chip.prompt)
    check(
      'dca: run resume never claimed by the jobs compiler; free text never reads as a run',
      compileJobAsk(chip.prompt) === null && parseDcaRun('run my errands today') === null,
    )

    // The one-step buy job: same native-swap builder + params contract the
    // funding plan's swap chips compile to (shared venue cascade).
    const buyJob = compileDcaBuy({ buyUsd: 10, buyToken: 'AAPL', sellToken: 'USDG', chainId: 4663, cadence: 'week' })
    check(
      'dca: a due period compiles to ONE native-swap sign step (fresh-at-offer, guardrailed)',
      buyJob.steps.length === 1 && buyJob.steps[0].kind === 'sign' && buyJob.steps[0].builder === 'native-swap' &&
        JSON.stringify(buyJob.steps[0].params) === JSON.stringify({ sellToken: 'USDG', buyToken: 'AAPL', amountHuman: '10.00', chainId: 4663 }),
    )

    // Manage grammar.
    const pause = parseDcaManage('pause my AAPL dca')
    const cancel = parseDcaManage('cancel my dca')
    const resumeAsk = parseDcaManage('resume my aapl dca')
    const list = parseDcaManage('list my recurring buys')
    check(
      'dca: manage parses (pause/cancel/resume/list, token filter optional)',
      pause?.op === 'pause' && pause.token === 'AAPL' && cancel?.op === 'cancel' && cancel.token === null &&
        resumeAsk?.op === 'resume' && resumeAsk.token === 'AAPL' && list?.op === 'list',
    )
    check(
      'dca: guardian/perp phrasing never reads as dca management',
      parseDcaManage('set a stop loss on my ETH long') === null && parseDcaManage('stop my SYRUP position') === null,
    )

    // Period math: UTC calendar periods; missed periods lapse by construction.
    check(
      'dca: day/month period keys are UTC calendar buckets',
      periodKeyFor('day', new Date(Date.UTC(2026, 6, 16))) === '2026-07-16' && periodKeyFor('month', new Date(Date.UTC(2026, 6, 16))) === '2026-07',
    )
    check(
      'dca: ISO week keys (year boundary lands in the owning ISO year)',
      periodKeyFor('week', new Date(Date.UTC(2026, 6, 16))) === '2026-W29' && periodKeyFor('week', new Date(Date.UTC(2027, 0, 1))) === '2026-W53',
    )

    // Discoverability contract: every DCA suggestion chip (empty-state
    // gallery + splash) must parse into a schedule create — a suggestion
    // that falls through to the swap layer would silently drop the cadence.
    const galleryDca = EXAMPLE_PROMPTS.find((e) => /every week/i.test(e.prompt))
    const galleryParse = galleryDca ? parseDcaCreate(galleryDca.prompt) : null
    check(
      'dca: the empty-state gallery chip parses into a schedule (never a one-shot)',
      !!galleryDca && !!galleryParse && !('problem' in galleryParse) && galleryParse.cadence === 'week' && galleryParse.chainId === 4663,
      galleryDca?.prompt,
    )
    const splashDcaPrompts = [
      'Buy $10 of AAPL every week on Robinhood Chain', // robinhood splash + preview
      'Buy $25 of ETH every week on Base', // uniswap preview
    ]
    check(
      'dca: splash/preview suggestion prompts all parse into schedule creates',
      splashDcaPrompts.every((p) => {
        const c = parseDcaCreate(p)
        return !!c && !('problem' in c) && c.cadence === 'week' && c.chainId !== null
      }),
    )
  }

  // ── DCA AUTOPILOT (Spend Permissions: grammar + typed data + the guard) ──
  {
    // Rail icon actions (2026-07-28): the schedule manage PATCH is owner-
    // gated — no session, no mutation; bad ops refuse by name.
    const noAuth = await fetch(`${BASE}/api/dca/nonexistent`, { method: 'PATCH', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ op: 'cancel' }) })
    check('dca manage: PATCH without a session → 401', noAuth.status === 401)
  }

  console.log('— dca autopilot')
  {
    // Toggle grammar: narrow, deterministic, and it must NEVER collide with
    // the manage grammar ("stop my dca autopilot" ≠ "cancel my dca").
    const arm1 = parseDcaAutoToggle('make my ETH dca autonomous')
    const arm2 = parseDcaAutoToggle('arm my dca')
    const arm3 = parseDcaAutoToggle('turn my aapl dca automatic')
    const dis1 = parseDcaAutoToggle('turn off my dca autopilot')
    const dis2 = parseDcaAutoToggle('stop my ETH dca autopilot')
    const dis3 = parseDcaAutoToggle('switch my dca back to manual')
    check(
      'dca autopilot: arm/disarm grammar parses (token filter optional)',
      arm1?.op === 'arm' && arm1.token === 'ETH' && arm2?.op === 'arm' && arm2.token === null &&
        arm3?.op === 'arm' && arm3.token === 'AAPL' &&
        dis1?.op === 'disarm' && dis1.token === null && dis2?.op === 'disarm' && dis2.token === 'ETH' && dis3?.op === 'disarm',
    )
    check(
      'dca autopilot: never claims creates, manages, or free text',
      parseDcaAutoToggle('buy $10 of ETH weekly') === null && parseDcaAutoToggle('pause my dca') === null &&
        parseDcaAutoToggle('cancel my AAPL dca') === null && parseDcaAutoToggle('is the car automatic?') === null,
    )
    check(
      'dca autopilot: "stop … autopilot" disarms, and plain "stop my dca" still cancels',
      parseDcaAutoToggle('stop my dca autopilot')?.op === 'disarm' && parseDcaManage('stop my dca')?.op === 'cancel' &&
        parseDcaAutoToggle('stop my dca') === null,
    )

    // Permission construction: the allowance IS the schedule's dollar amount,
    // the period IS the cadence window — a fatter permission cannot be built.
    const nowSec = 1_790_000_000
    const perm = buildDcaSpendPermission({
      account: '0x1111111111111111111111111111111111111111',
      spender: '0x2222222222222222222222222222222222222222',
      token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913',
      buyUsd: 25,
      cadence: 'week',
      nowSec,
      salt: BigInt(7),
    })
    check(
      'dca autopilot: permission binds exact allowance + cadence window + bounded life',
      perm.allowance === BigInt(25_000_000) && perm.period === 604_800 &&
        perm.start === nowSec - 300 && perm.end === nowSec + 366 * 86_400 && perm.extraData === '0x',
    )
    let selfGrantThrew = false
    try {
      buildDcaSpendPermission({ account: '0x1111111111111111111111111111111111111111', spender: '0x1111111111111111111111111111111111111111', token: '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913', buyUsd: 5, cadence: 'day', nowSec, salt: BigInt(1) })
    } catch {
      selfGrantThrew = true
    }
    check('dca autopilot: account == spender refuses at construction', selfGrantThrew)

    // The EIP-712 field order pin — must match SPEND_PERMISSION_TYPEHASH
    // exactly (the arm route also proves it on-chain by simulation, but a
    // drift should die HERE first).
    const typed = spendPermissionTypedData(perm, 8453, { name: 'Spend Permission Manager', version: '1' })
    check(
      'dca autopilot: typed-data field order pins to the contract TYPEHASH',
      JSON.stringify(typed.types.SpendPermission.map((f) => `${f.type} ${f.name}`)) ===
        JSON.stringify(['address account', 'address spender', 'address token', 'uint160 allowance', 'uint48 period', 'uint48 start', 'uint48 end', 'uint256 salt', 'bytes extraData']) &&
        typed.domain.verifyingContract === SPEND_PERMISSION_MANAGER && typed.domain.chainId === 8453 && typed.primaryType === 'SpendPermission',
    )

    // Storage round-trip + strict parse.
    const parsed = parsePermission(serializePermission(perm))
    check(
      'dca autopilot: permission serialize → parse round-trips bigints exactly',
      !!parsed && parsed.allowance === perm.allowance && parsed.salt === perm.salt && parsed.account === perm.account && parsed.period === perm.period,
    )
    check(
      'dca autopilot: junk permissions refuse to parse',
      parsePermission('{"account":"0xnope"}') === null && parsePermission('[]') === null && parsePermission(serializePermission(perm).replace('"allowance":"25000000"', '"allowance":"-1"')) === null,
    )

    // Permission ⇄ schedule agreement — one rulebook for arm AND sweep.
    const terms = { ownerWallet: perm.account, buyUsd: 25, cadence: 'week' as const, usdcAddress: perm.token, spender: perm.spender, nowSec }
    check('dca autopilot: matching permission passes the shared rulebook', permissionMatchesSchedule(perm, terms).ok)
    check(
      'dca autopilot: the rulebook refuses a fatter allowance, a foreign spender, an alien token, and an expired permission',
      !permissionMatchesSchedule({ ...perm, allowance: BigInt(26_000_000) }, terms).ok &&
        !permissionMatchesSchedule({ ...perm, spender: '0x3333333333333333333333333333333333333333' }, terms).ok &&
        !permissionMatchesSchedule({ ...perm, token: '0x4444444444444444444444444444444444444444' }, terms).ok &&
        !permissionMatchesSchedule(perm, { ...terms, nowSec: perm.end + 1 }).ok,
    )

    // guardAutoBuy — the independent re-decode over FABRICATED calldata:
    // green on exactly what the venue builder emits, refusal on every
    // deviation that matters (recipient, amount, token, router, deadline).
    const owner = perm.account
    const spender = perm.spender
    const usdc = perm.token
    const router = '0x2626664c2603336E57B271c5C0b26F421741e481'
    const weth = '0x4200000000000000000000000000000000000006'
    const pulled = perm.allowance
    const treasury = '0x9cc0000000000000000000000000000000009999'
    const mkApprove = (amount: bigint, to = usdc, spenderArg = router) => ({
      to,
      data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [spenderArg as `0x${string}`, amount] }),
      value: '0',
    })
    const mkSwap = (opts: { recipient?: string; sweepTo?: string; amountIn?: bigint; tokenIn?: string; deadline?: number; noSweep?: boolean; minOut?: bigint }) => {
      const inner = encodeFunctionData({
        abi: SWAP_ROUTER_02_ABI,
        functionName: 'exactInputSingle',
        args: [{
          tokenIn: (opts.tokenIn ?? usdc) as `0x${string}`,
          tokenOut: weth as `0x${string}`,
          fee: 500,
          recipient: (opts.recipient ?? (opts.noSweep ? owner : ADDRESS_THIS)) as `0x${string}`,
          amountIn: opts.amountIn ?? pulled,
          amountOutMinimum: opts.minOut ?? BigInt(1),
          sqrtPriceLimitX96: BigInt(0),
        }],
      })
      const calls = opts.noSweep
        ? [inner]
        : [inner, encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: 'sweepTokenWithFee', args: [weth as `0x${string}`, BigInt(1), (opts.sweepTo ?? owner) as `0x${string}`, BigInt(20), treasury as `0x${string}`] })]
      return {
        to: router,
        data: encodeFunctionData({ abi: SWAP_ROUTER_02_ABI, functionName: 'multicall', args: [BigInt(opts.deadline ?? nowSec + 600), calls] }),
        value: '0',
      }
    }
    const guardBase = {
      schedule: { mode: 'auto', status: 'active', buyUsd: 25, cadence: 'week' as const, chainId: 8453 },
      permission: perm,
      ownerWallet: owner,
      spender,
      chain: { chainId: 8453, swapRouter02: router, usdcAddress: usdc },
      expectedBuyAddr: weth,
      pulledAtomic: pulled,
      nowSec,
    }
    check('dca autopilot guard: the fee build passes (approve exact + swap → sweep to owner)', guardAutoBuy({ ...guardBase, steps: [mkApprove(pulled), mkSwap({})] }).ok)
    check('dca autopilot guard: the feeless build passes (output straight to owner)', guardAutoBuy({ ...guardBase, steps: [mkApprove(pulled), mkSwap({ noSweep: true })] }).ok)
    check(
      'dca autopilot guard: refuses a hijacked recipient (sweep AND direct)',
      !guardAutoBuy({ ...guardBase, steps: [mkApprove(pulled), mkSwap({ sweepTo: spender })] }).ok &&
        !guardAutoBuy({ ...guardBase, steps: [mkApprove(pulled), mkSwap({ noSweep: true, recipient: spender })] }).ok,
    )
    check(
      'dca autopilot guard: refuses amount drift, alien tokenIn, over-pull, and a dead deadline',
      !guardAutoBuy({ ...guardBase, steps: [mkApprove(pulled), mkSwap({ amountIn: pulled + BigInt(1) })] }).ok &&
        !guardAutoBuy({ ...guardBase, steps: [mkApprove(pulled), mkSwap({ tokenIn: weth })] }).ok &&
        !guardAutoBuy({ ...guardBase, pulledAtomic: pulled + BigInt(1), steps: [mkApprove(pulled + BigInt(1)), mkSwap({ amountIn: pulled + BigInt(1) })] }).ok &&
        !guardAutoBuy({ ...guardBase, steps: [mkApprove(pulled), mkSwap({ deadline: nowSec - 1 })] }).ok,
    )
    check(
      'dca autopilot guard: refuses an un-pinned router, an inflated approval, and a disarmed schedule',
      !guardAutoBuy({ ...guardBase, steps: [mkApprove(pulled), { ...mkSwap({}), to: '0x5555555555555555555555555555555555555555' }] }).ok &&
        !guardAutoBuy({ ...guardBase, steps: [mkApprove(pulled * BigInt(2)), mkSwap({})] }).ok &&
        !guardAutoBuy({ ...guardBase, schedule: { ...guardBase.schedule, mode: 'confirm' }, steps: [mkApprove(pulled), mkSwap({})] }).ok,
    )
    check('dca autopilot: atomic → human feeds the builder losslessly', usdcAtomsToHuman(BigInt(10_000_000)) === '10' && usdcAtomsToHuman(BigInt(10_500_000)) === '10.5' && usdcAtomsToHuman(BigInt(123)) === '0.000123')

    // HTTP surfaces: the cron is CRON_SECRET-gated (fail closed), the arm
    // route 404s foreign/missing schedules, disarm needs a session.
    const cronAnon = await fetch(`${BASE}/api/cron/dca`)
    check('dca autopilot: cron without the secret → 401 (fail closed)', cronAnon.status === 401)
    const armMissing = await fetch(`${BASE}/api/dca/nonexistent/arm`, {
      method: 'POST',
      headers: { ...C, 'content-type': 'application/json' },
      body: JSON.stringify({ permission: {}, signature: '0x00' }),
    })
    check('dca autopilot: arming a missing schedule → 404', armMissing.status === 404)
    const disarmAnon = await fetch(`${BASE}/api/dca/nonexistent/arm`, { method: 'DELETE' })
    check('dca autopilot: disarm without a session → 401', disarmAnon.status === 401)

    // The docs page: the two-tier story must stay routed and keep its spine —
    // confirm-mode for every wallet, autopilot for smart wallets, and the
    // honest EOA custody explanation (never a silent capability claim).
    const docsRes = await fetch(`${BASE}/docs/dca`)
    const docsHtml = await docsRes.text()
    check(
      'dca autopilot: /docs/dca routes and keeps the two-tier + EOA-honesty spine',
      docsRes.status === 200 && docsHtml.includes('confirm-mode') && docsHtml.includes('autopilot') && /EOA/.test(docsHtml) && docsHtml.includes('Spend Permission'),
    )

    // The chat turn: connect-first (the toggle layer answers, not the planner).
    const toggleRes = await fetch(`${BASE}/api/chat`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'make my dca autonomous', chatId: 'harness-dca-auto', activeServerIds: [], activeServers: [], history: [] }),
    })
    const toggleBody = await toggleRes.json()
    check(
      'dca autopilot: the walletless toggle gets the autopilot layer’s connect reply',
      toggleRes.status === 200 && typeof toggleBody.reply === 'string' && toggleBody.reply.includes('🤖'),
      String(toggleBody.reply).slice(0, 80),
    )
  }

  // ── HL execution layer (parse + build + guard + submit relay) ────────────
  console.log('— hl exec')
  {
    const long = parseHlIntent('long 0.01 eth on hyperliquid')
    const short = parseHlIntent('short $50 of btc on hl')
    const dep = parseHlIntent('deposit 20 usdc to hyperliquid')
    const close = parseHlIntent('close my syrup long on hyperliquid')
    check(
      'hl exec: parses long/short/deposit/close (venue word demanded)',
      long?.kind === 'open' && (long as HlOrderIntent).coin === 'ETH' && (long as HlOrderIntent).sizeUnits === 0.01 && (long as HlOrderIntent).isBuy === true &&
        short?.kind === 'open' && (short as HlOrderIntent).notionalUsd === 50 && (short as HlOrderIntent).isBuy === false &&
        dep?.kind === 'deposit' && dep.amountUsdc === 20 &&
        close?.kind === 'close' && (close as HlOrderIntent).coin === 'SYRUP',
    )
    check(
      'hl exec: never claims venue-less or swap asks',
      parseHlIntent('long eth') === null && parseHlIntent('swap 1 usdc for eth') === null && parseHlIntent('what is hyperliquid?') === null,
    )

    const snap = { assetIndex: 4, szDecimals: 4, markPx: 3000, positionSzi: 0, maxLeverage: 25, accountLeverage: null }
    const openIntent: HlOrderIntent = { kind: 'open', coin: 'ETH', isBuy: true, notionalUsd: 50 }
    const action = buildHlOrderAction(openIntent, snap)
    const ctx = { markPx: 3000, assetIndex: 4, withdrawableUsd: 100, positionSzi: 0 }
    const good = guardHlExecBuild(openIntent, action, ctx)
    check('hl exec: open build passes guard (IOC, bounded px, ≥$10 notional)', good.ok && action.orders[0].b === true && action.orders[0].r === false && (good.valueUsd ?? 0) >= 49, JSON.stringify(good.checks.filter((c) => !c.ok)))
    check(
      'hl exec: guard fails CLOSED (tiny notional / no collateral / wrong asset / stray px)',
      !guardHlExecBuild({ ...openIntent, notionalUsd: 5 }, buildHlOrderAction({ ...openIntent, notionalUsd: 5 }, snap), ctx).ok &&
        !guardHlExecBuild(openIntent, action, { ...ctx, withdrawableUsd: 0 }).ok &&
        !guardHlExecBuild(openIntent, { ...action, orders: [{ ...action.orders[0], a: 9 }] }, ctx).ok &&
        !guardHlExecBuild(openIntent, { ...action, orders: [{ ...action.orders[0], p: '3300' }] }, ctx).ok,
    )
    const closeIntent: HlOrderIntent = { kind: 'close', coin: 'ETH' }
    const closeSnap = { ...snap, positionSzi: 0.02 }
    const closeAction = buildHlOrderAction(closeIntent, closeSnap)
    const closeCtx = { ...ctx, positionSzi: 0.02 }
    check(
      'hl exec: close is reduce-only sized to the position; tampers refuse',
      guardHlExecBuild(closeIntent, closeAction, closeCtx).ok && closeAction.orders[0].r === true && closeAction.orders[0].b === false &&
        !guardHlExecBuild(closeIntent, { ...closeAction, orders: [{ ...closeAction.orders[0], r: false }] }, closeCtx).ok &&
        !guardHlExecBuild(closeIntent, { ...closeAction, orders: [{ ...closeAction.orders[0], s: '0.03' }] }, closeCtx).ok,
    )
    const td = hlActionTypedData(action, 1752440000000)
    check('hl exec: L1 typed data is the phantom agent over the action hash', td.primaryType === 'Agent' && (td.message as { source: string }).source === 'a' && /^0x[0-9a-f]{64}$/.test((td.message as { connectionId: string }).connectionId))

    const depGood = buildHlDeposit({ kind: 'deposit', amountUsdc: 20 }, 25)
    check(
      'hl exec: deposit build → USDC transfer to the pinned Bridge2; sub-minimum and over-balance refuse',
      depGood.guardrails.ok && depGood.tx.to === ARBITRUM_USDC && depGood.tx.chainId === 42161 && depGood.tx.data.includes(HL_BRIDGE2_ARBITRUM.slice(2)) &&
        !buildHlDeposit({ kind: 'deposit', amountUsdc: 4 }, 25).guardrails.ok &&
        !buildHlDeposit({ kind: 'deposit', amountUsdc: 20 }, 10).guardrails.ok,
    )

    check(
      'guardian arm parse: protect/stop/take-profit phrases → policy ask; questions → null',
      JSON.stringify(parseGuardianArm('protect my SYRUP long with a 10% stop')) === JSON.stringify({ coin: 'SYRUP', kind: 'stop_loss', triggerMode: 'price_move_pct', triggerValue: 10 }) &&
        parseGuardianArm('take profit on eth at +25%')?.kind === 'take_profit' &&
        parseGuardianArm('stop loss on syrup at $0.12')?.triggerMode === 'price' &&
        parseGuardianArm('what is a stop loss?') === null &&
        parseGuardianArm('protect my position') === null,
    )

    // Submit relay: the signature IS the auth — recover mismatch and guard
    // failures refuse before the venue ever sees anything.
    const relayBad = await fetch(`${BASE}/api/hl/submit`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({}) })
    check('hl submit: garbage → 400', relayBad.status === 400)
    const signer = privateKeyToAccount(generatePrivateKey())
    const sig = await signer.signTypedData({ domain: td.domain, types: td.types, primaryType: 'Agent', message: td.message } as Parameters<typeof signer.signTypedData>[0])
    const relayWrongFrom = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, nonce: 1752440000000, signature: sig, from: owner.address, expected: { coin: 'ETH', kind: 'open', isBuy: true } }),
    })
    const relayStale = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action, nonce: 1752440000000, signature: sig, from: signer.address, expected: { coin: 'ETH', kind: 'open', isBuy: true } }),
    })
    check('hl submit: signer≠from → 403; stale nonce → 400', relayWrongFrom.status === 403 && relayStale.status === 400)
    // Leverage-update path: expected.leverage is the contract; a PROPERLY
    // signed but stale leverage action still dies on nonce staleness (same
    // discipline as orders — recovery first, then freshness).
    const levWireAction = { type: 'updateLeverage' as const, asset: 0, isCross: true, leverage: 2 }
    const relayLevNoExp = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: levWireAction, nonce: 1752440000000, signature: sig, from: signer.address, expected: { coin: 'ETH' } }),
    })
    const levStaleTd = hlActionTypedData(levWireAction, 1752440000000)
    const levStaleSig = await signer.signTypedData({ domain: levStaleTd.domain, types: levStaleTd.types, primaryType: levStaleTd.primaryType, message: levStaleTd.message } as Parameters<typeof signer.signTypedData>[0])
    const relayLevStale = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: levWireAction, nonce: 1752440000000, signature: levStaleSig, from: signer.address, expected: { coin: 'ETH', leverage: 2 } }),
    })
    check('hl submit: leverage update without expected.leverage → 400; stale leverage nonce → 400', relayLevNoExp.status === 400 && relayLevStale.status === 400)
  }

  // ── App Mode panel swap (POST /api/panels/swap) ───────────────────────────
  // The panel's quote+build endpoint — same builders as chat, so this only
  // asserts the ROUTE contract (validation + honest errors + artifact shape),
  // not the venue logic the tx-layer sections already cover.
  // ── Venue-native fees: CoW partnerFee appData + Uniswap v3 sweep split ────
  console.log('— venue fees')
  check(
    'venue fees: cow appData carries the protocol partner fee (bps + treasury) when the fee is on',
    SWAP_FEE_BPS === 0 ||
      (COW_APP_DATA_JSON.includes(`"partnerFee":{"bps":${SWAP_FEE_BPS},"recipient":"${TREASURY_ADDRESS}"`) &&
        COW_APP_DATA_HASH === keccak256(stringToBytes(COW_APP_DATA_JSON))),
  )
  const tamperApp = pureChecks(
    { ...cowFixture, order: { ...cowFixture.order, appData: '0x' + 'de'.repeat(32), validTo: gNow + 1200 } },
    gFrom, gNow,
  )
  check(
    'venue fees: an order signing someone else\'s appData BLOCKS (fee stripping refused)',
    !buildReport(null, tamperApp).ok && tamperApp.find((c) => c.id === 'app-data')?.ok === false,
  )
  const submitTamper = await fetch(`${BASE}/api/cow/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      chainId: 8453,
      from: gFrom,
      signature: '0x' + '11'.repeat(65),
      order: { ...cowFixture.order, appData: '0x' + 'de'.repeat(32), validTo: Math.floor(Date.now() / 1000) + 1200 },
    }),
  })
  check(
    'venue fees: submit relay refuses a foreign-appData order (403, never relayed)',
    submitTamper.status === 403 && /appData/i.test(((await submitTamper.json()) as { error?: string }).error ?? ''),
  )
  // Live v3 build via the panel route (server-side env; SAME builder as
  // chat): the multicall must be [swap → router sentinel, sweep → user
  // minus feeBips to the treasury] — decoded, never trusted. Mirrors the
  // panel-swap check's tolerance: a spend-policy refusal is also honest.
  {
    const feeQuote = await fetch(`${BASE}/api/panels/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: owner.address, chainId: 8453, sellToken: 'USDC', buyToken: 'WETH', amountHuman: '1' }),
    })
    const fq = (await feeQuote.json()) as { ok?: boolean; txChain?: { steps?: { label: string; tx?: { data?: string } }[] }; policyBlock?: unknown; error?: string }
    const feeSwapStep = fq?.txChain?.steps?.find((s) => s.label === 'swap')
    if (fq?.ok && typeof feeSwapStep?.tx?.data === 'string' && SWAP_FEE_BPS > 0) {
      try {
        const mc = decodeFunctionData({
          abi: parseAbi(['function multicall(uint256 deadline, bytes[] data) payable returns (bytes[] results)']),
          data: feeSwapStep.tx.data as `0x${string}`,
        })
        const inner = mc.args[1] as readonly `0x${string}`[]
        const swapDec = decodeFunctionData({
          abi: parseAbi([
            'struct ExactInputSingleParams { address tokenIn; address tokenOut; uint24 fee; address recipient; uint256 amountIn; uint256 amountOutMinimum; uint160 sqrtPriceLimitX96; }',
            'function exactInputSingle(ExactInputSingleParams params) payable returns (uint256)',
          ]),
          data: inner[0],
        })
        const sweepDec = decodeFunctionData({
          abi: parseAbi(['function sweepTokenWithFee(address token, uint256 amountMinimum, address recipient, uint256 feeBips, address feeRecipient) payable']),
          data: inner[1],
        })
        const swapArgs = swapDec.args[0] as { recipient: string; amountOutMinimum: bigint }
        const [, sweepMin, sweepRecipient, sweepBips, sweepFeeRecipient] = sweepDec.args as readonly [string, bigint, string, bigint, string]
        check(
          'venue fees: uniswap v3 output routes via the router + sweepTokenWithFee(user, SWAP_FEE_BPS, treasury)',
          inner.length === 2 &&
            swapArgs.recipient.toLowerCase() === '0x0000000000000000000000000000000000000002' &&
            sweepRecipient.toLowerCase() === owner.address.toLowerCase() &&
            sweepBips === BigInt(SWAP_FEE_BPS) &&
            sweepFeeRecipient.toLowerCase() === TREASURY_ADDRESS.toLowerCase() &&
            sweepMin === swapArgs.amountOutMinimum,
          `calls=${inner.length} bips=${sweepBips}`,
        )
      } catch (e) {
        check('venue fees: uniswap v3 fee multicall decodes', false, String(e).slice(0, 120))
      }
    } else {
      check(
        'venue fees: uniswap v3 fee build (live via panel route) — built or policy-refused honestly',
        fq?.ok === true || fq?.policyBlock !== undefined,
        JSON.stringify(fq).slice(0, 140),
      )
    }
  }

  console.log('— panel swap')
  {
    const bad = await fetch(`${BASE}/api/panels/swap`, { method: 'POST', body: 'not json' })
    const missing = await fetch(`${BASE}/api/panels/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: '0x123', sellToken: 'USDC' }),
    })
    check('panel swap: garbage → 400, missing fields → 400', bad.status === 400 && missing.status === 400)
    const unknown = await fetch(`${BASE}/api/panels/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: owner.address, chainId: 8453, sellToken: 'USDC', buyToken: 'ZZZZNOTATOKEN', amountHuman: '1' }),
    })
    const unknownBody = await unknown.json()
    check('panel swap: unknown token → honest error, nothing built', unknown.status === 502 && /unknown buy token/i.test(String(unknownBody.error ?? '')))
    const quote = await fetch(`${BASE}/api/panels/swap`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: owner.address, chainId: 8453, sellToken: 'USDC', buyToken: 'ETH', amountHuman: '1' }),
    })
    const q = await quote.json()
    const steps = q?.txChain?.steps
    // Two honest outcomes: the artifact builds (chat-identical txChain), or
    // the wallet's own spend policy refuses it (the harness owner picks up a
    // restrictive policy in earlier sections — the refusal PROVES the panel
    // route runs the same policy gate as chat).
    const builtOk =
      q?.ok === true &&
      Array.isArray(steps) &&
      steps.length >= 1 &&
      steps[steps.length - 1].label === 'swap' &&
      typeof steps[steps.length - 1].tx?.data === 'string' &&
      q.txChain.refresh?.kind === 'uniswap-swap' &&
      q.txChain.refresh?.params?.chainId === '8453' &&
      typeof q.minReceived === 'string'
    const policyBlocked = q?.blocked === true && q?.blockKind === 'policy' && !!q?.guardrails && /spend policy|NOT_ALLOWED/i.test(String(q?.reasons ?? ''))
    check(
      'panel swap: USDC→ETH builds the chat-identical txChain OR the spend policy refuses (same gate as chat)',
      builtOk || policyBlocked,
      !(builtOk || policyBlocked) ? JSON.stringify(q).slice(0, 160) : policyBlocked ? 'policy refused — gate live' : '',
    )
  }

  // ── Wallet briefing (pure composer — the "what Yeetful noticed" tile) ─────
  console.log('— wallet briefing')
  {
    const pos = (over: Partial<BriefingPosition> = {}): BriefingPosition => ({
      coin: 'ETH', side: 'long', positionValueUsd: 412.5, unrealizedPnl: 12.4, leverage: 4, ...over,
    })
    const empty: BriefingInputs = { firedRecently: [], positions: [], protectedCoins: [], spotProtectedSymbols: [], funding: null, aave: null, failed: [] }

    // Unprotected position → the loud row, chip round-trips parseGuardianArm.
    const naked = composeBriefingItems({ ...empty, positions: [pos()] })
    const nakedChip = naked[0]?.actions?.[0]
    const nakedArm = nakedChip ? parseGuardianArm(nakedChip.prompt) : null
    check(
      'briefing: unprotected position → neg row + guardian chip that round-trips',
      naked.length === 1 && naked[0].tone === 'neg' && !!nakedArm && nakedArm.coin === 'ETH' && nakedArm.kind === 'stop_loss' && nakedArm.triggerValue === 10,
      JSON.stringify(naked).slice(0, 200),
    )
    // Protected position → quiet pos row, NO chip (active guardian never nags).
    const guarded = composeBriefingItems({ ...empty, positions: [pos()], protectedCoins: ['eth'] })
    check(
      'briefing: protected position → pos row, no actions (case-insensitive join)',
      guarded.length === 1 && guarded[0].tone === 'pos' && !guarded[0].actions,
    )
    // Dust positions never surface.
    check('briefing: dust position filtered', composeBriefingItems({ ...empty, positions: [pos({ positionValueUsd: 5 })] }).length === 0)

    const fundingBase = { readChains: ['Base', 'Arbitrum', 'Ethereum'], failedChains: [] as string[] }
    // Stranded USDC with an L2 ETH donor → unstick chip round-trips the
    // cross-chain parser; mainnet-only donors never chip (the #551 lesson).
    const stuck = composeBriefingItems({
      ...empty,
      funding: {
        ...fundingBase,
        sources: [{ chainId: 8453, chainWord: 'Base', token: 'ETH', balance: 0.004, usd: 7.5 }],
        stranded: [{ chainId: 42161, chainWord: 'Arbitrum', token: 'USDC', balance: 12, usd: 12 }],
      },
    })
    const stuckChip = stuck.find((r) => /stuck/.test(r.label))?.actions?.[0]
    const cc = stuckChip ? parseCrossChainSwap(stuckChip.prompt) : null
    check(
      'briefing: stranded USDC + L2 donor → unstick chip round-trips (base → arbitrum)',
      !!cc && !('problem' in cc) && cc.originChain === 'base' && cc.destinationChain === 'arbitrum',
      stuckChip ? stuckChip.prompt : 'no chip',
    )
    const stuckMainnetDonor = composeBriefingItems({
      ...empty,
      funding: {
        ...fundingBase,
        sources: [{ chainId: 1, chainWord: 'Ethereum', token: 'ETH', balance: 0.01, usd: 19 }],
        stranded: [{ chainId: 42161, chainWord: 'Arbitrum', token: 'USDC', balance: 12, usd: 12 }],
      },
    })
    check(
      'briefing: mainnet-only donor → stranded named but never chipped',
      stuckMainnetDonor.length === 1 && !stuckMainnetDonor[0].actions,
    )
    // Stranded ETH is the missing gas itself — named honestly, never
    // chipped, never a neg nag (the #551 "said out loud" rule); dust ETH
    // isn't even named.
    const stuckEth = composeBriefingItems({
      ...empty,
      funding: { ...fundingBase, sources: [], stranded: [{ chainId: 1, chainWord: 'Ethereum', token: 'ETH', balance: 0.0018, usd: 3.45 }] },
    })
    check(
      'briefing: sub-floor mainnet ETH → honest "not worth moving", no chip, no nag',
      stuckEth.length === 1 && !stuckEth[0].actions && stuckEth[0].tone === undefined && /not worth moving/.test(stuckEth[0].value ?? ''),
      JSON.stringify(stuckEth).slice(0, 160),
    )
    check('briefing: dust stranded ETH not even named', composeBriefingItems({
      ...empty,
      funding: { ...fundingBase, sources: [], stranded: [{ chainId: 42161, chainWord: 'Arbitrum', token: 'ETH', balance: 0.0004, usd: 0.8 }] },
    }).length === 0)
    // Mainnet-stranded USDC: the ~$8 unstick only pays for a real balance —
    // $12 gets named without a chip, $40 gets the 0.004 ETH donor leg.
    const mainnetStuckSmall = composeBriefingItems({
      ...empty,
      funding: { ...fundingBase, sources: [{ chainId: 8453, chainWord: 'Base', token: 'ETH', balance: 0.004, usd: 7.5 }], stranded: [{ chainId: 1, chainWord: 'Ethereum', token: 'USDC', balance: 12, usd: 12 }] },
    })
    const mainnetStuckBig = composeBriefingItems({
      ...empty,
      funding: { ...fundingBase, sources: [{ chainId: 8453, chainWord: 'Base', token: 'ETH', balance: 0.004, usd: 7.5 }], stranded: [{ chainId: 1, chainWord: 'Ethereum', token: 'USDC', balance: 40, usd: 40 }] },
    })
    const bigChip = mainnetStuckBig[0]?.actions?.[0]
    const bigCc = bigChip ? parseCrossChainSwap(bigChip.prompt) : null
    check(
      'briefing: mainnet unstick gated on balance — $12 named only, $40 chips 0.004 ETH base→ethereum',
      mainnetStuckSmall.length === 1 && !mainnetStuckSmall[0].actions &&
        !!bigCc && !('problem' in bigCc) && bigCc.amount === '0.004' && bigCc.originChain === 'base' && bigCc.destinationChain === 'ethereum',
      bigChip ? bigChip.prompt : 'no chip',
    )
    // Idle USDC → soft chips, both round-tripping their parsers, chain named.
    const idle = composeBriefingItems({
      ...empty,
      funding: { ...fundingBase, sources: [{ chainId: 8453, chainWord: 'Base', token: 'USDC', balance: 180, usd: 180 }], stranded: [] },
    })
    const workChip = idle[0]?.actions?.[0]
    const dcaChip = idle[0]?.actions?.[1]
    const swapChip = idle[0]?.actions?.[2]
    const swapIntent = swapChip ? parseSwapIntent(swapChip.prompt) : null
    check(
      'briefing: idle USDC → rebalance + DCA + swap chips that round-trip (swap names the chain)',
      idle.length === 1 && !!workChip && parseRebalanceAsk(workChip.prompt) &&
        !!dcaChip && !!parseDcaCreate(dcaChip.prompt) &&
        !!swapIntent && swapIntent.isSwap && !swapIntent.problem && swapIntent.sellToken === 'USDC' && /on Base/i.test(swapChip!.prompt),
      JSON.stringify(idle[0]?.actions).slice(0, 160),
    )
    check('briefing: dust USDC never reads as idle', composeBriefingItems({
      ...empty,
      funding: { ...fundingBase, sources: [{ chainId: 8453, chainWord: 'Base', token: 'USDC', balance: 10, usd: 10 }], stranded: [] },
    }).length === 0)
    // Fired standing intents lead the tile as loud pos rows — never a nag.
    const firedRows = composeBriefingItems({
      ...empty,
      firedRecently: [{ kind: 'guardian', label: 'Stop-loss fired · closed your ETH long', valueUsd: 11.93, when: 'yesterday' }],
      positions: [pos()],
    })
    check(
      'briefing: fired events lead the tile, pos tone, never counted as needs-you',
      firedRows.length === 2 && firedRows[0].tone === 'pos' && /fired/.test(firedRows[0].label) && briefingNeedsCount(firedRows) === 1,
      JSON.stringify(firedRows[0]).slice(0, 160),
    )

    // Spot-guard suggestion: large unwatched Base ETH chips the spot arm
    // (round-trips parseSpotGuardArm); armed → quiet pos row; small → silent.
    const bigEth = { chainId: 8453, chainWord: 'Base', token: 'ETH' as const, balance: 0.22, usd: 412 }
    const unwatched = composeBriefingItems({ ...empty, funding: { ...fundingBase, sources: [bigEth], stranded: [] } })
    const spotChip = unwatched.find((r) => /unwatched/.test(r.label))?.actions?.[0]
    const spotAsk = spotChip ? parseSpotGuardArm(spotChip.prompt) : null
    check(
      'briefing: large unwatched Base ETH → spot-guard chip that round-trips',
      !!spotAsk && spotAsk.token === 'ETH' && spotAsk.triggerMode === 'price_move_pct' && spotAsk.triggerValue === 10,
      spotChip ? spotChip.prompt : 'no chip',
    )
    const watched = composeBriefingItems({ ...empty, spotProtectedSymbols: ['ETH'], funding: { ...fundingBase, sources: [bigEth], stranded: [] } })
    check(
      'briefing: spot-protected ETH → quiet pos row, no chip',
      watched.length === 1 && watched[0].tone === 'pos' && !watched[0].actions,
    )
    check('briefing: small ETH never nags for a guard', composeBriefingItems({ ...empty, funding: { ...fundingBase, sources: [{ ...bigEth, usd: 50 }], stranded: [] } }).length === 0)

    // Aave HF drift only with live debt; healthy or debt-free stays silent.
    check(
      'briefing: HF < 1.5 with debt → neg row; no debt or healthy HF → silent',
      composeBriefingItems({ ...empty, aave: { healthFactor: 1.2, hasBorrows: true } }).length === 1 &&
        composeBriefingItems({ ...empty, aave: { healthFactor: 1.2, hasBorrows: false } }).length === 0 &&
        composeBriefingItems({ ...empty, aave: { healthFactor: 2.1, hasBorrows: true } }).length === 0,
    )
    // Nothing noticed → NO tile (affinity contract), and the headline counts
    // only the rows that need the user.
    check('briefing: zero items → null tile, never an empty card', briefingTile([]) === null)
    const tile = briefingTile(composeBriefingItems({ ...empty, positions: [pos(), pos({ coin: 'SYRUP', positionValueUsd: 80 })], protectedCoins: ['SYRUP'] }))
    check(
      'briefing: tile headline counts neg rows only',
      !!tile && tile.headline?.value === '1 needs you' && tile.rows.length === 2 && briefingNeedsCount(tile.rows) === 1,
      JSON.stringify(tile?.headline),
    )
  }

  // ── Rebalance (pure planner: gas honesty, economics floor, chip contract) ─
  console.log('— rebalance')
  {
    const scanBase = { ethUsd: 2000, readChains: ['Base', 'Arbitrum', 'Ethereum'], failedChains: [] as string[], stranded: [] as RebalanceInputs['scan']['stranded'] }
    const rates = { aaveUsdcSupplyApyPct: 4.2, lidoAprPct: 2.9 }
    const earning = { aaveSuppliedUsd: 0, lidoStakedUsd: 0 }
    const src = (chainId: number, chainWord: string, token: 'ETH' | 'USDC', balance: number, usd: number) =>
      ({ chainId, chainWord, token, balance, usd })

    // Grammar: the surfaced asks claim; reads and venue asks never do.
    check(
      'rebalance: grammar claims the surfaced asks',
      parseRebalanceAsk('Rebalance my portfolio') && parseRebalanceAsk('put my idle money to work') &&
        parseRebalanceAsk('Where could my money earn more?') && parseRebalanceAsk('make my money work harder'),
    )
    check(
      'rebalance: reads + venue asks never claimed ("balance" is not "rebalance")',
      !parseRebalanceAsk("what's my balance") && !parseRebalanceAsk('swap 5 USDC for ETH on base') &&
        !parseRebalanceAsk('supply 10 USDC to aave') && !parseRebalanceAsk('stake 0.1 eth on lido'),
    )

    // L2 USDC + mainnet gas → bridge → supply, ONE job, arrival haircut on
    // the supplied amount (the action never asks for more than arrives).
    const p1 = planRebalance({ scan: { ...scanBase, sources: [src(8453, 'Base', 'USDC', 500, 500), src(1, 'Ethereum', 'ETH', 0.01, 20)] }, rates, earning })
    const p1job = p1.kind === 'plan' ? compileJobAsk(p1.ask) : null
    check(
      'rebalance: L2 USDC + mainnet gas → bridge→supply plan that compiles as one job',
      p1.kind === 'plan' && p1.moves.length === 1 && p1.moves[0].venue === 'aave' && p1.moves[0].gasLeg === null &&
        !!p1job && !('problem' in p1job) && p1job.steps.map((s) => `${s.kind}:${s.builder}`).join(' ') === 'sign:native-cross-chain wait:wait sign:native-aave-supply' &&
        /supply 480 USDC to aave$/.test(p1.ask),
      p1.kind === 'plan' ? p1.ask : JSON.stringify(p1),
    )

    // Gasless mainnet + an L2 ETH donor → the plan buys its own signature
    // (gas leg first), and the standalone chip carries it too.
    const p2 = planRebalance({ scan: { ...scanBase, sources: [src(8453, 'Base', 'USDC', 500, 500), src(8453, 'Base', 'ETH', 0.02, 40)] }, rates, earning })
    const p2gas = p2.kind === 'plan' ? p2.moves[0]?.gasLeg : null
    const p2cc = p2gas ? parseCrossChainSwap(p2gas) : null
    const p2job = p2.kind === 'plan' ? compileJobAsk(p2.ask) : null
    check(
      'rebalance: gasless mainnet → explicit gas leg leads (ETH → Ethereum), plan still compiles',
      p2.kind === 'plan' && !!p2cc && !('problem' in p2cc) && p2cc.destinationChain === 'ethereum' && p2cc.destinationToken?.toUpperCase() === 'ETH' &&
        p2.ask.startsWith(p2gas!) && !!p2job && !('problem' in p2job),
      p2.kind === 'plan' ? p2.ask : JSON.stringify(p2),
    )

    // Both venues: the ETH move's arrivals ARE the mainnet gas — the
    // combined batch drops the USDC move's gas leg, the standalone keeps it.
    const p3 = planRebalance({ scan: { ...scanBase, sources: [src(8453, 'Base', 'USDC', 500, 500), src(42161, 'Arbitrum', 'ETH', 0.2, 400)] }, rates, earning })
    const p3aave = p3.kind === 'plan' ? p3.moves.find((m) => m.venue === 'aave') : undefined
    const p3solo = p3aave ? compileJobAsk(moveAsk(p3aave)) : null
    const p3job = p3.kind === 'plan' ? compileJobAsk(p3.ask) : null
    check(
      'rebalance: both venues → one batch (ETH bridge funds gas, no explicit gas leg); standalone USDC chip stays self-funding',
      p3.kind === 'plan' && p3.moves.length === 2 && !!p3aave?.gasLeg && !p3.ask.includes(p3aave.gasLeg) &&
        !!p3job && !('problem' in p3job) && p3job.steps.filter((s) => s.kind === 'sign').length === 4 &&
        /supply .* to aave, then stake .* eth on lido$/.test(p3.ask) &&
        !!p3solo && !('problem' in p3solo) && moveAsk(p3aave).startsWith(p3aave.gasLeg),
      p3.kind === 'plan' ? p3.ask : JSON.stringify(p3),
    )

    // Economics floor: small idle money gets the arithmetic, not a plan.
    const p4 = planRebalance({ scan: { ...scanBase, sources: [src(8453, 'Base', 'USDC', 30, 30), src(1, 'Ethereum', 'ETH', 0.01, 20)] }, rates, earning })
    check(
      'rebalance: small idle USDC → honest quiet naming the yearly math',
      p4.kind === 'quiet' && p4.notes.some((n) => /would earn ~\$1\.2\d\/yr/.test(n) && /move costs/.test(n)),
      JSON.stringify(p4),
    )

    // Unreadable rates are skipped BY NAME — never guessed.
    const p5 = planRebalance({ scan: { ...scanBase, sources: [src(8453, 'Base', 'USDC', 500, 500), src(1, 'Ethereum', 'ETH', 0.01, 20)] }, rates: { aaveUsdcSupplyApyPct: null, lidoAprPct: null }, earning })
    check(
      'rebalance: null rates → both venues sit out by name, quiet plan',
      p5.kind === 'quiet' && p5.notes.some((n) => /Aave/.test(n) && /not guessing/.test(n)) && p5.notes.some((n) => /Lido/.test(n) && /not guessing/.test(n)),
      JSON.stringify(p5.notes),
    )

    // Stranded money + failed chains are named (the #549 rule), and what's
    // already earning shows in the picture.
    const p6 = planRebalance({
      scan: { ...scanBase, failedChains: ['Arbitrum'], stranded: [src(8453, 'Base', 'USDC', 20, 20)], sources: [] },
      rates,
      earning: { aaveSuppliedUsd: 52, lidoStakedUsd: 0 },
    })
    check(
      'rebalance: stranded + failed chains + already-earning all named in the quiet',
      p6.kind === 'quiet' && p6.notes.some((n) => /Arbitrum didn't answer/.test(n)) &&
        p6.notes.some((n) => /no gas to move/.test(n)) && p6.notes.some((n) => /\$52\.00 supplied on Aave/.test(n)),
      JSON.stringify(p6.notes),
    )

    // No mainnet gas and no donor → the USDC move is named, never offered
    // (funds that land where the wallet can't sign are stranded).
    const p7 = planRebalance({ scan: { ...scanBase, sources: [src(8453, 'Base', 'USDC', 500, 500)] }, rates, earning })
    check(
      'rebalance: no gas anywhere → move refused by name, top-up asked',
      p7.kind === 'quiet' && p7.notes.some((n) => /can't sign on Ethereum/.test(n) && /top up mainnet gas/.test(n)),
      JSON.stringify(p7.notes),
    )

    // The live gate: no wallet → connect; harness wallet → live scan turn
    // (quiet or plan, buildPath pins the layer; RPC-down answers honestly).
    const rbNoWallet = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Rebalance my portfolio', activeServers: [] }),
    }).then((r) => r.json())
    check('rebalance: gate asks to connect without a wallet', rbNoWallet.connectWallet === true && /rebalance read/i.test(rbNoWallet.reply ?? ''))
    const rbLive = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: 'Rebalance my portfolio', activeServers: [], walletAddress: '0x1111111111111111111111111111111111111111' }),
    }).then((r) => r.json())
    check(
      'rebalance: live gate claims the turn (quiet/plan/honest-unreadable)',
      rbLive.buildPath === 'native-rebalance' && typeof rbLive.reply === 'string' && rbLive.reply.startsWith('💸'),
      String(rbLive.reply).slice(0, 120),
    )
  }

  // ── Spot guardian (pure: grammar, permission, trigger, fail-closed guard) ─
  console.log('— spot guardian (pure)')
  {
    const OWNER = '0x5EaaBd731d2Bc0490C2D47e41858e9b0629455a0'
    const SPENDER = '0x1111111111111111111111111111111111111111'
    const WETH = '0x4200000000000000000000000000000000000006'
    const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const ROUTER = '0x2626664c2603336E57B271c5C0b26F421741e481'
    const guardChain = { chainId: 8453, usdcAddress: USDC, swapRouter02: ROUTER, wethAddress: WETH }
    const NOW = 1_753_700_000

    // Grammar — DISJOINT from the HL guardian's by construction: side/venue
    // words always mean perps; spot needs its own marker.
    const a1 = parseSpotGuardArm('Protect my spot ETH with a 10% stop loss')
    check('spot arm: pct grammar', !!a1 && a1.token === 'ETH' && a1.triggerMode === 'price_move_pct' && a1.triggerValue === 10 && !a1.amountHuman)
    const a2 = parseSpotGuardArm('Protect 0.5 spot ETH with a 10% stop loss')
    check('spot arm: sized grammar carries the amount', !!a2 && a2.amountHuman === '0.5' && a2.token === 'ETH')
    const a3 = parseSpotGuardArm('Protect the ETH in my wallet with a 10% stop loss')
    check('spot arm: "in my wallet" marker works without the word spot', !!a3 && a3.token === 'ETH')
    const a4 = parseSpotGuardArm('Protect my spot ETH with a stop loss at $1500')
    const a5 = parseSpotGuardArm('Protect my spot ETH if it drops to $1500')
    check('spot arm: absolute-price grammars', !!a4 && a4.triggerMode === 'price' && a4.triggerValue === 1500 && !!a5 && a5.triggerValue === 1500)
    check(
      'spot arm: perp asks refused (long/position/hl belong to the HL guardian)',
      parseSpotGuardArm('Protect my ETH long with a 10% stop loss') === null &&
        parseSpotGuardArm('Protect my ETH position at -8%') === null &&
        parseSpotGuardArm('Protect my spot ETH long with a 10% stop loss') === null,
    )
    check('spot arm: bare protect (no spot marker) stays with the HL layer', parseSpotGuardArm('Protect my ETH with a 10% stop loss') === null)
    const mg = parseSpotGuardManage('cancel my ETH spot protection')
    check('spot manage: cancel/pause grammar', !!mg && mg.op === 'cancel' && mg.token === 'ETH' && parseSpotGuardManage('pause my spot stop loss')?.op === 'pause')

    // Permission: one-shot by construction.
    const amount = BigInt('500000000000000000') // 0.5 ETH
    const perm = buildSpotGuardPermission({ account: OWNER, spender: SPENDER, token: NATIVE_TOKEN_SENTINEL, amountAtoms: amount, nowSec: NOW, salt: BigInt(42) })
    check('spot permission: period spans the whole life (total pullable = the amount, once)', perm.period === perm.end - perm.start && perm.allowance === amount)
    const pm = permissionMatchesPolicy(perm, { ownerWallet: OWNER, spender: SPENDER, tokenAddress: NATIVE_TOKEN_SENTINEL, amountAtoms: amount, nowSec: NOW })
    const pmBad = permissionMatchesPolicy({ ...perm, allowance: amount * BigInt(2) }, { ownerWallet: OWNER, spender: SPENDER, tokenAddress: NATIVE_TOKEN_SENTINEL, amountAtoms: amount, nowSec: NOW })
    check('spot permission: policy agreement passes clean, refuses a doubled allowance', pm.ok && !pmBad.ok)

    // Trigger math: fires at/below the line, malformed never fires.
    const trig = { mode: 'price_move_pct' as const, value: 10, refPrice: 2000 }
    check('spot trigger: pct fires at/below the line, never above', spotTriggerFired(trig, 1800).fired && spotTriggerFired(trig, 1799).fired && !spotTriggerFired(trig, 1801).fired)
    check(
      'spot trigger: malformed inputs never fire',
      !spotTriggerFired({ mode: 'price_move_pct', value: 95, refPrice: 2000 }, 1).fired &&
        !spotTriggerFired({ mode: 'price', value: 0, refPrice: 0 }, 1).fired &&
        !spotTriggerFired(trig, NaN).fired,
    )

    // The fail-closed guard: fabricate the exact steps the sweep would build.
    const depositAbi = [{ name: 'deposit', type: 'function', stateMutability: 'payable', inputs: [], outputs: [] }] as const
    const wrapStep = { to: WETH, data: encodeFunctionData({ abi: depositAbi, functionName: 'deposit' }), value: amount.toString() }
    const approveStep = { to: WETH, data: encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [ROUTER as `0x${string}`, amount] }), value: '0' }
    const mkSwapStep = (over: Record<string, unknown> = {}) => ({
      to: ROUTER,
      value: '0',
      data: encodeFunctionData({
        abi: SWAP_ROUTER_02_ABI,
        functionName: 'multicall',
        args: [BigInt(NOW + 600), [encodeFunctionData({
          abi: SWAP_ROUTER_02_ABI,
          functionName: 'exactInputSingle',
          args: [{ tokenIn: WETH as `0x${string}`, tokenOut: USDC as `0x${string}`, fee: 500, recipient: OWNER as `0x${string}`, amountIn: amount, amountOutMinimum: BigInt(900000000), sqrtPriceLimitX96: BigInt(0), ...over } as never],
        })]],
      }),
    })
    const guardBase = {
      policy: { status: 'triggered', tokenAddress: NATIVE_TOKEN_SENTINEL, native: true, amountAtoms: amount, trigger: trig },
      permission: perm,
      ownerWallet: OWNER,
      spender: SPENDER,
      chain: guardChain,
      markPrice: 1750,
      minOutAtomic: BigInt(850000000),
      steps: [wrapStep, approveStep, mkSwapStep()],
      pulledAtomic: amount,
      nowSec: NOW,
    }
    const happy = guardSpotSell(guardBase)
    check('spot guard: native wrap+approve+sell to the OWNER passes every check', happy.ok, JSON.stringify(happy.checks.filter((c) => !c.ok)).slice(0, 200))
    check('spot guard: recipient ≠ owner refuses', !guardSpotSell({ ...guardBase, steps: [wrapStep, approveStep, mkSwapStep({ recipient: SPENDER })] }).ok)
    check('spot guard: minOut under the quote floor refuses', !guardSpotSell({ ...guardBase, steps: [wrapStep, approveStep, mkSwapStep({ amountOutMinimum: BigInt(1) })] }).ok)
    check('spot guard: un-fired trigger refuses the sell (mark re-checked)', !guardSpotSell({ ...guardBase, markPrice: 1990 }).ok)
    check('spot guard: pull ≠ allowance refuses', !guardSpotSell({ ...guardBase, pulledAtomic: amount + BigInt(1) }).ok)
    check('spot guard: unclaimed policy refuses (claim-before-build)', !guardSpotSell({ ...guardBase, policy: { ...guardBase.policy, status: 'active' } }).ok)
    check('spot guard: wrap value ≠ pull refuses', !guardSpotSell({ ...guardBase, steps: [{ ...wrapStep, value: (amount - BigInt(1)).toString() }, approveStep, mkSwapStep()] }).ok)
    // Share receipts: standing vs fired headlines, and the receipt's ask
    // round-trips the spot arm grammar (a shared receipt sells the exact move).
    const scStanding = spotGuardShareContent({ tokenSymbol: 'ETH', amountHuman: '0.5', triggerMode: 'price_move_pct', triggerValue: 10, refPrice: 2000, status: 'active' }, null)
    const scFired = spotGuardShareContent({ tokenSymbol: 'ETH', amountHuman: '0.5', triggerMode: 'price_move_pct', triggerValue: 10, refPrice: 2000, status: 'done' }, { status: 'sold', valueUsd: 912.4, markPrice: 1799.2 })
    check(
      'spot share: standing vs fired headlines + ask round-trips the arm grammar',
      /standing/i.test(scStanding.headline) && scStanding.valueUsd === null &&
        /fired/i.test(scFired.headline) && scFired.valueUsd === 912.4 &&
        !!scStanding.ask && parseSpotGuardArm(scStanding.ask) !== null,
      JSON.stringify({ s: scStanding.headline, f: scFired.headline, ask: scStanding.ask }).slice(0, 200),
    )
    const permW = buildSpotGuardPermission({ account: OWNER, spender: SPENDER, token: WETH, amountAtoms: amount, nowSec: NOW, salt: BigInt(7) })
    const erc = guardSpotSell({
      ...guardBase,
      policy: { ...guardBase.policy, tokenAddress: WETH, native: false },
      permission: permW,
      steps: [approveStep, mkSwapStep()],
    })
    check('spot guard: erc-20 approve+sell passes without a wrap', erc.ok, JSON.stringify(erc.checks.filter((c) => !c.ok)).slice(0, 200))
  }

  // ── Token charts (the uniform chart button + /t pages) ───────────────────
  console.log('— token charts')
  {
    // The resolver is the gate: it decides which rows grow the chart button
    // AND which symbols the candles proxy will touch. Fail-closed by design.
    check(
      'charts: resolver maps majors to Coinbase USD, collapses wrapped aliases',
      chartPairFor('ETH')?.pair === 'ETH-USD' &&
        chartPairFor('eth')?.source === 'coinbase' &&
        chartPairFor('WETH')?.pair === 'ETH-USD' &&
        chartPairFor('WBTC')?.pair === 'BTC-USD' &&
        chartPairFor('ETH')?.label === 'ETH / USD',
    )
    check(
      'charts: HL perps chart via hyperliquid, stables + stocks + garbage stay chartless',
      chartPairFor('HYPE')?.source === 'hyperliquid' &&
        chartPairFor('SYRUP')?.source === 'hyperliquid' &&
        chartPairFor('USDC') === null &&
        chartPairFor('USDG') === null &&
        // Tokenized stocks are the declared follow-up — this pin flips
        // consciously when a robinhood candle source lands.
        chartPairFor('AAPL') === null &&
        chartPairFor('$$$') === null &&
        chartPairFor('') === null,
    )
    const fakeCandles: Candle[] = Array.from({ length: 30 }, (_, i) => ({
      t: 1_700_000_000 + i * 3600, o: 100 + i, h: 101 + i, l: 99 + i, c: 100.5 + i, v: 10,
    }))
    const agg = aggregateCandles(fakeCandles, 14400)
    check(
      'charts: 4h aggregation buckets hourly candles with honest OHLCV',
      agg.length === 8 &&
        agg[0].o === fakeCandles[0].o &&
        agg[agg.length - 1].c === fakeCandles[29].c &&
        agg.every((c) => c.h >= c.l && c.h >= c.o && c.h >= c.c) &&
        agg.reduce((s, c) => s + c.v, 0) === 300,
      `buckets=${agg.length}`,
    )
    const nowSec = fakeCandles[29].t
    const chg = changePct24h(fakeCandles, nowSec)
    check('charts: 24h change anchors on the candle nearest 24h back', chg !== null && Math.abs(chg - ((129.5 - 105.5) / 105.5) * 100) < 0.01, `chg=${chg}`)

    // Candles proxy: unknown symbols never reach an upstream.
    const refuse = await fetch(`${BASE}/api/charts/candles?symbol=USDG&tf=1h`)
    const refuseBody = await refuse.json()
    check(
      'charts api: chartless symbol → shape-compatible refusal, no upstream probe',
      refuse.status === 200 && refuseBody.source === null && refuseBody.candles.length === 0 && refuseBody.error === 'no chart source',
    )
    const badSym = await fetch(`${BASE}/api/charts/candles?symbol=%3Cscript%3E&tf=1h`)
    check('charts api: malformed symbol → 400', badSym.status === 400)
    // Live feed (Coinbase public). Two honest outcomes: real candles with
    // sane OHLC ordering, or the named feed-down refusal — never a 500.
    const live = await fetch(`${BASE}/api/charts/candles?symbol=ETH&tf=1h`)
    const liveBody = await live.json()
    const liveCandles = (liveBody.candles ?? []) as Candle[]
    const liveOk =
      live.status === 200 &&
      liveBody.source === 'coinbase' &&
      liveCandles.length > 20 &&
      typeof liveBody.last === 'number' &&
      liveCandles.every((c) => c.h >= c.l && Number.isFinite(c.o) && Number.isFinite(c.v)) &&
      liveCandles.every((c, i) => i === 0 || c.t > liveCandles[i - 1].t)
    const feedDown = live.status === 200 && liveBody.error === 'feed unavailable'
    check('charts api: ETH 1h returns live ascending candles (or the named feed-down)', liveOk || feedDown, feedDown ? 'feed down — refusal shape verified' : `n=${liveCandles.length}`)

    // /t pages: chartable symbol gets the live pair page, chartless symbols
    // get the honest still-tradable page — both carry prefill CTAs only.
    const tEth = flat(await (await fetch(`${BASE}/t/ETH`)).text())
    // The hrefs are the contract (they must round-trip as chat prompts); the
    // labels are the pin — reword the bar and re-pin here together.
    check(
      '/t/ETH: pair header + prefill trade CTAs in the top bar (never auto-send)',
      /ETH \/ USD/.test(tEth) &&
        tEth.includes(`/chat?prompt=${encodeURIComponent('Buy $50 of ETH')}`) &&
        tEth.includes(`/chat?prompt=${encodeURIComponent('Sell $50 of ETH')}`) &&
        tEth.includes(`/chat?prompt=${encodeURIComponent('DCA $10 into ETH weekly')}`) &&
        tEth.includes('prefills chat · you send it') &&
        /Non-custodial/i.test(tEth),
    )
    // Full-bleed shell + the expand control ship in the server HTML: the page
    // is a chart workspace, not a centered article.
    check(
      '/t/ETH: full-bleed shell, no centered column, expand control present',
      /class="tchart"/.test(tEth) && !/<main className?="x-main"/.test(tEth) && /aria-label="Full screen chart"/.test(tEth),
    )
    const tUsdg = flat(await (await fetch(`${BASE}/t/USDG`)).text())
    check(
      '/t/USDG: chartless token stays honest + tradable',
      tUsdg.includes('No live chart for USDG yet') && tUsdg.includes(`/chat?prompt=${encodeURIComponent('Buy $50 of USDG')}`),
    )
    const tWeth = flat(await (await fetch(`${BASE}/t/weth`)).text())
    check('/t/weth: alias collapses to the ETH pair', /ETH \/ USD/.test(tWeth))
  }

  // ── Cleanup (verified) ────────────────────────────────────────────────────
  console.log('— cleanup')
  const delChat = await fetch(`${BASE}/api/chats/${chat.id}`, { method: 'DELETE', headers: C })
  const delGrant = await fetch(`${BASE}/api/grants/${grant.id}`, { method: 'DELETE', headers: C })
  const left = await Promise.all([
    (await fetch(`${BASE}/api/keys`, { headers: C })).json(),
    (await fetch(`${BASE}/api/grants`, { headers: C })).json(),
    (await fetch(`${BASE}/api/chats`, { headers: C })).json(),
    (await fetch(`${BASE}/api/orgs`, { headers: C })).json(),
  ])
  check(
    'all rows cleaned (keys, grants+ledger, chats, orgs)',
    delChat.status === 200 && delGrant.status === 200 && left.every((l) => Array.isArray(l) && l.length === 0),
  )

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
