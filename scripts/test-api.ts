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
import { resolveToken, COW_API_BASE, buildCowOrderTypedData, cowOrderAction, buildCowLimitOrder, buildCowSubmitBody, describeCowOrder, describeAmount, formatAtoms, tokenDecimals, tokenLabel, humanToAtoms, applySlippage, COW_APP_DATA_JSON, COW_APP_DATA_HASH, COW_CANONICAL_APP_DATA_HASHES, cowAppDataJson, cowAppDataHash, cowAppDataBpsOf, GPV2_SETTLEMENT, type CowQuoteResult } from '../lib/cow'
import { primeTokenList } from '../lib/token-list'
import { pairStockToken, stockChipLabel } from '../lib/stock-pairing'
import { chartPairFor, changePct24h, aggregateCandles, type Candle } from '../lib/charts'
import { pureChecks, policyCheck, orderValueUsd, buildReport } from '../lib/cow-guardrails'
import { policyCheckInflow, recipientCheck, validityCheck, MAX_VALID_SEC } from '../lib/tx-guardrails'
import { guardPlannerArtifact, PERMIT2_ADDRESS } from '../lib/planner-artifact-guard'
import { LIMIT_EXAMPLES, parseSwapIntent, swapClarify } from '../lib/swap-intent'
import { activeLinkCapFor, composeMcps, linkEyebrow, linkLockup, linkLockupWord } from '../lib/intent-links'
import { DEFAULT_TAB, parseTabParam, tabUrl } from '../lib/app-tab-url'
import { LINKS_STUDIO_HREF } from '../lib/links-href'
import { formatEarnedUsd, netFeeBpsFor, creatorEarningsUsd, FEE_BEARING_BUILD_PATHS, CROSS_CHAIN_FEE_BPS, CROSS_CHAIN_NET_FEE_BPS } from '../lib/fees'
import { BUILD_PATHS, venueOfBuildPath } from '../lib/build-path'

/** A venue label is a product name ('uniswap'); a build path is an internal
 *  one ('native-swap-lifi', 'app-mode-swap'). The public /activity payload must
 *  never print the latter where the former belongs. */
const isRawBuildPath = (venue: string) => venue.startsWith('native-') || venue.startsWith('app-mode-')
import { hexLuminance, normalizeAccent, normalizeBg, parseBrandHtml, validateBrandUrl } from '../lib/brand-scan'
import { brandBloomTint, brandCtaStyle, brandThemeStyle } from '../lib/brand-theme'
import {
  assertAgentIdentity,
  assertUnderDeskCap,
  cleanAgentKey,
  deskEnabled,
  DESK_MAX_INTENT_USD,
} from '../lib/broker-policy'
import {
  assertProposalBudget,
  assertRosterOpen,
  assertUnderSlotCap,
  cleanMandateInput,
  consentExpired,
  decideBench,
  decideProposalBudget,
  mandateHash,
  mintRosterNonce,
  rosterEnabled,
  rosterFireConsentMessage,
  rosterHireConsentMessage,
  verifyRosterConsent,
  ROSTER_DAILY_BUDGET_MULT,
  ROSTER_MAX_MANDATE_CHARS,
  ROSTER_MAX_PENDING_PROPOSALS,
} from '../lib/roster-policy'
import { cleanAgentKeyHash, cleanCapUsd, parseMandate, MANDATE_KIND_LABELS, ROSTER_MAX_CAP_USD } from '../lib/roster'
import { decideProposalGate } from '../lib/roster-propose'
import { decideManagerMove, stackingRefusal, undecidedProposalFor } from '../lib/roster-manager'
import { markPeriodKey, parseMarkAsk, reviewFlipDecision, tryoutReportCard, PAPER_LABEL, TRYOUT_BANNED_PHRASES } from '../lib/roster-tryouts'
import { houseManagerRow, resolveHouseManager, HOUSE_MANAGER_ID } from '../lib/roster-managers'
import { walletLineup, walletLaneHint, wcConfigured, WC_APP_METADATA } from '../lib/wallet-lineup'
import { buildDelivery, mintCallbackSecret, notifyEligible, signWebhook, validateCallbackUrl } from '../lib/broker-webhook'
import { agentHandleFor } from '../lib/agent-record'
import {
  foundingHandles,
  orderOpeningRoster,
  qualifiesForBoard,
  rankLeagueRows,
  showOrdinals,
  ORDINALS_MIN_QUALIFIED,
} from '../lib/league'
import { DOCS_PAGES } from '../lib/docs'
import prisma from '../lib/db'
import { identiconCells } from '../components/ManagerMark'
import { addrsUnion, arcQuery } from '../lib/gtm-arc'
import { isInternalRun, INTERNAL_RUN_HEADER } from '../lib/internal-run'
import { COUNTED_EVENT_SQL, COUNTED_EVENT_WHERE, decideReceiptVerdict, expectedReceiptClass, extractTxHash } from '../lib/link-receipt-verify'
import { deskExecuteConsentMessage, cleanSenderLabel } from '../lib/broker-exec'
import { brandFromRow, isDeniedBrandHost, THIRD_PARTY_BRAND_HOSTS } from '../lib/brand-denylist'
import { BRAND_PRESETS, colorFieldError, presetFor } from '../lib/brand-presets'
import { deskPricing, priceForTool, pricingBlock } from '../lib/broker-pricing'
import {
  clientIpFrom,
  decideTurnLimit,
  hashIp,
  limitKeysFor,
  UNSIGNED_IP_HOURLY_CAP,
  UNSIGNED_WALLET_HOURLY_CAP,
} from '../lib/turn-limits'
import { HOUSE_LINKS, houseLinkMarks } from '../lib/house-links'
import { EXPLAINER_VIDEO, explainerPosterUrl, explainerWatchUrl, isoDuration } from '../lib/explainer-video'
import { isDbChatId } from '../lib/chat-ids'
import { usdToTokenAmount } from '../lib/usd-probe'
import { parseRobinhoodBridge, guardRobinhoodBridge, RH_L1_INBOX, ARB_SYS } from '../lib/robinhood-bridge'
import { parseNftAsk, parseOpenSeaItemUrl, guardNftTransfer, ERC721_ABI as NFT_ERC721_ABI, ERC1155_ABI as NFT_ERC1155_ABI } from '../lib/nft-layer'
import { parseNftListAsk, parseNftMarketAsk, parseNftTransferFollowUp, nftTransferPending, nftAskFromPending } from '../lib/nft-layer'
import { nftGalleryChains, nftRowActions } from '../lib/nft-gallery'
import { groupCollections, marketReplyCopy, offersDisplay, valuationDisplay } from '../lib/nft-market'
import { nftGalleryOf, nftMarketOf } from '../lib/nft-display'
import { getProtocolMark, YeetfulMark, MorphoMark } from '../components/protocol-marks'
import { gemMarkSvg, ogMarkSvg } from '../lib/og-marks'
import { splitListingPrice, buildListingComponents, guardListingComponents, openseaAssetUrl, SEAPORT_1_6, guardBuyFulfillment, fulfillmentToCalldata, normalizeOpenseaListing, normalizeOpenseaOffer, collectionSlugCandidates } from '../lib/opensea'
import { keccak256, stringToBytes, decodeFunctionData, parseAbi, recoverMessageAddress, recoverTypedDataAddress } from 'viem'
import { isCacheable, routeCacheKey, getCached, setCached, clearRouteCache } from '../lib/route-cache'
import { routeSavings } from '../lib/route-telemetry'
import { portfolioFromToolResult, portfolioOf } from '../lib/portfolio-display'
import { jobContextFor } from '../lib/job-context'
import { crossChainAgentOf, detectCrossChain, swapWorkingContext } from '../lib/swap-intent'
import { encodeV4SwapCalldata, guardUniswapV4Build, type V4BuiltStep, type V4GuardExpectations, type V4PoolKey } from '../lib/uniswap-v4'
import { guardLifiBuild, isLifiNoRouteMessage, verifyLifiQuoteEcho, lifiPriceAcceptable, lifiRoutersFor, type LifiBuiltStep, type LifiGuardExpectations, type LifiQuote } from '../lib/lifi-venue'
import { clampNativeSellAtoms, fillableLeg, FUNDING_ALT_USDC, FUNDING_ORIGIN_CHAINS, FUNDING_ORIGIN_WORD, fundingAltUsdcFor, fundingNeedUsd, listWords, fundingSourceSymbols, LIFI_LEG_FLAT_USD, MIN_VALUE_LEG_USD, minLegNote, offChainStableSource, ROBINHOOD_CHAIN_ID, STABLE_LEG_MIN_OUT_BPS, GAS_LEG_LADDER_USD, GAS_LEG_USD, GAS_TOPUP_ETH, guardLifiBridgeBuild, lifiBridgeRoutersFor, parseRhFundingFollowUp, planDownsizedRobinhoodBuy, planRobinhoodFundingAdvice, planRobinhoodFundingChips, rhFundingPending, robinhoodBuyNeedUsd, verifyLifiBridgeEcho, type FundingOrigin, type LifiBridgeExpectations, type LifiBridgeStep } from '../lib/lifi-bridge'
import { classifyOneclickStatus, inflightDepositFromPending, inflightPendingData, inflightSettlingNote } from '../lib/inflight-funding'
import { sanitizeWorkingContext } from '../lib/working-context'
import { parseRobinhoodFunding, parseSameChainSwapSegment, JOB_SEGMENT_PARSERS } from '../lib/jobs'
import { parseMultiSendSegments, parseTransferSegment } from '../lib/transfer-exec'
import { buildFundsDetail, classifyTurn, FAILURE_PROBE_TOKENS, moneyShaped } from '../lib/ask-failure'
import { guardSyncDrift } from './guard-sync-check'
import { canonicalChainWord, normalizeChainWords } from '../lib/chain-lexicon'
import {
  clampFundUsd,
  classifyStripeOnrampFailure,
  fundChipFor,
  onrampAssetOf,
  onrampConsentMessage,
  planFundUsd,
  stripeOnrampParams,
  ONRAMP_ASSET,
  ONRAMP_CONSENT_TTL_MS,
  ONRAMP_ETH_KEEP_USD,
  ONRAMP_MAX_USD,
  ONRAMP_MIN_USD,
  STRIPE_NETWORK,
  STRIPE_UNSUPPORTABLE_CUSTOMER,
  STRIPE_WALLET_KEY,
} from '../lib/onramp'
import { clarifyOf } from '../lib/clarify'
import { fundingPathOf } from '../lib/funding-path'
import { decideFundingTurn, detectBalanceShortfall, FUNDING_CHAIN_WORD, FUNDING_SCAN_CHAINS, fundingPlanUsd, planFundingChips, planStrandedRescue, promisableCapacityUsd, rankFundingSources, shortRefusalCopy, softenClaimedFailureBlock, type FundingNeed, type FundingSource } from '../lib/funding-plan'
import { compileDcaBuy, dcaRunChip, parseDcaCreate, parseDcaManage, parseDcaRun, periodKeyFor } from '../lib/dca'
import { briefingNeedsCount, briefingTile, composeBriefingItems, type BriefingInputs, type BriefingPosition } from '../lib/briefing'
import { moveAsk, parseRebalanceAsk, planRebalance, type RebalanceInputs } from '../lib/rebalance'
import { fmtUnits, isMosaicAsk, MOSAIC_STABLE, mosaicAskString, mosaicStableFor, parseMosaicAsk, planMosaic, type MosaicHolding } from '../lib/mosaic'
import { simulateLadder } from './ask-ladder'
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
import { swapFeeAtoms, SWAP_FEE_BPS, LINK_SWAP_FEE_BPS, TREASURY_ADDRESS, HL_BUILDER_FEE_TENTH_BPS, HL_BUILDER_MAX_FEE_RATE } from '../lib/fees'
import { APP_CHAINS, chainById, chainByKey, chainNamedIn, explorerTokenUrl, primaryStable, sanitizeChainId } from '../lib/chains'
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
import {
  parseMorphoLend,
  parseMorphoOp,
  morphoCompetingVenueOf,
  guardMorphoOpBuild,
  parseMorphoLendFollowUp,
  parseMorphoOpFollowUp,
  pickLendMarket,
  pickCollateralMarket,
  pickDebtPosition,
  pickSuppliedPosition,
  pickBorrowPosition,
  MORPHO_OP_SELECTORS,
  MORPHO_SINGLETON,
  type MorphoOpGuardExpectation,
} from '../lib/morpho-supply'
import { assertTokenIdentity } from '../lib/morpho-exec'
import { splitSimpleReply } from '../lib/simple-reply'
import { decodeAbiParameters, encodeAbiParameters, encodeFunctionData, erc20Abi, toFunctionSelector } from 'viem'
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
  hlUnsizedChips,
  buildHlOrderAction,
  builderEligibleFromAccountValue,
  HL_BUILDER_MIN_ACCOUNT_USD,
  guardHlExecBuild,
  buildHlDeposit,
  buildHlLeverageAction,
  guardHlLeverageBuild,
  hlActionTypedData,
  hlCollateralTargetUsd,
  approveBuilderFeeArtifacts,
  guardHlBuilderFeeApproval,
  hlApproveBuilderFeeTypedData,
  hlConsentMessage,
  hlActionSummary,
  classifyHlSignFailure,
  isChainMismatchSignError,
  HL_CONSENT_HEADER,
  HL_BRIDGE2_ARBITRUM,
  HL_MIN_DEPOSIT_USDC,
  HL_MIN_ORDER_USD,
  ARBITRUM_USDC,
  type HlOrderIntent,
  type HlWireApproveBuilderFeeAction,
} from '../lib/hyperliquid-exec'
import { createL1ActionHash } from '@nktkas/hyperliquid/signing'
import { isReportableWalletError, walletErrorWords, WALLET_REFUSAL_KIND } from '../lib/wallet-refusal'
import { encryptAgentKey, signL1ActionWithDelegation } from '../lib/hl-guardian-store'
import { compileJobAsk as compileJobAskFull, stampSwapFeeTier, type CompiledJob } from '../lib/jobs'
import { LIVE_JOB_STATUSES, jobStatusWord, statusTone } from '../lib/step-status'

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
import {
  classifyLegacyTurn,
  INTERNAL_ORIGIN_SQL,
  INTERNAL_TRAFFIC_WHERE,
  isInternalOrigin,
  isInternalTurn,
  STANDING_TURN_SQL,
} from '../lib/value-origin'
import { cleanServerName } from '../lib/utils'
import { SITE_URL } from '../lib/site-url'
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

/** Every wallet this suite signed in with OR drove a chat turn for — the
 *  end-of-suite "no stranger left behind" pin reads exactly these back off
 *  the cohorts view. */
const SIGNED_IN_WALLETS = new Set<string>()
async function signIn(account: PrivateKeyAccount): Promise<string> {
  SIGNED_IN_WALLETS.add(account.address.toLowerCase())
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
//
// HARNESS HONESTY (the arrival-table extension of Q3, 2026-08-18): every
// request this suite makes to BASE carries `x-yf-internal-run: 1`, so every
// intent_links / wallet_working_sets / jobs row it mints is stamped
// is_internal and the GTM arc never counts a throwaway wallet as an arrival.
// Two deliberate exceptions: (1) /api/embed/telemetry keeps its PER-PROBE
// stamps — the referral fixtures there simulate ORGANIC strangers and the
// belt would silently break them (the Q3 lesson); (2) a probe that must look
// organic on purpose sends `x-yf-organic-probe: 1`, which the wrapper strips
// and honors (the arc pin below proves an organic mint DOES arrive).
const ORGANIC_PROBE = 'x-yf-organic-probe'
const realFetch = globalThis.fetch
globalThis.fetch = ((input: Parameters<typeof realFetch>[0], init?: RequestInit) => {
  const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
  // Roster + desk probes deliberately provoke refusals by the hundred — the
  // roster observability choke (lib/roster-observe, doors run) honors the
  // same opt-out. A pin that WANTS a row sends the header as '0' (the
  // server only honors '1'; present-but-'0' survives this belt).
  if (typeof url === 'string' && (url.includes('/api/roster') || url.includes('/api/broker'))) {
    const h = { ...((init?.headers as Record<string, string>) ?? {}) }
    if (!('x-yf-no-ask-log' in h)) h['x-yf-no-ask-log'] = '1'
    init = { ...(init ?? {}), headers: h }
  }
  if (typeof url === 'string' && url.includes('/api/chat')) {
    init = { ...(init ?? {}), headers: { ...((init?.headers as Record<string, string>) ?? {}), 'x-yf-no-ask-log': '1' } }
    // Connect-to-act turns carry the wallet in the BODY (no SIWE) — record it
    // so the end-of-suite "no stranger left" pin reads those wallets back too
    // (chat turns write jobs / dca_schedules / chats for them).
    if (typeof init.body === 'string') {
      try {
        const w = (JSON.parse(init.body) as { walletAddress?: unknown }).walletAddress
        if (typeof w === 'string' && /^0x[0-9a-fA-F]{40}$/.test(w)) SIGNED_IN_WALLETS.add(w.toLowerCase())
      } catch {
        /* not JSON */
      }
    }
  }
  if (typeof url === 'string' && url.startsWith(BASE) && !url.includes('/api/embed/telemetry')) {
    const h = { ...((init?.headers as Record<string, string>) ?? {}) }
    if (h[ORGANIC_PROBE] === '1') delete h[ORGANIC_PROBE]
    else if (!('x-yf-internal-run' in h)) h['x-yf-internal-run'] = '1'
    init = { ...(init ?? {}), headers: h }
  }
  return realFetch(input, init)
}) as typeof fetch

const SUITE_STARTED_AT = Date.now()
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
  // The @yeetful/guard extraction (guard-sdk/) carries FULL COPIES of the
  // pure guard modules; this is the drift tripwire — the open-core package
  // must stay the same code that guards production, or the extraction is a
  // marketing lie. Its own unit suite runs via `npm run guard:test`.
  check('guard-sdk: package copies in sync with lib/ (no drift)', guardSyncDrift().length === 0, guardSyncDrift().join(' | '))
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

  // ── Internal-run stamping (the 2026-08-11 harness-honesty rule) ───────────
  // A prod-pointed drill's rows carry a REAL origin (the first-party lane
  // requires one), so the stamp — header, body flag, or harness- sessionId —
  // is the only marker the scoreboard filters can see. The route echoes the
  // stamp so a drill can assert its rows can never read as growth.
  const intHdr = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1' },
    body: JSON.stringify({
      key: ek.key, sessionId: 'drill-hdr-1', page: 'https://harness-embed.test/swap',
      outcome: 'signed', artifact: 'tx', valueUsd: 1349,
    }),
  })
  check('telemetry: x-yf-internal-run header stamps + echoes internal', intHdr.status === 200 && (await intHdr.json()).internal === true)
  const intBody = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: ek.key, sessionId: 'drill-body-1', page: 'https://harness-embed.test/swap',
      outcome: 'tx-built', artifact: 'tx', internalRun: true,
    }),
  })
  check('telemetry: internalRun body flag stamps (the sendBeacon path — no headers)', intBody.status === 200 && (await intBody.json()).internal === true)
  const intSess = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: ek.key, sessionId: 'harness-belt-1', page: 'https://harness-embed.test/swap', outcome: 'answered',
    }),
  })
  check('telemetry: harness- sessionId prefix stamps (belt for pre-header fixtures)', intSess.status === 200 && (await intSess.json()).internal === true)
  const intOrganic = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      key: ek.key, sessionId: 'organic-visitor-1', page: 'https://harness-embed.test/swap', outcome: 'answered',
    }),
  })
  check('telemetry: an organic beacon is never stamped internal', intOrganic.status === 200 && (await intOrganic.json()).internal === undefined)
  // The prod-drill shape end to end: first-party lane + our own (real) origin
  // + the header. The row records stamped — and the write-once referral
  // claimer skips internal runs (a drill must never permanently attribute a
  // wallet to a creator).
  const intFp = await fetch(`${BASE}/api/embed/telemetry`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1' },
    body: JSON.stringify({
      firstParty: true, sessionId: 'drill-fp-1', page: `${BASE}/chat`, outcome: 'signed', artifact: 'tx', valueUsd: 1349,
    }),
  })
  check('telemetry: a first-party drill beacon (real origin) records stamped internal', intFp.status === 200 && (await intFp.json()).internal === true)

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
  // The GTM arc (§2.2): shape + within-source monotonicity, read as a REAL
  // admin — the .env.local burner is an owner wallet, so this is a genuine
  // SIWE, not a forged session. Skipped (pass) when no burner key is around.
  {
    const envFs = await import('node:fs')
    const pkRaw = (() => {
      try {
        return envFs.readFileSync('.env.local', 'utf8').match(/^PRIVATE_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '') ?? null
      } catch {
        return null
      }
    })()
    if (pkRaw) {
      const burner = privateKeyToAccount((pkRaw.startsWith('0x') ? pkRaw : `0x${pkRaw}`) as `0x${string}`)
      const adminSession = await signIn(burner)
      const arcRes = await fetch(`${BASE}/api/admin/cohorts?days=30`, { headers: { cookie: adminSession } })
      const arcBody = (await arcRes.json()) as {
        arc?: { total: Record<string, number>; bySource: ({ source: string } & Record<string, number>)[] }
      }
      const stops = ['arrived', 'asked', 'built', 'signed'] as const
      const sourcesOk =
        Array.isArray(arcBody.arc?.bySource) &&
        arcBody.arc!.bySource.every(
          (r) =>
            ['house link', 'creator link', 'embed', 'direct'].includes(r.source) &&
            // each stop is a subset of the previous within a source cohort
            stops.every((k, i) => i === 0 || r[k] <= r[stops[i - 1]]) &&
            r.returned <= r.arrived,
        )
      const totalsOk =
        !!arcBody.arc &&
        stops.every((k) => arcBody.arc!.total[k] === arcBody.arc!.bySource.reduce((s, r) => s + r[k], 0))
      check(
        'gtm arc: admin read → five stops per source, monotone within each source, totals = Σ sources',
        arcRes.status === 200 && sourcesOk && totalsOk,
        JSON.stringify(arcBody.arc).slice(0, 300),
      )

      // ── Honest denominator (2026-08-18): the arrival tables carry the Q3
      // stamp. A stamped mint/write NEVER arrives; an organic one DOES — and
      // the organic probe wallet is then re-stamped so this run leaves no
      // durable "stranger" behind (the wallet_working_sets stamp is sticky-on).
      const walletsOf = async () => {
        const r = await fetch(`${BASE}/api/admin/cohorts?days=30`, { headers: { cookie: adminSession } })
        const b = (await r.json()) as { wallets?: { address: string; links?: number }[] }
        return b.wallets ?? []
      }
      const w1 = privateKeyToAccount(generatePrivateKey())
      const w1Session = await signIn(w1)
      const stampedMint = await fetch(`${BASE}/api/intent-links`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', cookie: w1Session },
        body: JSON.stringify({ ask: 'Swap $5 of ETH to USDC' }),
      })
      const stampedMintBody = (await stampedMint.json()) as { slug?: string; internal?: boolean }
      const stampedWs = await fetch(`${BASE}/api/working-set`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: w1Session },
        body: JSON.stringify({ serviceIds: [] }),
      })
      const stampedWsBody = (await stampedWs.json()) as { internal?: boolean }
      const afterStamped = await walletsOf()
      check(
        'arrivals: a stamped intent-link mint + working-set write echo internal:true and the wallet NEVER arrives (cohorts wallets)',
        stampedMint.status === 200 && stampedMintBody.internal === true && !!stampedMintBody.slug &&
          stampedWs.status === 200 && stampedWsBody.internal === true &&
          !afterStamped.some((w) => w.address.toLowerCase() === w1.address.toLowerCase()),
        `wallets=${afterStamped.length}`,
      )
      const w2 = privateKeyToAccount(generatePrivateKey())
      const w2Session = await signIn(w2)
      const organicWs = await fetch(`${BASE}/api/working-set`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: w2Session, [ORGANIC_PROBE]: '1' },
        body: JSON.stringify({ serviceIds: [] }),
      })
      const organicWsBody = (await organicWs.json()) as { internal?: boolean }
      const afterOrganic = await walletsOf()
      const organicArrived = afterOrganic.some((w) => w.address.toLowerCase() === w2.address.toLowerCase())
      // Re-stamp the organic wallet (sticky-on) so the suite leaves no stranger.
      const restamp = await fetch(`${BASE}/api/working-set`, {
        method: 'PUT',
        headers: { 'content-type': 'application/json', cookie: w2Session },
        body: JSON.stringify({ serviceIds: [] }),
      })
      const afterRestamp = await walletsOf()
      check(
        'arrivals: an unstamped organic working-set write DOES arrive (no internal echo); a later stamped write flips it out (sticky-on)',
        organicWs.status === 200 && organicWsBody.internal !== true && organicArrived &&
          restamp.status === 200 &&
          !afterRestamp.some((w) => w.address.toLowerCase() === w2.address.toLowerCase()),
        `organicArrived=${organicArrived}`,
      )

      // Watchable failures feed (squad 2026-08-18 r3): the drill has this
      // open beside a recruit — `?kind=wallet-refused` slices one kind,
      // `?internal=1` opts INTO stamped harness rows (hidden by default,
      // counted in internalHidden), and the reader tolerates a DB without
      // the is_internal column (never a 500). The page mirrors these params
      // in its URL (?funded=1&kind=…&internal=1) — pinned at the source
      // since the toggles are client-rendered.
      const feedRes = await fetch(`${BASE}/api/admin/ask-failures?days=30&kind=wallet-refused`, { headers: { cookie: adminSession } })
      const feedBody = (await feedRes.json()) as { kind?: string | null; counts?: { internalHidden?: number }; failures?: Array<{ kind: string; internal?: boolean }> }
      const feedInternal = await fetch(`${BASE}/api/admin/ask-failures?days=30&internal=1&kind=nope`, { headers: { cookie: adminSession } })
      const feedInternalBody = (await feedInternal.json()) as { kind?: string | null; counts?: { internalHidden?: number } }
      check(
        'ask-failures feed: ?kind=wallet-refused slices to that kind, rows carry the internal tag, unknown kinds are ignored, ?internal=1 zeroes internalHidden',
        feedRes.status === 200 && feedBody.kind === 'wallet-refused' &&
          (feedBody.failures ?? []).every((r) => r.kind === 'wallet-refused' && typeof r.internal === 'boolean') &&
          typeof feedBody.counts?.internalHidden === 'number' &&
          feedInternal.status === 200 && feedInternalBody.kind === null && feedInternalBody.counts?.internalHidden === 0,
        JSON.stringify({ kind: feedBody.kind, n: feedBody.failures?.length, hidden: feedBody.counts?.internalHidden }),
      )
      const failuresPageSrc = envFs.readFileSync('app/dashboard/failures/page.tsx', 'utf8')
      check(
        'ask-failures page: URL ⇄ toggles (?funded=1 / ?kind= / ?internal=1 read on mount, written back) + live poll pill',
        /q\.get\('funded'\)/.test(failuresPageSrc) && /q\.get\('kind'\)/.test(failuresPageSrc) && /q\.get\('internal'\)/.test(failuresPageSrc) &&
          /replaceState/.test(failuresPageSrc) && /useLivePoll\(/.test(failuresPageSrc) && /<LivePill/.test(failuresPageSrc),
      )
    } else {
      check('gtm arc: skipped — no burner key in .env.local', true)
    }
  }
  // Pure pins on the arc SQL + the signal reader — the digest and dashboard
  // share these strings, so a regression here is a regression on both.
  {
    const union = addrsUnion({ prodJobsOnly: true }).sql
    const unionAll = addrsUnion().sql
    const arc = arcQuery(30).sql
    check(
      'arrivals: addrsUnion + arcQuery exclude is_internal rows on intent_links, wallet_working_sets, jobs, dca_schedules, chats (+ messages/job_steps joins, embed_turns owners)',
      /FROM intent_links WHERE creator IS NOT NULL AND NOT is_internal/.test(union) &&
        /FROM wallet_working_sets WHERE NOT is_internal/.test(union) &&
        /FROM dca_schedules WHERE NOT is_internal/.test(union) &&
        /FROM chats WHERE owner_address IS NOT NULL AND NOT is_internal/.test(union) &&
        /WHERE c\.owner_address IS NOT NULL AND NOT c\.is_internal/.test(arc) &&
        /FROM jobs WHERE origin_env = 'production' AND NOT is_internal/.test(union) &&
        /FROM jobs WHERE NOT is_internal/.test(unionAll) &&
        /FROM embed_turns WHERE owner_address IS NOT NULL AND NOT is_internal/.test(union) &&
        (arc.match(/j\.origin_env = 'production' AND NOT j\.is_internal/g) ?? []).length === 2 &&
        /e\.kind = 'connect' AND NOT il\.is_internal/.test(arc),
    )
    // The homepage hero strip ("Links live" / "Opens") is a public claim on a
    // STATIC route (baked at build) — no live delta to observe, so pin the
    // reader contract at the source: both counts must go through is_internal.
    const heroSrc = await readFile(new URL('../components/LinksHero.tsx', import.meta.url), 'utf8')
    check(
      'hero strip: "Links live" + "Opens" read through the honest reader (intent_links.is_internal; opens exclude internal links)',
      /intentLink\.count\(\{ where: \{ revoked: false, isInternal: false \} \}\)/.test(heroSrc) &&
        /NOT EXISTS \(SELECT 1 FROM intent_links il WHERE il\.id = e\.slug AND il\.is_internal\)/.test(heroSrc) &&
        /REAL_TRAFFIC_WHERE/.test(heroSrc),
    )
    check(
      'arrivals: isInternalRun reads the header (Headers + plain record) and the body flag, and nothing else',
      isInternalRun(new Headers({ [INTERNAL_RUN_HEADER]: '1' })) &&
        isInternalRun({ 'x-yf-internal-run': '1' }) &&
        isInternalRun(null, { internalRun: true }) &&
        !isInternalRun(new Headers({ [INTERNAL_RUN_HEADER]: 'yes' })) &&
        !isInternalRun(null, { internalRun: 'true' }) &&
        !isInternalRun(null, null) &&
        !isInternalRun({}, {}),
    )
  }

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

  // /rebrand — the public record of the Yeetful → Pantessa rename (the §1.1
  // disclosure anchor cited by the MetaMask/Blockaid/SEAL drafts). A security
  // reviewer must find both brand names, the appeal number, and the
  // retired-fork admission in the served HTML, no JS required. Since
  // 2026-08-18 the page must ALSO be honest that #273376 was CLOSED (on a
  // misread of the domain — the maintainer checked the out-of-scope hosts)
  // and that a new request is being filed; a public record that calls a dead
  // issue "open" is exactly the kind of stale claim a reviewer catches first.
  const rebrandRes = await fetch(`${BASE}/rebrand`)
  const rebrandHtml = await rebrandRes.text()
  check(
    'rebrand: public record names both brands, the appeal, the retired fork',
    rebrandRes.status === 200 &&
      rebrandHtml.includes('Yeetful is now Pantessa') &&
      rebrandHtml.includes('273376') &&
      rebrandHtml.includes('uniswap-embed.yeetful.com'),
  )
  check(
    'rebrand: the first removal request is stated as CLOSED (misread) with a new one being filed — never "open"',
    !/appeal to correct the record is open/i.test(rebrandHtml) &&
      /was closed on 2026-07-30/.test(rebrandHtml) &&
      /new removal request is being filed/i.test(rebrandHtml),
  )
  const footerHomeHtml = await (await fetch(`${BASE}/`)).text()
  check('rebrand: reachable from the footer on every page', footerHomeHtml.includes('href="/rebrand"'))
  check('mosaic: reachable from the footer on every page', footerHomeHtml.includes('href="/mosaic"'))
  const linksPageHtml = await (await fetch(`${BASE}/links`)).text()
  check('mosaic: the /links board cross-links the wall', linksPageHtml.includes('href="/mosaic"'))

  // Old-origin fence (L2-Q2 embed-origin audit): the app must never emit
  // links to the OLD apex/www origin — lib/site-url.ts canonicalizes,
  // snippets emit `mountPantessaChat`, Stripe URLs ride billingOrigin().
  // `*.yeetful.com` MCP/policy hosts are legitimate frozen wire identifiers
  // (the regex skips subdomains), /rebrand cites the old domain on purpose
  // (not fenced), and mailto stays on yeetful.com until §1.3's DNS lands
  // (stripped before the test).
  {
    const OLD_ORIGIN_RE = /https?:\/\/(www\.)?yeetful\.com(?![\w.-])/
    for (const path of ['/docs/embed', '/links/embed', '/sitemap.xml', '/robots.txt']) {
      const body = (await (await fetch(`${BASE}${path}`)).text()).replace(/mailto:[^"'<\s]+/g, '')
      check(`old-origin fence: ${path} emits no apex/www yeetful.com links`, !OLD_ORIGIN_RE.test(body))
    }
  }

  // SWC entity-space fence (squad 2026-08-18 UI/UX drill): a text node that
  // follows an inline element and CONTAINS an HTML entity (&apos; &rsquo; …)
  // loses its leading space at compile time — "<code>scan_wallet</code>reads"
  // shipped on /docs/desk, /docs/embed and /pricing. The rendered HTML is the
  // only place the bug is visible; the fix is `{' '}` after the element.
  // Prose pages only — chat/dashboard bodies are client-rendered.
  {
    // Glued = a letter, an opening paren/quote, or a spaced em dash sitting
    // directly on the closing tag. Punctuation like `</a>.` / `</code>,` is
    // legitimate and stays out of the class.
    const ENTITY_SPACE_RE = /<\/(em|strong|a|code)>(?:[A-Za-z(]|—|“|&ldquo;)/g
    const PROSE_PATHS = [
      '/', '/pricing', '/links', '/links/embed', '/rebrand', '/mosaic',
      '/docs', '/docs/desk', '/docs/embed', '/docs/links', '/docs/jobs', '/docs/trust',
      '/docs/first-five-minutes', '/docs/host-buttons', '/docs/embedded-wallet',
      '/docs/creator-earnings', '/docs/spend-policy', '/docs/transactions',
      '/docs/privacy', '/docs/terms', '/docs/dca', '/docs/guardian', '/docs/snapshot',
    ]
    for (const path of PROSE_PATHS) {
      const body = await (await fetch(`${BASE}${path}`)).text()
      const hits = body.match(ENTITY_SPACE_RE) ?? []
      check(`entity-space fence: ${path} has no glued inline-element text`, hits.length === 0, hits.slice(0, 3).join(' '))
    }
  }

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
  // ── the flow map + chains built (the 2026-07-28 /activity rethink) ──────
  // The flow is only worth drawing if it ADDS UP: every signed dollar has to
  // land in exactly one source lane and one venue lane, or the diagram is
  // decoration. And the chains carry SHAPE only — a job title is compiled
  // from the user's ask and can echo an address, so it must never ship.
  const ov2 = (await (await fetch(`${BASE}/api/activity/overview`)).json()) as {
    hero: { systemTotalUsd: number }
    flow: { source: string; venue: string; usd: number; n: number }[]
    venues: { venue: string; built: number; signed: number; builtUsd: number; signedUsd: number }[]
    chains: { status: string; usd: number; at: string; steps: { kind: string; status: string; builder: string; venue: string | null; usd: number | null; chain: string | null; txUrl: string | null }[] }[]
  }
  check(
    'overview: the flow map is a clean partition — its lanes sum to THE number',
    Array.isArray(ov2.flow) &&
      Math.abs(ov2.flow.reduce((a, e) => a + e.usd, 0) - ov2.hero.systemTotalUsd) < 0.06,
    `flow=${ov2.flow?.reduce((a, e) => a + e.usd, 0)} total=${ov2.hero.systemTotalUsd}`,
  )
  check(
    'overview: every flow lane names a known source and a resolved venue (never a raw build_path)',
    ov2.flow.every(
      (e) =>
        ['chat', 'embed', 'link', 'standing', 'guardian', 'agents'].includes(e.source) &&
        !isRawBuildPath(e.venue) &&
        e.usd > 0 &&
        e.n > 0,
    ),
    JSON.stringify(ov2.flow.filter((e) => isRawBuildPath(e.venue)).slice(0, 3)),
  )
  // Same contract on the venue table — it reads the same column and used to
  // have its own weaker fallback (`?? build_path`), so the NFT layer showed up
  // there as a raw `native-nft-transfer` "venue".
  check(
    'overview: every venue row names a resolved venue (never a raw build_path)',
    ov2.venues.every((v) => !isRawBuildPath(v.venue)),
    JSON.stringify(ov2.venues.filter((v) => isRawBuildPath(v.venue)).map((v) => v.venue)),
  )
  // The two checks above can only catch a leak whose build_path happens to be
  // in the DB today. This one is data-independent: EVERY declared build path
  // must resolve, so adding one without a venue fails here (and at tsc, since
  // VENUE_OF_BUILD_PATH is a total Record<BuildPath, string>).
  check(
    'overview: every declared build path resolves to a venue that is not itself a build path',
    BUILD_PATHS.every((p) => {
      const venue = venueOfBuildPath(p)
      return typeof venue === 'string' && venue.length > 0 && !isRawBuildPath(venue)
    }),
    JSON.stringify(BUILD_PATHS.filter((p) => !venueOfBuildPath(p) || isRawBuildPath(venueOfBuildPath(p)!))),
  )
  check(
    'overview: chains carry ordered multi-step shape',
    Array.isArray(ov2.chains) && ov2.chains.every((c) => c.steps.length > 1 && typeof c.status === 'string'),
  )
  check(
    'overview: P1 — chains ship SHAPE only (no title, wallet, params or raw result)',
    ov2.chains.every((c) => {
      const own = Object.keys(c).sort().join(',') === 'at,status,steps,usd'
      const steps = c.steps.every(
        (s) => Object.keys(s).sort().join(',') === 'builder,chain,kind,status,txUrl,usd,venue',
      )
      return own && steps
    }),
  )
  // A step's receipt is ONE narrowed field: an explorer URL ending in the tx
  // hash. The `result` blob it comes from also holds compiled human titles, so
  // this pins that nothing else escaped with it.
  check(
    'overview: a chain step links to a real explorer tx, or to nothing at all',
    ov2.chains.every((c) =>
      c.steps.every((s) => s.txUrl === null || /^https:\/\/[a-z0-9.-]+\/tx\/0x[0-9a-fA-F]{64}$/.test(s.txUrl)),
    ),
    JSON.stringify(ov2.chains.flatMap((c) => c.steps.map((s) => s.txUrl)).filter(Boolean).slice(0, 2)),
  )
  check(
    'overview: a linked step names the chain it settled on (never a bare hash)',
    ov2.chains.every((c) => c.steps.every((s) => (s.txUrl === null) === (s.chain === null))),
  )
  // (No HTML pin for the flow/chains headings: both sections live behind the
  // overview's client fetch, so they are absent from the server-rendered
  // document by design. Asserting on a string that can never appear is a
  // broken test, not a broken page — the payload checks above are the pin.)

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
    !isInternalOrigin('https://www.pantessa.com') &&
      !isInternalOrigin('https://www.yeetful.com') &&
      !isInternalOrigin('https://yeetful.com') &&
      !isInternalOrigin('https://app.uniswap.org') &&
      !isInternalOrigin('https://someones-dapp.vercel.app') &&
      !isInternalOrigin('https://localhosting.io') &&
      !isInternalOrigin('https://my.test-app.com') &&
      !isInternalOrigin(null) &&
      !isInternalOrigin('not a url'),
  )
  // Display-name brand map (Q4, §1.5): Neon-seeded rows rename on the
  // owner's clock and the `Yeetful · Claude` family can never rename in
  // data (code IN-lists) — so the word renders as Pantessa at display
  // time via cleanServerName, suffixes still stripped, third-party names
  // untouched. Drawer rows, responder strip, directory cards, and the
  // /servers detail H1 all route through it.
  check(
    'brand map: cleanServerName renders every Yeetful-worded name as Pantessa',
    cleanServerName('Yeetful Wallet') === 'Pantessa Wallet' &&
      cleanServerName('Yeetful Finance (Free)') === 'Pantessa Finance' &&
      cleanServerName('NEAR Intents MCP · Yeetful') === 'NEAR Intents' &&
      cleanServerName('Yeetful · Claude') === 'Pantessa · Claude' &&
      cleanServerName('Hyperliquid (Free)') === 'Hyperliquid' &&
      cleanServerName('SomeDapp Tools') === 'SomeDapp Tools',
  )
  // The stamped flag (2026-08-11 audit): a prod-pointed drill's origin looks
  // exactly like a stranger's — the first-party lane requires it — so all
  // three mirrors must treat is_internal as internal alongside the patterns.
  check(
    'value-origin: isInternalTurn — the flag marks internal even on a real prod origin',
    isInternalTurn({ origin: 'https://www.pantessa.com', isInternal: true }) &&
      !isInternalTurn({ origin: 'https://www.pantessa.com', isInternal: false }) &&
      !isInternalTurn({ origin: 'https://www.pantessa.com' }) &&
      isInternalTurn({ origin: 'http://localhost:3477' }),
  )
  check(
    'value-origin: both query mirrors carry the is_internal flag',
    INTERNAL_ORIGIN_SQL.startsWith('(is_internal OR ') &&
      (INTERNAL_TRAFFIC_WHERE.OR as Record<string, unknown>[]).some((c) => c.isInternal === true),
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

  // ── Splash delta refetch (serversOnly) ─────────────────────────────────────
  // When an MCP is toggled onto an ALREADY-painted splash, the client fetches
  // just that server's tiles with serversOnly:true — the wallet-alone tiles
  // (briefing + recurring buys) are already on screen and must NOT ride the
  // delta response (they'd duplicate on merge, and recomputing the briefing
  // is the slow half of the scan). Toggling an MCP off fetches nothing at all.
  console.log('— splash delta refetch (serversOnly)')
  {
    const noServers = await fetch(`${BASE}/api/splash`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: owner.address, servers: [], serversOnly: true }),
    })
    const noServersBody = (await noServers.json()) as { address?: string; tiles?: unknown[] }
    check(
      'splash: serversOnly suppresses the wallet-alone tiles (empty set → zero tiles)',
      noServers.status === 200 && noServersBody.address === owner.address && Array.isArray(noServersBody.tiles) && noServersBody.tiles.length === 0,
    )
    const unknownSlug = await fetch(`${BASE}/api/splash`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ address: owner.address, servers: [{ slug: 'no-such-mcp-slug' }], serversOnly: true }),
    })
    const unknownBody = (await unknownSlug.json()) as { tiles?: unknown[] }
    check(
      'splash: serversOnly with an unknown slug settles empty (no wallet tiles, no crash)',
      unknownSlug.status === 200 && Array.isArray(unknownBody.tiles) && unknownBody.tiles.length === 0,
    )
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
  // ── The public origin is ONE value (lib/site-url) ────────────────────────
  // It used to be a `?? '<literal>'` copied into nine files, and the copies
  // had drifted apex-vs-www. With the env var unset the apex copies won, so
  // canonical / og:url / sitemap / robots / RSS all advertised a host that
  // only redirects — and anything sending an auth header to it lost the
  // header, because fetch drops Authorization across a cross-origin redirect.
  // These checks are the pin: they fail if a literal creeps back, or if
  // SITE_URL stops being a canonical origin.
  check(
    'site-url: SITE_URL is a canonical origin (https, no trailing slash, not a redirecting host)',
    /^https:\/\/[a-z0-9.-]+$/.test(SITE_URL) &&
      !SITE_URL.endsWith('/') &&
      !/\byeetful\.com$/.test(new URL(SITE_URL).hostname),
  )
  {
    const siteHost = new URL(SITE_URL).hostname
    const canonicalHref = /<link[^>]+rel="canonical"[^>]+href="([^"]+)"/.exec(homeHtml)?.[1] ?? ''
    const ogUrl = /<meta[^>]+property="og:url"[^>]+content="([^"]+)"/.exec(homeHtml)?.[1] ?? ''
    // Local runs serve from localhost, so only assert agreement when the
    // harness is pointed at a real deployment.
    const deployed = !/^https?:\/\/(localhost|127\.0\.0\.1)/.test(BASE)
    check(
      'site-url: canonical + og:url agree with SITE_URL on a deployed host',
      !deployed || (new URL(canonicalHref).hostname === siteHost && new URL(ogUrl).hostname === siteHost),
    )
  }
  check('router: og:image present (social card)', /<meta[^>]+property="og:image"/.test(homeHtml))
  // The links-first repositioning (2026-07-22, HANDOFF-links-first.md) leads
  // with the intent claim: "You have an intent. We do the rest." Retitle and
  // re-pin TOGETHER — this check is the pin.
  check(
    'home: descriptive <title> (the links-first claim)',
    /<title>[^<]*(You have an intent|[Ww]e do the rest|intent link)[^<]*<\/title>/.test(homeHtml),
  )
  // The hero h1 PERFORMS the claim: line one cycles the ask reel
  // (components/typed-asks.ts) and SSR paints the full first entry, so the
  // first frame and the crawler both read a real sentence — never an empty
  // typed slot. Re-order the reel and this pin re-pins with it.
  check(
    "home: hero types the reel (first ask SSR'd in the h1)",
    homeHtml.includes('Buy $12 of AAPL') && /We do the rest\./.test(homeHtml),
  )
  const sitemapXml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  check('sitemap: site root is listed', /<loc>https?:\/\/[^</]+\/?<\/loc>/.test(sitemapXml))
  check(
    'sitemap + robots never advertise the pre-rebrand origin',
    !/yeetful\.com/.test(sitemapXml) &&
      !/yeetful\.com/.test(await (await fetch(`${BASE}/robots.txt`)).text()),
  )

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

    // ── The studio has ONE address (2026-09-03) ────────────────────────────
    // Minting lived on /dashboard/links AND in the app's LINKS tab; the
    // dashboard one won every CTA by default. The studio is the app view
    // now and the old route redirects — carrying the ?ask= handoff, or a
    // creator arriving from a receipt/onboarding CTA loses their sentence.
    const studioMoved = await fetch(`${BASE}/dashboard/links`, { redirect: 'manual' })
    check(
      'links studio: /dashboard/links redirects into the app LINKS tab',
      [307, 308, 302].includes(studioMoved.status) &&
        (studioMoved.headers.get('location') ?? '').includes('/chat?tab=links'),
    )
    const studioPrefill = await fetch(`${BASE}/dashboard/links?ask=${encodeURIComponent('Buy $5 of AAPL')}&mcps=robinhood-free`, {
      redirect: 'manual',
    })
    const studioLoc = studioPrefill.headers.get('location') ?? ''
    check(
      'links studio: the redirect carries the ask + mcps handoff through',
      studioLoc.includes('tab=links') &&
        studioLoc.includes(encodeURIComponent('Buy $5 of AAPL')) &&
        studioLoc.includes('mcps=robinhood-free'),
    )

    // ── The spine's destinations are addressable (2026-09-04) ─────────────
    // The left tabs used to be pure session state: deep in the links studio,
    // reload, and you were back on MCPs. `?tab=` is now bidirectional — the
    // spine mirrors it — so a refresh, a bookmark and a pasted link all land
    // on the destination you were looking at. These pin the grammar the
    // spine and every deep link in the product share.
    check(
      'app tabs: every spine destination parses out of the URL',
      (['mcps', 'chats', 'jobs', 'links', 'team'] as const).every((t) => parseTabParam(`?tab=${t}`) === t),
    )
    check(
      'app tabs: an unknown or absent tab resolves to null, never a blank drawer',
      parseTabParam('?tab=nope') === null && parseTabParam('') === null && parseTabParam('?ask=hi') === null,
    )
    check(
      'app tabs: a destination writes ?tab= onto whichever chat route you are on',
      tabUrl('links', '/chat', '') === '/chat?tab=links' &&
        tabUrl('jobs', '/chat/abc123', '') === '/chat/abc123?tab=jobs',
    )
    check(
      'app tabs: the mint handoff (?ask=&mcps=) survives a tab change',
      (() => {
        const next = tabUrl('links', '/chat', '?ask=Buy+%245+of+AAPL&mcps=robinhood-free')
        return next.includes('tab=links') && next.includes('mcps=robinhood-free') && next.includes('AAPL')
      })(),
    )
    check(
      'app tabs: the resting destination stays OUT of the URL (/chat === /chat?tab=mcps)',
      tabUrl(DEFAULT_TAB, '/chat', '') === '/chat' &&
        tabUrl(null, '/chat', '?tab=jobs') === '/chat' &&
        tabUrl(DEFAULT_TAB, '/chat', '?tab=jobs&ask=x') === '/chat?ask=x',
    )
    check(
      'app tabs: the studio href IS the tab URL — one address, no drift',
      LINKS_STUDIO_HREF === tabUrl('links', '/chat', ''),
    )

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
    const evSettled = await fetch(`${BASE}/api/intent-links/${slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind: 'settled', valueUsd: 12.5 }),
    })
    check('intent links: settled event accepted (the fourth funnel stop)', evSettled.status === 200)
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
    const listBody = (await list.json()) as { links: Array<{ slug: string; funnel: { open: number; settled?: number } }> }
    check(
      'intent links: the funnel aggregates settled',
      listBody.links.find((l) => l.slug === slug)?.funnel.settled === 1,
      JSON.stringify(listBody.links.find((l) => l.slug === slug)?.funnel),
    )
    const row = listBody.links?.find((l) => l.slug === slug)
    check('intent links: creator list shows the link with its funnel', !!row && row.funnel.open >= 1)

    const page = await fetch(`${BASE}/i/${slug}`)
    const pageHtml = await page.text()
    check('intent links: /i runtime renders the ask + consent button', page.status === 200 && pageHtml.includes('Buy $12 of AAPL') && /Connect (&amp;|&) build/.test(pageHtml))
    // Simple-mode shell: /i is a focused full-screen landing — the brochure
    // top nav must not render on it (Navigation returns null on /i/).
    check('intent links: /i page carries no brochure nav', !pageHtml.includes('nav__tab'))
    // /i has no site footer, so the rebrand disclosure every other page
    // carries in its footer rides the splash instead (squad 2026-08-18 r2).
    check('intent links: /i splash carries the "formerly Yeetful" /rebrand pointer', pageHtml.includes('href="/rebrand"') && /formerly Yeetful/i.test(pageHtml))
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
          // fixture-, NOT harness-: these beacons simulate ORGANIC stranger
          // signs (referral + earnings paths must fire); the harness- prefix
          // would auto-stamp them internal and the write-once referral
          // claimer correctly skips internal runs. Their localhost origin
          // still keeps them out of every public read.
          sessionId: `fixture-ilink-${Date.now()}`,
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
    // The out-earn instrument: earnings carry a per-week axis (same money
    // math, bucketed read-time). The turns just posted land in the CURRENT
    // ISO week: its earnings include the fee-bearing $0.10 and its moved $
    // includes the fee-free $500 — the fee rules survive the bucketing.
    {
      const weekly = (afterBody.earnings as { weekly?: { weekStart: string; earnedUsd: number; signedUsd: number; signs: number }[] }).weekly
      const thisWeek = weekly?.[0]
      check(
        'intent links: earnings.weekly buckets the same money math by ISO week (newest first, current week carries the fixture)',
        Array.isArray(weekly) &&
          weekly.length >= 1 &&
          !!thisWeek &&
          thisWeek.earnedUsd >= 0.1 - 0.001 &&
          thisWeek.signedUsd >= 600 &&
          thisWeek.signs >= 2 &&
          weekly.every((w, i) => i === 0 || w.weekStart < weekly[i - 1].weekStart),
        JSON.stringify(weekly),
      )
    }
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
    // Lifetime attribution (HANDOFF-yeetcall-gtm C2): the first link a wallet
    // SIGNS through claims it for that creator; the wallet's later
    // UNattributed fee-bearing turns accrue to the creator forever; direct
    // link attribution wins per-turn; the creator's own wallet never claims
    // itself. The referred wallet must be RANDOM per run — referred_wallets
    // keys on the wallet globally, so a constant address gets claimed by the
    // FIRST run's mallory forever and every rerun sees zero rows (caught
    // live 2026-07-30; also the phantom-wallet-metric lesson: random rows
    // stay inert).
    const referredWallet = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
    await turn({ buildPath: 'native-swap-uniswap', walletAddress: referredWallet, valueUsd: 50 }) // stamps first touch (+$0.05 direct)
    await turn({ buildPath: 'native-swap-uniswap', walletAddress: mallory.address, valueUsd: 50 }) // self-referral: excluded (+$0.05 direct)
    await turn({ buildPath: 'native-swap-uniswap', walletAddress: referredWallet, valueUsd: 200, intentLinkSlug: undefined }) // later trade, no link → referral $0.20
    await turn({ buildPath: 'native-nft-transfer', walletAddress: referredWallet, valueUsd: 999, intentLinkSlug: undefined }) // fee-free later trade → $0
    const lifeRes = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })
    const life = (await lifeRes.json()) as {
      earnings: { referredWallets: number; referredEarnedUsd: number; referredSignedUsd: number; totalEarnedUsd: number }
    }
    check(
      'intent links: first-touch stamps ONE referred wallet (self-referral excluded)',
      life.earnings.referredWallets === 1,
      JSON.stringify(life.earnings),
    )
    check(
      'intent links: referred later-trade accrues at the path rate; fee-free moves earn $0',
      Math.abs(life.earnings.referredEarnedUsd - 0.2) < 0.005 && life.earnings.referredSignedUsd >= 1199,
    )
    check(
      'intent links: lifetime earnings ride totalEarnedUsd (claim parity)',
      Math.abs(life.earnings.totalEarnedUsd - 0.4) < 0.01,
      JSON.stringify(life.earnings),
    )
    // C2b: the STAMPED tier wins over the path default — a $100 link-tier
    // (50bps) referred swap earns $0.25 where the base rate would say $0.10.
    await turn({ buildPath: 'native-swap-uniswap', walletAddress: referredWallet, valueUsd: 100, intentLinkSlug: undefined, feeBps: 50 })
    const tierRes = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })
    const tierLife = (await tierRes.json()) as {
      earnings: { referredEarnedUsd: number; totalEarnedUsd: number; referredSignedUsd: number }
    }
    check(
      'intent links: earnings honor the STAMPED fee tier (a 50bps row earns 2.5x the base rate)',
      Math.abs(tierLife.earnings.referredEarnedUsd - 0.45) < 0.005,
      JSON.stringify(tierLife.earnings),
    )
    // Internal runs mint NOTHING: stamped drill turns — direct-attributed or
    // referred — move neither earnings nor the moved-$ sums, so a prod drill
    // can never create claimable USDC (claims parity rides the same
    // isInternal predicate in /api/intent-links/claims).
    await turn({ buildPath: 'native-swap-uniswap', valueUsd: 4000, internalRun: true })
    await turn({ buildPath: 'native-swap-uniswap', walletAddress: referredWallet, valueUsd: 4000, intentLinkSlug: undefined, internalRun: true })
    const drillRes = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })
    const drillLife = (await drillRes.json()) as {
      earnings: { referredEarnedUsd: number; totalEarnedUsd: number; referredSignedUsd: number }
    }
    check(
      'intent links: stamped internal turns mint NOTHING (earnings + moved $ unchanged)',
      Math.abs(drillLife.earnings.referredEarnedUsd - tierLife.earnings.referredEarnedUsd) < 0.001 &&
        Math.abs(drillLife.earnings.totalEarnedUsd - tierLife.earnings.totalEarnedUsd) < 0.001 &&
        Math.abs(drillLife.earnings.referredSignedUsd - tierLife.earnings.referredSignedUsd) < 0.001,
      JSON.stringify(drillLife.earnings),
    )
    const claim = await fetch(`${BASE}/api/intent-links/claims`, { method: 'POST', headers: M })
    check('intent links: claim below the $10 floor refused (400)', claim.status === 400)

    // The fee-split disclosure renders on creator-minted /i pages.
    const iPage = await (await fetch(`${BASE}/i/${slug}`)).text()
    check('intent links: /i discloses the creator fee split', /earns half of Pantessa/.test(iPage))
    // CALL framing (C3): creator links read as a posted call and disclose
    // the WHOLE deal (lifetime first-touch); house links stay the neutral
    // pure-Pantessa lockup with no creator fee line.
    // r6 (Ideation N3): the eyebrow mirrors the OG card — WHOSE + the model,
    // never "call · by" jargon. mallory has no claimed handle here, so the
    // creator page reads "Call · your wallet signs"; the house link reads
    // "Intent link · your wallet signs".
    check(
      'intent links: creator /i wears the CALL framing + lifetime disclosure',
      />Call · your wallet signs</.test(iPage) && !/Call · by/.test(iPage) && /lifetime, first touch/.test(iPage) && /paid calls should say so/.test(iPage),
    )
    const houseCallPage = await (await fetch(`${BASE}/i/protected-long`)).text()
    check(
      'intent links: house /i stays pure Pantessa — no call framing, no creator fee line',
      />Intent link · from Pantessa · your wallet signs</.test(houseCallPage) && !/earns half of Pantessa/.test(houseCallPage) && !/>Call/.test(houseCallPage),
    )
    check(
      'intent links: linkEyebrow mirrors the OG card (From @handle / Call by agent / Intent link · from sender · your wallet signs)',
      linkEyebrow({ hasCreator: true, handle: 'nate' }) === 'From @nate · your wallet signs' &&
        linkEyebrow({ hasCreator: true, handle: '@nate', agent: 'Risk Bot' }) === 'From @nate · your wallet signs' &&
        linkEyebrow({ hasCreator: true, agent: 'Risk Bot' }) === 'Call by Risk Bot · your wallet signs' &&
        linkEyebrow({ hasCreator: true }) === 'Call · your wallet signs' &&
        linkEyebrow({ hasCreator: false, agent: 'Risk Bot' }) === 'Intent link · from Risk Bot · your wallet signs' &&
        linkEyebrow({ hasCreator: false }) === 'Intent link · your wallet signs' &&
        linkEyebrow({ hasCreator: true, handle: 'nate' }, '') === 'From @nate',
    )
    // The lockup WORD is one source (lib/intent-links) because the rendered
    // check above only covers an UNBRANDED creator page: a white-labeled
    // splash kept the brand lockup and dropped the framing entirely, live in
    // prod, and the in-chat header said "intent link" on every call. Driving
    // the branded splash headlessly needs a scanned logo (open internet), so
    // the pure pin is what stands between here and that regression.
    check(
      'intent links: the lockup word is creator-derived (a call is BY its author, a neutral link is FROM one)',
      linkLockupWord(true) === 'Call' &&
        linkLockupWord(false) === 'Intent link' &&
        linkLockup(true, 'mallory') === 'Call · by mallory' &&
        linkLockup(false, 'mallory') === 'Intent link · from mallory' &&
        linkLockup(true, '') === 'Call' &&
        linkLockup(false, null) === 'Intent link',
    )

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
    // …and it TAKES THE LINK DOWN. Give this one a fee-bearing conversion
    // first, so the two halves of the contract are both under test: the row
    // must leave the creator's own list (2026-09-04 — a revoked link kept
    // sitting in the studio table long after its /i page 404'd, which reads
    // as a button that did nothing), while the money it already earned must
    // NOT leave with it. Filtering the earnings base instead of the listing
    // is the tempting one-line version of this change and it would silently
    // subtract accrued, claimable dollars.
    await fetch(`${BASE}/api/embed/telemetry`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        firstParty: true,
        sessionId: `fixture-ilink-revoke-${Date.now()}`,
        page: `${BASE}/i/${thirdSlug}`,
        outcome: 'signed',
        artifact: 'tx',
        valueUsd: 100,
        buildPath: 'native-swap-uniswap',
        intentLinkSlug: thirdSlug,
      }),
    })
    type OwnerList = { links: Array<{ slug: string }>; earnings: { totalEarnedUsd: number; claimableUsd: number } }
    const ownerList = async () =>
      (await (await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })).json()) as OwnerList
    const beforeRevoke = await ownerList()
    const revoke = await fetch(`${BASE}/api/intent-links/${thirdSlug}`, { method: 'DELETE', headers: { cookie: mallorySession } })
    const fifth = await fetch(`${BASE}/api/intent-links`, { method: 'POST', headers: M, body: JSON.stringify({ ask: 'DCA $25 into ETH weekly' }) })
    check('intent links: revoke frees capacity (next mint 200) and needs auth', revoke.status === 200 && fifth.status === 200)
    const afterRevoke = await ownerList()
    check(
      'intent links: a revoked link leaves the creator\'s own list',
      beforeRevoke.links.some((l) => l.slug === thirdSlug) && !afterRevoke.links.some((l) => l.slug === thirdSlug),
      JSON.stringify({ before: beforeRevoke.links.map((l) => l.slug), after: afterRevoke.links.map((l) => l.slug), thirdSlug }),
    )
    check(
      'intent links: revoking a link never subtracts what it already earned',
      beforeRevoke.earnings.totalEarnedUsd >= 0.1 - 1e-9 &&
        Math.abs(afterRevoke.earnings.totalEarnedUsd - beforeRevoke.earnings.totalEarnedUsd) < 1e-6 &&
        Math.abs(afterRevoke.earnings.claimableUsd - beforeRevoke.earnings.claimableUsd) < 1e-6,
      JSON.stringify({ before: beforeRevoke.earnings, after: afterRevoke.earnings }),
    )
    const strangerRevoke = await fetch(`${BASE}/api/intent-links/${slug}`, { method: 'DELETE' })
    check('intent links: revoking without a session → 401', strangerRevoke.status === 401)

    // The public leaderboard: server-truth board, mint CTA, no wallets.
    const board = await fetch(`${BASE}/links`)
    const boardHtml = await board.text()
    check('intent links: /links leaderboard renders with the mint CTA', board.status === 200 && /Mint yours/.test(boardHtml) && /dollars moved/i.test(boardHtml))
    // The mint CTA is the composer ITSELF (the mint stage — the share-card
    // replica a stranger types into, pre-sign-in), not a button to a form
    // behind the dashboard wall: the card's promise line + the folded
    // fine-print disclosure must SSR on the public page.
    check(
      'intent links: /links carries the mint stage (card promise + folded fine print)',
      boardHtml.includes('Connect a wallet and the path builds itself.') && /Fine print/.test(boardHtml),
    )
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
    // The recent tab reads MINTS (not turns), so it needs its OWN internal
    // fence: NOT_HARNESS filters the TURN side only, and the harness's fetch
    // wrapper stamps every mint internal. This pin used to assert the
    // opposite — that a harness mint SURFACES — and so enshrined the bug it
    // was meant to guard: on 2026-09-03 the live board's newest ten rows were
    // ten identical "Swap $5 of ETH to USDC" harness mints from throwaway
    // wallets, which reads as bot spam on the front door of the links pitch.
    check('intent links: internal mints never reach the recently-minted tab', !boardHtml.includes('Stake some ETH for me'))
    // …and the tab is fenced, not broken: an ORGANIC row does surface. The
    // fixture is written straight to the table (the mint route would stamp it
    // internal) and deleted below — never revoked-and-left, because the GTM
    // arc counts intent_links by is_internal alone and a lingering unflagged
    // row would inflate the arrival denominator by one wallet per run.
    // Prisma reads .env, not .env.local, so the harness process may hold no
    // DATABASE_URL — the same guard the founding + jobs-cron drills use (a
    // failed engine init is cached, so an unguarded call poisons the rest).
    if (process.env.DATABASE_URL) {
      const recentFixtureId = `fixt-rec-${Math.random().toString(36).slice(2, 8)}`
      const recentFixtureAsk = `Swap $3 of ETH to USDC — recent-tab fixture ${recentFixtureId}`
      await prisma.intentLink.create({
        data: { id: recentFixtureId, ask: recentFixtureAsk, creator: mallory.address.toLowerCase(), isInternal: false },
      })
      const organicHtml = await (await fetch(`${BASE}/links`)).text()
      // …and the same row, revoked, must be OFF the board on the next load:
      // the leaderboard half of "revoke takes the link down". Same fixture,
      // one flag flipped — nothing else about it changes, so a row that
      // stays is the board forgetting to ask.
      await prisma.intentLink.update({ where: { id: recentFixtureId }, data: { revoked: true } })
      const revokedHtml = await (await fetch(`${BASE}/links`)).text()
      await prisma.intentLink.deleteMany({ where: { id: recentFixtureId } })
      check('intent links: recently-minted tab surfaces an organic mint pre-sign', organicHtml.includes(recentFixtureAsk))
      check('intent links: revoking pulls the link off the public board', !revokedHtml.includes(recentFixtureAsk))
      check('intent links: recent-tab fixture released', (await prisma.intentLink.count({ where: { id: recentFixtureId } })) === 0)
    } else {
      check('intent links: organic recent-tab round-trip skipped — no DATABASE_URL for the harness process', true)
    }
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
    // Rule 7 — never wear a third-party financial brand (2026-08-18: /l/yeet
    // was found live wearing Robinhood from a scan drill). The write site
    // refuses by name BEFORE any fetch; the render side falls back to house
    // for any stored row whose domain is denied (data left for the owner).
    const bDenied = await fetch(`${BASE}/api/intent-links/brand`, { method: 'POST', headers: M, body: JSON.stringify({ url: 'https://app.uniswap.org/swap' }) })
    const bDeniedBody = (await bDenied.json()) as { error?: string; denied?: boolean }
    const bDenied2 = await fetch(`${BASE}/api/intent-links/brand`, { method: 'POST', headers: M, body: JSON.stringify({ url: 'https://robinhood.com/' }) })
    check(
      'brand rule 7: scanning a denied third-party financial brand (uniswap.org subdomain, robinhood.com) is refused 403 by name, never fetched',
      bDenied.status === 403 && bDeniedBody.denied === true && /never wears a third-party financial brand/.test(bDeniedBody.error ?? '') && bDenied2.status === 403,
    )
    const rowRobinhood = { brandDomain: 'robinhood.com', brandName: 'Robinhood', brandLogo: 'data:image/png;base64,AAAA', brandAccent: '#526700', brandBg: '#ccff00' }
    const rowStripe = { brandDomain: 'stripe.com', brandName: 'Stripe', brandLogo: 'data:image/png;base64,AAAA', brandAccent: '#635bff', brandBg: null }
    check(
      'brand rule 7: brandFromRow renders HOUSE for a denied stored row (Robinhood, swap.cow.fi, www.metamask.io, opensea.io) and the brand for an allowed one; venue policy hosts are covered',
      brandFromRow(rowRobinhood) === null &&
        brandFromRow({ ...rowStripe, brandDomain: 'swap.cow.fi' }) === null &&
        brandFromRow({ ...rowStripe, brandDomain: 'www.metamask.io' }) === null &&
        brandFromRow({ ...rowStripe, brandDomain: 'https://opensea.io/collection/x' }) === null &&
        brandFromRow(rowStripe)?.domain === 'stripe.com' &&
        brandFromRow({ brandDomain: null, brandName: null, brandLogo: null, brandAccent: null, brandBg: null }) === null &&
        isDeniedBrandHost('api.hyperliquid.xyz') && isDeniedBrandHost('lido.fi') && isDeniedBrandHost('pro.coinbase.com') &&
        !isDeniedBrandHost('notrobinhood.com') && !isDeniedBrandHost('pantessa.com') && !isDeniedBrandHost('uniswap.yeetful.com') &&
        THIRD_PARTY_BRAND_HOSTS.includes('robinhood.com'),
    )
    // Every public render site goes through brandFromRow — no raw row → brand
    // construction survives (the four sites: /l page + OG, /i page + OG).
    const renderSites = ['app/l/[handle]/page.tsx', 'app/l/[handle]/opengraph-image.tsx', 'app/i/[slug]/page.tsx', 'app/i/[slug]/opengraph-image.tsx']
    const renderSrc = await Promise.all(renderSites.map((f) => readFile(new URL(`../${f}`, import.meta.url), 'utf8')))
    check(
      'brand rule 7: all four public render sites read the brand ONLY via brandFromRow (no raw creator_handles → brand construction)',
      renderSrc.every((src) => src.includes('brandFromRow(') && !src.includes('{ domain: row.brandDomain')),
    )
    const bAccent = await fetch(`${BASE}/api/intent-links/brand`, { method: 'PATCH', headers: M, body: JSON.stringify({ accent: '#6633cc' }) })
    const bAccentBad = await fetch(`${BASE}/api/intent-links/brand`, { method: 'PATCH', headers: M, body: JSON.stringify({ accent: '#ffffff' }) })
    check('brand: accent PATCH validates (#6633cc lands, near-white refused)', bAccent.status === 200 && bAccentBad.status === 400)
    const brandedHtml = flat(await (await fetch(`${BASE}/l/harness-store`)).text())
    check(
      'brand: the /l page wears the accent and keeps the Powered by Pantessa mark',
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

    const brandedIPage = redirected.slug ? flat(await (await fetch(`${BASE}/i/${redirected.slug}`)).text()) : ''
    check('brand: the creator brand re-themes their /i splash (bg carried)', brandedIPage.includes('--bg:#052b65'))
    const houseIPage = flat(await (await fetch(`${BASE}/i/buy-aapl`)).text())
    check('brand: house links stay pure Pantessa (no brand bg on their /i splash)', !houseIPage.includes('--bg:#'))
    // ── Colors without a third party (the /dashboard/customize studio) ─────
    // Rule 7 refuses someone else's IDENTITY (logo, name, domain), never a
    // color. So the palette is a first-class control: presets + free hex,
    // no scan involved. Every preset has to survive the render math, or a
    // creator taps one and the page ignores half of it.
    check(
      'customize: every preset is renderable — bg parses, accent passes the accent gate, and the pair clears the contrast guard (>0.18 luminance apart)',
      BRAND_PRESETS.length >= 6 &&
        BRAND_PRESETS.every(
          (p) =>
            normalizeBg(p.bg) === p.bg &&
            normalizeAccent(p.accent) === p.accent &&
            Math.abs((hexLuminance(p.bg) ?? 0) - (hexLuminance(p.accent) ?? 0)) > 0.18,
        ) &&
        new Set(BRAND_PRESETS.map((p) => p.id)).size === BRAND_PRESETS.length,
    )
    check(
      'customize: presetFor round-trips a stored pair (and is null for a hand-picked one)',
      presetFor(BRAND_PRESETS[0].bg, BRAND_PRESETS[0].accent)?.id === BRAND_PRESETS[0].id &&
        presetFor(BRAND_PRESETS[0].bg.toUpperCase(), BRAND_PRESETS[0].accent) !== null &&
        presetFor('#052b65', '#6633cc') === null &&
        presetFor(null, null) === null,
    )
    check(
      'customize: the hex field states the accent rule before the server does (near-white/near-black refused, junk refused, a real hex accepted for both roles)',
      colorFieldError('accent', '#ffffff') !== null &&
        colorFieldError('accent', '#000000') !== null &&
        colorFieldError('accent', 'zebra') !== null &&
        colorFieldError('accent', '#38bdf8') === null &&
        colorFieldError('bg', '#ffffff') === null &&
        colorFieldError('bg', '#0f172a') === null,
    )
    // A preset applied through the real API paints the real page — this is
    // the "skin it, no site attached" path end to end (no logo, no domain,
    // no scan: brandFromRow still returns a brand, made only of colors).
    const preset = BRAND_PRESETS[0]
    const bPreset = await fetch(`${BASE}/api/intent-links/brand`, {
      method: 'PATCH',
      headers: M,
      body: JSON.stringify({ bg: preset.bg, accent: preset.accent }),
    })
    const presetHtml = flat(await (await fetch(`${BASE}/l/harness-store`)).text())
    check(
      'customize: a preset applied with no site attached re-themes the page and KEEPS its accent (the contrast guard does not swap it)',
      bPreset.status === 200 &&
        presetHtml.includes(`--bg:${preset.bg}`) &&
        presetHtml.includes(`--accent:${preset.accent}`) &&
        presetHtml.includes('Powered by'),
    )
    // The section exists and both surfaces read the SAME state machine —
    // a second copy of the claim/scan/color calls is how they drift.
    const railSrc = await readFile(new URL('../components/DashboardSidebar.tsx', import.meta.url), 'utf8')
    check(
      'customize: the dashboard rail carries the Customize page section pointing at /dashboard/customize',
      /href: '\/dashboard\/customize', label: 'Customize page'/.test(railSrc),
    )
    const [studioSrc, panelSrc] = await Promise.all([
      readFile(new URL('../components/CreatorPageStudio.tsx', import.meta.url), 'utf8'),
      readFile(new URL('../components/CreatorPagePanel.tsx', import.meta.url), 'utf8'),
    ])
    check(
      'customize: the studio and the compact panel share useCreatorPage (neither builds its own fetch to the brand API)',
      studioSrc.includes('useCreatorPage()') &&
        panelSrc.includes('useCreatorPage()') &&
        !studioSrc.includes("fetch('/api/intent-links/brand'") &&
        !panelSrc.includes("fetch('/api/intent-links/brand'"),
    )
    check(
      'customize: the studio names the rule-7 line on the logo step, and never restricts colors',
      /refused here by name/.test(studioSrc) && /colors above are\s+never restricted/i.test(studioSrc.replace(/\n\s+/g, ' ')),
    )
    // The creator's brand rides onto their /i splash pages too (bg + accent
    // scoped to the splash) — house links (creator=null) stay pure Pantessa.
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

    // U3 — human send: minting with a recipient ADDRESSES the link (inbox +
    // allowlist target + sender label); a junk recipient refuses at mint.
    const u3Recipient = '0x7777777777777777777777777777777777777777'
    const sentMint = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: BJ,
      body: JSON.stringify({ ask: 'Buy $5 of AAPL, sent by a friend', recipient: u3Recipient }),
    })
    const sentMintData = (await sentMint.json()) as { slug?: string; recipient?: string; inboxUrl?: string }
    const u3Inbox = ((await (await fetch(`${BASE}/api/inbox?wallet=${u3Recipient}`)).json()) as { items?: { slug?: string; from?: string | null }[] }).items ?? []
    const u3Row = u3Inbox.find((i) => i.slug === sentMintData.slug)
    check(
      'intent links U3: a human mint with recipient lands in their inbox with the sender named',
      sentMint.status === 200 &&
        sentMintData.recipient === u3Recipient &&
        sentMintData.inboxUrl === `/inbox/${u3Recipient}` &&
        !!u3Row &&
        typeof u3Row.from === 'string' &&
        u3Row.from.length > 0,
    )
    const u3Allowed = await fetch(`${BASE}/api/intent-links/${sentMintData.slug}/allowed?wallet=${u3Recipient}`)
    check(
      'intent links U3: the addressed mint targets its recipient (allowlist)',
      ((await u3Allowed.json()) as { allowed?: boolean }).allowed === true,
    )
    const badRecipMint = await fetch(`${BASE}/api/intent-links`, {
      method: 'POST',
      headers: BJ,
      body: JSON.stringify({ ask: 'Buy $5 of AAPL, sent nowhere', recipient: '@no-such-handle-ever' }),
    })
    check('intent links U3: an unknown handle refuses at mint (400, named)', badRecipMint.status === 400)
    await fetch(`${BASE}/api/intent-links/${sentMintData.slug}`, { method: 'DELETE', headers: B })

    // U4 — the desk transcript strip rides /docs/desk (the ten-second aha).
    const deskDocs = flat(await (await fetch(`${BASE}/docs/desk`)).text())
    check(
      'docs U4: /docs/desk carries the replayable desk-session transcript',
      /data-desk-transcript/.test(deskDocs) && /two agents, one human signature/i.test(deskDocs),
    )
    // Squad visuals: the strip is the launch clip's storyboard — replay +
    // pause affordances, the .yprog progress line, and role inks as THEME
    // TOKENS (never sky-/amber-400 — ~1.8:1 on paper). SSR paints the empty
    // terminal (armed on scroll-into-view; the client clock lands lines).
    check(
      'docs U4: the desk transcript ships replay + pause, the .yprog arc, and token role inks',
      /aria-label="Replay the session"/.test(deskDocs) &&
        /aria-label="(Pause|Resume) the session"/.test(deskDocs) &&
        /data-desk-state=/.test(deskDocs) &&
        /class="[^"]*\bdesktx\b/.test(deskDocs) &&
        /class="[^"]*\byprog\b/.test(deskDocs.slice(deskDocs.indexOf('data-desk-transcript'))) &&
        !/data-desk-transcript[\s\S]{0,4000}text-(sky|amber)-\d/.test(deskDocs),
    )
    // The light-mode remap now covers amber/red/sky text utilities the way
    // it covers emerald — a hardcoded dark-stage ink must never ship
    // unflipped again (the 37-file --done lesson).
    const designCss = await readFile(new URL('../app/x402-design.css', import.meta.url), 'utf8')
    check(
      'theme: light-mode remaps exist for text-amber-400 / text-red-400 / text-sky-400',
      /html\[data-theme='light'\] \.text-amber-400/.test(designCss) &&
        /html\[data-theme='light'\] \.text-red-400/.test(designCss) &&
        /html\[data-theme='light'\] \.text-sky-400/.test(designCss),
    )
    // Full-bleed bands (.filmband) reach the viewport edges with 50% - 50vw,
    // which overshoots the content box by half a classic scrollbar. The
    // stylesheet's old comment promised a body overflow-x guard that never
    // existed; this is the guard, and it must stay clip (not hidden) so the
    // viewport remains the scroll container.
    check(
      'layout: the viewport clips its x axis so full-bleed bands never mint a horizontal scrollbar',
      /html \{ overflow-x: clip; \}/.test(designCss) && /\.filmband::before, \.filmband::after \{[^}]*left: calc\(50% - 50vw\)/.test(designCss),
    )

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
    // The explainer under the spread is a FACADE (components/ExplainerVideo):
    // poster + play control ship in the HTML and the YouTube iframe mounts
    // only on press — a landing page must never pay for a player most
    // visitors won't start. The VideoObject JSON-LD rides the same record
    // (lib/explainer-video), so the page and search results can't disagree.
    check(
      'explainer: the landing spread carries the video facade, not a YouTube iframe',
      homeHtml.includes(`data-video="${EXPLAINER_VIDEO.id}"`) &&
        homeHtml.includes('EXPLAINER · 6:47') &&
        homeHtml.includes(EXPLAINER_VIDEO.headline) &&
        homeHtml.includes(explainerWatchUrl) &&
        !/<iframe[^>]+youtube/i.test(homeHtml),
    )
    check(
      'explainer: the home page declares a VideoObject for the same upload',
      homeHtml.includes('"@type":"VideoObject"') &&
        homeHtml.includes(`"duration":"${isoDuration(EXPLAINER_VIDEO.seconds)}"`) &&
        homeHtml.includes(`"uploadDate":"${EXPLAINER_VIDEO.uploadDate}"`),
    )
    // The poster is YouTube's own thumbnail served first-party through
    // next/image — prove a real build's optimizer accepts the host.
    const posterRes = await fetch(`${BASE}/_next/image?url=${encodeURIComponent(explainerPosterUrl)}&w=1080&q=75`)
    check(
      'explainer: the poster serves first-party through the image optimizer',
      posterRes.status === 200 && (posterRes.headers.get('content-type') ?? '').startsWith('image/'),
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
    // ACTIVE links until `need` slots are open (free plan cap = 3). The list
    // route returns live links only, so everything it hands back is active.
    const freeSlots = async (need: number) => {
      const list = await fetch(`${BASE}/api/intent-links`, { headers: { cookie: mallorySession } })
      const active = ((await list.json()) as { links?: Array<{ slug: string }> }).links ?? []
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
      const held = ((await tail.json()) as { links?: Array<{ slug: string }> }).links ?? []
      await Promise.all(
        held.map((l) => fetch(`${BASE}/api/intent-links/${l.slug}`, { method: 'DELETE', headers: { cookie: mallorySession } })),
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
  // is now refused server-side (not advisory) — Pantessa executes this rail, so
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
    'broker M1: desk kill switch is fail-closed (true→open, false/unset→closed)',
    (() => {
      const prior = process.env.BROKER_DESK_ENABLED
      try {
        process.env.BROKER_DESK_ENABLED = 'true'
        const open = deskEnabled() === true
        process.env.BROKER_DESK_ENABLED = 'false'
        const off = deskEnabled() === false
        delete process.env.BROKER_DESK_ENABLED
        const unset = deskEnabled() === false // fail-closed when unset
        return open && off && unset
      } finally {
        if (prior === undefined) delete process.env.BROKER_DESK_ENABLED
        else process.env.BROKER_DESK_ENABLED = prior
      }
    })(),
  )
  check(
    'broker M1: identity gate + cap + agent_key sanitize behave',
    (() => {
      let idRefused = false
      try {
        assertAgentIdentity(null)
      } catch {
        idRefused = true
      }
      let idOk = true
      try {
        assertAgentIdentity('desk-abc')
      } catch {
        idOk = false
      }
      let overRefused = false
      try {
        assertUnderDeskCap(DESK_MAX_INTENT_USD + 1)
      } catch {
        overRefused = true
      }
      let underOk = true
      try {
        assertUnderDeskCap(DESK_MAX_INTENT_USD)
        assertUnderDeskCap(null) // unpriceable ask passes the cap gate
      } catch {
        underOk = false
      }
      return (
        idRefused &&
        idOk &&
        overRefused &&
        underOk &&
        cleanAgentKey('a') === null && // too short
        cleanAgentKey('desk-key-123') === 'desk-key-123' &&
        cleanAgentKey('bad key!!') === 'badkey'
      )
    })(),
  )
  check(
    'broker M3: callback URL SSRF fence — https public only, no localhost/IP/creds/http',
    (() => {
      const bad = [
        'http://example.com/hook', // not https
        'https://localhost/hook',
        'https://127.0.0.1/hook',
        'https://10.0.0.1/hook',
        'https://user:pass@example.com/hook', // credentials
        'https://example.com:8080/hook', // non-default port
        'not-a-url',
      ]
      const allBad = bad.every((u) => validateCallbackUrl(u).ok === false)
      const good = validateCallbackUrl('https://hooks.example.com/pantessa')
      return allBad && good.ok === true
    })(),
  )
  check(
    'broker M6: desk pricing is fail-closed to free; a valid pay-to flips it to x402 per-call',
    (() => {
      const prior = {
        addr: process.env.BROKER_PAYMENT_ADDRESS,
        price: process.env.BROKER_X402_PRICE_USD,
      }
      try {
        // Unset / malformed → free, and priced tools cost nothing.
        delete process.env.BROKER_PAYMENT_ADDRESS
        const free = deskPricing().mode === 'free' && priceForTool('broker_open') === null && (pricingBlock() as { model?: string }).model === 'free'
        process.env.BROKER_PAYMENT_ADDRESS = 'not-an-address'
        const stillFree = deskPricing().mode === 'free'
        // Valid pay-to → paid, value tools priced, control/discovery free.
        process.env.BROKER_PAYMENT_ADDRESS = '0x' + '1'.repeat(40)
        process.env.BROKER_X402_PRICE_USD = '0.05'
        const p = deskPricing()
        const paid =
          p.mode === 'paid' &&
          p.priceUsd === '0.05' &&
          priceForTool('broker_open') === '0.05' &&
          priceForTool('broker_execute') === '0.05' &&
          priceForTool('broker_status') === null &&
          priceForTool('broker_close') === null &&
          (pricingBlock() as { model?: string }).model === 'x402-per-call'
        return free && stillFree && paid
      } finally {
        if (prior.addr === undefined) delete process.env.BROKER_PAYMENT_ADDRESS
        else process.env.BROKER_PAYMENT_ADDRESS = prior.addr
        if (prior.price === undefined) delete process.env.BROKER_X402_PRICE_USD
        else process.env.BROKER_X402_PRICE_USD = prior.price
      }
    })(),
  )
  check(
    'broker M4: agent handle is a stable, collision-distinct sha256 prefix (never the raw key)',
    (() => {
      const h1 = agentHandleFor('harness-desk-key')
      const h2 = agentHandleFor('harness-desk-key')
      const h3 = agentHandleFor('some-other-agent')
      return /^[0-9a-f]{16}$/.test(h1) && h1 === h2 && h1 !== h3 && !h1.includes('harness')
    })(),
  )
  // --- ROSTER (overnight 2026-08-25) — security policy fences, CONTRACTS v1 ---
  check(
    'roster: kill switch fail-closed; FIRE is exempt even while disabled',
    (() => {
      const prior = process.env.ROSTER_ENABLED
      try {
        delete process.env.ROSTER_ENABLED
        const closedUnset = rosterEnabled() === false
        let hireWalled = false
        try {
          assertRosterOpen('hire')
        } catch {
          hireWalled = true
        }
        let fireOpen = true
        try {
          assertRosterOpen('fire') // the exit door never closes
        } catch {
          fireOpen = false
        }
        process.env.ROSTER_ENABLED = 'true'
        let hireOpen = true
        try {
          assertRosterOpen('hire')
        } catch {
          hireOpen = false
        }
        process.env.ROSTER_ENABLED = 'TRUE' // exact-match only, like the desk
        const strict = rosterEnabled() === false
        return closedUnset && hireWalled && fireOpen && hireOpen && strict
      } finally {
        if (prior === undefined) delete process.env.ROSTER_ENABLED
        else process.env.ROSTER_ENABLED = prior
      }
    })(),
  )
  check(
    'roster: hire consent signs over slot + agent hash + mandate hash + cap + nonce + expiry, never a raw key or sentence',
    (() => {
      const nonce = mintRosterNonce()
      const msg = rosterHireConsentMessage({
        slotId: 'slot_abc',
        wallet: '0xABCDEF0000000000000000000000000000000001',
        agentKeyHash: agentHandleFor('harness-desk-key'),
        mandateHash: mandateHash('DCA $25 into ETH weekly'),
        capUsd: 50,
        nonce,
        expiresAt: new Date('2026-08-26T00:00:00Z'),
      })
      const fire = rosterFireConsentMessage({
        slotId: 'slot_abc',
        wallet: '0xABCDEF0000000000000000000000000000000001',
        nonce,
        expiresAt: new Date('2026-08-26T00:00:00Z'),
      })
      return (
        msg.includes('Slot: slot_abc') &&
        msg.includes('Wallet: 0xabcdef0000000000000000000000000000000001') && // canonical lowercase
        msg.includes(`Agent: ${agentHandleFor('harness-desk-key')}`) &&
        msg.includes(`Mandate: ${mandateHash('DCA $25 into ETH weekly')}`) &&
        msg.includes('Cap: $50 per proposal') &&
        msg.includes(`Nonce: ${nonce}`) &&
        msg.includes('Expires: 2026-08-26T00:00:00.000Z') &&
        !msg.includes('harness-desk-key') && // raw agent key never in the signed bytes (T8)
        !msg.includes('DCA $25') && // the sentence rides as a hash, never text (T9)
        fire.includes('Slot: slot_abc') &&
        fire.includes('fires the agent') &&
        /^[0-9a-f]{16}$/.test(mandateHash('x')) &&
        consentExpired(new Date(Date.now() - 1000)) &&
        !consentExpired(new Date(Date.now() + 60_000)) &&
        consentExpired(null) && // unreadable expiry fails closed
        consentExpired('garbage')
      )
    })(),
  )
  check(
    'roster: consent verify recovers the signer — right wallet passes, wrong wallet / reused-slot text / garbage refuse',
    await (async () => {
      const employer = privateKeyToAccount(generatePrivateKey())
      const nonce = mintRosterNonce()
      const input = {
        slotId: 'slot_verify',
        wallet: employer.address,
        agentKeyHash: agentHandleFor('harness-desk-key'),
        mandateHash: mandateHash('keep me 60/40 ETH/USDC'),
        capUsd: 100,
        nonce,
        expiresAt: new Date(Date.now() + 60_000),
      }
      const msg = rosterHireConsentMessage(input)
      const sig = await employer.signMessage({ message: msg })
      let ok = true
      try {
        await verifyRosterConsent(msg, employer.address, sig)
      } catch {
        ok = false
      }
      // Cross-slot reuse: the SAME signature against a different slot's text.
      const otherMsg = rosterHireConsentMessage({ ...input, slotId: 'slot_other' })
      let crossRefused = false
      try {
        await verifyRosterConsent(otherMsg, employer.address, sig)
      } catch (e) {
        crossRefused = /recovers to|does not verify/i.test(String(e))
      }
      // A different wallet presenting the real signature.
      const mallory2 = privateKeyToAccount(generatePrivateKey())
      let walletRefused = false
      try {
        await verifyRosterConsent(msg, mallory2.address, sig)
      } catch (e) {
        walletRefused = /recovers to/i.test(String(e))
      }
      let garbageRefused = false
      try {
        await verifyRosterConsent(msg, employer.address, '0x1234')
      } catch (e) {
        garbageRefused = /65-byte/i.test(String(e))
      }
      return ok && crossRefused && walletRefused && garbageRefused
    })(),
  )
  check(
    'roster: slot cap fails CLOSED on unpriceable money asks; open/build stages named; over-cap refuses by name',
    (() => {
      let overRefused = false
      try {
        assertUnderSlotCap(51, 50, { moneyShaped: true, stage: 'open', slotLabel: 'DCA lane' })
      } catch (e) {
        overRefused = /open/.test(String(e)) && /\$50/.test(String(e)) && /DCA lane/.test(String(e))
      }
      let nullMoneyRefused = false
      try {
        assertUnderSlotCap(null, 50, { moneyShaped: true, stage: 'build' })
      } catch (e) {
        nullMoneyRefused = /build/.test(String(e)) && /could not be priced/i.test(String(e))
      }
      let underOk = true
      try {
        assertUnderSlotCap(50, 50, { moneyShaped: true, stage: 'build' }) // at-cap passes
        assertUnderSlotCap(null, 50, { moneyShaped: false, stage: 'open' }) // non-money null passes
      } catch {
        underOk = false
      }
      return overRefused && nullMoneyRefused && underOk
    })(),
  )
  check(
    'roster R2: assertProposalBudget (DB-backed §4.4 fence) — clean slot passes, fence errors fail open',
    await (async () => {
      // An unknown slot has 0 pending and no 24h spend — a $10 proposal under
      // a $50 cap must pass without throwing (and a store hiccup fails OPEN,
      // exercised implicitly when the column is absent in a stale DB).
      try {
        await assertProposalBudget(`no-such-slot-${Date.now()}`, 50, 10)
        return true
      } catch {
        return false
      }
    })(),
  )
  check(
    'roster: aggregate fences — pending-full, daily budget (3× cap / 24h); bench on cap breach ONLY (decline-streak benching killed)',
    (() => {
      const full = decideProposalBudget({ estUsd: 5, capUsd: 50, pendingCount: ROSTER_MAX_PENDING_PROPOSALS, sum24hUsd: 5 })
      const budget = decideProposalBudget({ estUsd: 10, capUsd: 50, pendingCount: 0, sum24hUsd: 50 * ROSTER_DAILY_BUDGET_MULT + 1 })
      const fine = decideProposalBudget({ estUsd: 10, capUsd: 50, pendingCount: 1, sum24hUsd: 60 })
      return (
        full === 'pending-full' &&
        budget === 'daily-budget' &&
        fine === null &&
        decideBench({ capBreach: true }) && // probing the cap benches immediately
        !decideBench({ capBreach: false, consecutiveDeclines: 99 }) // declines NEVER bench (ideation judges, 2026-08-25)
      )
    })(),
  )
  check(
    'roster: mandate input hygiene — NFKC fold, control chars stripped, over-length REFUSED (never truncated)',
    (() => {
      const folded = cleanMandateInput('ＤＣＡ $25  into\nETH  weekly') === 'DCA $25 into ETH weekly'
      let longRefused = false
      try {
        cleanMandateInput('x'.repeat(ROSTER_MAX_MANDATE_CHARS + 1))
      } catch (e) {
        longRefused = /over the/.test(String(e))
      }
      let emptyRefused = false
      try {
        cleanMandateInput('   ')
      } catch {
        emptyRefused = true
      }
      return folded && longRefused && emptyRefused
    })(),
  )
  // ── THE ROSTER R1 (lib/roster + /api/roster) — mandate grammar + slots ───
  console.log('— roster R1 (lib/roster + /api/roster)')
  check(
    'roster R1: the four launch mandates parse to their kinds and the CANONICAL text round-trips idempotently',
    (() => {
      const cases: [string, string][] = [
        ['tile my wallet 60% ETH, 40% USDC', 'shape'],
        ['keep me 60/40 ETH/USDC', 'shape'], // natural phrasing (ideation) → tile canonical
        ['buy $25 of ETH weekly', 'dca'],
        ['protect my ETH in my wallet with a 10% stop', 'protect'],
        ['supply 25 USDC to aave', 'yield'],
        ['stake 0.5 ETH on lido', 'yield'],
      ]
      return cases.every(([text, kind]) => {
        const p = parseMandate(text)
        if ('problem' in p) return false
        if (p.kind !== kind) return false
        // The stored sentence is the executor's own canonical form — parsing
        // it AGAIN must land identically (what a hired proposal compiles from).
        const rt = parseMandate(p.mandateText)
        return !('problem' in rt) && rt.kind === p.kind && rt.mandateText === p.mandateText && MANDATE_KIND_LABELS[p.kind].length > 0
      })
    })(),
  )
  check(
    'roster R1: garbage refuses BY NAME (all four grammars listed); un-executable flagships refuse by name too',
    (() => {
      const garbage = parseMandate('do a backflip with my money please')
      const conditional = parseMandate('buy $25 of ETH weekly, double on red weeks') // no DCA conditional executor (ideation)
      const hunt = parseMandate('hunt stable yield, boring only') // no yield-hunt executor (ideation)
      return (
        'problem' in garbage &&
        /tile my wallet/.test(garbage.problem) &&
        /weekly/.test(garbage.problem) &&
        /stop/.test(garbage.problem) &&
        /aave|lido/i.test(garbage.problem) &&
        'problem' in conditional &&
        /aren't executable yet|silently ignored/.test(conditional.problem) &&
        'problem' in hunt &&
        /isn't an executable mandate yet/.test(hunt.problem)
      )
    })(),
  )
  check(
    'roster R1: slot-cap sanitize + agent-hash shape — over-cap refuses by name, hash is 16-hex or nothing',
    (() => {
      const over = cleanCapUsd(ROSTER_MAX_CAP_USD + 1)
      return (
        cleanCapUsd(null) === 200 &&
        cleanCapUsd('50') === 50 &&
        typeof over === 'object' &&
        /cap at \$/.test(over.problem) &&
        typeof cleanCapUsd(-3) === 'object' &&
        cleanAgentKeyHash('AB12CD34EF56AB12') === 'ab12cd34ef56ab12' &&
        cleanAgentKeyHash('0x' + 'a'.repeat(16)) === null && // 0x-prefixed ≠ the handle shape
        cleanAgentKeyHash('short') === null
      )
    })(),
  )
  // The live flow: draft → (private) → hire consent → sign → hired → fire.
  {
    const employer = privateKeyToAccount(generatePrivateKey())
    SIGNED_IN_WALLETS.add(employer.address.toLowerCase())
    const agentHash = agentHandleFor('roster-r1-drill-agent')
    const J = { 'content-type': 'application/json' }
    const post = await fetch(`${BASE}/api/roster`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ wallet: employer.address, mandate: 'buy $25 of ETH weekly', capUsd: 50 }),
    })
    const posted = (await post.json()) as { slot?: { id: string; status: string; mandateText: string }; internal?: boolean; error?: string }
    check(
      'roster R1: connect-to-act draft mint — pending, canonical text stored, internal-run stamp echoed',
      post.status === 200 && posted.slot?.status === 'pending' && posted.slot.mandateText === 'buy $25 of ETH weekly' && posted.internal === true,
      posted.error ?? '',
    )
    const slotId = posted.slot?.id ?? 'missing'
    const pubList = (await (await fetch(`${BASE}/api/roster?wallet=${employer.address}`)).json()) as { slots?: { id: string }[] }
    check(
      'roster R1: a pending draft is PRIVATE — the public roster never lists it (T1)',
      (pubList.slots ?? []).every((s) => s.id !== slotId),
    )
    const badMint = await fetch(`${BASE}/api/roster/hire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId, wallet: employer.address, agentKeyHash: 'roster-r1-drill-agent' }),
    })
    check('roster R1: hiring with a raw agent key (not the 16-hex handle) refuses by name (T8)', badMint.status === 400 && /16-hex|never its raw key/.test(((await badMint.json()) as { error?: string }).error ?? ''))
    const mint = await fetch(`${BASE}/api/roster/hire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId, wallet: employer.address, agentKeyHash: agentHash }),
    })
    const minted = (await mint.json()) as { consentText?: string; error?: string }
    check(
      'roster R1: hire consent text is server-composed — carries slot + agent hash + nonce, NEVER the mandate sentence (T9)',
      mint.status === 200 &&
        !!minted.consentText &&
        minted.consentText.includes(`Slot: ${slotId}`) &&
        minted.consentText.includes(`Agent: ${agentHash}`) &&
        /Nonce: [0-9a-f]{32}/.test(minted.consentText) &&
        !minted.consentText.includes('buy $25 of ETH weekly'),
      minted.error ?? '',
    )
    // Without consent: no signature at all → still pending; mallory's
    // signature over the same text → refused, still pending.
    const malloryAcct = privateKeyToAccount(generatePrivateKey())
    const wrongSig = await malloryAcct.signMessage({ message: minted.consentText ?? '' })
    const wrongHire = await fetch(`${BASE}/api/roster/hire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId, wallet: employer.address, signature: wrongSig }),
    })
    check(
      "roster R1: hire WITHOUT the wallet's own consent refuses — a stranger's signature recovers and is named",
      wrongHire.status === 401 && /recovers to/.test(((await wrongHire.json()) as { error?: string }).error ?? ''),
    )
    const rightSig = await employer.signMessage({ message: minted.consentText ?? '' })
    const hire = await fetch(`${BASE}/api/roster/hire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId, wallet: employer.address, signature: rightSig }),
    })
    const hired = (await hire.json()) as { slot?: { status: string; agentKeyHash: string | null }; error?: string }
    const pubAfter = (await (await fetch(`${BASE}/api/roster?wallet=${employer.address}`)).json()) as { slots?: { id: string; status: string }[] }
    check(
      'roster R1: the hire consent signature flips pending → hired and the slot goes PUBLIC',
      hire.status === 200 && hired.slot?.status === 'hired' && hired.slot.agentKeyHash === agentHash && (pubAfter.slots ?? []).some((s) => s.id === slotId && s.status === 'hired'),
      hired.error ?? '',
    )
    // Replay: the hire nonce died on success — re-submitting the same
    // signature must refuse (slot no longer pending + nonce cleared).
    const replay = await fetch(`${BASE}/api/roster/hire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId, wallet: employer.address, signature: rightSig }),
    })
    check('roster R1: a spent hire consent cannot replay (nonce single-use, state machine forward-only)', replay.status === 409)
    // Fire via the consent door (connect-to-act — no SIWE needed to leave).
    const fMint = await fetch(`${BASE}/api/roster/fire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId, wallet: employer.address }),
    })
    const fMinted = (await fMint.json()) as { consentText?: string }
    const fSig = await employer.signMessage({ message: fMinted.consentText ?? '' })
    const fired = await fetch(`${BASE}/api/roster/fire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId, wallet: employer.address, signature: fSig }),
    })
    const firedBody = (await fired.json()) as { slot?: { status: string }; error?: string }
    const pubFired = (await (await fetch(`${BASE}/api/roster?wallet=${employer.address}`)).json()) as { slots?: { id: string }[] }
    check(
      'roster R1: fire consent retires the slot (terminal) and it leaves the public roster',
      fired.status === 200 && firedBody.slot?.status === 'fired' && (pubFired.slots ?? []).every((s) => s.id !== slotId),
      firedBody.error ?? '',
    )
    // Release the row: the signed-in owner may remove fired history.
    const employerSession = await signIn(employer)
    const gone = await fetch(`${BASE}/api/roster/fire`, {
      method: 'POST',
      headers: { ...J, cookie: employerSession },
      body: JSON.stringify({ slotId, wallet: employer.address }),
    })
    check('roster R1: the signed-in owner removes fired history — drill row released', ((await gone.json()) as { deleted?: boolean }).deleted === true)
  }

  // ── The doors: WalletConnect lane (lib/wallet-lineup) ────────────────────
  console.log('— wallet lineup (WC lane, doors run)')
  check(
    'wallet lineup: env absent = EXACTLY today\'s connectors (injected/MetaMask/Coinbase, in order); a real WC id adds the two WC lanes; the placeholder never counts',
    (() => {
      const dark = walletLineup(null)
      const placeholder = walletLineup('YOUR_WALLETCONNECT_PROJECT_ID')
      const lit = walletLineup('abc123realprojectid')
      return (
        JSON.stringify(dark) === JSON.stringify(['injected', 'metaMask', 'coinbase']) &&
        JSON.stringify(placeholder) === JSON.stringify(dark) &&
        JSON.stringify(lit) === JSON.stringify(['injected', 'metaMask', 'coinbase', 'rainbow', 'walletConnect']) &&
        wcConfigured(undefined) === false &&
        wcConfigured('abc123realprojectid') === true &&
        // the modal lane's one env-sensitive line: absent = today's copy,
        // present names the mobile-QR path; WC metadata is the site's own.
        !/WalletConnect/.test(walletLaneHint(null)) &&
        /QR/.test(walletLaneHint('abc123realprojectid')) &&
        WC_APP_METADATA.appName === 'Pantessa' &&
        WC_APP_METADATA.appUrl === 'https://www.pantessa.com'
      )
    })(),
  )

  // ── THE STOREFRONT (lib/roster-managers + /api/roster/managers) ──────────
  console.log('— roster storefront (FIRST HIRE)')
  check(
    'storefront: env-absent house row is an honest, NOT-hireable "coming soon"; env-present is hireable; resolve of an absent house is null',
    (() => {
      const dark = houseManagerRow(null)
      const lit = houseManagerRow('some-house-key')
      return (
        dark.id === HOUSE_MANAGER_ID &&
        dark.hireable === false &&
        /Coming soon/.test(dark.note ?? '') &&
        lit.hireable === true &&
        lit.house === true &&
        resolveHouseManager(null) === null &&
        resolveHouseManager('some-house-key')?.agentKeyHash === agentHandleFor('some-house-key')
      )
    })(),
  )
  {
    const J = { 'content-type': 'application/json' }
    const boss = privateKeyToAccount(generatePrivateKey())
    SIGNED_IN_WALLETS.add(boss.address.toLowerCase())
    // The server env carries HOUSE_MANAGER_KEY (.env.local — same belt as
    // ROSTER_ENABLED); the expected hash comes from reading it back, never
    // from the wire (the raw key must not cross it).
    const houseKeyLocal = (await readFile('.env.local', 'utf8')).match(/^HOUSE_MANAGER_KEY=(.*)$/m)?.[1]?.trim() ?? ''
    const list = await fetch(`${BASE}/api/roster/managers`)
    const listed = ((await list.json()) as { managers?: { id: string; name: string; hireable: boolean; house: boolean; kinds: string[] }[] }).managers ?? []
    const houseRow = listed.find((r) => r.id === HOUSE_MANAGER_ID)
    check(
      'storefront: the managers list serves the house row first, hireable, shape-serving — and never a hash or raw key on the wire',
      list.status === 200 &&
        listed[0]?.id === HOUSE_MANAGER_ID &&
        houseRow?.hireable === true &&
        houseRow.kinds.includes('shape') &&
        !JSON.stringify(listed).includes(houseKeyLocal) &&
        !JSON.stringify(listed).includes(agentHandleFor(houseKeyLocal)),
      `first=${listed[0]?.id}`,
    )
    // Prefilled hire round-trips: slot → hire step 1 with the MANAGER ID →
    // consent binds the env-derived hash → sign → hired to exactly it.
    const mk = await fetch(`${BASE}/api/roster`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ wallet: boss.address, mandate: 'tile my wallet 60% ETH, 40% USDC', capUsd: 50 }),
    })
    const slotId = ((await mk.json()) as { slot?: { id: string } }).slot?.id ?? 'missing'
    const mint = await fetch(`${BASE}/api/roster/hire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId, wallet: boss.address, managerId: HOUSE_MANAGER_ID }),
    })
    const minted = (await mint.json()) as { consentText?: string; error?: string }
    const sig = await boss.signMessage({ message: minted.consentText ?? '' })
    const hired = await fetch(`${BASE}/api/roster/hire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId, wallet: boss.address, signature: sig }),
    })
    const hiredBody = (await hired.json()) as { slot?: { agentKeyHash?: string | null }; error?: string }
    check(
      'storefront: the prefilled hire round-trips — managerId resolves SERVER-side and the slot hires to the env-derived hash',
      mint.status === 200 &&
        (minted.consentText ?? '').includes(`Agent: ${agentHandleFor(houseKeyLocal)}`) &&
        hired.status === 200 &&
        hiredBody.slot?.agentKeyHash === agentHandleFor(houseKeyLocal),
      minted.error ?? hiredBody.error ?? '',
    )
    // A client-supplied HASH is not a manager id — refused by name; so is
    // any unlisted id (nothing outside the server's own list resolves).
    const mk2 = await fetch(`${BASE}/api/roster`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ wallet: boss.address, mandate: 'buy $25 of ETH weekly', capUsd: 50 }),
    })
    const slot2 = ((await mk2.json()) as { slot?: { id: string } }).slot?.id ?? 'missing'
    const hashAsId = await fetch(`${BASE}/api/roster/hire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId: slot2, wallet: boss.address, managerId: agentHandleFor(houseKeyLocal) }),
    })
    const foundingSpoof = await fetch(`${BASE}/api/roster/hire`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ slotId: slot2, wallet: boss.address, managerId: `founding-${agentHandleFor('never-a-founder')}` }),
    })
    check(
      'storefront: a client-supplied hash (or unlisted founding id) is NOT a manager id — refused by name, consent never minted',
      hashAsId.status === 400 &&
        /a raw hash is not a manager id/.test(((await hashAsId.json()) as { error?: string }).error ?? '') &&
        foundingSpoof.status === 400,
    )
    // Release the drill rows (fire → fired-history delete, the R1 pattern).
    const bossSession = await signIn(boss)
    for (const sid of [slotId, slot2]) {
      for (let i = 0; i < 2; i++) {
        await fetch(`${BASE}/api/roster/fire`, {
          method: 'POST',
          headers: { ...J, cookie: bossSession },
          body: JSON.stringify({ slotId: sid, wallet: boss.address }),
        })
      }
    }
    const bossLeft = ((await (
      await fetch(`${BASE}/api/roster?wallet=${boss.address}`, { headers: { cookie: bossSession } })
    ).json()) as { slots?: unknown[] }).slots ?? []
    check('storefront: drill rows released', bossLeft.length === 0)
  }

  // ── M6 forward-paper tryouts (lib/roster-tryouts + /api/roster/tryouts) ──
  console.log('— roster tryouts (M6 forward-paper)')
  check(
    'tryouts: the review flip is all-or-stay-running — a zero-quote (or partial) capture pass never freezes permanent nulls behind `reviewed`',
    reviewFlipDecision([]) === true && // no marks: reviews trivially
      reviewFlipDecision([{ captured: true }, { captured: true }]) === true &&
      reviewFlipDecision([{ captured: true }, { captured: false }]) === false && // partial: keep retrying
      reviewFlipDecision([{ captured: false }]) === false, // zero-quote outage: stay running
  )
  check(
    'tryouts: the report card renders both quote numbers side by side and NEVER computes across them (banned phrases + delta + quote-line %)',
    (() => {
      const q = (out: number) => ({ pair: 'ETH/USDC', side: 'sell' as const, amountIn: 20, quoteOut: out, unit: 'USD per ETH' })
      const card = tryoutReportCard({
        mandateText: 'tile my wallet 60% ETH, 40% USDC',
        startedAt: new Date('2026-08-01T00:00:00Z'),
        reviewAt: new Date('2026-08-08T00:00:00Z'),
        reviewedAt: new Date('2026-08-08T01:00:00Z'),
        marks: [{ seq: 1, askText: 'Swap $20 of ETH to USDC on base', proposedAt: new Date('2026-08-02T00:00:00Z'), venue: 'Uniswap v3 ETH/USDC', quoteAtPropose: q(2000.12), quoteAtReview: q(1875.5) }],
        kindCount90d: 2,
      })
      const quoteLines = card.split('\n').slice(3).join('\n')
      const delta = Math.abs(2000.12 - 1875.5).toFixed(2) // 124.62 — must never appear
      return (
        card.startsWith(PAPER_LABEL) &&
        card.includes('2000.12') &&
        card.includes('1875.5') &&
        card.includes('run 2 tryouts of this mandate kind in the last 90 days') &&
        TRYOUT_BANNED_PHRASES.every((p) => !card.toLowerCase().includes(p)) &&
        !card.includes(delta) &&
        !quoteLines.includes('%')
      )
    })(),
  )
  check(
    'tryouts: the mark grammar is the canonical proposal sentence — one $-priced leg, one side the stable; everything else refuses',
    (() => {
      const ok = parseMarkAsk('Swap $20 of ETH to USDC on base')
      const both = parseMarkAsk('Swap $20 of USDC to DAI on base')
      const none = parseMarkAsk('Swap $20 of ETH to WBTC on base')
      const junk = parseMarkAsk('buy the dip')
      return (
        !('problem' in ok) && ok.quoteToken === 'ETH' && ok.side === 'sell' && ok.amountUsd === 20 &&
        'problem' in both && 'problem' in none && 'problem' in junk
      )
    })(),
  )
  check(
    "tryouts: marks are bounded by the mandate's OWN cadence — dca rides its period key, everything else one per UTC day",
    markPeriodKey('dca', 'buy $25 of ETH weekly') === markPeriodKey('dca', 'buy $25 of ETH weekly') &&
      markPeriodKey('shape', 'tile my wallet 60% ETH, 40% USDC') === markPeriodKey('shape', 'tile my wallet 60% ETH, 40% USDC') &&
      markPeriodKey('dca', 'buy $25 of ETH weekly') !== markPeriodKey('shape', 'tile my wallet 60% ETH, 40% USDC'),
  )
  {
    const J = { 'content-type': 'application/json' }
    const paperWallet = privateKeyToAccount(generatePrivateKey()).address.toLowerCase()
    SIGNED_IN_WALLETS.add(paperWallet)
    const paperAgent = agentHandleFor(`tryout-drill-${Date.now()}`)
    const create = await fetch(`${BASE}/api/roster/tryouts`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ wallet: paperWallet, agentKeyHash: paperAgent, mandate: 'tile my wallet 60% ETH, 40% USDC', capUsd: 50 }),
    })
    const created = (await create.json()) as { paper?: string; tryout?: { id: string; startedAt: string; reviewAt: string; mandateText: string }; internal?: boolean; error?: string }
    const t = created.tryout
    check(
      'tryouts: create stores the canonical mandate, wears the verbatim Paper label, and stamps review_at = started_at + 7 days exactly',
      create.status === 200 &&
        created.paper === PAPER_LABEL &&
        created.internal === true &&
        t?.mandateText === 'tile my wallet 60% ETH, 40% USDC' &&
        new Date(t!.reviewAt).getTime() - new Date(t!.startedAt).getTime() === 7 * 24 * 60 * 60 * 1000,
      created.error ?? '',
    )
    const tryoutId = t?.id ?? 'missing'
    // §1.5-1 — the payload contributes ONLY the sentence: quote-shaped
    // fields are ignored because the schema never reads them.
    const mark = await fetch(`${BASE}/api/roster/tryouts`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ tryoutId, ask: 'Swap $20 of ETH to USDC on base', quoteOut: 999999, quote_at_propose: { quoteOut: 999999 } }),
    })
    const marked = (await mark.json()) as { paper?: string; mark?: { quoteAtPropose?: { quoteOut?: number }; venue?: string; periodKey?: string }; error?: string }
    check(
      'tryouts: a mark is SERVER-quoted through the executor quote path — a live number, never the payload\'s',
      mark.status === 200 &&
        marked.paper === PAPER_LABEL &&
        (marked.mark?.quoteAtPropose?.quoteOut ?? 0) > 0 &&
        marked.mark?.quoteAtPropose?.quoteOut !== 999999 &&
        /Uniswap/i.test(marked.mark?.venue ?? ''),
      marked.error ?? `quote=${marked.mark?.quoteAtPropose?.quoteOut}`,
    )
    const markAgain = await fetch(`${BASE}/api/roster/tryouts`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ tryoutId, ask: 'Swap $10 of ETH to USDC on base' }),
    })
    check('tryouts: a second mark in the same period refuses by name (§1.5-4)', markAgain.status === 400 && /already has its mark for the current period/.test(((await markAgain.json()) as { error?: string }).error ?? ''))
    const overCap = await fetch(`${BASE}/api/roster/tryouts`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ tryoutId: t?.id, ask: 'Swap $80 of ETH to USDC on base' }),
    })
    check('tryouts: an over-cap mark refuses with the REAL gate\'s copy', overCap.status === 400 && /caps proposals at \$50/.test(((await overCap.json()) as { error?: string }).error ?? ''))
    // G1 (spec gap, fail-closed): kinds with no executor quote fn refuse marks.
    const protectTry = await fetch(`${BASE}/api/roster/tryouts`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ wallet: paperWallet, agentKeyHash: paperAgent, mandate: 'protect my spot ETH with a 10% stop', capUsd: 50 }),
    })
    const protectId = ((await protectTry.json()) as { tryout?: { id: string } }).tryout?.id
    const protectMark = await fetch(`${BASE}/api/roster/tryouts`, {
      method: 'POST',
      headers: J,
      body: JSON.stringify({ tryoutId: protectId, ask: 'Swap $10 of ETH to USDC on base' }),
    })
    check(
      'tryouts: a mandate kind with no executor quote path refuses marks by name (spec gap G1, fail-closed)',
      !!protectId && protectMark.status === 400 && /no executor quote path is defined/.test(((await protectMark.json()) as { error?: string }).error ?? ''),
    )
    // §1.5-2 — early review refuses by name; review_at is immutable.
    const early = await fetch(`${BASE}/api/roster/tryouts/review`, { method: 'POST', headers: J, body: JSON.stringify({ tryoutId }) })
    const stillT = ((await (await fetch(`${BASE}/api/roster/tryouts?wallet=${paperWallet}`)).json()) as { tryouts?: { id: string; reviewAt: string; status: string }[] }).tryouts?.find((x) => x.id === tryoutId)
    check(
      'tryouts: early review refuses BY NAME and review_at is immutable (+7d fixed at creation)',
      early.status === 409 && /Too early/.test(((await early.json()) as { error?: string }).error ?? '') && stillT?.reviewAt === t?.reviewAt && stillT?.status === 'running',
    )
    // Write-once capture under the ZERO-QUOTE FENCE (security sprint
    // 2026-08-26): a capture pass whose venue quote fail-softs (a 429'd
    // public RPC mid-suite) now leaves the tryout RUNNING — never a
    // permanent-null `reviewed` — and the next pass retries. So the pin
    // retries the capture a few times; once `reviewed`, EVERY mark holds a
    // real quote (the flip condition guarantees it) and a further capture
    // changes nothing. A persistent outage passes the FENCE branch instead:
    // still running, quote still null, nothing frozen.
    type TryoutRead = { tryouts?: { id: string; status: string; marks: { quoteAtReview: { quoteOut?: number } | null }[]; card: string }[] }
    const readTryout = async () =>
      ((await (await fetch(`${BASE}/api/roster/tryouts?wallet=${paperWallet}`)).json()) as TryoutRead).tryouts?.find((x) => x.id === tryoutId)
    let revStatus = 0
    let after1 = await readTryout()
    for (let i = 0; i < 4 && after1?.status !== 'reviewed'; i++) {
      const rev = await fetch(`${BASE}/api/roster/tryouts/review`, { method: 'POST', headers: J, body: JSON.stringify({ tryoutId, forceDue: true }) })
      revStatus = rev.status
      after1 = await readTryout()
      if (after1?.status !== 'reviewed') await new Promise((r) => setTimeout(r, 800))
    }
    const rev2 = await fetch(`${BASE}/api/roster/tryouts/review`, { method: 'POST', headers: J, body: JSON.stringify({ tryoutId, forceDue: true }) })
    const after2 = await readTryout()
    check(
      'tryouts: the lazy review capture is WRITE-ONCE and the zero-quote fence never freezes nulls — reviewed ⇒ every quote real + immutable; outage ⇒ still running',
      revStatus === 200 &&
        rev2.status === 200 &&
        (after1?.status === 'reviewed'
          ? (after1.marks[0]?.quoteAtReview?.quoteOut ?? 0) > 0 &&
            after2?.status === 'reviewed' &&
            after2?.marks[0]?.quoteAtReview?.quoteOut === after1.marks[0]?.quoteAtReview?.quoteOut
          : after1?.status === 'running' && after1?.marks[0]?.quoteAtReview == null),
      JSON.stringify({ r2: rev2.status, s: after1?.status, q1: after1?.marks[0]?.quoteAtReview?.quoteOut, q2: after2?.marks[0]?.quoteAtReview?.quoteOut }),
    )
    check(
      'tryouts: the report card carries the verbatim Paper label and both server quotes',
      (after1?.card ?? '').startsWith(PAPER_LABEL) && /quote then: .+ · quote at review: .+/.test(after1?.card ?? ''),
    )
    // PAPER IS STRUCTURAL — nothing real was touched: no inbox item exists
    // for the wallet, and the agent hash has NO track record page (tryouts
    // never mint a broker intent, so /agents/<hash> 404s).
    const paperInbox = ((await (await fetch(`${BASE}/api/inbox?wallet=${paperWallet}`)).json()) as { items?: unknown[] }).items ?? []
    const recordPage = await fetch(`${BASE}/agents/${paperAgent}`)
    check(
      'tryouts: paper never touches records, standings, or the inbox — no inbox items, no track record minted',
      paperInbox.length === 0 && recordPage.status === 404,
      `inbox=${paperInbox.length} record=${recordPage.status}`,
    )
    // Public agent reads exclude internal drill rows (§1.5-5).
    const publicRead = ((await (await fetch(`${BASE}/api/roster/tryouts?agent=${paperAgent}`)).json()) as { tryouts?: unknown[] }).tryouts ?? []
    check('tryouts: stamped drill rows are excluded from the public per-agent read (§1.5-5)', publicRead.length === 0)
    // Append-only by spec — no delete API exists; the drill rows stay
    // stamped internal (excluded from every public surface).
  }
  // ── THE ROSTER (HANDOFF-roster R3/R6, visuals lane): flag + league pins ──
  console.log('— roster league (lib/league)')
  check(
    'roster: ROSTER_ENABLED kill switch is fail-closed (true→on, false/unset→off)',
    (() => {
      const prior = process.env.ROSTER_ENABLED
      try {
        process.env.ROSTER_ENABLED = 'true'
        const on = rosterEnabled() === true
        process.env.ROSTER_ENABLED = 'false'
        const off = rosterEnabled() === false
        delete process.env.ROSTER_ENABLED
        const unset = rosterEnabled() === false // fail-closed when unset
        return on && off && unset
      } finally {
        if (prior === undefined) delete process.env.ROSTER_ENABLED
        else process.env.ROSTER_ENABLED = prior
      }
    })(),
  )
  check(
    'roster §2.4: standings order = employers → signed → clean-cap → tenure → handle; NEVER volume USD',
    (() => {
      const row = (
        handle: string,
        walletsServed: number,
        signedTurns: number,
        capBreaches: number,
        firstSignedAt: Date | null,
        moneyMovedUsd = 0,
      ) => ({
        handle,
        displayName: null,
        mandateKind: null,
        moneyMovedUsd,
        signedTurns,
        walletsServed,
        intents: 1,
        firstSignedAt,
        capBreaches,
        founding: false,
        maxDrawdownPct: null,
        lastSeen: new Date(0),
      })
      const d1 = new Date('2026-01-01')
      const d2 = new Date('2026-02-01')
      const ranked = rankLeagueRows([
        // a whale-wash row: HUGE volume, one employer — must NOT lead (§2.4)
        row('aaaa', 1, 40, 0, d1, 900_000),
        row('bbbb', 3, 2, 0, d2), // most employers wins outright
        row('cccc', 1, 40, 1, d1), // signed tie w/ dddd broken by clean cap record
        row('dddd', 1, 40, 0, d2), // zero breaches beats cccc despite later tenure
        row('eeee', 1, 40, 0, d1), // ties aaaa on all keys → earlier… same date → handle tail
      ])
      return (
        ranked.map((r) => r.handle).join(',') === 'bbbb,aaaa,eeee,dddd,cccc' &&
        ranked.map((r) => r.rank).join(',') === '1,2,3,4,5'
      )
    })(),
  )
  check(
    'roster §2.3: ordinals suppressed below 5 qualified; opening roster orders by tenure asc',
    (() => {
      const mk = (handle: string, firstSignedAt: Date | null) => ({
        rank: 0,
        handle,
        displayName: null,
        mandateKind: null,
        moneyMovedUsd: 0,
        signedTurns: 1,
        walletsServed: 1,
        intents: 1,
        firstSignedAt,
        capBreaches: 0,
        founding: false,
        maxDrawdownPct: null,
        lastSeen: new Date(0),
      })
      const opening = orderOpeningRoster([
        mk('bbbb', new Date('2026-03-01')),
        mk('aaaa', new Date('2026-01-01')),
        mk('cccc', new Date('2026-03-01')), // date tie → handle tail keeps it deterministic
      ])
      return (
        ORDINALS_MIN_QUALIFIED === 5 &&
        showOrdinals(4) === false &&
        showOrdinals(5) === true &&
        showOrdinals(0) === false &&
        opening.map((r) => r.handle).join(',') === 'aaaa,bbbb,cccc'
      )
    })(),
  )
  // Founding badge (FOUNDING-MANAGERS.md): owner-set rows round-trip through
  // the one read path; fixture cleaned in finally. Needs direct DB creds —
  // the harness process reads env only (no .env.local), so without
  // DATABASE_URL this drills the fail-soft read path instead (never a red:
  // the blog-suite precedent for cred-gated checks).
  if (process.env.DATABASE_URL) {
    const fixture = 'f0f0f0f0f0f0f0f0'
    let ok = false
    try {
      await prisma.foundingAgent.upsert({
        where: { agentKeyHash: fixture },
        create: { agentKeyHash: fixture, label: 'harness fixture' },
        update: {},
      })
      const set = await foundingHandles([fixture, 'aaaaaaaaaaaaaaaa'])
      ok = set.has(fixture) && !set.has('aaaaaaaaaaaaaaaa')
    } finally {
      await prisma.foundingAgent.deleteMany({ where: { agentKeyHash: fixture } }).catch(() => {})
    }
    const gone = !(await foundingHandles([fixture])).has(fixture)
    check('roster: founding badge — owner-set row round-trips and the fixture cleans up', ok && gone)
  } else {
    // No creds: the read path must fail SOFT (empty set), never throw — the
    // badge can only ever disappear, not break a page.
    const soft = await foundingHandles(['f0f0f0f0f0f0f0f0'])
    check('roster: founding badge read path fails soft without DB creds (empty set, no throw)', soft.size === 0)
    console.log('  (founding round-trip skipped: DATABASE_URL unset for the harness process)')
  }
  check(
    'roster: the board takes only agents a real human has signed for (harness residue never ranks)',
    qualifiesForBoard({ signedTurns: 1 }) === true && qualifiesForBoard({ signedTurns: 0 }) === false,
  )
  check(
    'roster: manager identicon is deterministic, col-mirrored, and never faceless',
    (() => {
      const a = identiconCells('a1b2c3d4e5f60718')
      const b = identiconCells('a1b2c3d4e5f60718')
      const c = identiconCells('ffffffffffffffff')
      const zero = identiconCells('0000000000000000') // nothing lights → fallback face
      const mirrored = (cells: ReturnType<typeof identiconCells>) =>
        cells.every((cell) => cells.some((m) => m.y === cell.y && m.x === 3 - cell.x && m.strong === cell.strong))
      return (
        JSON.stringify(a) === JSON.stringify(b) &&
        JSON.stringify(a) !== JSON.stringify(c) &&
        a.length > 0 &&
        zero.length === 4 &&
        mirrored(a) &&
        mirrored(c) &&
        identiconCells('not-a-handle').length === 4 // malformed → the fallback face, never a throw
      )
    })(),
  )
  // Route fence: the /agents standings index + the /roster front-door preview
  // are fail-closed behind ROSTER_ENABLED — a server without the flag serves
  // 404 on both (and on the standings OG card), which for /agents is exactly
  // today's behavior (the segment had no index page). A flag-on server serves
  // the real pages instead; the hallmark strings only render from the gated
  // branch. Per-handle record pages are NOT flag-gated and stay unchanged.
  {
    const [agentsRes, rosterRes, ogRes, docsRes] = await Promise.all([
      fetch(`${BASE}/agents`),
      fetch(`${BASE}/roster`),
      fetch(`${BASE}/agents/opengraph-image`),
      fetch(`${BASE}/docs/roster`),
    ])
    const agentsHtml = await agentsRes.text()
    const rosterHtml = await rosterRes.text()
    const docsHtml = await docsRes.text()
    // §2.6 copy fences ride the hallmark: the required phrase must be on the
    // board, and the banned standings words must not (checked as rendered
    // words — the page copy carries none of them in any mode).
    const agentsOn =
      agentsRes.status === 200 &&
      agentsHtml.includes('The standings are signatures') &&
      /real signed history — never projections/i.test(agentsHtml) &&
      !/top performer|returns|APY/i.test(agentsHtml)
    const rosterOn =
      rosterRes.status === 200 &&
      rosterHtml.includes('You keep the only pen') &&
      // wave 2: the page carries the how-it-works strip + the proof transcript
      rosterHtml.includes('How it works') &&
      rosterHtml.includes('data-roster-transcript') &&
      // first-hire sprint: the "Meet your first manager" strip fronts the
      // house Rebalancer with the three-beat hire framing en route
      rosterHtml.includes('Meet your first manager')
    const docsOn =
      docsRes.status === 200 &&
      docsHtml.includes('Hire agents for your money') &&
      docsHtml.includes('data-roster-transcript')
    check(
      'roster: the /agents standings index is fail-closed — 404 without the flag, the real table only with it',
      agentsRes.status === 404 || agentsOn,
    )
    check(
      'roster: /roster front-door preview is fail-closed the same way (hero + how-it-works + transcript)',
      rosterRes.status === 404 || rosterOn,
    )
    check(
      'roster: the standings OG card gates with its page (no data ahead of the flip)',
      agentsRes.status === 404
        ? ogRes.status === 404
        : ogRes.status === 200 && (ogRes.headers.get('content-type') ?? '').includes('image/png'),
    )
    check(
      'roster: /docs/roster (the transcript doc) is fail-closed with the same flag',
      docsRes.status === 404 || docsOn,
    )
    // The dark doc must not leak through the docs registry (sidebar/doors/
    // sitemap render from DOCS_PAGES) — registering it is an owner flip step.
    check(
      'roster: /docs/roster stays OUT of DOCS_PAGES until the flip',
      !DOCS_PAGES.some((p) => p.slug === 'roster'),
    )
    // /roster's own OG card gates with the page (the DM-thumbnail card,
    // overnight 09-01) — before it existed the page fell to the generic
    // site card, so a 200 here must be a PNG and a flag-off server 404s.
    const rosterOgRes = await fetch(`${BASE}/roster/opengraph-image`)
    check(
      'roster: the /roster OG card gates with its page',
      rosterRes.status === 404
        ? rosterOgRes.status === 404
        : rosterOgRes.status === 200 && (rosterOgRes.headers.get('content-type') ?? '').includes('image/png'),
    )
  }

  // ── THE HOMEPAGE TRIPWIRE (overnight 09-01, visuals): the Roster front
  // door is BUILT DARK behind NEXT_PUBLIC_ROSTER_HOMEPAGE. The critical pin:
  // with the flag off (every deploy until the tripwire), `/` is the shipped
  // links-first homepage — its hallmark present, the roster variant's marker
  // ABSENT. With the flag on, the roster front door renders whole (hero +
  // storefront strip + transcript + the §2.2 Season-0 narrative, no counts).
  {
    const homeRes = await fetch(`${BASE}/`)
    const homeHtml = await homeRes.text()
    const currentHome =
      homeRes.status === 200 &&
      homeHtml.includes('You have an intent') &&
      !homeHtml.includes('data-roster-home') &&
      !homeHtml.includes('You keep the only pen')
    const rosterHome =
      homeRes.status === 200 &&
      homeHtml.includes('data-roster-home') &&
      homeHtml.includes('You keep the only pen') &&
      homeHtml.includes('The staff is hiring') &&
      homeHtml.includes('data-roster-transcript') &&
      homeHtml.includes('The standings are signatures') &&
      // §2.2 discipline: the narrative, never a pathetic count
      !/\b0 (signed|agents|managers)\b/.test(homeHtml)
    check(
      'roster homepage: flag off = the shipped homepage (no roster marker); flag on = the whole front door',
      currentHome || rosterHome,
    )
  }

  check(
    'broker M3: webhook signature is a deterministic HMAC over the raw body',
    (() => {
      const secret = mintCallbackSecret()
      if (!/^whsec_[0-9a-f]{48}$/.test(secret)) return false
      const ev = {
        intentId: 'abc123',
        event: 'signed' as const,
        ask: 'Buy $15 of AAPL',
        url: 'https://www.pantessa.com/i/xyz',
        valueUsd: 15,
        deliveryId: 'deliv1',
        at: 1_700_000_000_000,
      }
      const { body, headers } = buildDelivery(secret, ev)
      const expect = `sha256=${signWebhook(secret, body)}`
      // deterministic, matches, and the secret never rides in the payload body
      return (
        headers['x-pantessa-signature'] === expect &&
        headers['x-pantessa-event'] === 'signed' &&
        !body.includes(secret)
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
    /\/chat\?tab=links&(amp;)?ask=/.test(receiptHtml) && receiptHtml.includes('Mint this as a link'),
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
    // ── The on-ramp door (lib/onramp). The empty wallet was the ONE refusal
    // that shipped no artifact; these pin the arithmetic and the fail-closed
    // rule so a half-configured door can never render a button that 500s.
    {
      const wasEnabled = process.env.ONRAMP_ENABLED
      const wasStripeKey = process.env.STRIPE_SECRET_KEY

      // The floor is DERIVED, not chosen, and lib/onramp cannot import the
      // constants it comes from (lib/lifi-bridge is server-side; lib/onramp is
      // imported by a client component). So this is where the two are held
      // together: ~$11 has to SURVIVE to the wallet for a gas-bearing segment
      // to clear the parity guard, and a preset loses Stripe's onramp fee on
      // the way in and the ETH keep-back on the way out. If MIN_VALUE_LEG_USD
      // ever moves, this fails and ONRAMP_MIN_USD gets re-derived on purpose.
      check(
        'onramp: the minimum preset still clears the parity floor + gas leg + ETH keep-back',
        ONRAMP_MIN_USD >= MIN_VALUE_LEG_USD + GAS_LEG_USD + ONRAMP_ETH_KEEP_USD.base,
        `min=${ONRAMP_MIN_USD} vs value=${MIN_VALUE_LEG_USD}+gas=${GAS_LEG_USD}+keep=${ONRAMP_ETH_KEEP_USD.base}`,
      )
      check(
        'onramp: a preset never lands under that floor, nor under the chain\'s own ETH keep-back',
        planFundUsd(1) === ONRAMP_MIN_USD &&
          planFundUsd(0) === ONRAMP_MIN_USD &&
          planFundUsd(0, 'ethereum') >= ONRAMP_ETH_KEEP_USD.ethereum,
        `${planFundUsd(0)}/${planFundUsd(0, 'ethereum')}`,
      )
      // 12 * 1.15 + 2 = 15.8 → $16;  100 * 1.15 + 2 = 117 (and 114.99999…
      // in binary float, which is exactly why planFundUsd rounds to cents
      // BEFORE the ceil — without that this pin reads $118).
      check(
        'onramp: the preset clears the plan after the onramp fee, the swap and the gas keep-back',
        planFundUsd(12) === 16 && planFundUsd(100) === 117,
        `${planFundUsd(12)}/${planFundUsd(100)}`,
      )
      // Mainnet keeps back 0.002 ETH, which is real money — the same plan
      // costs meaningfully more to fund there, and the preset has to say so.
      check(
        'onramp: an Ethereum preset carries L1\'s much larger ETH keep-back',
        planFundUsd(12, 'ethereum') === 30 && planFundUsd(12, 'ethereum') > planFundUsd(12, 'base'),
        `${planFundUsd(12, 'ethereum')}`,
      )
      check(
        'onramp: no plan, however large, can preset above the cap',
        planFundUsd(100_000) === ONRAMP_MAX_USD,
        String(planFundUsd(100_000)),
      )

      process.env.ONRAMP_ENABLED = 'false'
      check(
        'onramp: the door FAILS CLOSED — unconfigured offers no chip at all',
        fundChipFor({ needUsd: 12, actionLabel: 'buy $10 of AAPL', resume: 'Buy $10 of AAPL' }) === null,
      )
      // Half-configured is still closed: the flag alone must not render a
      // button whose route answers 503.
      process.env.ONRAMP_ENABLED = 'true'
      delete process.env.STRIPE_SECRET_KEY
      check(
        'onramp: the flag alone is not enough — no Stripe key, no chip',
        fundChipFor({ needUsd: 12, actionLabel: 'buy $10 of AAPL', resume: 'Buy $10 of AAPL' }) === null,
      )

      process.env.STRIPE_SECRET_KEY = 'sk_test_harness'
      const chip = fundChipFor({ needUsd: 12, actionLabel: 'buy $10 of AAPL', resume: 'Buy $10 of AAPL' })
      check(
        'onramp: the chip NAMES the intent and carries it as the resume (the ask survives the trip off-site)',
        !!chip && chip.label.includes('buy $10 of AAPL') && chip.label.includes('$16') && chip.resume === 'Buy $10 of AAPL' && chip.fund?.network === 'base',
        JSON.stringify(chip),
      )
      // ETH, not a stable: the wallet being funded is EMPTY, so a stable
      // would land money that cannot pay the gas to move itself — the exact
      // gas-stranded wall the refusals above have to apologise for.
      check(
        'onramp: the chip funds with ETH, which pays its own gas on arrival',
        chip?.fund?.asset === 'ETH' && ONRAMP_ASSET === 'ETH',
        JSON.stringify(chip?.fund),
      )
      check(
        'onramp: the server CLAMPS the client preset, never re-plans it (rendered $16 must not charge $18)',
        clampFundUsd(16) === 16 && clampFundUsd(1) === ONRAMP_MIN_USD && clampFundUsd(9_999) === ONRAMP_MAX_USD,
        `${clampFundUsd(16)}/${clampFundUsd(1)}/${clampFundUsd(9_999)}`,
      )
      check(
        'onramp: an unknown asset is narrowed away rather than passed to Stripe\'s enum',
        onrampAssetOf('eth') === 'ETH' && onrampAssetOf('USDC') === 'USDC' && onrampAssetOf('DOGE') === null && onrampAssetOf(42) === null,
      )
      // Stripe's documented refusal for a customer it will not serve. The
      // first cut of this classifier was a regex for "unsupported" / "not
      // supported" over message text — and Stripe's actual words are
      // "unsupportable" and "unable to support". Codes, not prose.
      const stripeRegion400 = JSON.stringify({
        error: {
          type: 'invalid_request_error',
          code: STRIPE_UNSUPPORTABLE_CUSTOMER,
          message: "Based on the information provided about the customer, we're currently unable to support them.",
        },
      })
      check(
        'onramp: Stripe\'s crypto_onramp_unsupportable_customer 400 classifies as REGION (about the user), by code',
        classifyStripeOnrampFailure(400, stripeRegion400).kind === 'region' &&
          /still send USDC or ETH/.test(classifyStripeOnrampFailure(400, stripeRegion400).message),
        JSON.stringify(classifyStripeOnrampFailure(400, stripeRegion400)),
      )
      check(
        'onramp: the same words WITHOUT the code still classify as region (prose fallback), and a bare 400/401/403 do not',
        classifyStripeOnrampFailure(400, JSON.stringify({ error: { message: 'unable to support this customer' } })).kind === 'region' &&
          classifyStripeOnrampFailure(400, JSON.stringify({ error: { code: 'parameter_unknown', message: 'Received unknown parameter: wallet_addresses[base]' } })).kind === 'stripe' &&
          classifyStripeOnrampFailure(401, JSON.stringify({ error: { message: 'Invalid API Key provided' } })).kind === 'stripe' &&
          classifyStripeOnrampFailure(403, 'not json at all').kind === 'stripe',
      )
      // ── The Stripe create-session payload. Pinned as a pure value because
      // the alternative is finding out on a live request: Stripe 400s an
      // unrecognised key (verified 2026-09-04 — `wallet_addresses[base]`
      // returns `parameter_unknown`), which would take the funding path down
      // for everyone at once behind a generic "could not start the session".
      const FUND_ADDR = '0x' + 'ab'.repeat(20)
      const form = stripeOnrampParams({ address: FUND_ADDR, presetFiatUsd: 16, asset: 'ETH', network: 'base', customerIp: '203.0.113.7' })
      // THE asymmetry: the network enum is `base`, the wallet-address key is
      // `base_network` — different words for the same chain in the same
      // request. On Ethereum the two agree, which is exactly what makes Base
      // easy to get wrong, so both lanes are pinned.
      check(
        'onramp: Stripe\'s wallet-address key is base_network while its network enum is base (the wrong key is a live 400)',
        STRIPE_WALLET_KEY.base === 'base_network' &&
          STRIPE_NETWORK.base === 'base' &&
          form.get('wallet_addresses[base_network]') === FUND_ADDR &&
          form.get('destination_network') === 'base' &&
          form.get('wallet_addresses[base]') === null,
        form.toString(),
      )
      check(
        'onramp: the payload presets the FIAT amount the chip rendered, in USD',
        form.get('source_amount') === '16' && form.get('source_currency') === 'usd' && form.get('destination_currency') === 'eth',
        form.toString(),
      )
      // Locked on all three axes. The consent the user signed names an
      // address, an asset and a chain; if the hosted page let them change any
      // of those, the signature would be authorising a session it never saw.
      check(
        'onramp: the payload LOCKS the wallet, the asset and the network — the session can only do what was signed for',
        form.get('lock_wallet_address') === 'true' &&
          form.get('destination_currencies[0]') === 'eth' &&
          form.get('destination_networks[0]') === 'base',
        form.toString(),
      )
      // Stripe answers 400 up front for an unservable region, which is a
      // better refusal than one delivered after the hand-off. But a faked IP
      // would produce a wrong region, so it is passed only when real.
      check(
        'onramp: a real client IP rides along for region/fraud, and a missing one is never invented',
        form.get('customer_ip_address') === '203.0.113.7' &&
          stripeOnrampParams({ address: FUND_ADDR, presetFiatUsd: 16, asset: 'ETH', network: 'base', customerIp: null }).get('customer_ip_address') === null,
      )
      const ethForm = stripeOnrampParams({ address: FUND_ADDR, presetFiatUsd: 30, asset: 'ETH', network: 'ethereum' })
      check(
        'onramp: the Ethereum lane keys its address under `ethereum` (where enum and key DO agree)',
        ethForm.get('wallet_addresses[ethereum]') === FUND_ADDR && ethForm.get('destination_network') === 'ethereum',
        ethForm.toString(),
      )

      // clarifyOf is the one narrowing point, and a planner can emit this
      // shape too — a hostile fund payload must degrade to a plain chip,
      // never render an offer to charge someone thousands.
      const hostile = clarifyOf({
        question: 'Add funds?',
        options: [
          { label: 'Add', resume: 'Buy $10 of AAPL', fund: { presetFiatUsd: 99999, asset: 'ETH', network: 'base' } },
          { label: 'Bad chain', resume: 'Buy $10 of AAPL', fund: { presetFiatUsd: 20, asset: 'ETH', network: 'solana' } },
        ],
      })
      check(
        'onramp: clarifyOf clamps a hostile fund payload (over-cap and unknown chain both drop to plain chips)',
        !!hostile && hostile.options[0].fund === undefined && hostile.options[1].fund === undefined,
        JSON.stringify(hostile),
      )
      // Arbitrum was a VALID fund network until 2026-09-04 and is not one at
      // Stripe, whose destination_network enum has no arbitrum. A stale chip
      // (or a planner echoing the old shape) must degrade to a plain resume
      // rather than open a session Stripe will reject at its own door.
      const staleArb = clarifyOf({
        question: 'Add funds?',
        options: [
          { label: 'Add on Arbitrum', resume: 'Buy $10 of AAPL', fund: { presetFiatUsd: 20, asset: 'ETH', network: 'arbitrum' } },
          { label: 'Add on Base', resume: 'Buy $10 of AAPL', fund: { presetFiatUsd: 20, asset: 'ETH', network: 'base' } },
        ],
      })
      check(
        'onramp: arbitrum is no longer a fund network — the stale chip degrades, the Base one still works',
        !!staleArb && staleArb.options[0].fund === undefined && staleArb.options[1].fund?.network === 'base',
        JSON.stringify(staleArb),
      )

      // ── Wallet proof (raised by Coinbase's integration review, case
      // 500PC00000kDVUv; the finding was about US, so it outlived the switch
      // to Stripe). The route mints a real payment session, so "who asked"
      // has to be answerable before we spend one. personal_sign is the only
      // proof an EMPTY wallet can give — it costs no gas — and these pin that
      // the consent binds every value the session is minted from.
      {
        const funder = privateKeyToAccount(generatePrivateKey())
        const base = {
          address: funder.address,
          presetFiatUsd: 16,
          asset: ONRAMP_ASSET,
          network: 'base' as const,
          issuedAt: Date.now(),
        }
        const consent = onrampConsentMessage(base)
        check(
          'onramp consent: the text NAMES what it authorises (wallet, amount, asset, chain) and says it can only deliver IN',
          consent.includes(funder.address.toLowerCase()) &&
            consent.includes('$16 USD') &&
            consent.includes('ETH on base') &&
            /only deliver funds TO this wallet/.test(consent) &&
            /costs no gas/.test(consent),
          consent,
        )
        // The user is being sent to Stripe and the text has to say so — a
        // consent that names the wrong company is a consent to something the
        // signer did not read.
        check(
          'onramp consent: the text names the provider the user is about to be handed to',
          /Stripe/.test(consent) && !/Coinbase/.test(consent),
          consent,
        )
        // Every field is load-bearing: if any could be swapped after signing,
        // the signature would authorise a session it never saw.
        check(
          'onramp consent: changing ANY bound field changes the text (amount, asset, chain, wallet, time)',
          onrampConsentMessage({ ...base, presetFiatUsd: 500 }) !== consent &&
            onrampConsentMessage({ ...base, asset: 'USDC' }) !== consent &&
            onrampConsentMessage({ ...base, network: 'ethereum' }) !== consent &&
            onrampConsentMessage({ ...base, address: '0x' + '1'.repeat(40) }) !== consent &&
            onrampConsentMessage({ ...base, issuedAt: base.issuedAt + 60_000 }) !== consent,
        )
        check(
          'onramp consent: address casing cannot fork the text (a checksummed and a lowercase caller sign the same bytes)',
          onrampConsentMessage({ ...base, address: funder.address.toUpperCase().replace('0X', '0x') }) === consent,
        )
        // The round trip the route performs: recover from OUR derivation of
        // the text, and refuse anyone who is not the wallet being funded.
        const sig = await funder.signMessage({ message: consent })
        const recovered = await recoverMessageAddress({ message: consent, signature: sig })
        check(
          'onramp consent: a signature over the consent recovers to the wallet being funded',
          recovered.toLowerCase() === funder.address.toLowerCase(),
          recovered,
        )
        const impostor = privateKeyToAccount(generatePrivateKey())
        const impostorSig = await impostor.signMessage({ message: consent })
        const impostorRecovered = await recoverMessageAddress({ message: consent, signature: impostorSig })
        check(
          'onramp consent: someone else signing the SAME text recovers to themselves — the route refuses on address mismatch',
          impostorRecovered.toLowerCase() === impostor.address.toLowerCase() &&
            impostorRecovered.toLowerCase() !== funder.address.toLowerCase(),
        )
        // A signature captured for a $14 session must not mint a $500 one.
        const recoveredOnTamper = await recoverMessageAddress({
          message: onrampConsentMessage({ ...base, presetFiatUsd: 500 }),
          signature: sig,
        }).catch(() => '0xfailed')
        check(
          'onramp consent: replaying a signature against a RAISED amount does not recover the funder (tamper fails closed)',
          recoveredOnTamper.toLowerCase() !== funder.address.toLowerCase(),
          recoveredOnTamper,
        )
        check(
          'onramp consent: the replay window is bounded and short',
          ONRAMP_CONSENT_TTL_MS > 0 && ONRAMP_CONSENT_TTL_MS <= 15 * 60_000,
          String(ONRAMP_CONSENT_TTL_MS),
        )

        // ── WIRING. The server can offer a perfect fund chip and the UI can
        // silently drop it: #675 rewrote ClarifyChips and deleted the whole
        // funding branch, so for days the chat emitted fund chips that
        // rendered as plain text and re-sent the ask into the same
        // empty-wallet wall the on-ramp exists to fix. Nothing caught it,
        // because every unit above still passed. The chip is only real if the
        // component that renders clarify options CONSUMES `fund` and reaches
        // the route — so pin that, at the source.
        //
        // The sign-then-mint dance moved into lib/onramp-client on 2026-09-04
        // (two surfaces fund a wallet now), so the pins split: the chip must
        // still consume `fund` and call the starter, and the starter must
        // still sign the consent and call the route.
        const chipFs = await import('node:fs')
        // Comments stripped before any of these read the source: the FIRST cut
        // of these pins searched raw text and both failed against this repo's
        // own prose — the starter's doc comment says "after an `await`" and
        // the fund card's says "a bare link to pay.coinbase.com". A source pin
        // that a comment can satisfy (or defeat) is not a pin.
        const codeOnly = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/^\s*\/\/.*$/gm, '')
        const chipSrc = codeOnly(chipFs.readFileSync('components/ClarifyChips.tsx', 'utf8'))
        const starterSrc = codeOnly(chipFs.readFileSync('lib/onramp-client.ts', 'utf8'))
        check(
          'onramp wiring: the clarify surface still CONSUMES o.fund (a fund chip is not a plain chip)',
          /o\.fund/.test(chipSrc) && chipSrc.includes('startOnrampSession'),
        )
        check(
          'onramp wiring: the shared starter still CALLS the on-ramp route',
          starterSrc.includes('/api/onramp/session'),
        )
        check(
          'onramp wiring: the shared starter still SIGNS the consent (an unsigned call is refused 401 by the route)',
          starterSrc.includes('onrampConsentMessage') && /signMessage\(/.test(starterSrc),
        )
        // The popup must be opened BEFORE the first await or the browser
        // blocks it — the one ordering constraint the extraction could have
        // quietly broken for both surfaces at once.
        check(
          'onramp wiring: the starter opens the tab BEFORE it awaits anything (a post-await popup is blocked)',
          starterSrc.indexOf('window.open') < starterSrc.indexOf('await'),
        )
        // Every funding surface goes through the signed door. A bare provider
        // link is how the dashboard card spent months pointing at a
        // pay.coinbase.com URL that 302s to a generic landing page — no
        // address, no amount, no purchase.
        const fundCardSrc = codeOnly(chipFs.readFileSync('components/FundAccountCard.tsx', 'utf8'))
        check(
          'onramp wiring: the dashboard fund card uses the signed door, not a bare provider link',
          fundCardSrc.includes('startOnrampSession') && !/pay\.coinbase\.com/.test(fundCardSrc),
        )
      }

      process.env.ONRAMP_ENABLED = wasEnabled
      if (wasStripeKey === undefined) delete process.env.STRIPE_SECRET_KEY
      else process.env.STRIPE_SECRET_KEY = wasStripeKey
    }

    // The live door, over HTTP. Whether or not this deployment has the on-ramp
    // configured (unconfigured fails closed at 503, before auth), the
    // invariant is the same one Coinbase's review asked for and Stripe
    // inherits: an unsigned or wrongly-signed request NEVER receives a
    // session URL.
    {
      const stranger = privateKeyToAccount(generatePrivateKey())
      const fundBody = { address: stranger.address, presetFiatUsd: 16, asset: ONRAMP_ASSET, network: 'base' }
      const post = async (body: Record<string, unknown>) => {
        const r = await fetch(`${BASE}/api/onramp/session`, {
          method: 'POST',
          headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
          body: JSON.stringify(body),
        })
        return { status: r.status, data: (await r.json().catch(() => ({}))) as { url?: string } }
      }

      const unsigned = await post(fundBody)
      check(
        'onramp route: an UNSIGNED request never gets a funding URL',
        !unsigned.data.url && unsigned.status !== 200,
        `${unsigned.status}`,
      )

      const issuedAt = Date.now()
      const wrongWalletSig = await privateKeyToAccount(generatePrivateKey()).signMessage({
        message: onrampConsentMessage({ ...fundBody, network: 'base', address: stranger.address, issuedAt }),
      })
      const spoofed = await post({ ...fundBody, issuedAt, signature: wrongWalletSig })
      check(
        'onramp route: a valid signature from a DIFFERENT wallet never gets a funding URL',
        !spoofed.data.url && spoofed.status !== 200,
        `${spoofed.status}`,
      )

      const staleAt = Date.now() - (ONRAMP_CONSENT_TTL_MS + 60_000)
      const staleSig = await stranger.signMessage({
        message: onrampConsentMessage({ ...fundBody, network: 'base', address: stranger.address, issuedAt: staleAt }),
      })
      const stale = await post({ ...fundBody, issuedAt: staleAt, signature: staleSig })
      check(
        'onramp route: an EXPIRED consent never gets a funding URL, even correctly signed',
        !stale.data.url && stale.status !== 200,
        `${stale.status}`,
      )

      // A chip persisted before 2026-09-04 carries the old $14 preset (floor
      // was $5). The server clamps it to today's floor, so the consent it
      // re-derives can never match what the wallet signed — and the honest
      // answer is "this button is out of date", not "signature mismatch".
      // (When the door is closed the route 503s before it gets here.)
      const oldChip = { ...fundBody, presetFiatUsd: 14 }
      const oldSig = await stranger.signMessage({
        message: onrampConsentMessage({ ...oldChip, network: 'base', address: stranger.address, issuedAt }),
      })
      const outdated = await post({ ...oldChip, issuedAt, signature: oldSig })
      // Unknown chain/asset refuse by name too — the alternative (default to
      // base/ETH, then fail the re-derived signature) blames the wallet for
      // the client's stale payload.
      const badNet = await post({ ...fundBody, network: 'solana', issuedAt, signature: oldSig })
      check(
        'onramp route: an unknown network is refused BY NAME (400), never by defaulting and failing the signature',
        !badNet.data.url && (badNet.status === 503 || (badNet.status === 400 && /Base or Ethereum/.test(String((badNet.data as { error?: string }).error)))),
        `${badNet.status} ${JSON.stringify(badNet.data)}`,
      )
      check(
        'onramp route: a pre-2026-09-04 chip ($14 preset) is refused as OUT OF DATE, never as a signature mismatch',
        !outdated.data.url &&
          (outdated.status === 503 ||
            (outdated.status === 409 && (outdated.data as { stage?: string }).stage === 'stale' && /out of date/.test(String((outdated.data as { error?: string }).error)))),
        `${outdated.status} ${JSON.stringify(outdated.data)}`,
      )
    }

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
    // ── Off-chain source ── the live 2026-09-03 wall: "Convert 1 USDC to 1
    // USDG on robinhood" answered "I don't know the token USDC on Robinhood
    // Chain" while the wallet held USDC on Base. Two faults, both pinned
    // here: the buy token was LOST to the amount sitting in front of it, and
    // a dollar-parity funding source was read as an unknown token instead of
    // as the ask naming its own origin.
    const convertParity = parseSwapIntent('Convert 1 USDC to 1 USDG on robinhood')
    check(
      'swap intent: "Convert 1 USDC to 1 USDG" keeps the buy token (an amount on the buy side never eats it)',
      convertParity.isSwap &&
        !convertParity.problem &&
        convertParity.mode === 'swap' &&
        convertParity.sellAmountHuman === '1' &&
        convertParity.sellToken?.toUpperCase() === 'USDC' &&
        convertParity.buyToken?.toUpperCase() === 'USDG' &&
        convertParity.buyAmountNamedHuman === '1',
      JSON.stringify(convertParity),
    )
    // The named output is RECORDED, never promised — builds are exact-input.
    const convertUneven = parseSwapIntent('swap 1 ETH for 3000 USDC')
    check(
      'swap intent: a buy-side amount on a non-parity pair still builds exact-input (token kept, amount recorded only)',
      convertUneven.mode === 'swap' && convertUneven.sellAmountHuman === '1' && convertUneven.sellToken?.toUpperCase() === 'ETH' && convertUneven.buyToken?.toUpperCase() === 'USDC' && convertUneven.buyAmountNamedHuman === '3000',
      JSON.stringify(convertUneven),
    )
    check(
      'swap intent: the LIMIT grammar still owns a priced second amount (the word "limit" wins)',
      parseSwapIntent('limit order: sell 0.5 WETH for at least 1750 USDC').mode === 'limit',
    )
    check(
      'swap intent: "swap 1 USDC to arbitrum" still reads as a cross-chain move, not a token named ARBITRUM',
      !!parseSwapIntent('swap 1 USDC to arbitrum').problem,
    )

    // The funding scan can only SOURCE what readFundingShortfall reads —
    // naming a symbol it can't see would promise money the chips can't spend.
    const srcSyms = fundingSourceSymbols()
    check(
      'off-chain source: the sourceable set is derived from the scan (USDC + USDC.e + ETH, never USDT/DAI)',
      srcSyms.includes('USDC') && srcSyms.includes('ETH') && srcSyms.includes('USDC.E') && !srcSyms.includes('USDT') && !srcSyms.includes('DAI'),
      srcSyms.join(','),
    )
    const offChain = offChainStableSource({ chainId: ROBINHOOD_CHAIN_ID, sellSymbol: 'USDC', knownOnChain: false, amountHuman: '1' })
    check(
      'off-chain source: USDC spent on Robinhood Chain restates as $1 of USDG (the funding plan owns it, not a refusal)',
      offChain?.sourceSymbol === 'USDC' && offChain?.stableSymbol === 'USDG' && offChain?.usd === 1,
      JSON.stringify(offChain),
    )
    check(
      'off-chain source: a dollar-denominated convert restates the same way',
      offChainStableSource({ chainId: ROBINHOOD_CHAIN_ID, sellSymbol: 'USDC', knownOnChain: false, amountUsd: '20' })?.usd === 20,
    )
    check(
      'off-chain source: bridged USDC.e counts (the scan reads it on Arbitrum)',
      offChainStableSource({ chainId: ROBINHOOD_CHAIN_ID, sellSymbol: 'USDC.e', knownOnChain: false, amountHuman: '5' })?.usd === 5,
    )
    check(
      'off-chain source: a token the destination DOES know is never claimed (normal same-chain sell)',
      offChainStableSource({ chainId: ROBINHOOD_CHAIN_ID, sellSymbol: 'USDG', knownOnChain: true, amountHuman: '5' }) === null,
    )
    check(
      'off-chain source: a genuinely unknown symbol keeps the honest refusal',
      offChainStableSource({ chainId: ROBINHOOD_CHAIN_ID, sellSymbol: 'FOOBAR', knownOnChain: false, amountHuman: '5' }) === null,
    )
    check(
      'off-chain source: ETH is a funding source but not a PARITY one — no price-free restatement',
      offChainStableSource({ chainId: ROBINHOOD_CHAIN_ID, sellSymbol: 'ETH', knownOnChain: false, amountHuman: '1' }) === null,
    )
    check(
      'off-chain source: only Robinhood Chain (the one destination with live-probed LiFi routes in)',
      offChainStableSource({ chainId: 8453, sellSymbol: 'USDG', knownOnChain: false, amountHuman: '5' }) === null,
    )
    check(
      'off-chain source: no amount named → falls through rather than guessing a size',
      offChainStableSource({ chainId: ROBINHOOD_CHAIN_ID, sellSymbol: 'USDC', knownOnChain: false }) === null,
    )
    // A conversion moves NAMED money: held USDG must not shrink or cancel
    // the bridge (creditUsd 0), while a top-up still nets against it.
    check(
      'off-chain source: a conversion sizes off the ask alone, a top-up nets against held USDG',
      robinhoodBuyNeedUsd(10, 0, false) > robinhoodBuyNeedUsd(10, 8, false),
    )
    // Every conversion chip must still be a COMPILING contract.
    // ── Minimum fillable leg ── live 2026-09-03: the "$1.5 from Base" chip
    // compiled into a job that DIED on step 1 — "only 1.329574 USDG for $1.5,
    // more than 4% below dollar parity". The guard was right; the OFFER was
    // the bug. A LiFi leg costs ~$0.16–0.46 FLAT at every size probed from $1
    // to $100, so the percentage loss is what moves, and under the floor it
    // can never clear. Never offer what can't fill.
    check(
      'min leg: the floor is DERIVED from the parity guard (flat cost / the guard tolerance)',
      MIN_VALUE_LEG_USD === Math.ceil(LIFI_LEG_FLAT_USD / (1 - STABLE_LEG_MIN_OUT_BPS / 10_000)) && MIN_VALUE_LEG_USD >= 6,
      String(MIN_VALUE_LEG_USD),
    )
    check(
      'min leg: a leg AT the floor clears parity, a leg below it cannot (the arithmetic the guard applies)',
      MIN_VALUE_LEG_USD - LIFI_LEG_FLAT_USD >= MIN_VALUE_LEG_USD * (STABLE_LEG_MIN_OUT_BPS / 10_000) &&
        3 - LIFI_LEG_FLAT_USD < 3 * (STABLE_LEG_MIN_OUT_BPS / 10_000),
    )
    check(
      'min leg: fundingNeedUsd floors the VALUE portion, and the gas leg rides on top of it',
      fundingNeedUsd(1, false) >= MIN_VALUE_LEG_USD && fundingNeedUsd(1, true) >= MIN_VALUE_LEG_USD + GAS_LEG_USD,
      `${fundingNeedUsd(1, false)} / ${fundingNeedUsd(1, true)}`,
    )
    check(
      'min leg: a leg big enough on its own is NOT inflated (the flagship $12 buy is untouched)',
      fundingNeedUsd(12, true) === 14.5 && fundingNeedUsd(50, false) === 52,
      `${fundingNeedUsd(12, true)} / ${fundingNeedUsd(50, false)}`,
    )
    // The exact dead chip from the incident, at the exact size.
    check(
      'min leg: the $1.5 chip that died on step 1 is never offered again',
      planRobinhoodFundingChips({ origins: [{ chainId: 8453, word: 'Base', token: 'USDC', usd: 20, gasEth: 0.01 }], needUsd: 1.5, gasIncluded: false, followup: '' }) === null,
    )
    check(
      'min leg: every chip offered clears the floor on its own value portion (half/all included)',
      (planRobinhoodFundingChips({ origins: [{ chainId: 8453, word: 'Base', token: 'USDC', usd: 40, gasEth: 0.01 }], needUsd: fundingNeedUsd(1, true), gasIncluded: true, followup: '' }) ?? []).every((c) => {
        const f = parseRobinhoodFunding(c.resume.split(', then ')[0])
        return !!f && fillableLeg(f.fundUsd, f.gasIncluded)
      }),
    )
    // A fillable TOTAL split into unfillable halves is the same dead offer,
    // twice — each leg pays the flat cost separately.
    check(
      'min leg: a combine whose legs fall under the floor is refused, not split',
      planRobinhoodFundingChips({
        origins: [
          { chainId: 8453, word: 'Base', token: 'USDC', usd: 10, gasEth: 0.01 },
          { chainId: 1, word: 'Ethereum', token: 'USDC', usd: 5, gasEth: 0.01 },
        ],
        needUsd: 14,
        gasIncluded: false,
        followup: '',
      }) === null,
    )
    check(
      'min leg: a combine whose legs BOTH clear the floor still compiles',
      (() => {
        const c = planRobinhoodFundingChips({
          origins: [
            { chainId: 8453, word: 'Base', token: 'USDC', usd: 12, gasEth: 0.01 },
            { chainId: 1, word: 'Ethereum', token: 'USDC', usd: 12, gasEth: 0.01 },
          ],
          needUsd: 22,
          gasIncluded: false,
          followup: '',
        })
        return !!c && c.length > 0 && c[0].resume.split(', then ').every((seg) => { const f = parseRobinhoodFunding(seg); return !!f && fillableLeg(f.fundUsd, f.gasIncluded) })
      })(),
    )
    check(
      'min leg: the downsize never counter-offers a buy the floor would silently inflate',
      planDownsizedRobinhoodBuy({ scan: { origins: [{ chainId: 8453, word: 'Base', token: 'USDC', usd: 6, gasEth: 0.01 }] }, buyUsd: 25, holdingUsd: 0, includeGas: false, buySym: 'AAPL', acquiring: false }) === null,
    )
    check(
      'min leg: the note says the flat cost out loud below the floor, and stays silent above it',
      (minLegNote(1) ?? '').includes(String(MIN_VALUE_LEG_USD)) && minLegNote(50) === null,
      String(minLegNote(1)),
    )

    const convertOrigin: FundingOrigin = { chainId: 8453, word: 'Base', token: 'USDC', usd: 20, gasEth: 0.01 }
    const convertChips = planRobinhoodFundingChips({ origins: [convertOrigin], needUsd: fundingNeedUsd(1, true), gasIncluded: true, followup: '' })
    check(
      'off-chain source: the conversion chips compile as funding jobs (resume round-trips parseRobinhoodFunding)',
      !!convertChips && convertChips.length > 0 && convertChips.every((c) => !!parseRobinhoodFunding(c.resume.split(', then ')[0])),
      JSON.stringify(convertChips?.map((c) => c.resume)),
    )

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
      'ask-failure: a door and a held question are answers, not walls',
      classifyTurn({ reply: 'add the dapp', door: { mcps: 'lido-free' } }).kind === null &&
        classifyTurn({ reply: 'where should it go?', awaiting: 'recipient' }).kind === null &&
        // the guards stay strict: a truthy-but-wrong shape is not a pass
        classifyTurn({ reply: 'x', door: 'lido-free' }).kind === 'planner-answer' &&
        classifyTurn({ reply: 'x', awaiting: '' }).kind === 'planner-answer',
    )
    check(
      'ask-failure: walls classify by the layer that answered',
      classifyTurn({ reply: 'sorry, no idea' }).kind === 'planner-answer' &&
        classifyTurn({ reply: 'cannot', buildPath: 'native-transfer' }).kind === 'native-wall' &&
        classifyTurn({ reply: 'refused', blocked: true }).kind === 'blocked' &&
        classifyTurn(null).kind === 'error',
    )
    // A native layer's QUIET verdict (mosaic already in shape, rebalance
    // below the floors) is an answer — two "Already in shape" replies sat on
    // the funded queue 2026-08-12. The flag is fenced to native buildPaths:
    // a planner reply can't declare itself quiet.
    check(
      'ask-failure: a native quiet verdict is answered, not a wall — and only a native layer may say so',
      classifyTurn({ reply: 'Already in shape.', quiet: true, buildPath: 'native-mosaic' }).kind === null &&
        classifyTurn({ reply: 'Nothing worth moving.', quiet: true, buildPath: 'native-rebalance' }).kind === null &&
        classifyTurn({ reply: 'meh', quiet: true }).kind === 'planner-answer' &&
        classifyTurn({ reply: 'meh', quiet: 'yes', buildPath: 'native-mosaic' }).kind === 'native-wall',
    )
    // The 2026-08-12 funded rows, replayed read-only against the wallets that
    // hit them (nothing signed): the CETH mosaic (cETH resolves on the mainnet
    // list and the wallet holds it — a within-band read is the honest end,
    // never a wall) and the 0.05-ETH Lido ask from a wallet that can only
    // afford a smaller stake (the affordable size rides as chips; every lido
    // refusal is attributed to its layer).
    {
      const fleet = await fetch(`${BASE}/api/servers?free=1`).then((r) => r.json() as Promise<{ slug: string; endpoint: string | null }[]>).catch(() => [])
      const rows = (slugs: string[]) => fleet.filter((s) => slugs.includes(s.slug))
      const cethMosaic = await fetch(`${BASE}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
        body: JSON.stringify({ message: 'tile my wallet 42% ETH, 39% DAI, 19% CETH on ethereum', activeServers: rows(['uniswap', 'yeetful-tool-wallet']), walletAddress: '0x66268791b55e1f5fa585d990326519f101407257', history: [] }),
      }).then((r) => r.json() as Promise<Record<string, unknown>>)
      check(
        'funded-row replay: the CETH mosaic answers from the mosaic layer with a plan, chips or an honest quiet — never a wall (CETH resolves, no aliasing)',
        cethMosaic.buildPath === 'native-mosaic' && classifyTurn(cethMosaic).kind === null && !/isn't a token I can trade/.test(String(cethMosaic.reply)),
        JSON.stringify(cethMosaic).slice(0, 300),
      )
      const lidoRow = rows(['lido-free'])
      const lidoSmall = await fetch(`${BASE}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
        body: JSON.stringify({ message: 'Stake 0.05 ETH with Lido', activeServers: [...rows(['uniswap', 'yeetful-tool-wallet', 'near-intents-mcp-yeetful']), ...lidoRow], walletAddress: '0xb74db8eb4aebca066614e0f425d125fe6cad131f', history: [] }),
      }).then((r) => r.json() as Promise<Record<string, unknown>>)
      const lidoOpts = ((lidoSmall.clarify as { options?: { resume: string }[] } | undefined)?.options ?? [])
      const lidoBare = !lidoSmall.txRequest && !lidoSmall.jobId && !lidoSmall.clarify
      check(
        'funded-row replay: "Stake 0.05 ETH with Lido" from the under-funded wallet is attributed to the lido layer, and any chip it offers round-trips parseLidoStake',
        lidoRow.length === 0 ||
          ((lidoBare ? lidoSmall.buildPath === 'native-lido' : true) &&
            /^🌊|^🌉|^🔏/.test(String(lidoSmall.reply)) &&
            lidoOpts.filter((o) => /stake/i.test(o.resume)).every((o) => { const p = parseLidoStake(o.resume); return !!p && !('problem' in p) })),
        JSON.stringify(lidoSmall).slice(0, 300),
      )
    }

    // ── Stranger phrasings (squad 2026-08-18, Ideation's ask inventory) ──
    // The sentences the ten-strangers drill will actually type. Each either
    // lands on its native gate (grammar grown) or gets a named clarify whose
    // chips round-trip — never planner prose. Pinned at the parse + ladder
    // level so a regex edit can't quietly hand them back to the planner.
    {
      const bareBuy = parseSwapIntent('buy $20 eth on base')
      const bareBuyBad = parseSwapIntent('buy $20 with usdc')
      check(
        'strangers: "buy $20 eth on base" (no "of") is the dollar buy; "buy $20 with usdc" never claims a token named WITH',
        bareBuy.isSwap && bareBuy.mode === 'swap' && bareBuy.sellAmountUsd === '20' && bareBuy.buyToken?.toLowerCase() === 'eth' && !bareBuy.sellToken &&
          !bareBuyBad.isSwap && simulateLadder('buy $20 eth on base').gate === 'swap' && simulateLadder('buy $20 eth every week').gate === 'dca',
        JSON.stringify({ bareBuy, bareBuyBad }),
      )
      const nounDca = parseDcaCreate('set up a weekly $10 ETH buy')
      check(
        'strangers: "set up a weekly $10 ETH buy" (noun form) → DCA create; the verb form still parses',
        !!nounDca && !('problem' in nounDca) && nounDca.buyUsd === 10 && nounDca.buyToken === 'ETH' && nounDca.cadence === 'week' &&
          simulateLadder('set up a weekly $10 ETH buy').gate === 'dca' && simulateLadder('buy $10 of ETH every week').gate === 'dca',
        JSON.stringify(nounDca),
      )
      const makeWallet = parseMosaicAsk('make my wallet 60% ETH 40% USDC')
      check(
        'strangers: "make/set/rebalance my wallet 60% ETH 40% USDC" is a mosaic; "rebalance my portfolio" (no tiles) stays the rebalance layer\'s',
        !!makeWallet && !('problem' in makeWallet) && makeWallet.slices.length === 2 &&
          simulateLadder('make my wallet 60% ETH 40% USDC').gate === 'mosaic' &&
          simulateLadder('rebalance my wallet to 50% ETH 50% USDC').gate === 'mosaic' &&
          parseMosaicAsk('rebalance my portfolio') === null && simulateLadder('rebalance my portfolio').gate === 'rebalance' &&
          isMosaicAsk(mosaicAskString(makeWallet.slices)),
        JSON.stringify(makeWallet),
      )
      const dollarSend = parseTransferSegment('send $5 to nate.eth', { fallbackChainId: null })
      const dollarSendChips = dollarSend && 'problem' in dollarSend ? (dollarSend.chips ?? []) : []
      check(
        'strangers: "send $5 to nate.eth" = 5 USDC, chain asked with chips whose resumes round-trip the parser as complete sends',
        !!dollarSend && 'problem' in dollarSend && /5 USDC/.test(dollarSend.problem) && dollarSendChips.length === 3 &&
          dollarSendChips.every((c) => { const p = parseTransferSegment(c.resume, { fallbackChainId: null }); return !!p && !('problem' in p) && p.token.toUpperCase() === 'USDC' && p.amountHuman === '5' && p.to === 'nate.eth' }) &&
          simulateLadder('send $5 to nate.eth').gate === 'transfer',
        JSON.stringify(dollarSend),
      )
      const handleSend = parseTransferSegment('send 5 USDC on base to @nate', { fallbackChainId: null })
      check(
        'strangers: "send 5 USDC to @handle" refuses BY NAME (a handle is not a payable address) and points at the addressed-link door',
        !!handleSend && 'problem' in handleSend && /@nate/.test(handleSend.problem) && /0x address or an ENS/.test(handleSend.problem) && /\/links/.test(handleSend.problem) &&
          simulateLadder('send 5 USDC to @nate').gate === 'transfer',
        JSON.stringify(handleSend),
      )
      const priceSell = parseSwapIntent('sell my eth when it hits $4000')
      const priceChips = swapClarify(priceSell)
      const sizedPriceSell = parseSwapIntent('sell 0.5 ETH if it reaches $4k')
      const sizedChips = swapClarify(sizedPriceSell)
      check(
        'strangers: "sell my eth when it hits $4000" → limit-order chips at that price; every resume round-trips as a complete limit order; a sized ask keeps its size',
        priceSell.isSwap && !!priceSell.problem && priceSell.limitPriceUsd === '4000' && !!priceChips && priceChips.options.length === 3 &&
          priceChips.options.every((o) => { const p = parseSwapIntent(o.resume); return p.mode === 'limit' && p.sellToken?.toUpperCase() === 'ETH' && p.buyToken?.toUpperCase() === 'USDC' && !p.problem }) &&
          sizedPriceSell.limitPriceUsd === '4000' && sizedPriceSell.sellAmountHuman === '0.5' && !!sizedChips && sizedChips.options[0].resume === 'limit order: sell 0.5 ETH for at least 2000 USDC' &&
          simulateLadder('sell my eth when it hits $4000').gate === 'swap' && simulateLadder('sell my eth when it hits $4000').kind === 'clarify',
        JSON.stringify({ priceSell, chips: priceChips?.options, sizedChips: sizedChips?.options }),
      )
      const spotOnBase = parseSpotGuardArm('Protect my ETH on Base with a 10% stop')
      check(
        'strangers: "Protect my ETH on Base with a 10% stop" (WALLET-MATRIX row 6) is the SPOT guardian, not the HL door; perp-worded asks still refuse',
        !!spotOnBase && spotOnBase.token === 'ETH' && spotOnBase.triggerMode === 'price_move_pct' && spotOnBase.triggerValue === 10 &&
          simulateLadder('Protect my ETH on Base with a 10% stop').gate === 'spot-guard' &&
          parseSpotGuardArm('protect my HYPE long on base with a 5% stop') === null &&
          simulateLadder('protect my SYRUP long with a 10% stop').gate === 'guardian',
        JSON.stringify(spotOnBase),
      )
      // The route: a chain-less send answers CHIPS from the transfer layer.
      const sendTurn = await fetch(`${BASE}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
        body: JSON.stringify({ message: 'send $5 to nate.eth', activeServers: [], walletAddress: owner.address, history: [] }),
      }).then((r) => r.json() as Promise<Record<string, unknown>>)
      const sendOpts = ((sendTurn.clarify as { options?: { resume: string }[] } | undefined)?.options ?? [])
      check(
        'strangers (route): "send $5 to nate.eth" answers chain chips from the transfer layer, attributed, answered — not a wall',
        sendTurn.buildPath === 'native-transfer' && sendOpts.length === 3 && classifyTurn(sendTurn).kind === null,
        JSON.stringify(sendTurn).slice(0, 300),
      )
      // The route: the spot guardian refuses an EOA BY NAME before any
      // signature — a Spend Permission an EOA signs can never be spent (the
      // manager pulls through the smart wallet's execute()), so an arm here
      // would look armed and never fire. `owner` is a fresh EOA.
      const eoaArm = await fetch(`${BASE}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
        body: JSON.stringify({ message: 'Protect my spot ETH with a 10% stop loss', activeServers: [], walletAddress: owner.address, history: [] }),
      }).then((r) => r.json() as Promise<Record<string, unknown>>)
      const eoaReply = String(eoaArm.reply ?? '')
      check(
        'spot guardian (route): an EOA wallet is refused by name BEFORE any signature (needs a smart wallet); nothing armed, no policy row, provisioning gate stays upstream',
        eoaArm.buildPath === 'native-spot-guard' && !eoaArm.spotGuardArm &&
          (/needs a smart wallet/.test(eoaReply) || /aren’t provisioned in this environment/.test(eoaReply)) &&
          !/ready to arm/i.test(eoaReply),
        JSON.stringify(eoaArm).slice(0, 300),
      )
    }
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
        // v4 fee wired (PAY_PORTION/SWEEP split, treasury-pinned in the
        // guard) → the map claims the full base tier again
        netFeeBpsFor('native-swap-uniswap-v4') === SWAP_FEE_BPS &&
        FEE_BEARING_BUILD_PATHS.has('native-swap-uniswap-v4') &&
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

    // ── The fee split: v4's mirror of v3's sweepTokenWithFee. The router's
    // own PAY_PORTION/SWEEP commands split the output treasury/sender; the
    // guard pins the treasury address, the canonical two-tier family, the
    // sender sentinel, and the post-fee minimum — and refuses fee legs
    // nobody priced as hard as a missing split.
    const DEAD = '0x000000000000000000000000000000000000dEaD' as `0x${string}`
    const SENDER_SENTINEL = '0x0000000000000000000000000000000000000001' as `0x${string}`
    const expFee: V4GuardExpectations = { ...exp, feeBps: SWAP_FEE_BPS }
    const feeSwap = (data: `0x${string}`): V4BuiltStep[] => [goodSteps[0], goodSteps[1], { ...goodSteps[2], tx: { ...goodSteps[2].tx, data } }]
    const feeData = encodeV4SwapCalldata({ poolKey, zeroForOne: true, amountIn, minOut, deadline, feeBps: SWAP_FEE_BPS })
    const linkData = encodeV4SwapCalldata({ poolKey, zeroForOne: true, amountIn, minOut, deadline, feeBps: LINK_SWAP_FEE_BPS })
    check('v4 fee: fee-bearing build PASSES at the base tier', guardUniswapV4Build(feeSwap(feeData), expFee).ok)
    check('v4 fee: link-tier build PASSES', guardUniswapV4Build(feeSwap(linkData), { ...exp, feeBps: LINK_SWAP_FEE_BPS }).ok)
    check('v4 fee: fee legs NOBODY priced are refused (fee-free expectation)', !guardUniswapV4Build(feeSwap(feeData), exp).ok)
    check('v4 fee: a MISSING split is refused when the build was priced with one', !guardUniswapV4Build(goodSteps, expFee).ok)
    check('v4 fee: tier mismatch is refused (link calldata vs base expectation)', !guardUniswapV4Build(feeSwap(linkData), expFee).ok)
    const oddTier = encodeV4SwapCalldata({ poolKey, zeroForOne: true, amountIn, minOut, deadline, feeBps: 37 })
    check('v4 fee: a rate outside the canonical tiers is refused even when "expected"', !guardUniswapV4Build(feeSwap(oddTier), { ...exp, feeBps: 37 }).ok)

    // Tampered splits — hand-patched calldata, so the guard faces an
    // adversary rather than our own encoder.
    const urAbi = [{ name: 'execute', type: 'function', stateMutability: 'payable', inputs: [{ name: 'commands', type: 'bytes' }, { name: 'inputs', type: 'bytes[]' }, { name: 'deadline', type: 'uint256' }], outputs: [] }] as const
    const aau = [{ type: 'address' }, { type: 'address' }, { type: 'uint256' }] as const
    const patchFee = (patch: { pay?: [`0x${string}`, `0x${string}`, bigint]; sweep?: [`0x${string}`, `0x${string}`, bigint]; take?: [`0x${string}`, `0x${string}`, bigint] }): `0x${string}` => {
      const dec = decodeFunctionData({ abi: urAbi, data: feeData })
      const [commands, inputs, dl] = dec.args as [`0x${string}`, readonly `0x${string}`[], bigint]
      const next = [...inputs]
      if (patch.pay) next[1] = encodeAbiParameters([...aau], patch.pay)
      if (patch.sweep) next[2] = encodeAbiParameters([...aau], patch.sweep)
      if (patch.take) {
        const [actions, params] = decodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], inputs[0]) as [`0x${string}`, readonly `0x${string}`[]]
        const nextParams = [...params]
        nextParams[2] = encodeAbiParameters([...aau], patch.take)
        next[0] = encodeAbiParameters([{ type: 'bytes' }, { type: 'bytes[]' }], [actions, nextParams])
      }
      return encodeFunctionData({ abi: urAbi, functionName: 'execute', args: [commands, next, dl] })
    }
    const sweepMinAfterFee = minOut - swapFeeAtoms(minOut, SWAP_FEE_BPS)
    check('v4 fee: PAY_PORTION to a NON-treasury recipient is refused', !guardUniswapV4Build(feeSwap(patchFee({ pay: [AAPL, DEAD, BigInt(SWAP_FEE_BPS)] })), expFee).ok)
    check('v4 fee: PAY_PORTION bips drift is refused', !guardUniswapV4Build(feeSwap(patchFee({ pay: [AAPL, TREASURY_ADDRESS, BigInt(9_999)] })), expFee).ok)
    check('v4 fee: SWEEP away from the sender sentinel is refused', !guardUniswapV4Build(feeSwap(patchFee({ sweep: [AAPL, DEAD, sweepMinAfterFee] })), expFee).ok)
    check('v4 fee: a weakened SWEEP minimum is refused', !guardUniswapV4Build(feeSwap(patchFee({ sweep: [AAPL, SENDER_SENTINEL, BigInt(0)] })), expFee).ok)
    check('v4 fee: TAKE diverted off the router sentinel is refused', !guardUniswapV4Build(feeSwap(patchFee({ take: [AAPL, DEAD, BigInt(0)] })), expFee).ok)
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
      { label: 'fee', title: 'Pantessa fee', tx: { to: USDG, data: feeData, value: '0', chainId: 4663, action: 'transfer' } },
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

    check('bridge: funding need = buy + 4% margin + gas leg, rounded to $0.50', fundingNeedUsd(10, true) === 12.5 && fundingNeedUsd(10, false) === 10.5)

    // The 2026-09-02 wall: LiFi's small-transfer floor rose above the $1.50
    // gas leg and the failure surfaced as a generic error, stranding a
    // compiled fund-then-buy job at step 1. The classifier turns LiFi's
    // "can't fill" shapes into NoLifiRouteError; the ladder is the builder's
    // self-heal for jobs that froze the old size into their step params.
    check(
      'lifi no-route classifier: every live "can\'t fill" shape matches, real errors do not',
      isLifiNoRouteMessage('No possible route found') &&
        isLifiNoRouteMessage('No available quotes for the requested transfer') &&
        isLifiNoRouteMessage('None of the available routes could successfully generate a tx') &&
        !isLifiNoRouteMessage('Internal server error') &&
        !isLifiNoRouteMessage('Unauthorized'),
    )
    check(
      'gas leg: base size sits on the ladder, ladder ascends and stays bounded',
      GAS_LEG_USD === GAS_LEG_LADDER_USD[0] &&
        GAS_LEG_LADDER_USD.every((u, i) => i === 0 || u > GAS_LEG_LADDER_USD[i - 1]) &&
        GAS_LEG_LADDER_USD[GAS_LEG_LADDER_USD.length - 1] <= 5,
    )

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
        (fundJob.steps[1].params as { usd?: number }).usd === 10 &&
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
        (ethJob.steps[1].params as { usd?: number }).usd === 5,
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
    // Sizes sit above MIN_VALUE_LEG_USD throughout: a sub-floor plan is
    // refused outright now (it could never fill), so a fixture under it
    // would test the floor instead of the shape it's here to guard.
    const chipOrigins = [O(1, 'Ethereum', 30), O(8453, 'Base', 6)]
    const chips = planRobinhoodFundingChips({ origins: chipOrigins, needUsd: 13, gasIncluded: true, followup: 'buy $5 of NVDA' })
    check(
      'funding chips: richest covering origin leads and every resume compiles',
      !!chips && chips.length >= 2 && /Ethereum/.test(chips[0].label) && /~\$13/.test(chips[0].label) &&
        chips.every((c) => {
          const j = compileJobAsk(c.resume)
          return !!j && !('problem' in j)
        }),
      JSON.stringify(chips),
    )
    const altChips = planRobinhoodFundingChips({ origins: [O(8453, 'Base', 30), O(1, 'Ethereum', 20)], needUsd: 13, gasIncluded: false, followup: 'buy $5 of NVDA' })
    check(
      'funding chips: a second covering origin gets an "instead" chip',
      !!altChips && altChips.some((c) => /Use Ethereum instead/.test(c.label)),
      JSON.stringify(altChips),
    )
    const comboChips = planRobinhoodFundingChips({ origins: [O(1, 'Ethereum', 12), O(8453, 'Base', 10)], needUsd: 21, gasIncluded: true, followup: 'buy $5 of NVDA' })
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
    const whaleChips = planRobinhoodFundingChips({ origins: [O(8453, 'Base', 15112), O(1, 'Ethereum', 142)], needUsd: 13, gasIncluded: true, followup: 'buy $5 of NVDA' })
    check(
      'funding chips: a whale balance skips half/all (10× cap) but keeps the alternative origin',
      !!whaleChips && !whaleChips.some((c) => /Half|All/.test(c.label)) && whaleChips.some((c) => /Use Ethereum instead/.test(c.label)),
      JSON.stringify(whaleChips),
    )
    const bridgeOnlyChips = planRobinhoodFundingChips({ origins: chipOrigins, needUsd: 13, gasIncluded: true, followup: '' })
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
      needUsd: 13, gasIncluded: true, followup: 'buy $5 of NVDA',
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
      scan: { origins: [O(8453, 'Base', 20)] }, buyUsd: 50, holdingUsd: 5, includeGas: true, buySym: 'USDG', acquiring: true,
    })
    const downsizedAcqJob = downsizedAcq ? compileJobAsk(downsizedAcq.chips[0].resume) : null
    check(
      'funding downsize: an acquisition counts the held USDG and compiles bridge-only',
      !!downsizedAcq && downsizedAcq.buyUsd === 22.25 && /Land \$22\.25 of it instead/.test(downsizedAcq.chips[0].label) &&
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
    const usdceOrigin = O(42161, 'Arbitrum', 20, 0.01, 'USDC.e')
    const usdceChips = planRobinhoodFundingChips({ origins: [usdceOrigin], needUsd: 13, gasIncluded: true, followup: 'buy $5 of NVDA' })
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

    // ── Funding-path visualization (lib/funding-path): the route card the
    // user PICKS from is derived from the resume string — the chip IS the
    // contract, so the drawing can never diverge from what the click runs.
    // SYNC GUARD: every planner-emitted chip above must parse, so a grammar
    // change that breaks the visualization fails here, loudly, not as a
    // silent fallback to plain text chips in production.
    const pathChips = [
      ...(chips ?? []), ...(altChips ?? []), ...(comboChips ?? []), ...(bridgeOnlyChips ?? []), ...(usdceChips ?? []),
      ...(covered.kind === 'chips' ? covered.chips : []),
      ...(rescue.kind === 'gas-stranded' && rescue.chips ? rescue.chips.filter((c) => !/never mind/i.test(c.resume)) : []),
    ]
    check(
      'funding path: every planner-emitted chip resume parses into a drawable route',
      pathChips.length >= 10 && pathChips.every((c) => fundingPathOf(c.resume) !== null),
      JSON.stringify(pathChips.filter((c) => fundingPathOf(c.resume) === null).map((c) => c.resume)),
    )
    const leadPath = chips ? fundingPathOf(chips[0].resume) : null
    check(
      'funding path: the lead fund chip draws origin → Robinhood Chain (USDG + gas) → the buy',
      !!leadPath && leadPath.nodes.map((n) => n.title).join(' | ') === 'Ethereum | Robinhood Chain | Buy $5 of NVDA' &&
        leadPath.nodes[0].detail === '$13 USDC' && leadPath.nodes[1].detail === 'USDG + gas' &&
        leadPath.nodes[2].kind === 'action' && leadPath.arrows.join(' | ') === 'bridge | then',
      JSON.stringify(leadPath),
    )
    const rescuePath = rescue.kind === 'gas-stranded' && rescue.chips ? fundingPathOf(rescue.chips[0].resume) : null
    check(
      'funding path: the donor-topup route folds — Base → Arbitrum → Robinhood Chain → the buy, no repeated stop',
      !!rescuePath && rescuePath.nodes.map((n) => n.title).join(' | ') === 'Base | Arbitrum | Robinhood Chain | Buy $10 of GOOGL' &&
        rescuePath.nodes[0].detail === `${GAS_TOPUP_ETH} ETH` &&
        rescuePath.nodes[1].detail === '$11 USDC' && rescuePath.arrows.join(' | ') === 'bridge | bridge | then',
      JSON.stringify(rescuePath),
    )
    // The universal planner's two leg shapes: a destination-chain conversion
    // draws a same-chain swap; a cross-chain leg draws bridge + swap.
    const vizNeed: FundingNeed = { chainId: 8453, token: 'ETH', amountHuman: 0.004, followupResume: 'buy the cheapest 0x1234 nft on base', actionLabel: 'the buy' }
    const vizSame = planFundingChips(vizNeed, 12, [{ chainId: 8453, chainWord: 'Base', token: 'USDC', balance: 20, usd: 20 }])
    const vizSamePath = vizSame.kind === 'offer' ? fundingPathOf(vizSame.chips[0].resume) : null
    check(
      'funding path: a destination-chain conversion draws Base —swap→ Base (ETH) → the buy',
      !!vizSamePath && vizSamePath.nodes.map((n) => n.title).join(' | ') === 'Base | Base | Buy the cheapest 0x1234 nft on base' &&
        vizSamePath.nodes[1].detail === 'ETH' && vizSamePath.arrows[0] === 'swap',
      JSON.stringify(vizSamePath),
    )
    const vizCross = planFundingChips(vizNeed, 12, [{ chainId: 1, chainWord: 'Ethereum', token: 'USDC', balance: 30, usd: 30 }])
    const vizCrossPath = vizCross.kind === 'offer' ? fundingPathOf(vizCross.chips[0].resume) : null
    check(
      'funding path: a cross-chain leg draws Ethereum —bridge + swap→ Base (ETH) → the buy',
      !!vizCrossPath && vizCrossPath.nodes.map((n) => n.title).join(' | ') === 'Ethereum | Base | Buy the cheapest 0x1234 nft on base' &&
        vizCrossPath.arrows[0] === 'bridge + swap' && vizCrossPath.nodes[1].detail === 'ETH',
      JSON.stringify(vizCrossPath),
    )
    // ── Optimism as a funding origin (2026-09-04) ─────────────────────────
    // OP joined FUNDING_SCAN_CHAINS + FUNDING_ORIGIN_CHAINS because 1Click
    // lists native ETH and USDC there (probed live) and LiFi routes OP→4663
    // through the same canonical diamond. These pin the full path a stranger
    // whose money lives on Optimism travels: scanned → chip → compiles →
    // draws. Half-adding a chain (seen by the scanner, unparseable by the
    // compiler) is the failure this guards.
    check(
      'optimism: joined both funding scan sets',
      FUNDING_SCAN_CHAINS.includes(10 as never) && (FUNDING_ORIGIN_CHAINS as readonly number[]).includes(10) &&
        FUNDING_CHAIN_WORD[10] === 'Optimism' && FUNDING_ORIGIN_WORD[10] === 'Optimism',
      JSON.stringify({ scan: FUNDING_SCAN_CHAINS, origins: FUNDING_ORIGIN_CHAINS }),
    )
    const opPlan = planFundingChips(
      { chainId: 8453, token: 'USDC', amountHuman: 10, followupResume: 'swap 10 USDC for ETH on base', actionLabel: 'the swap' },
      10,
      [{ chainId: 10, chainWord: 'Optimism', token: 'USDC', balance: 20, usd: 20 }],
    )
    const opPath = opPlan.kind === 'offer' ? fundingPathOf(opPlan.chips[0].resume) : null
    check(
      'optimism: an OP-only wallet gets chips that compile AND draw Optimism → Base → the swap',
      opPlan.kind === 'offer' &&
        opPlan.chips.filter((c) => !/never mind/i.test(c.resume)).every((c) => compileJobAsk(c.resume) !== null) &&
        !!opPath && opPath.nodes.map((n) => n.title).join(' | ') === 'Optimism | Base | Base' &&
        opPath.nodes[0].detail === '10 USDC' && opPath.arrows.join(' | ') === 'bridge | swap',
      JSON.stringify({ kind: opPlan.kind, chips: opPlan.kind === 'offer' ? opPlan.chips.map((c) => c.resume) : [], path: opPath }),
    )
    check(
      'optimism: the jobs compiler reads OP in both the fund and same-chain-swap grammars',
      parseRobinhoodFunding('fund robinhood chain with $14 from optimism')?.originChainId === 10 &&
        parseRobinhoodFunding('fund robinhood chain with $14 from optimsim')?.originWord === 'Optimism' &&
        parseSameChainSwapSegment('swap 20 USDC for WETH on optimism')?.chainId === 10,
      JSON.stringify(parseRobinhoodFunding('fund robinhood chain with $14 from optimism')),
    )
    // The refusal copy is DERIVED from the origin set, so widening the scan
    // can never leave it claiming we checked three chains when we checked
    // four. Pinning the derivation, not the frozen sentence.
    const opRefusal = planRobinhoodFundingAdvice({
      scan: { origins: [], gaslessOrigins: [], allScanned: [], failedOrigins: [] },
      needUsd: 20, gasIncluded: true, followup: '',
    })
    check(
      'optimism: the empty-wallet refusal names every scanned origin, Optimism included',
      opRefusal.kind === 'none' && opRefusal.copy.includes('Base, Ethereum, Arbitrum, or Optimism') &&
        listWords(['Base']) === 'Base' && listWords(['Base', 'Ethereum']) === 'Base or Ethereum' &&
        listWords(['A', 'B', 'C'], 'and') === 'A, B, and C',
      JSON.stringify(opRefusal),
    )
    // The registry entry itself: a picker chain with no venue is a dead chip.
    check(
      'optimism: registry entry is complete and honest (v3 yes, v4 none, CoW has no OP book)',
      (() => {
        const op = chainByKey('optimism')
        return !!op && op.id === 10 && op.alchemyNet === 'opt-mainnet' && !!op.uniswap && op.uniswapV4 === null &&
          op.cow === false && !COW_API_BASE[10] &&
          op.stables['0x0b2c639c533813f4aa9d7837caf62653d097ff85'] === 6 &&
          op.stables['0x7f5c764cbc14f9669b88837ca1490cca17c31607'] === 6 &&
          primaryStable(10)?.symbol === 'USDC' && chainNamedIn('bridge it to optimism')?.id === 10
      })(),
      JSON.stringify(chainByKey('optimism')?.tokens),
    )
    // Every funding origin must be a first-class registry chain AND a chain
    // the WALLET can switch to — otherwise the chip walls at signature time,
    // which is exactly what made Optimism unusable before this change
    // (cross-chain-swap already mapped optimism→10; wagmi didn't carry it,
    // and switchChainAsync only knows the chains in that list). Read as
    // source text because importing lib/wagmi pulls browser-only modules.
    check(
      'funding origins: every origin is a first-class registry chain',
      (FUNDING_ORIGIN_CHAINS as readonly number[]).every((id) => chainById(id) !== null) &&
        (FUNDING_SCAN_CHAINS as readonly number[]).every((id) => chainById(id) !== null),
      JSON.stringify({ origins: FUNDING_ORIGIN_CHAINS, scan: FUNDING_SCAN_CHAINS }),
    )
    const wagmiSrc = await readFile(new URL('../lib/wagmi.ts', import.meta.url), 'utf8')
    const wagmiChainsLine = wagmiSrc.match(/chains:\s*\[([^\]]*)\]/)?.[1] ?? ''
    check(
      'funding origins: lib/wagmi carries a switchable chain for every funding origin',
      (FUNDING_ORIGIN_CHAINS as readonly number[]).every((id) => {
        // registry key → the viem/wagmi identifier the config imports
        const ident = { 1: 'mainnet', 10: 'optimism', 8453: 'base', 42161: 'arbitrum', 4663: 'robinhoodChain' }[id]
        return !!ident && new RegExp(`\\b${ident}\\b`).test(wagmiChainsLine)
      }),
      JSON.stringify({ origins: FUNDING_ORIGIN_CHAINS, wagmiChainsLine: wagmiChainsLine.trim() }),
    )

    // Non-funding resumes stay plain chips: "Not now", planner clarifies,
    // vote options — the visualization must never claim a turn it can't draw.
    check(
      'funding path: non-funding resumes return null (plain chips, never a bogus route)',
      fundingPathOf('Never mind — leave my funds where they are.') === null &&
        fundingPathOf('Vote FOR on proposal 12 in the uniswap DAO') === null &&
        fundingPathOf('Swap 5 USDC for ETH on saturn') === null,
    )

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
      'funding advice: an empty wallet names both scanned tokens on every scanned chain',
      emptyAdvice.kind === 'none' &&
        emptyAdvice.copy.includes(`no USDC or ETH on ${listWords(FUNDING_ORIGIN_CHAINS.map((c) => FUNDING_ORIGIN_WORD[c]))}`) &&
        // …and it really does name each one, not just match its own template.
        (FUNDING_ORIGIN_CHAINS as readonly number[]).every((c) => emptyAdvice.copy.includes(FUNDING_ORIGIN_WORD[c])),
      JSON.stringify(emptyAdvice),
    )

    // ── ETH two-leg headroom (live 2026-07-28): "~$8 from Ethereum ETH"
    // compiled a $1.5 gas leg + $6.5 value leg off the SAME balance — leg 1's
    // own L1 fee came out of the keep-back leg 2 re-checks in full, and the
    // job died mid-flight with $1.5 already bridged. A gas-included plan may
    // only promise an ETH row's capacity MINUS the per-chain headroom.
    // Sized so the HEADROOM is what decides: the need clears the parity
    // floor either way, and only the $1 mainnet two-leg keep-back separates
    // the gas-included null from the gas-free offer.
    const ethTight = O(1, 'Ethereum', 11, 0.0063, 'ETH')
    check(
      'funding chips: a gas-included plan never promises an ETH row\'s whole movable balance (two legs, one balance)',
      planRobinhoodFundingChips({ origins: [ethTight], needUsd: 11, gasIncluded: true, followup: 'buy $8.65 of AAPL' }) === null,
    )
    check(
      'funding chips: the same ETH row still covers a single-leg (gas-free) plan at full size',
      planRobinhoodFundingChips({ origins: [ethTight], needUsd: 11, gasIncluded: false, followup: 'buy $8.65 of AAPL' }) !== null,
    )
    // The counter-offer this wallet used to get was a ~$7 plan — under the
    // parity floor, i.e. exactly the chip that compiled and died on step 1
    // (live 2026-09-03). Once the gas leg and the $1 keep-back come out of
    // an $11 ETH row there is no fillable bridge left, so the honest
    // refusal (which NAMES the flat cost) is the right answer, not a
    // smaller number that can't clear either.
    const ethDownsized = planDownsizedRobinhoodBuy({ scan: { origins: [ethTight] }, buyUsd: 12, holdingUsd: 0, includeGas: true, buySym: 'AAPL', acquiring: false })
    check(
      'funding downsize: a wallet whose remaining capacity is under the parity floor gets the refusal, not a dead counter-offer',
      ethDownsized === null,
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
    check('aave rival: wallet+aave only → null (Aave is the only venue)', competingVenueOf([{ slug: 'aave', name: 'Aave' }, { slug: 'yeetful-tool-wallet', name: 'Pantessa Wallet' }]) === null)

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

  // ── Morpho: parse + the TUPLE-BOUND guard (lib/morpho-supply.ts) ──────────
  // Morpho calldata carries the full MarketParams tuple — the market id
  // never appears in it — so the guard binds through the tuple: every word
  // (loanToken, collateralToken, oracle, irm, lltv) must match the market
  // resolved on-chain. Good plans below are encoded with viem from the
  // pinned ABI (ground truth, not the guard's own layout table), then
  // tampered word-by-word.
  console.log('— morpho native (parse + tuple-bound guard)')
  {
    // Parse: lend.
    const l = parseMorphoLend('lend 100 USDC on morpho')
    check('morpho parse: "lend 100 USDC on morpho" (Base default)', !!l && !('problem' in l) && l.amount === '100' && l.token === 'USDC' && l.explicitMorpho && l.chainId === 8453 && l.otherChain === null && !l.weak)
    const l2 = parseMorphoLend('supply 50 USDC to morpho on ethereum')
    check('morpho parse: named Ethereum → chainId 1', !!l2 && !('problem' in l2) && l2.chainId === 1 && l2.otherChain === null)
    const l3 = parseMorphoLend('lend 100 USDC on morpho on arbitrum')
    check('morpho parse: wrong chain surfaces BY NAME', !!l3 && !('problem' in l3) && l3.otherChain === 'arbitrum')
    check('morpho parse: aave-worded ask NEVER claimed', parseMorphoLend('supply 20 USDC to aave') === null && parseMorphoOp('repay 100 USDC on aave') === null)
    check('morpho parse: morpho-worded ask never claimed by AAVE (mutual exclusion)', parseAaveSupply('lend 100 USDC on morpho') === null && parseAaveOp('repay 100 USDC on morpho') === null)
    const lbare = parseMorphoLend('lend 100 USDC')
    check('morpho parse: bare lending-only verb is NOT weak (set decides at the route)', !!lbare && !('problem' in lbare) && !lbare.explicitMorpho && !lbare.weak)
    const lweak = parseMorphoLend('deposit 5 USDC')
    check('morpho parse: bare generic verb → WEAK', !!lweak && !('problem' in lweak) && lweak.weak === true)
    check('morpho parse: non-Morpho destination → null', parseMorphoLend('deposit 5 USDC to hyperliquid') === null)
    check('morpho parse: question → null', parseMorphoLend('should i lend 100 USDC on morpho') === null)
    check('morpho parse: bare "eth" as a TOKEN never flips the chain', (() => { const p = parseMorphoLend('lend 100 USDC on morpho and keep my eth'); return !!p && !('problem' in p) && p.chainId === 8453 })())
    const lna = parseMorphoLend('lend USDC on morpho')
    check('morpho parse: missing amount → problem (the one real clarify)', !!lna && 'problem' in lna)
    check('morpho parse: collateral phrasing is NOT a lend', parseMorphoLend('supply 0.5 cbBTC collateral to morpho') === null)
    check('morpho rival: aave in the set → named', morphoCompetingVenueOf([{ slug: 'morpho-free', name: 'Morpho (Free)' }, { slug: 'aave-free', name: 'Aave (Free)' }]) === 'Aave (Free)')
    check('morpho rival: morpho+wallet only → null', morphoCompetingVenueOf([{ slug: 'morpho-free', name: 'Morpho (Free)' }, { slug: 'yeetful-tool-wallet', name: 'Pantessa Wallet' }]) === null)

    // Parse: ops.
    const b = parseMorphoOp('borrow 50 USDC on morpho')
    check('morpho ops parse: "borrow 50 USDC on morpho"', !!b && !('problem' in b) && b.op === 'borrow' && b.amount === '50' && !b.max && b.chainId === 8453)
    const r = parseMorphoOp('repay 25 USDC on morpho')
    check('morpho ops parse: "repay 25 USDC"', !!r && !('problem' in r) && r.op === 'repay' && r.amount === '25' && !r.max)
    const rmax = parseMorphoOp('pay off my USDC debt on morpho')
    check('morpho ops parse: "pay off my USDC debt" → max repay', !!rmax && 'op' in rmax && !('problem' in rmax) && rmax.op === 'repay' && rmax.max)
    const w = parseMorphoOp('withdraw 100 USDC from morpho')
    check('morpho ops parse: "withdraw 100 USDC from morpho"', !!w && !('problem' in w) && w.op === 'withdraw' && w.amount === '100')
    const wmax = parseMorphoOp('withdraw all my USDC from morpho')
    check('morpho ops parse: "withdraw all my USDC" → max', !!wmax && !('problem' in wmax) && wmax.op === 'withdraw' && wmax.max)
    const wc = parseMorphoOp('withdraw 0.5 cbBTC collateral from morpho')
    check('morpho ops parse: collateral withdrawal is its OWN op', !!wc && !('problem' in wc) && wc.op === 'withdraw-collateral' && wc.amount === '0.5' && wc.token === 'cbBTC')
    const sc = parseMorphoOp('post 0.5 cbBTC as collateral on morpho')
    check('morpho ops parse: "post … as collateral" → supply-collateral', !!sc && !('problem' in sc) && sc.op === 'supply-collateral' && sc.amount === '0.5')
    const wbare = parseMorphoOp('withdraw 100 USDC')
    check('morpho ops parse: bare withdraw → WEAK (set decides)', !!wbare && !('problem' in wbare) && wbare.op === 'withdraw' && wbare.weak === true)
    check('morpho ops parse: bare withdraw from a non-Morpho source → null', parseMorphoOp('withdraw 100 USDC from binance') === null)
    check('morpho ops parse: question → null', parseMorphoOp('should I repay my USDC debt on morpho?') === null)
    const bna = parseMorphoOp('borrow USDC on morpho')
    check('morpho ops parse: borrow missing amount → problem', !!bna && 'problem' in bna && bna.op === 'borrow')
    const wchain = parseMorphoOp('repay 5 USDC on morpho on polygon')
    check('morpho ops parse: unsupported chain surfaces by name', !!wchain && !('problem' in wchain) && wchain.otherChain === 'polygon')

    // The guard vs viem-encoded ground truth. Selectors re-derive from the
    // ABI signatures first — the pinned table can never drift silently.
    const sel = (sig: string) => toFunctionSelector(sig).slice(2)
    const P = '(address,address,address,address,uint256)'
    check(
      'morpho guard: pinned selectors re-derive from the ABI signatures',
      sel(`supply(${P},uint256,uint256,address,bytes)`) === MORPHO_OP_SELECTORS.lend &&
        sel(`supplyCollateral(${P},uint256,address,bytes)`) === MORPHO_OP_SELECTORS['supply-collateral'] &&
        sel(`borrow(${P},uint256,uint256,address,address)`) === MORPHO_OP_SELECTORS.borrow &&
        sel(`repay(${P},uint256,uint256,address,bytes)`) === MORPHO_OP_SELECTORS.repay &&
        sel(`withdraw(${P},uint256,uint256,address,address)`) === MORPHO_OP_SELECTORS.withdraw &&
        sel(`withdrawCollateral(${P},uint256,address,address)`) === MORPHO_OP_SELECTORS['withdraw-collateral'],
    )

    // The symbol→address binding (2026-07-29 audit finding): every check
    // below this line binds calldata to a RESOLVED tuple, but the tuple's
    // market is chosen from the agent's own market list. Without an
    // independent identity read, a hostile MCP answering {loan:'USDC',
    // marketId:<a real WETH market>} passes every downstream check and the
    // user signs an approve of the WRONG TOKEN. The chain is the authority.
    const IDENT_USDC_BASE = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913'
    const IDENT_WETH_BASE = '0x4200000000000000000000000000000000000006'
    const identOk = await assertTokenIdentity(8453, IDENT_USDC_BASE, 'USDC', 6).then(() => true).catch(() => false)
    check('morpho identity: the real USDC address passes as USDC/6 (on-chain read)', identOk)
    const identWrongToken = await assertTokenIdentity(8453, IDENT_WETH_BASE, 'USDC', 6).then(() => null).catch((e: Error) => e.message)
    check(
      'morpho identity: a "USDC" ask pointed at the WETH address REFUSES by name',
      typeof identWrongToken === 'string' && /WETH/i.test(identWrongToken) && /not USDC/i.test(identWrongToken),
      String(identWrongToken).slice(0, 160),
    )
    const identWrongDecimals = await assertTokenIdentity(8453, IDENT_USDC_BASE, 'USDC', 18).then(() => null).catch((e: Error) => e.message)
    check(
      'morpho identity: a lied-about decimals scale REFUSES (never sizes atoms wrong)',
      typeof identWrongDecimals === 'string' && /6 decimals on-chain/i.test(identWrongDecimals),
      String(identWrongDecimals).slice(0, 160),
    )
    const identEthAlias = await assertTokenIdentity(8453, IDENT_WETH_BASE, 'ETH', 18).then(() => true).catch(() => false)
    check('morpho identity: "eth" accepts the market\'s WETH (the one documented alias)', identEthAlias)

    // The funding offer's chip is the contract: its resume must re-enter the
    // SAME lend turn, on the same chain, or the fund-then-lend loop dead-ends.
    const fundResumeBase = parseMorphoLend('lend 100 USDC on morpho')
    const fundResumeEth = parseMorphoLend('lend 0.5 WETH on morpho on ethereum')
    check(
      'morpho funding: both chip resume shapes round-trip the lend parser (chain preserved)',
      !!fundResumeBase && !('problem' in fundResumeBase) && fundResumeBase.chainId === 8453 && fundResumeBase.amount === '100' &&
        !!fundResumeEth && !('problem' in fundResumeEth) && fundResumeEth.chainId === 1 && fundResumeEth.token === 'WETH',
      JSON.stringify({ fundResumeBase, fundResumeEth }),
    )

    const LOAN = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // USDC (Base)
    const COLL = '0xcbB7C0000aB88B473b1f5aFd9ef808440eed33Bf' // cbBTC (Base)
    const ORACLE = '0x1111111111111111111111111111111111111111'
    const IRM = '0x46415998764C29aB2a25CbeA6254146D50D22687'
    const LLTV = BigInt('860000000000000000')
    const USER = '0x28C6c06298d514Db089934071355E5743bf21d60'
    const EVIL = '0x000000000000000000000000000000000000dEaD'
    const MP = [
      { name: 'loanToken', type: 'address' }, { name: 'collateralToken', type: 'address' },
      { name: 'oracle', type: 'address' }, { name: 'irm', type: 'address' }, { name: 'lltv', type: 'uint256' },
    ]
    const MORPHO_TEST_ABI = [
      { name: 'supply', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'marketParams', type: 'tuple', components: MP }, { name: 'assets', type: 'uint256' }, { name: 'shares', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [] },
      { name: 'withdraw', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'marketParams', type: 'tuple', components: MP }, { name: 'assets', type: 'uint256' }, { name: 'shares', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'receiver', type: 'address' }], outputs: [] },
      { name: 'supplyCollateral', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'marketParams', type: 'tuple', components: MP }, { name: 'assets', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [] },
      { name: 'withdrawCollateral', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'marketParams', type: 'tuple', components: MP }, { name: 'assets', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'receiver', type: 'address' }], outputs: [] },
      { name: 'borrow', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'marketParams', type: 'tuple', components: MP }, { name: 'assets', type: 'uint256' }, { name: 'shares', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'receiver', type: 'address' }], outputs: [] },
      { name: 'repay', type: 'function', stateMutability: 'nonpayable', inputs: [{ name: 'marketParams', type: 'tuple', components: MP }, { name: 'assets', type: 'uint256' }, { name: 'shares', type: 'uint256' }, { name: 'onBehalf', type: 'address' }, { name: 'data', type: 'bytes' }], outputs: [] },
    ] as const
    const tuple = { loanToken: LOAN, collateralToken: COLL, oracle: ORACLE, irm: IRM, lltv: LLTV } as const
    const atoms = BigInt(1000000)
    const enc = (fn: string, args: unknown[]) => encodeFunctionData({ abi: MORPHO_TEST_ABI, functionName: fn as 'supply', args: args as never })
    const mstep = (to: string, data: string, label = 'op') => ({ action: 'send_transaction', label, summary: label, tx: { to, data, value: '0', chainId: 8453 } })
    const mexp = (op: MorphoOpGuardExpectation['op'], amount: MorphoOpGuardExpectation['amount']): MorphoOpGuardExpectation =>
      ({ op, chainId: 8453, amount, params: tuple, morpho: MORPHO_SINGLETON, user: USER })
    /** Tamper one 32-byte word of viem-encoded calldata by index. */
    const tamper = (data: string, word: number, hex64: string) => {
      const head = 2 + 8 + word * 64
      return data.slice(0, head) + hex64 + data.slice(head + 64)
    }
    const addrWord = (a: string) => a.toLowerCase().replace(/^0x/, '').padStart(64, '0')

    const lendData = enc('supply', [tuple, atoms, BigInt(0), USER, '0x'])
    const approveData = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [MORPHO_SINGLETON as `0x${string}`, atoms] })
    const lendExp = mexp('lend', { kind: 'exact', atoms })
    check('morpho guard: correct approve→lend PASSES', (() => { const g = guardMorphoOpBuild({ operation: 'lend', steps: [mstep(LOAN, approveData, 'approve'), mstep(MORPHO_SINGLETON, lendData, 'lend')] }, lendExp); return g.ok && g.steps?.length === 2 })())
    check('morpho guard: no-approve single-step lend PASSES', guardMorphoOpBuild({ operation: 'lend', steps: [mstep(MORPHO_SINGLETON, lendData, 'lend')] }, lendExp).ok)
    // EVERY tuple word binds — a single swapped word is a different market.
    const tupleTampers: Array<[string, string]> = [
      ['loanToken', addrWord(EVIL)], ['collateralToken', addrWord(EVIL)], ['oracle', addrWord(EVIL)],
      ['irm', addrWord(EVIL)], ['lltv', (LLTV + BigInt(1)).toString(16).padStart(64, '0')],
    ]
    check(
      'morpho guard: EVERY tampered tuple word refuses (loan/collateral/oracle/irm/lltv)',
      tupleTampers.every(([, hex], i) => !guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, tamper(lendData, i, hex), 'lend')] }, lendExp).ok),
    )
    check('morpho guard: tampered onBehalf refuses', !guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, tamper(lendData, 7, addrWord(EVIL)), 'lend')] }, lendExp).ok)
    check('morpho guard: wrong amount refuses', !guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, enc('supply', [tuple, atoms * BigInt(2), BigInt(0), USER, '0x']), 'lend')] }, lendExp).ok)
    check('morpho guard: a non-empty callback payload refuses', !guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, enc('supply', [tuple, atoms, BigInt(0), USER, '0xdeadbeef']), 'lend')] }, lendExp).ok)
    check('morpho guard: wrong chain refuses', !guardMorphoOpBuild({ steps: [{ ...mstep(MORPHO_SINGLETON, lendData, 'lend'), tx: { to: MORPHO_SINGLETON, data: lendData, value: '0', chainId: 1 } }] }, lendExp).ok)
    check('morpho guard: native value refuses', !guardMorphoOpBuild({ steps: [{ ...mstep(MORPHO_SINGLETON, lendData, 'lend'), tx: { to: MORPHO_SINGLETON, data: lendData, value: '1', chainId: 8453 } }] }, lendExp).ok)
    check('morpho guard: a non-singleton target refuses', !guardMorphoOpBuild({ steps: [mstep(USER, lendData, 'lend')] }, lendExp).ok)
    const evilApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [EVIL as `0x${string}`, atoms] })
    check('morpho guard: approval to a non-Morpho spender refuses', !guardMorphoOpBuild({ steps: [mstep(LOAN, evilApprove, 'approve'), mstep(MORPHO_SINGLETON, lendData, 'lend')] }, lendExp).ok)
    check('morpho guard: approval on the WRONG token contract refuses', !guardMorphoOpBuild({ steps: [mstep(COLL, approveData, 'approve'), mstep(MORPHO_SINGLETON, lendData, 'lend')] }, lendExp).ok)
    const bigApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [MORPHO_SINGLETON as `0x${string}`, atoms * BigInt(2)] })
    check('morpho guard: an OVER-approve refuses (exact means exact)', !guardMorphoOpBuild({ steps: [mstep(LOAN, bigApprove, 'approve'), mstep(MORPHO_SINGLETON, lendData, 'lend')] }, lendExp).ok)

    // Cross-op smuggling: pinned selector per op.
    const borrowData = enc('borrow', [tuple, atoms, BigInt(0), USER, USER])
    check('morpho guard: cross-op calldata (borrow sel on a withdraw) refuses', !guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, borrowData, 'withdraw')] }, mexp('withdraw', { kind: 'exact', atoms })).ok)
    check('morpho guard: correct borrow PASSES', guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, borrowData, 'borrow')] }, mexp('borrow', { kind: 'exact', atoms })).ok)
    check('morpho guard: borrow receiver tampered refuses', !guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, tamper(borrowData, 8, addrWord(EVIL)), 'borrow')] }, mexp('borrow', { kind: 'exact', atoms })).ok)
    const withdrawData = enc('withdraw', [tuple, atoms, BigInt(0), USER, USER])
    check('morpho guard: a withdraw growing an approve step refuses', !guardMorphoOpBuild({ steps: [mstep(LOAN, approveData, 'approve'), mstep(MORPHO_SINGLETON, withdrawData, 'withdraw')] }, mexp('withdraw', { kind: 'exact', atoms })).ok)

    // Shares-mode: assets 0 + shares set — ONLY for max repay/withdraw.
    const debt = BigInt(92899677)
    const shares = BigInt('123456789012345')
    const repayMaxData = enc('repay', [tuple, BigInt(0), shares, USER, '0x'])
    const bufferedApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [MORPHO_SINGLETON as `0x${string}`, debt + debt / BigInt(2000) + BigInt(1)] })
    const repayMaxExp = mexp('repay', { kind: 'max-shares', anchorAtoms: debt })
    check('morpho guard: shares-mode max repay w/ buffered approve PASSES', guardMorphoOpBuild({ steps: [mstep(LOAN, bufferedApprove, 'approve'), mstep(MORPHO_SINGLETON, repayMaxData, 'repay')] }, repayMaxExp).ok)
    check('morpho guard: max repay with assets != 0 refuses', !guardMorphoOpBuild({ steps: [mstep(LOAN, bufferedApprove, 'approve'), mstep(MORPHO_SINGLETON, enc('repay', [tuple, debt, shares, USER, '0x']), 'repay')] }, repayMaxExp).ok)
    check('morpho guard: exact repay that is shares-denominated refuses', !guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, repayMaxData, 'repay')] }, mexp('repay', { kind: 'exact', atoms: debt })).ok)
    check('morpho guard: shares-mode on a NON-maxable op (lend) refuses', !guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, enc('supply', [tuple, BigInt(0), shares, USER, '0x']), 'lend')] }, mexp('lend', { kind: 'max-shares', anchorAtoms: atoms })).ok)
    const overApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [MORPHO_SINGLETON as `0x${string}`, debt + debt / BigInt(50)] })
    check('morpho guard: repay-max approve outside the 0.2% window refuses', !guardMorphoOpBuild({ steps: [mstep(LOAN, overApprove, 'approve'), mstep(MORPHO_SINGLETON, repayMaxData, 'repay')] }, repayMaxExp).ok)
    const underApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [MORPHO_SINGLETON as `0x${string}`, debt - BigInt(1)] })
    check('morpho guard: repay-max approve UNDER the anchored debt refuses', !guardMorphoOpBuild({ steps: [mstep(LOAN, underApprove, 'approve'), mstep(MORPHO_SINGLETON, repayMaxData, 'repay')] }, repayMaxExp).ok)
    check('morpho guard: shares-mode max withdraw PASSES (no approve)', guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, enc('withdraw', [tuple, BigInt(0), shares, USER, USER]), 'withdraw')] }, mexp('withdraw', { kind: 'max-shares', anchorAtoms: atoms })).ok)
    // Collateral ops: asset-exact always; approve targets the COLLATERAL token.
    const scData = enc('supplyCollateral', [tuple, atoms, USER, '0x'])
    const collApprove = encodeFunctionData({ abi: erc20Abi, functionName: 'approve', args: [MORPHO_SINGLETON as `0x${string}`, atoms] })
    check('morpho guard: approve→supplyCollateral PASSES (collateral-token approve)', guardMorphoOpBuild({ steps: [mstep(COLL, collApprove, 'approve'), mstep(MORPHO_SINGLETON, scData, 'post')] }, mexp('supply-collateral', { kind: 'exact', atoms })).ok)
    check('morpho guard: supplyCollateral approve on the LOAN token refuses', !guardMorphoOpBuild({ steps: [mstep(LOAN, collApprove, 'approve'), mstep(MORPHO_SINGLETON, scData, 'post')] }, mexp('supply-collateral', { kind: 'exact', atoms })).ok)
    const wcData = enc('withdrawCollateral', [tuple, atoms, USER, USER])
    check('morpho guard: correct withdrawCollateral PASSES', guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, wcData, 'withdraw collateral')] }, mexp('withdraw-collateral', { kind: 'exact', atoms })).ok)
    check('morpho guard: withdrawCollateral receiver tampered refuses', !guardMorphoOpBuild({ steps: [mstep(MORPHO_SINGLETON, tamper(wcData, 7, addrWord(EVIL)), 'withdraw collateral')] }, mexp('withdraw-collateral', { kind: 'exact', atoms })).ok)

    // Pickers over the agent's own tool-result shapes.
    const M1 = `0x${'11'.repeat(32)}`
    const M2 = `0x${'22'.repeat(32)}`
    const marketRows = [
      { marketId: M1, curated: true, loan: 'USDC', collateral: 'cbBTC', totalSupplyUsd: 1_440_000_000 },
      { marketId: M2, curated: true, loan: 'USDC', collateral: 'WETH', totalSupplyUsd: 78_000_000 },
      { marketId: `0x${'33'.repeat(32)}`, curated: false, loan: 'DAI', collateral: 'WETH' },
    ]
    check('morpho pick: lend takes the first (deepest) curated loan match', pickLendMarket(marketRows, 'usdc')?.marketId === M1)
    check('morpho pick: uncurated markets never picked', pickLendMarket(marketRows, 'DAI') === null)
    check('morpho pick: collateral market prefers the user’s existing market', pickCollateralMarket(marketRows, 'WETH', [M2])?.marketId === M2 && pickCollateralMarket(marketRows, 'cbBTC', [])?.marketId === M1)
    const posRows = [
      { marketId: M1, market: 'USDC / cbBTC (lltv 86.0%)', borrowed: { amount: '150', asset: 'USDC' }, collateral: { amount: '0.01', asset: 'cbBTC' }, borrowingPower: { remaining: '400', asset: 'USDC' } },
      { marketId: M2, market: 'USDC / WETH (lltv 86.0%)', supplied: { amount: '1200', asset: 'USDC' }, borrowed: { amount: '90', asset: 'USDC' } },
    ]
    check('morpho pick: repay anchors to the LARGEST debt market', pickDebtPosition(posRows, 'USDC')?.marketId === M1)
    check('morpho pick: withdraw anchors to the supplied market', pickSuppliedPosition(posRows, 'USDC')?.marketId === M2 && pickSuppliedPosition(posRows, 'WETH') === null)
    check('morpho pick: borrow needs collateral + the loan-asset match', pickBorrowPosition(posRows, 'USDC')?.marketId === M1 && pickBorrowPosition(posRows, 'WETH') === null)

    // Follow-ups.
    const mpend = { kind: 'morpho-lend', data: { amount: '100', token: 'USDC', market: 'USDC / cbBTC', chainId: '8453' } }
    check('morpho follow-up: "cancel" drops it', parseMorphoLendFollowUp('cancel', mpend)?.kind === 'cancel')
    check('morpho follow-up: "yes" is a noop (card already there)', parseMorphoLendFollowUp('yes', mpend)?.kind === 'noop')
    const mamend = parseMorphoLendFollowUp('make it 250', mpend)
    check('morpho follow-up: "make it 250" re-amount keeps token + chain', mamend?.kind === 'amend' && mamend.params.amount === '250' && mamend.params.token === 'USDC' && mamend.params.chainId === 8453)
    const opend = { kind: 'morpho-repay', data: { op: 'repay', amount: '25', token: 'USDC', market: 'USDC / cbBTC', chainId: '1' } }
    const oamend = parseMorphoOpFollowUp('make it 40', opend)
    check('morpho ops follow-up: amend keeps op + chainId', oamend?.kind === 'amend' && oamend.params.op === 'repay' && oamend.params.amount === '40' && oamend.params.chainId === 1)
    check('morpho ops follow-up: aave pending is not ours', parseMorphoOpFollowUp('cancel', { kind: 'aave-repay', data: {} }) === null)

    // Jobs: explicit-venue segments compile; lone/weak asks never do.
    const mjob = compileJobAsk('lend 100 USDC on morpho on ethereum, then repay 50 USDC on morpho')
    check(
      'morpho jobs: explicit lend→repay compiles with per-segment chains',
      !!mjob && !('problem' in mjob) && mjob.steps.length === 2 &&
        mjob.steps[0].builder === 'native-morpho-lend' && (mjob.steps[0].params as { chainId?: number }).chainId === 1 &&
        mjob.steps[1].builder === 'native-morpho-repay' && (mjob.steps[1].params as { chainId?: number }).chainId === 8453,
      mjob && !('problem' in mjob) ? mjob.steps.map((s) => `${s.kind}:${s.builder}`).join(',') : JSON.stringify(mjob),
    )
    check('morpho jobs: a LONE lend is not a job (native layer owns it)', compileJobAsk('lend 100 USDC on morpho') === null)
    const mweak = compileJobAsk('swap 1 USDC for WETH on base, then lend 5 USDC')
    check('morpho jobs: a venue-less lend segment never compiles as Morpho', !!mweak && 'problem' in mweak && /step 2/i.test(mweak.problem))

    // The door: a full grammar match without the agent answers the add-the-
    // dapp deep link (prefill, never auto-send) — never the planner.
    const morphoDoor = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ message: 'lend 20 USDC on morpho', activeServers: [] }),
    }).then((r) => r.json())
    check(
      'morpho door: a lone lend without the agent deep-links the add with the ask ready',
      typeof morphoDoor.reply === 'string' && morphoDoor.reply.includes('Add Morpho with this ask ready](/chat?mcps=morpho-free&prompt='),
      JSON.stringify(morphoDoor).slice(0, 220),
    )
    const morphoLadder = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ message: 'Swap 0.1 ETH from Base to ETH on Ethereum, then lend 5 USDC on morpho', activeServers: [] }),
    }).then((r) => r.json())
    check(
      'morpho ladder: a compound ask reaches the jobs gate BEFORE the Morpho door steals it',
      typeof morphoLadder.reply === 'string' && /chains multiple money steps/i.test(morphoLadder.reply) && !/Add Morpho with this ask ready/.test(morphoLadder.reply),
      JSON.stringify(morphoLadder).slice(0, 220),
    )
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
      // Pantessa's real appData hash — the app-data guard block-refuses
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
  // Two-doc family (C2b): base tier + link tier are the ONLY canonical
  // docs; the tier reads back from the signed hash and foreign docs are
  // nobody's — the guard/relay membership pin rests on exactly this.
  check(
    'cow: appData is a two-doc family — link tier canonical, tier reads back from the hash, foreign hashes refuse',
    cowAppDataJson(LINK_SWAP_FEE_BPS).includes(`"bps":${LINK_SWAP_FEE_BPS}`) &&
      COW_CANONICAL_APP_DATA_HASHES.has(cowAppDataHash(LINK_SWAP_FEE_BPS).toLowerCase()) &&
      COW_CANONICAL_APP_DATA_HASHES.has(COW_APP_DATA_HASH.toLowerCase()) &&
      cowAppDataBpsOf(cowAppDataHash(LINK_SWAP_FEE_BPS)) === LINK_SWAP_FEE_BPS &&
      cowAppDataBpsOf(COW_APP_DATA_HASH) === SWAP_FEE_BPS &&
      cowAppDataBpsOf(`0x${'ee'.repeat(32)}`) === null &&
      LINK_SWAP_FEE_BPS === 50,
  )
  check(
    'cow: limit order builds on the link tier when asked',
    buildCowLimitOrder({ sellToken: 'WETH', buyToken: 'USDC', sellAmount: '500000000000000000', buyAmountAtLeast: '1750000000', from: '0x1111111111111111111111111111111111111111', feeBps: LINK_SWAP_FEE_BPS }).order.appData ===
      cowAppDataHash(LINK_SWAP_FEE_BPS),
  )
  // C2b closes over JOBS (#608 follow-up): a link-priced turn's compiled
  // swaps carry the tier its one-shot would — stamped into swap-building
  // steps only (native-swap + the funded-buy native-lifi-swap), everything
  // else untouched, and a tier-less compile is the SAME object (no-op).
  {
    const SWAP_STAMP_BUILDERS = new Set(['native-swap', 'native-lifi-swap'])
    const mixed = compileJobAskFull('swap 5 USDC from base to arbitrum, then swap 3 USDC for ETH on arbitrum')
    const ok = mixed && !('problem' in mixed) && !('clarify' in mixed)
    const stamped = ok ? stampSwapFeeTier(mixed, LINK_SWAP_FEE_BPS) : null
    const swapSteps = stamped ? stamped.steps.filter((s) => SWAP_STAMP_BUILDERS.has(s.builder)) : []
    const otherSteps = stamped ? stamped.steps.filter((s) => !SWAP_STAMP_BUILDERS.has(s.builder)) : []
    check(
      'jobs fee tier: stampSwapFeeTier stamps swap-building steps only; no tier → the same compiled object',
      !!stamped &&
        swapSteps.length === 1 &&
        swapSteps.every((s) => (s.params as { feeBps?: number }).feeBps === LINK_SWAP_FEE_BPS) &&
        otherSteps.length > 0 &&
        otherSteps.every((s) => (s.params as { feeBps?: number }).feeBps === undefined) &&
        (ok ? stampSwapFeeTier(mixed, undefined) === mixed : false),
    )
    // The funded stock buy is link GTM's flagship path — its buy step now
    // builds through the shared venue cascade (the pinned-LiFi fill reverted
    // live under its own quote, 2026-08-12) and must carry the link tier the
    // one-shot would, so the creator's kickback survives the funding detour.
    const funded = compileJobAskFull('Fund robinhood chain with $12 from base including gas, then buy $10 of AAPL')
    const fundedOk = funded && !('problem' in funded) && !('clarify' in funded)
    const fundedStamped = fundedOk ? stampSwapFeeTier(funded, LINK_SWAP_FEE_BPS) : null
    check(
      'jobs fee tier: the funded-buy (native-lifi-swap) step takes the link stamp; funding legs stay unstamped',
      !!fundedStamped &&
        fundedStamped.steps.filter((s) => s.builder === 'native-lifi-swap').length === 1 &&
        fundedStamped.steps.every((s) =>
          s.builder === 'native-lifi-swap'
            ? (s.params as { feeBps?: number }).feeBps === LINK_SWAP_FEE_BPS
            : (s.params as { feeBps?: number }).feeBps === undefined,
        ),
    )
  }
  // The live seam: a compound swap ask carrying a live link slug compiles a
  // job whose native-swap steps carry the LINK tier in their stored params;
  // the same ask organic stays unstamped. House slug 'dca-eth' is the
  // always-live fixture (seeded, never revoked). Jobs are canceled after —
  // the fixture wallet is the 0x1111… test constant, nobody's rail.
  {
    const W = '0x1111111111111111111111111111111111111111'
    const mkJob = (withSlug: boolean) =>
      fetch(`${BASE}/api/chat`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
        body: JSON.stringify({
          message: 'swap 5 USDC for ETH on base, then swap 3 USDC for ETH on base',
          activeServers: [],
          walletAddress: W,
          ...(withSlug ? { intentLinkSlug: 'dca-eth' } : {}),
        }),
      }).then((r) => r.json() as Promise<{ jobId?: string; jobToken?: string }>)
    const readSteps = async (j: { jobId?: string; jobToken?: string }) => {
      if (!j.jobId) return null
      const t = encodeURIComponent(j.jobToken ?? '')
      const res = (await (await fetch(`${BASE}/api/jobs/${j.jobId}?t=${t}`)).json()) as {
        job?: { steps?: { builder: string; params?: { feeBps?: unknown } }[] }
      }
      await fetch(`${BASE}/api/jobs/${j.jobId}?t=${t}`, { method: 'DELETE' }).catch(() => {})
      return res.job?.steps ?? null
    }
    const linked = await readSteps(await mkJob(true))
    const organic = await readSteps(await mkJob(false))
    const linkedSwaps = (linked ?? []).filter((s) => s.builder === 'native-swap')
    check(
      'jobs fee tier: a link-slug turn stores native-swap steps at the LINK tier; the organic twin stays unstamped',
      linkedSwaps.length === 2 &&
        linkedSwaps.every((s) => Number(s.params?.feeBps) === LINK_SWAP_FEE_BPS) &&
        !!organic &&
        organic.filter((s) => s.builder === 'native-swap').every((s) => s.params?.feeBps === undefined),
      JSON.stringify({ linked: linked?.map((s) => s.params?.feeBps), organic: organic?.map((s) => s.params?.feeBps) }),
    )
  }
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
  // Polygon: a real chain we deliberately do NOT build on. Asserted against
  // the registry so this can't silently become a supported id (chainId 10 did
  // exactly that when Optimism landed).
  const OFF_REGISTRY_CHAIN_ID = 137
  check('planner guard: the off-registry fixture chain really is off-registry', chainById(OFF_REGISTRY_CHAIN_ID) === null)
  const offRegistryChain = mkTx({ to: mallory.address, data: '0x12345678' + 'ab'.repeat(64), value: '0', chainId: OFF_REGISTRY_CHAIN_ID })
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
  // Buy-led limits (live 2026-08-03: "place a limit order to buy 1 UNI for 4
  // USDC on base" matched neither the sell-led grammar nor the clarify, fell
  // to the planner, and got Uniswap/CoW/1inch recommended BY NAME). The
  // operands INVERT — the amount named first is what you RECEIVE.
  const lb = parseSwapIntent('place a limit order to buy 1 UNI for 4 USDC on base')
  check(
    'swap intent: buy-led limit inverts the operands (spend 4 USDC, receive ≥1 UNI)',
    lb.isSwap && lb.mode === 'limit' && !lb.problem && lb.sellAmountHuman === '4' && lb.sellToken === 'USDC' && lb.buyAmountAtLeastHuman === '1' && lb.buyToken === 'UNI',
  )
  const ls = parseSwapIntent('limit sell 5 USDC for 2 UNI on base')
  check(
    'swap intent: the sell-led operand order is unchanged (spend 5 USDC, receive ≥2 UNI)',
    ls.isSwap && ls.mode === 'limit' && !ls.problem && ls.sellAmountHuman === '5' && ls.sellToken === 'USDC' && ls.buyAmountAtLeastHuman === '2' && ls.buyToken === 'UNI',
  )
  const lb2 = parseSwapIntent('limit order: buy 2 WETH for at most 6000 USDC')
  check(
    'swap intent: "at most" buy-side ceiling parses',
    lb2.mode === 'limit' && lb2.sellAmountHuman === '6000' && lb2.sellToken === 'USDC' && lb2.buyAmountAtLeastHuman === '2',
  )
  check(
    'swap intent: "with"/"using" buy-side connectors parse',
    parseSwapIntent('limit buy 1 UNI with 4 USDC').sellAmountHuman === '4' && parseSwapIntent('limit buy 1 UNI using 4 USDC').sellToken === 'USDC',
  )
  // A bare "at" on the buy side reads as a PER-UNIT price while the sell-led
  // convention is TOTAL — never claimed, always clarified.
  const lat = parseSwapIntent('limit buy 10 UNI at 3 USDC')
  check('swap intent: per-unit-sounding "buy N at P" clarifies instead of resting a 10× -smaller order', lat.isSwap && lat.mode === undefined && !!lat.problem)
  // No buy-led limit reaches the planner: an unparsed one still clarifies.
  const lc = parseSwapIntent('limit order to buy 5 shares of AAPL')
  check('swap intent: unparsed buy-led limit clarifies (never the planner)', lc.isSwap && !!lc.problem)
  check(
    'swap intent: the limit clarify names BOTH operand orders, and both round-trip',
    lc.problem!.includes(LIMIT_EXAMPLES[0]) &&
      lc.problem!.includes(LIMIT_EXAMPLES[1]) &&
      LIMIT_EXAMPLES.every((ex) => {
        const r = parseSwapIntent(`limit order: ${ex}`)
        return r.isSwap && r.mode === 'limit' && !r.problem && !!r.sellAmountHuman && !!r.sellToken && !!r.buyAmountAtLeastHuman && !!r.buyToken
      }),
  )
  // The buy-inclusive clarify is LIMIT-ONLY — widening the general fallback
  // would claim buys that belong to other layers.
  check(
    'swap intent: "buy" in the clarify fallback stays scoped to limit asks',
    parseSwapIntent('buy $12 of ETH on hyperliquid').isSwap === false && parseSwapIntent('buy AAPL with 500 USDG on robinhood').isSwap === false,
  )
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
  check(
    'nft transfer turn: the held question stamps `awaiting` and classifies as an answer, not a wall',
    nftXferOpen.awaiting === 'recipient' && classifyTurn(nftXferOpen).kind === null,
    JSON.stringify({ awaiting: nftXferOpen.awaiting }),
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
  // Brand marks: the first-party `yeetful-tool-*` internal MCPs carry Pantessa's
  // own mark (rail + server pages), while `yeetful-claude` KEEPS its Anthropic
  // icon (resolved via ICON_SLUG, not a protocol mark). getProtocolMark is the
  // step-1 winner in BrandIcon, so this is what decides which glyph shows.
  check(
    'brand mark: yeetful-tool-* MCPs resolve to the Pantessa mark',
    getProtocolMark(undefined, 'yeetful-tool-wallet', 'yeetful-tool-wallet', 'Pantessa Wallet') === YeetfulMark &&
      getProtocolMark(undefined, 'yeetful-tool-funding', 'yeetful-tool-funding', 'Pantessa Funding Planner') === YeetfulMark,
  )
  check(
    'brand mark: yeetful-claude is NOT captured (keeps its Anthropic icon)',
    getProtocolMark('anthropic', 'yeetful-claude', 'yeetful-claude', 'Yeetful · Claude') === null,
  )
  // Morpho: the seeded row (`morpho-free` / "Morpho (Free)") and the
  // `morpho` venue label on /activity all resolve to the vendored wing mark
  // instead of an Archivo "M" lettermark.
  check(
    'brand mark: morpho resolves to the vendored mark on every identifier',
    getProtocolMark(undefined, 'morpho-free', 'morpho-free', 'Morpho (Free)') === MorphoMark &&
      getProtocolMark('morpho') === MorphoMark &&
      getProtocolMark(undefined, undefined, undefined, 'Morpho') === MorphoMark,
  )
  // og-marks mirrors the registry by hand — a mark that renders in the rail
  // but not on a share card is the drift this pins.
  const ogMorpho = ogMarkSvg('morpho-free Morpho (Free)', '#fff', 44)
  check(
    'og mark: morpho mirrors the vendored mark (4 wing paths, aspect kept)',
    !!ogMorpho && (ogMorpho.match(/<path/g) ?? []).length === 4 && ogMorpho.includes('viewBox="0 0 22 20"') && ogMorpho.includes('height="40"'),
  )
  // The Emerald Cut is the house mark on EVERY share card. It used to be
  // copied inline per card, which is how five cards kept shipping the retired
  // hub glyph after the rebrand — these pin the one source and the re-inking.
  const gemHouse = gemMarkSvg()
  const gemBrand = gemMarkSvg('#ff4198')
  const gemStrip = (svg: string) => svg.replace(/ fill="[^"]*"/g, '').replace(/ fill-opacity="[^"]*"/g, '')
  check(
    'gem mark: satori-safe (self-contained svg, no external refs)',
    gemHouse.startsWith('<svg') &&
      gemHouse.includes('viewBox="0 0 128 128"') &&
      !/<image|xlink:href/.test(gemHouse) &&
      !/https?:\/\/(?!www\.w3\.org)/.test(gemHouse),
  )
  check(
    'gem mark: an accent re-inks the WHOLE facet ramp via fill-opacity steps; the house form keeps the emerald tones',
    gemHouse.includes('#159B68') &&
      gemHouse.includes('#3ECF8E') &&
      !gemHouse.includes('fill-opacity') &&
      (gemBrand.match(/<path[^>]*fill="#ff4198"/g) ?? []).length === 2 &&
      gemBrand.includes('fill-opacity="0.72"') &&
      !gemBrand.includes('#3ECF8E') &&
      gemStrip(gemHouse) === gemStrip(gemBrand),
  )
  // Drift guard: a card that re-inlines its own mark silently stops tracking
  // the brand. Every OG card must import the shared helper and hold no glyph.
  const ogFs = await import('node:fs')
  const ogCards = [
    'app/opengraph-image.tsx',
    'app/chat/opengraph-image.tsx',
    'app/i/[slug]/opengraph-image.tsx',
    'app/l/[handle]/opengraph-image.tsx',
    'app/p/[slug]/opengraph-image.tsx',
    'app/r/[slug]/opengraph-image.tsx',
    'app/agents/[handle]/opengraph-image.tsx',
  ].map((f) => ({ f, src: ogFs.readFileSync(f, 'utf8') }))
  check(
    'og cards: all seven draw the house mark from lib/og-marks, none inline one',
    ogCards.every((c) => c.src.includes('gemMarkSvg')) &&
      ogCards.every((c) => !c.src.includes('mask id="hub"')),
  )
  // The /i unfurl is the first thing a DM'd stranger sees (the H1 drill).
  // GTM's stranger-eye read: say WHOSE ("FROM @HANDLE", never a "CALL BY"
  // trade-tip), never hint auto-run ("TAP TO RUN" → "YOUR WALLET SIGNS"),
  // and state non-custodial in words once. Pinned on the source — the
  // PNG can't be grepped.
  const iCard = ogCards.find((c) => c.f.startsWith('app/i/'))!.src
  check(
    'og /i card: eyebrow says FROM @HANDLE + YOUR WALLET SIGNS, non-custodial stated in words, no TAP TO RUN',
    iCard.includes('FROM @${handle.toUpperCase()') &&
      iCard.includes("'INTENT LINK · YOUR WALLET SIGNS'") &&
      iCard.includes('Nothing moves until you sign — in your own wallet.') &&
      !iCard.includes('TAP TO RUN') &&
      !iCard.includes("'CALL · TAP TO RUN'"),
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
  // swap building is Pantessa's own tool, not gated on CoW being active).
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
  // Curated-beats-dynamic (C6 squat fix, live 2026-07-30): a token squatting
  // a real stock ticker on a PERMISSIONLESS target-chain list must never
  // hijack the stock ask off Robinhood Chain — "Buy $10 of AAPL" routes to
  // the stock path (build or funding cascade), never a dead target-chain
  // quote. Live check against the real Base list (where the squat exists).
  const stockSquat = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
    body: JSON.stringify({ message: 'Buy $10 of AAPL', activeServers: [], walletAddress: owner.address }),
  }).then((r) => r.json())
  check(
    'native swap: stock ticker squatted on Base still routes to the stock path',
    typeof stockSquat.reply === 'string' && !/Couldn't build the swap/i.test(stockSquat.reply) && /robinhood|usdg|usdc|bridge|holding/i.test(stockSquat.reply),
    JSON.stringify(stockSquat.reply ?? '').slice(0, 200),
  )
  // C2b: a refresh recipe carrying a NON-canonical fee tier is not ours —
  // the rebuild refuses instead of silently repricing the signed chain.
  const refreshBadTier = await fetch(`${BASE}/api/tx/refresh`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ kind: 'uniswap-swap', from: owner.address, sellToken: 'USDC', buyToken: 'WETH', amountHuman: '1', chainId: '8453', feeBps: '37' }),
  })
  const refreshBadTierBody = (await refreshBadTier.json().catch(() => ({}))) as { error?: string }
  check(
    'tx refresh: non-canonical fee tier refused (400) — re-quotes keep the tier they signed',
    refreshBadTier.status === 400 && /unknown fee tier/i.test(refreshBadTierBody.error ?? ''),
    JSON.stringify(refreshBadTierBody),
  )
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
  const shellRow = { slug: 'near-intents-mcp-yeetful', name: 'NEAR Intents MCP · Pantessa', description: null, endpoint: null }
  const seededRow = { slug: 'near-intents-free', name: 'NEAR Intents (Free)', description: 'Cross-chain swaps…', endpoint: 'https://near-intents.yeetful.com/mcp' }
  check('cross-chain agent: shell row detected but NOT usable', (() => { const r = crossChainAgentOf([shellRow]); return r.agent === shellRow && r.usable === false })())
  check('cross-chain agent: seeded row usable', (() => { const r = crossChainAgentOf([seededRow]); return r.agent === seededRow && r.usable === true })())
  check('cross-chain agent: none in set', crossChainAgentOf([{ slug: 'uniswap-free', name: 'Uniswap (Free)', description: null, endpoint: 'https://uniswap-mcp.yeetful.com/mcp' }]).agent === undefined)

  // ── Chain registry + picker (lib/chains) ──────────────────────────────────
  // The registry is the single source of truth for the picker, splash scoping,
  // and per-chain swap builds — every entry must be complete enough to build.
  check('chains: registry carries base/ethereum/arbitrum/optimism/robinhood', JSON.stringify(APP_CHAINS.map((c) => c.key).sort()) === '["arbitrum","base","ethereum","optimism","robinhood"]')
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
    // Term-aware dupes (live 2026-07-30: asking for the EXACT stop already
    // armed got "pause or remove it first" — a wall on a satisfied intent).
    const sameTerms = { triggerMode: 'price_move_pct' as const, triggerValue: 10 }
    const dupeSame = planForExistingPolicy('active', 'stop_loss', 'SYRUP', sameTerms, sameTerms)
    const dupeConflict = planForExistingPolicy('active', 'stop_loss', 'SYRUP', sameTerms, { triggerMode: 'price_move_pct', triggerValue: 5 })
    const dupeModeSwap = planForExistingPolicy('active', 'stop_loss', 'SYRUP', sameTerms, { triggerMode: 'price', triggerValue: 10 })
    check(
      'guardian: active dupe with the SAME terms AFFIRMS; a conflict names both sets of terms',
      dupeSame.action === 'affirm' &&
        dupeConflict.action === 'refuse' && /closes 10% against you from entry/.test(dupeConflict.message) && /re-arm 5% against you from entry instead/.test(dupeConflict.message) &&
        dupeModeSwap.action === 'refuse' && /re-arm when the mark crosses 10 instead/.test(dupeModeSwap.message),
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

    // ── Bare-"and" intents (the #595 drop through a different connector) ────
    // Two intents joined by "and" once compiled to NOTHING and fell to the
    // single-venue gates, where the first parser to match its own clause
    // claimed the turn and the other intent vanished. The speculative split
    // is accepted ONLY when every piece parses cleanly on its own.
    const andTwo = compileJobAsk('lend 100 USDC on morpho and stake 0.5 ETH on lido')
    const andTwoRev = compileJobAsk('stake 0.5 ETH on lido and lend 100 USDC on morpho')
    check(
      'jobs and-split: two venue intents joined by "and" compile as ONE job (either order)',
      !!andTwo && !('problem' in andTwo) && !('clarify' in andTwo) && andTwo.steps.length === 2 &&
        !!andTwoRev && !('problem' in andTwoRev) && !('clarify' in andTwoRev) && andTwoRev.steps.length === 2,
      JSON.stringify({ andTwo, andTwoRev }).slice(0, 200),
    )
    // Every connector below was probed and reproduced the same silent drop.
    // Symbolic ones require surrounding whitespace so nothing inside a value
    // is ever cut — the decimal/pair guards two checks down prove it.
    const CONNECTORS = [' plus ', ' also ', ' & ', ' + ', ' / ', ' followed by ', ' after that ', '. ', ', ', '\n']
    const connectorMisses = CONNECTORS.filter((c) => {
      const r = compileJobAsk(`lend 100 USDC on morpho${c}stake 0.5 ETH on lido`)
      return !r || 'problem' in r || 'clarify' in r || r.steps.length !== 2
    })
    check(
      'jobs compound-split: every connector (plus/also/&/+//"/followed by/after that/./,/newline) compiles both intents',
      connectorMisses.length === 0,
      `missed: ${JSON.stringify(connectorMisses)}`,
    )
    const andMixed = compileJobAsk('bridge 5 USDC from base to arbitrum and lend 100 USDC on morpho')
    check(
      'jobs and-split: a bridge + venue intent chains (bridge legs keep their wait)',
      !!andMixed && !('problem' in andMixed) && !('clarify' in andMixed) && andMixed.steps.length === 3,
      JSON.stringify(andMixed).slice(0, 160),
    )
    // The conservatism IS the safety: shapes where "and" lives INSIDE one
    // intent must be left whole, because at least one piece won't parse.
    const sendToProbe = '0x6F93fa8B383E51D59DDfC87988AFC964d6ffb5Da'
    const andMultiSend = compileJobAsk(`send all my USDC on arbitrum and an additional 5 USDC on base to ${sendToProbe}`)
    check(
      'jobs and-split: a multi-clause send sharing one recipient stays ONE segment',
      !!andMultiSend && !('problem' in andMultiSend) && !('clarify' in andMultiSend) && andMultiSend.steps.length === 2 &&
        andMultiSend.steps.every((s) => s.builder === 'native-transfer'),
      JSON.stringify(andMultiSend).slice(0, 200),
    )
    check(
      'jobs and-split: unparseable halves reject the split (lone asks still fall to the native layers)',
      compileJobAsk('buy $10 of AAPL and $10 of TSLA') === null &&
        compileJobAsk('lend 100 USDC on morpho') === null &&
        compileJobAsk('stake 0.05 eth on lido') === null,
    )
    // The whitespace requirement on symbolic connectors: a decimal amount, a
    // market pair, and a percentage must never be cut mid-value.
    check(
      'jobs compound-split: decimals, token pairs, and percentages survive the symbolic connectors',
      compileJobAsk('stake 0.5 ETH on lido') === null &&
        compileJobAsk('lend 100 USDC on morpho') === null &&
        (() => {
          const canon = compileJobAsk(
            'swap 25 usdc from base to arbitrum, then deposit 24 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop',
          )
          return !!canon && !('problem' in canon) && !('clarify' in canon) && canon.steps.length === 6
        })(),
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
    // ── The ladder net (the #595 invariant, generalized) ───────────────────
    // Every single-venue gate must sit BELOW the jobs compiler: a parser that
    // matches ONE clause of a compound ask must never claim the whole turn.
    // #595 was Aave; #586-era probing found the same shape behind every
    // connector. This drives real compound asks across venue PAIRS over HTTP,
    // so adding a new gate above the jobs compiler fails here immediately —
    // behavioral, not a source grep, so it can't rot into a false green.
    const LADDER_PAIRS: Array<{ label: string; ask: string; thief: RegExp }> = [
      { label: 'aave+lido', ask: 'supply 5 USDC to aave and stake 0.01 eth on lido', thief: /needs the \*\*Aave\*\*|Add Aave with this ask ready|Staking with Lido runs right here/ },
      { label: 'morpho+lido', ask: 'lend 100 USDC on morpho and stake 0.5 ETH on lido', thief: /Add Morpho with this ask ready|Staking with Lido runs right here/ },
      { label: 'morpho+aave', ask: 'lend 100 USDC on morpho and supply 5 USDC to aave', thief: /Add Morpho with this ask ready|Add Aave with this ask ready/ },
      { label: 'bridge+morpho', ask: 'bridge 5 USDC from base to arbitrum and lend 100 USDC on morpho', thief: /Add Morpho with this ask ready|built-in swap tools cover/ },
      { label: 'hl+lido', ask: 'deposit 20 usdc to hyperliquid and stake 0.01 eth on lido', thief: /Hyperliquid orders build right here|Staking with Lido runs right here/ },
    ]
    const ladderMisses: string[] = []
    for (const p of LADDER_PAIRS) {
      const res = await fetch(`${BASE}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
        body: JSON.stringify({ message: p.ask, activeServers: [] }),
      }).then((r) => r.json())
      const reply = typeof res.reply === 'string' ? res.reply : ''
      const reachedJobs = /chains multiple money steps/i.test(reply)
      if (!reachedJobs || p.thief.test(reply)) ladderMisses.push(`${p.label}: ${reply.slice(0, 90)}`)
    }
    check(
      'jobs ladder net: every venue PAIR reaches the jobs gate (no single-venue gate claims a compound ask)',
      ladderMisses.length === 0,
      ladderMisses.join(' || '),
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
    check(
      'aave door: the turn stamps `door` so the ask-failure classifier counts it as an answer',
      aaveDoor.door?.mcps === 'aave-free' && classifyTurn(aaveDoor).kind === null,
      JSON.stringify(aaveDoor.door),
    )
    // Door audit (Lane O): every gate that needs a missing dapp answers the
    // deep-link door — a full grammar match must never silently fall to the
    // planner (guardian did) or refuse without the add link (cross-chain did).
    const guardianDoor = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ message: 'protect my ETH long with a 5% stop', activeServers: [] }),
    }).then((r) => r.json())
    check(
      'guardian door: an arm ask without the HL agent answers the door (never the planner)',
      typeof guardianDoor.reply === 'string' && guardianDoor.reply.includes('Add Hyperliquid with this ask ready](/chat?mcps=hyperliquid-free&prompt='),
      JSON.stringify(guardianDoor).slice(0, 220),
    )
    check(
      'guardian door: stamps `door` and classifies as an answer',
      guardianDoor.door?.mcps === 'hyperliquid-free' && classifyTurn(guardianDoor).kind === null,
      JSON.stringify(guardianDoor.door),
    )
    const ccDoor = await fetch(`${BASE}/api/chat`, {
      method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ message: 'swap 5 USDC from base to polygon', activeServers: [], walletAddress: '0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045' }),
    }).then((r) => r.json())
    check(
      'cross-chain door: no NEAR agent → the refusal carries the add-with-ask deep link',
      typeof ccDoor.reply === 'string' && ccDoor.reply.includes('Add NEAR Intents with this ask ready](/chat?mcps=near-intents-mcp-yeetful&prompt='),
      JSON.stringify(ccDoor).slice(0, 220),
    )

    // ── One progress vocabulary (Lane U, PLAN-progress-ui.md): run-state
    // color lives in the --done/--live/--fail tokens (both theme blocks —
    // hardcoded emerald never flipped in light mode), and the word/live-set
    // module is the single source across JobCard/rail/logs.
    const fsMod = await import('node:fs')
    const designCss = fsMod.readFileSync('app/x402-design.css', 'utf8')
    check(
      'progress tokens: --done/--fail defined in BOTH the dark root and the light block',
      (designCss.match(/--done:/g) ?? []).length >= 2 && (designCss.match(/--fail:/g) ?? []).length >= 2 && designCss.includes('--live:'),
    )
    check(
      'step-status: one live-set + canonical words + token tones',
      LIVE_JOB_STATUSES.length === 3 && jobStatusWord('done') === 'done' && jobStatusWord('waiting_signature') === 'needs your signature' && statusTone('failed') === 'var(--fail)' && statusTone('done') === 'var(--done)',
    )
    const progressSurfaces = [
      'components/JobCard.tsx',
      'components/SendTxChain.tsx',
      'components/SendTxButton.tsx',
      'components/JobsRailTab.tsx',
      'components/SharedJobLog.tsx',
      'components/GuardianPolicyCard.tsx',
      'app/r/[slug]/page.tsx',
    ]
    check(
      'progress surfaces: zero hardcoded emerald/red state colors (tokens only)',
      progressSurfaces.every((f) => !/emerald-\d|red-400|#f87171/.test(fsMod.readFileSync(f, 'utf8'))),
      progressSurfaces.filter((f) => /emerald-\d|red-400|#f87171/.test(fsMod.readFileSync(f, 'utf8'))).join(','),
    )
    const yprogSurfaces = ['components/JobCard.tsx', 'components/IntentRuntime.tsx', 'components/JobsRailTab.tsx', 'app/r/[slug]/page.tsx']
    check(
      'yprog: the shared progress line is defined once and all four surfaces wear it',
      designCss.includes('.yprog__fill') && designCss.includes('.yprog--fail') && designCss.includes('.yprog--full') &&
        yprogSurfaces.every((f) => fsMod.readFileSync(f, 'utf8').includes('yprog')),
      yprogSurfaces.filter((f) => !fsMod.readFileSync(f, 'utf8').includes('yprog')).join(','),
    )
    check(
      'settled arc: JobCard one-shot onSettled → ChatInterface forwards outcome settled → /i flips the bar to done',
      fsMod.readFileSync('components/JobCard.tsx', 'utf8').includes('onSettled') &&
        fsMod.readFileSync('components/ChatInterface.tsx', 'utf8').includes("outcome: 'settled'") &&
        fsMod.readFileSync('components/IntentRuntime.tsx', 'utf8').includes("=== 'settled'"),
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
    // A comma-separated list with no conjunction is the same intent typed a
    // different way — it compiled to NOTHING before (the clause splitter only
    // knew and/plus) and fell to the single-send layer, which took one clause.
    const multiComma = parseMultiSendSegments(`send 1 USDC on base, 2 USDC on arbitrum to ${multiTo}`)
    const multiThree = parseMultiSendSegments(`send 1 USDC on base, 2 USDC on arbitrum, 3 USDC on ethereum to ${multiTo}`)
    check(
      'multi-send parse: a bare comma separates clauses (list form, no conjunction)',
      !!multiComma && !('problem' in multiComma) && multiComma.length === 2 && multiComma[0].chainId === 8453 && multiComma[1].chainId === 42161 &&
        !!multiThree && !('problem' in multiThree) && multiThree.length === 3,
      JSON.stringify({ multiComma, multiThree }).slice(0, 200),
    )
    // The comma branch demands whitespace after the comma, so a thousands
    // separator is never a split point — "1,000 USDC" stays ONE amount.
    check(
      'multi-send parse: a thousands separator is not a clause break ("1,000 USDC" stays single)',
      parseMultiSendSegments(`send 1,000 USDC on base to ${multiTo}`) === null,
      JSON.stringify(parseMultiSendSegments(`send 1,000 USDC on base to ${multiTo}`)),
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
    const levSnap = { assetIndex: 7, szDecimals: 2, markPx: 40, positionSzi: 0, maxLeverage: 3, accountLeverage: null, approvedBuilderFeeTenthBps: null }
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

    // ── Jobs cron window: age-out + settlement-first (the 2026-09-02
    // starved queue). 32 zombie jobs camped in the oldest-first take-20
    // window on prod, so a freshly signed bridge's settlement wait was
    // NEVER polled again after the one inline check at signature time —
    // "Funds arrive on Robinhood Chain" sat forever with the money already
    // there. The drill fences a private originEnv so advanceJobs sees ONLY
    // the seeded rows.
    if (!process.env.DATABASE_URL) {
      // The blog-suite precedent for cred-gated checks: the harness runs
      // creds-less by default (Prisma reads .env, not .env.local, and the
      // engine caches a failed init) — run `DATABASE_URL=… npm run
      // test:api` for the full drill.
      check('jobs cron drill: skipped — no DATABASE_URL for the harness process', true)
    } else {
      const { advanceJobs, JOB_MAX_AGE_MS } = await import('../lib/jobs-runner')
      const FENCE = `drill-starve-${Date.now()}`
      const prevEnv = process.env.VERCEL_ENV
      process.env.VERCEL_ENV = FENCE
      const DRILL_WALLET = '0x00000000000000000000000000000000000c0ffe'
      try {
        const zombie = await prisma.job.create({
          data: { wallet: DRILL_WALLET, title: 'drill zombie', source: 'drill', status: 'waiting_signature', currentStep: 0, originEnv: FENCE, createdAt: new Date(Date.now() - JOB_MAX_AGE_MS - 3_600_000) },
        })
        const signing = await prisma.job.create({
          data: {
            wallet: DRILL_WALLET, title: 'drill signing', source: 'drill', status: 'waiting_signature', currentStep: 0, originEnv: FENCE, createdAt: new Date(Date.now() - 3_600_000),
            steps: { create: [{ seq: 0, kind: 'sign', builder: 'native-lifi-fund', title: 'sign me', status: 'offered', params: {}, expiresAt: new Date(Date.now() + 600_000) }] },
          },
        })
        const settling = await prisma.job.create({
          data: {
            wallet: DRILL_WALLET, title: 'drill settling', source: 'drill', status: 'waiting_settlement', currentStep: 1, originEnv: FENCE,
            steps: {
              create: [
                { seq: 0, kind: 'sign', builder: 'native-lifi-fund', title: 'signed', status: 'done', params: {} },
                { seq: 1, kind: 'wait', builder: 'wait', title: 'arrive', status: 'running', params: {}, waitPredicate: { kind: 'chain-arrival', fromSteps: [0] }, expiresAt: new Date(Date.now() + 600_000) },
              ],
            },
          },
        })
        await advanceJobs(1)
        const [zombieAfter, signingAfter, settlingAfter] = await Promise.all([
          prisma.job.findUnique({ where: { id: zombie.id } }),
          prisma.job.findUnique({ where: { id: signing.id } }),
          prisma.job.findUnique({ where: { id: settling.id } }),
        ])
        check(
          'jobs cron: a 7-day abandoned job ages OUT of the window by name (nothing signed or spent)',
          zombieAfter?.status === 'failed' && /expired/.test(zombieAfter.failReason ?? '') && /nothing was signed/.test(zombieAfter.failReason ?? ''),
          zombieAfter?.failReason ?? zombieAfter?.status ?? 'missing',
        )
        // The settling job's wait has no arrival expectations, so being
        // TOUCHED fails it by name — the proof it led the window past an
        // OLDER waiting_signature job even at limit 1.
        check(
          'jobs cron: settlement waits lead the window — evaluated ahead of an older signature job',
          settlingAfter?.status === 'failed' && /no arrival expectations/.test(settlingAfter.failReason ?? '') && signingAfter?.status === 'waiting_signature',
          JSON.stringify({ settling: settlingAfter?.failReason ?? settlingAfter?.status, signing: signingAfter?.status }),
        )
        // The JobCard poll advances its OWN mid-settlement job inline (the
        // open card never depends on the cron window). Token door, GET only.
        // The poll advance is fenced to the SERVER's own env (originEnv
        // rule), so this row rides 'dev' — invisible to the fenced
        // advanceJobs above, cleaned by id below. Token minting needs the
        // server's SESSION_SECRET — same .env.local belt as
        // HOUSE_MANAGER_KEY above.
        if (!process.env.SESSION_SECRET) {
          const s = (await readFile('.env.local', 'utf8').catch(() => '')).match(/^SESSION_SECRET=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '')
          if (s) process.env.SESSION_SECRET = s
        }
        const { signJobToken } = await import('../lib/job-token')
        const settling2 = await prisma.job.create({
          data: {
            wallet: DRILL_WALLET, title: 'drill poll', source: 'drill', status: 'waiting_settlement', currentStep: 1, originEnv: 'dev',
            steps: {
              create: [
                { seq: 0, kind: 'sign', builder: 'native-lifi-fund', title: 'signed', status: 'done', params: {} },
                { seq: 1, kind: 'wait', builder: 'wait', title: 'arrive', status: 'running', params: {}, waitPredicate: { kind: 'chain-arrival', fromSteps: [0] }, expiresAt: new Date(Date.now() + 600_000) },
              ],
            },
          },
        })
        const polled = await fetch(`${BASE}/api/jobs/${settling2.id}?t=${signJobToken(settling2.id)}`)
        const polledBody = (await polled.json()) as { job?: { status?: string; failReason?: string | null } }
        check(
          'jobs poll: GET /api/jobs/[id] advances a mid-settlement job inline (watcher-driven, cron-independent)',
          polled.status === 200 && polledBody.job?.status === 'failed' && /no arrival expectations/.test(polledBody.job?.failReason ?? ''),
          JSON.stringify({ status: polled.status, job: polledBody.job?.status, reason: polledBody.job?.failReason }),
        )
        await prisma.job.deleteMany({ where: { OR: [{ originEnv: FENCE }, { id: settling2.id }] } })
        check('jobs cron drill: fenced rows released', (await prisma.job.count({ where: { OR: [{ originEnv: FENCE }, { id: settling2.id }] } })) === 0)
      } finally {
        if (prevEnv === undefined) delete process.env.VERCEL_ENV
        else process.env.VERCEL_ENV = prevEnv
        await prisma.job.deleteMany({ where: { OR: [{ originEnv: FENCE }, { wallet: DRILL_WALLET, title: 'drill poll' }] } }).catch(() => {})
      }
    }

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
    // A Morpho job asks the Morpho agent for live rows — and only for the
    // chain its OWN steps target (a Base job never queries mainnet). With no
    // morpho MCP seeded this returns empty rather than throwing (fail-soft).
    const morphoCtx = await jobContextFor({
      wallet: '0x0000000000000000000000000000000000000001',
      status: 'running',
      currentStep: 0,
      valueUsd: null,
      failReason: null,
      steps: [{ builder: 'native-morpho-lend', params: { token: 'USDC', amount: '100', chainId: 8453 } }],
    })
    check(
      'job context: a morpho job derives without throwing (fail-soft when the agent is absent)',
      Array.isArray(morphoCtx.rows) && /running/i.test(morphoCtx.note ?? ''),
      JSON.stringify(morphoCtx).slice(0, 160),
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
      parseHlIntent('long eth') === null && parseHlIntent('swap 1 usdc for eth') === null && parseHlIntent('what is hyperliquid?') === null &&
        parseHlIntent('buy some eth') === null && parseHlIntent('sell $50 of ETH') === null && parseHlIntent('buy $12 of AAPL') === null,
    )
    // ── Unsized opens (the funded miss of 2026-08-12) ─────────────────────
    // "I want to buy some HYPE and 2x long" fell to the planner, whose chips
    // were prose that parsed under nothing. A leverage phrase is perp
    // evidence on its own (spot has no "2x long"); side + coin without a
    // size is an unsized open the route answers with size chips whose
    // resumes round-trip into full orders. The jobs compiler refuses the
    // shape by name (a step needs a size); the builder never sees it.
    {
      const flagship = parseHlIntent('I want to buy some HYPE and 2x long')
      const chips = flagship?.kind === 'open-unsized' ? hlUnsizedChips(flagship) : []
      check(
        'hl unsized: "buy some HYPE and 2x long" → open-unsized HYPE long @2x; every size chip round-trips into a full 2x order',
        flagship?.kind === 'open-unsized' && flagship.coin === 'HYPE' && flagship.isBuy === true && flagship.leverage === 2 &&
          chips.length === 3 &&
          chips.every((c) => {
            const back = parseHlIntent(c.resume) as HlOrderIntent | null
            return back?.kind === 'open' && back.coin === 'HYPE' && back.isBuy === true && back.leverage === 2 && (back.notionalUsd ?? 0) >= HL_MIN_ORDER_USD
          }),
        JSON.stringify({ flagship, chips }),
      )
      const venueLessSized = parseHlIntent('2x long $12 of HYPE') as HlOrderIntent | null
      const shortLev = parseHlIntent('short 2x on BTC')
      const venueUnsized = parseHlIntent('long hype on hyperliquid')
      const plannerChip = parseHlIntent('I want to open a 2x leveraged long position on HYPE perpetual futures on Hyperliquid')
      check(
        'hl unsized: leverage alone is venue evidence (sized + unsized), venue word alone still yields an unsized open, grammar/venue/chain words never become coins',
        venueLessSized?.kind === 'open' && venueLessSized.notionalUsd === 12 && venueLessSized.leverage === 2 &&
          shortLev?.kind === 'open-unsized' && shortLev.coin === 'BTC' && shortLev.isBuy === false && shortLev.leverage === 2 &&
          venueUnsized?.kind === 'open-unsized' && venueUnsized.coin === 'HYPE' && venueUnsized.leverage === undefined &&
          plannerChip?.kind === 'open-unsized' && plannerChip.coin === 'HYPE' &&
          parseHlIntent('long on hyperliquid') === null && parseHlIntent('2x long on base') === null && parseHlIntent('buy the dip 2x long') === null,
        JSON.stringify({ venueLessSized, shortLev, venueUnsized, plannerChip }),
      )
      const unsizedJob = compileJobAsk('buy some HYPE and 2x long, then deposit 12 usdc to hyperliquid')
      check(
        'hl unsized: inside a compound ask the jobs compiler refuses the sizeless step BY NAME (never a half-claimed job)',
        !!unsizedJob && 'problem' in unsizedJob && /Step 1/.test(unsizedJob.problem) && /no size/.test(unsizedJob.problem) && /2x long \$12 of HYPE on hyperliquid/.test(unsizedJob.problem),
        JSON.stringify(unsizedJob),
      )
      const hlLive = await fetch(`${BASE}/api/servers?free=1`).then((r) => r.json() as Promise<{ slug: string; endpoint: string | null }[]>).catch(() => [])
      const hlRow = hlLive.find((s) => s.slug === 'hyperliquid-free')
      const unsizedTurn = await fetch(`${BASE}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
        body: JSON.stringify({ message: 'I want to buy some HYPE and 2x long', activeServers: hlRow ? [hlRow] : [], walletAddress: owner.address, history: [] }),
      }).then((r) => r.json() as Promise<Record<string, unknown>>)
      const unsizedOpts = ((unsizedTurn.clarify as { options?: { resume: string }[] } | undefined)?.options ?? [])
      check(
        'hl unsized (route): the flagship ask answers HL size chips from the native layer — never planner prose; the turn is answered, not a wall',
        (hlRow
          ? unsizedTurn.buildPath === 'native-hl-exec' && unsizedOpts.length === 3 && unsizedOpts.every((o) => (parseHlIntent(o.resume) as HlOrderIntent | null)?.kind === 'open')
          : /mcps=hyperliquid-free/.test(String(unsizedTurn.reply))) && classifyTurn(unsizedTurn).kind === null,
        JSON.stringify(unsizedTurn).slice(0, 300),
      )
      const unsizedDoor = await fetch(`${BASE}/api/chat`, {
        method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
        body: JSON.stringify({ message: 'I want to buy some HYPE and 2x long', activeServers: [], history: [] }),
      }).then((r) => r.json() as Promise<Record<string, unknown>>)
      check(
        'hl unsized (route): without the Hyperliquid MCP the flagship ask gets the add door with the ask ready',
        /Add Hyperliquid with this ask ready\]\(\/chat\?mcps=hyperliquid-free&prompt=/.test(String(unsizedDoor.reply)) && classifyTurn(unsizedDoor).kind === null,
        JSON.stringify(unsizedDoor).slice(0, 300),
      )
    }

    const snap = { assetIndex: 4, szDecimals: 4, markPx: 3000, positionSzi: 0, maxLeverage: 25, accountLeverage: null, approvedBuilderFeeTenthBps: null }
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

    // Builder fee (HANDOFF-yeetcall-gtm C1): rides INSIDE the signed action —
    // recipient and rate are pinned both ways, so the signature can never be
    // redirected onto a foreign fee, and a disabled fee means no field at all.
    check(
      'hl fee: 10bps perp builder fee configured; native-hl-exec is fee-bearing',
      HL_BUILDER_FEE_TENTH_BPS === 100 && HL_BUILDER_MAX_FEE_RATE === '0.1%' &&
        netFeeBpsFor('native-hl-exec') === 10 && FEE_BEARING_BUILD_PATHS.has('native-hl-exec'),
    )
    check(
      'hl fee: order carries the treasury fee; foreign recipient / off rate refuse',
      action.builder?.b === TREASURY_ADDRESS.toLowerCase() && action.builder?.f === HL_BUILDER_FEE_TENTH_BPS &&
        !guardHlExecBuild(openIntent, { ...action, builder: { b: `0x${'dd'.repeat(20)}`, f: HL_BUILDER_FEE_TENTH_BPS } }, ctx).ok &&
        !guardHlExecBuild(openIntent, { ...action, builder: { b: TREASURY_ADDRESS.toLowerCase(), f: 50 } }, ctx).ok,
    )
    // Q2 self-heal (§1.2): an UNFUNDED builder must never wall the flagship.
    // The build-time decision omits the fee (two-shape family: exactly ours,
    // or absent — never foreign), the guard notes the omission, and the
    // eligibility rule sits exactly on the venue's $100 builder floor.
    {
      const freeAction = buildHlOrderAction(openIntent, snap, { builderFee: false })
      const freeGuard = guardHlExecBuild(openIntent, freeAction, ctx)
      check(
        'hl fee self-heal: builderFee:false builds NO builder field and the guard passes it with the omission note',
        freeAction.builder === undefined &&
          freeGuard.ok &&
          /omitted this build/.test(freeGuard.checks.find((c) => c.id === 'builder-fee')?.note ?? ''),
        JSON.stringify(freeGuard.checks.find((c) => c.id === 'builder-fee')),
      )
      check(
        'hl fee self-heal: eligibility sits exactly on the venue floor; NaN and $0 are ineligible',
        HL_BUILDER_MIN_ACCOUNT_USD === 100 &&
          builderEligibleFromAccountValue(100) &&
          builderEligibleFromAccountValue(250.5) &&
          !builderEligibleFromAccountValue(99.99) &&
          !builderEligibleFromAccountValue(0) &&
          !builderEligibleFromAccountValue(NaN),
      )
    }
    const feeArt = approveBuilderFeeArtifacts({ nonce: 1752440000000, signatureChainId: 8453, isTestnet: false })
    check(
      'hl fee: approval artifacts — user-signed domain, treasury pinned, exact rate; tampers refuse',
      feeArt.typedData.primaryType === 'HyperliquidTransaction:ApproveBuilderFee' &&
        (feeArt.typedData.domain as { name?: string }).name === 'HyperliquidSignTransaction' &&
        (feeArt.typedData.domain as { chainId?: number }).chainId === 8453 &&
        feeArt.action.signatureChainId === '0x2105' &&
        feeArt.action.builder === TREASURY_ADDRESS.toLowerCase() &&
        feeArt.action.maxFeeRate === HL_BUILDER_MAX_FEE_RATE &&
        guardHlBuilderFeeApproval(feeArt.action, false).ok &&
        !guardHlBuilderFeeApproval({ ...feeArt.action, builder: `0x${'dd'.repeat(20)}` }, false).ok &&
        !guardHlBuilderFeeApproval({ ...feeArt.action, maxFeeRate: '1%' }, false).ok &&
        !guardHlBuilderFeeApproval(feeArt.action, true).ok,
    )

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
    // Fee-approval path: a PROPERLY signed approval naming a FOREIGN builder
    // must die at the relay guard (403) — recovery passes, the pin refuses —
    // and never reach the venue. Fresh nonce so it's the guard that speaks.
    const foreignFee: HlWireApproveBuilderFeeAction = {
      type: 'approveBuilderFee',
      signatureChainId: '0x2105',
      hyperliquidChain: 'Mainnet',
      maxFeeRate: HL_BUILDER_MAX_FEE_RATE,
      builder: `0x${'dd'.repeat(20)}`,
      nonce: Date.now(),
    }
    const foreignFeeTd = hlApproveBuilderFeeTypedData(foreignFee)
    const foreignFeeSig = await signer.signTypedData({
      domain: foreignFeeTd.domain,
      types: foreignFeeTd.types,
      primaryType: foreignFeeTd.primaryType,
      message: { ...foreignFeeTd.message, nonce: BigInt(foreignFee.nonce) },
    } as Parameters<typeof signer.signTypedData>[0])
    const relayForeignFee = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ action: foreignFee, nonce: foreignFee.nonce, signature: foreignFeeSig, from: signer.address }),
    })
    const relayForeignFeeBody = (await relayForeignFee.json().catch(() => ({}))) as { error?: string }
    check(
      'hl submit: fee approval for a foreign builder → 403 at the relay guard',
      relayForeignFee.status === 403 && /different fee recipient/i.test(relayForeignFeeBody.error ?? ''),
      JSON.stringify(relayForeignFeeBody),
    )

    // ── Wallet-agnostic execution (2026-08-17: the MetaMask chainId-1337 wall) ──
    // The phantom-agent domain IS 1337 (venue constant) — the very thing
    // MetaMask refuses to sign on any chain. Pin the fact so nobody "fixes"
    // the domain, then pin the door around it: consent text binds the venue's
    // own action hash; the wallet-error classifier routes MetaMask's exact
    // wording to the delegated path and a human "no" nowhere.
    check(
      'hl delegated: phantom-agent domain is the venue constant 1337 (why MetaMask refuses it)',
      (td.domain as { chainId?: number }).chainId === 1337 && td.primaryType === 'Agent',
    )
    const consentExpected = { coin: 'ETH', kind: 'open' as const, isBuy: true }
    const consent = hlConsentMessage({ from: signer.address, action, nonce: 1752440000000, isTestnet: false, expected: consentExpected })
    const consentHash = createL1ActionHash({ action: action as unknown as Record<string, unknown>, nonce: 1752440000000 })
    check(
      'hl delegated: consent text = header + action summary + wallet + network + nonce + the L1 action hash; a different nonce = a different text',
      consent.startsWith(`${HL_CONSENT_HEADER}\n`) &&
        consent.includes(`Hash: ${consentHash}`) &&
        consent.includes(`Wallet: ${signer.address.toLowerCase()}`) &&
        consent.includes('Network: Mainnet') &&
        consent.includes(`Action: ${hlActionSummary(action, consentExpected)}`) &&
        /buy \(long\) [\d.]+ ETH @ ≤[\d.]+ IOC/.test(hlActionSummary(action, consentExpected)) &&
        hlActionSummary({ type: 'updateLeverage', asset: 0, isCross: true, leverage: 3 }, { coin: 'eth' }) === 'set 3x cross leverage on ETH' &&
        hlConsentMessage({ from: signer.address, action, nonce: 1752440000001, isTestnet: false, expected: consentExpected }) !== consent,
      consent,
    )
    check(
      'hl delegated: MetaMask "must match the active chainId" → switch-to-delegated; user rejection → declined; anything else → error',
      classifyHlSignFailure('An internal error was received. Details: Provided chainId "1337" must match the active chainId "4663" Version: viem@2.48.1') === 'switch-to-delegated' &&
        isChainMismatchSignError('chainId mismatch: expected 1 got 1337') &&
        classifyHlSignFailure('User rejected the request.') === 'declined' &&
        classifyHlSignFailure('User denied message signature.') === 'declined' &&
        classifyHlSignFailure('Internal JSON-RPC error.') === 'error' &&
        !isChainMismatchSignError('User rejected the request.'),
    )
    // The agent-signing half, offline: an encrypted-at-rest agent key signs
    // the SAME phantom-agent typed data a direct wallet would, and the venue-
    // side recovery lands on the agent — what the venue maps back to the
    // user. (Custody secret set inline for the pure round trip; a row
    // encrypted under a different secret refuses.)
    {
      process.env.GUARDIAN_KEY_SECRET ??= 'harness-custody-secret-not-prod'
      const agentPk = generatePrivateKey()
      const agentAddress = privateKeyToAccount(agentPk).address
      const agentSig = await signL1ActionWithDelegation({ agentKeyEnc: encryptAgentKey(agentPk), agentAddress }, td)
      const agentRecovered = await recoverTypedDataAddress({
        domain: td.domain as Parameters<typeof recoverTypedDataAddress>[0]['domain'],
        types: td.types,
        primaryType: td.primaryType,
        message: td.message,
        signature: agentSig,
      })
      let wrongAddrRefused = false
      try {
        await signL1ActionWithDelegation({ agentKeyEnc: encryptAgentKey(agentPk), agentAddress: signer.address }, td)
      } catch {
        wrongAddrRefused = true
      }
      check(
        'hl delegated: the encrypted agent key signs the phantom-agent typed data and recovers to the agent; a key≠address row refuses',
        agentRecovered.toLowerCase() === agentAddress.toLowerCase() && wrongAddrRefused,
      )
    }
    // The relay's delegated mode: consent must recover to `from`; a wallet
    // with no live Pantessa agent gets the 409 door (never a silent 502).
    const stranger = privateKeyToAccount(generatePrivateKey())
    const consentBySigner = await signer.signMessage({ message: consent })
    const consentByStranger = await stranger.signMessage({ message: consent })
    const delegatedWrong = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'delegated', action, nonce: 1752440000000, consentSignature: consentByStranger, from: signer.address, expected: consentExpected }),
    })
    const delegatedNoAgent = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'delegated', action, nonce: 1752440000000, consentSignature: consentBySigner, from: signer.address, expected: consentExpected }),
    })
    const delegatedNoAgentBody = (await delegatedNoAgent.json().catch(() => ({}))) as { code?: string; error?: string }
    const delegatedTampered = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      // Same consent signature, different action bytes → the re-derived text differs → recovery lands elsewhere.
      body: JSON.stringify({ mode: 'delegated', action: { ...action, orders: [{ ...action.orders[0], s: '9.9' }] }, nonce: 1752440000000, consentSignature: consentBySigner, from: signer.address, expected: consentExpected }),
    })
    const delegatedFee = await fetch(`${BASE}/api/hl/submit`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ mode: 'delegated', action: foreignFee, nonce: foreignFee.nonce, consentSignature: consentBySigner, from: signer.address }),
    })
    check(
      'hl submit delegated: stranger consent → 403; tampered action → 403; fee approval never delegated → 400; no live agent → 409 delegation-required',
      delegatedWrong.status === 403 &&
        delegatedTampered.status === 403 &&
        delegatedFee.status === 400 &&
        delegatedNoAgent.status === 409 &&
        delegatedNoAgentBody.code === 'delegation-required',
      `${delegatedWrong.status}/${delegatedTampered.status}/${delegatedFee.status}/${delegatedNoAgent.status} ${JSON.stringify(delegatedNoAgentBody)}`,
    )
    // The connect-only "enable trading" door: mint returns typed data on the
    // WALLET's chain (the whole point — every wallet signs its own chain);
    // activation is signature-gated (a stranger's signature activates
    // nothing); a bad-shape mint is a 400. GUARDIAN_KEY_SECRET must be set
    // locally for the mint (prod has it) — a 500 naming it is a config warn.
    const delegGetNone = await fetch(`${BASE}/api/hl/delegation?wallet=${signer.address}`)
    const delegGetBad = await fetch(`${BASE}/api/hl/delegation?wallet=nope`)
    const delegMintBad = await fetch(`${BASE}/api/hl/delegation`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ from: signer.address }) })
    const delegMint = await fetch(`${BASE}/api/hl/delegation`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ from: signer.address, signatureChainId: 4663 }),
    })
    const delegMintBody = (await delegMint.json().catch(() => ({}))) as { id?: string; active?: boolean; agentAddress?: string; typedData?: { domain?: { chainId?: number; name?: string }; primaryType?: string; message?: Record<string, unknown> }; error?: string }
    check(
      'hl delegation: GET unknown wallet → active:false; bad wallet → 400; mint without chain → 400',
      delegGetNone.status === 200 && ((await delegGetNone.json()) as { active?: boolean }).active === false && delegGetBad.status === 400 && delegMintBad.status === 400,
    )
    if (delegMint.status === 500 && /GUARDIAN_KEY_SECRET/.test(delegMintBody.error ?? '')) {
      console.log('  ⚠️  hl delegation: mint skipped — GUARDIAN_KEY_SECRET unset locally (set any ≥16-char value in .env.local; prod has its own)')
    } else {
      check(
        'hl delegation: connect-only mint → pending agent + approveAgent typed data on the WALLET\'s chain (4663), agent named pantessa',
        delegMint.status === 200 &&
          !!delegMintBody.id &&
          delegMintBody.active === false &&
          delegMintBody.typedData?.domain?.chainId === 4663 &&
          delegMintBody.typedData?.domain?.name === 'HyperliquidSignTransaction' &&
          delegMintBody.typedData?.primaryType === 'HyperliquidTransaction:ApproveAgent' &&
          String(delegMintBody.typedData?.message?.agentName ?? '').startsWith('pantessa valid_until ') &&
          String(delegMintBody.typedData?.message?.agentAddress ?? '') === delegMintBody.agentAddress,
        JSON.stringify(delegMintBody).slice(0, 300),
      )
      // Idempotent retry (QA 2026-08-18): the same wallet + chain within the
      // reuse window gets the SAME pending row + byte-identical typed data —
      // no second row; a different signing chain mints a fresh one.
      const delegRetry = await fetch(`${BASE}/api/hl/delegation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: signer.address, signatureChainId: 4663 }),
      })
      const delegRetryBody = (await delegRetry.json().catch(() => ({}))) as { id?: string; agentAddress?: string; typedData?: unknown; reused?: boolean }
      const delegOtherChain = await fetch(`${BASE}/api/hl/delegation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: signer.address, signatureChainId: 8453 }),
      })
      const delegOtherBody = (await delegOtherChain.json().catch(() => ({}))) as { id?: string; typedData?: { domain?: { chainId?: number } } }
      check(
        'hl delegation: a retry for the same wallet+chain returns the SAME pending row (id, agent, typed data; reused:true) — no row spam; another chain mints fresh',
        delegRetry.status === 200 &&
          delegRetryBody.id === delegMintBody.id &&
          delegRetryBody.agentAddress === delegMintBody.agentAddress &&
          delegRetryBody.reused === true &&
          JSON.stringify(delegRetryBody.typedData) === JSON.stringify(delegMintBody.typedData) &&
          delegOtherChain.status === 200 &&
          !!delegOtherBody.id && delegOtherBody.id !== delegMintBody.id && delegOtherBody.typedData?.domain?.chainId === 8453,
      )
      // Re-mint on 4663 for the activation probes below (the 8453 mint above
      // superseded it — one pending row per wallet at a time).
      const delegBack = await fetch(`${BASE}/api/hl/delegation`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ from: signer.address, signatureChainId: 4663 }),
      })
      const delegBackBody = (await delegBack.json().catch(() => ({}))) as typeof delegMintBody
      Object.assign(delegMintBody, delegBackBody)
      const mintTd = delegMintBody.typedData!
      const approveByStranger = await stranger.signTypedData({
        domain: mintTd.domain,
        types: { 'HyperliquidTransaction:ApproveAgent': [{ name: 'hyperliquidChain', type: 'string' }, { name: 'agentAddress', type: 'address' }, { name: 'agentName', type: 'string' }, { name: 'nonce', type: 'uint64' }] },
        primaryType: 'HyperliquidTransaction:ApproveAgent',
        message: { ...mintTd.message, nonce: BigInt(mintTd.message!.nonce as number) },
      } as Parameters<typeof stranger.signTypedData>[0])
      const activateWrong = await fetch(`${BASE}/api/hl/delegation`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: delegMintBody.id, from: signer.address, signature: approveByStranger }),
      })
      const activateMissing = await fetch(`${BASE}/api/hl/delegation`, {
        method: 'PATCH',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ id: 'nope', from: signer.address, signature: approveByStranger }),
      })
      const stillNone = (await (await fetch(`${BASE}/api/hl/delegation?wallet=${signer.address}`)).json()) as { active?: boolean }
      check(
        'hl delegation: a stranger\'s approveAgent signature activates nothing (403); unknown id → 404; wallet still has no live agent',
        activateWrong.status === 403 && activateMissing.status === 404 && stillNone.active === false,
        `${activateWrong.status}/${activateMissing.status}`,
      )
    }
    // The wallet-refusal beacon: a built + guarded artifact the WALLET refused
    // lands in the ask-failure queue as had_funds TRUE; human rejections and
    // harness runs (x-yf-no-ask-log) never do.
    check(
      'wallet refusal: MetaMask chainId wall is reportable; user rejections are not',
      isReportableWalletError('An internal error was received. Details: Provided chainId "1337" must match the active chainId "4663"') &&
        !isReportableWalletError('User rejected the request.') &&
        !isReportableWalletError('MetaMask Tx Signature: User denied transaction signature.') &&
        WALLET_REFUSAL_KIND === 'wallet-refused',
    )
    // The row must carry the wallet's WORDS, not viem's wrapper (QA r3 found
    // "An internal error was received." stored as the reply): the real text
    // sits in .details / .data.message / .cause — first specific line wins.
    {
      const viemShaped = Object.assign(new Error('An internal error was received.\n\nRequest Arguments:\n  from: 0x…\n\nDetails: Provided chainId "1337" must match the active chainId "4663"\nVersion: viem@2.x'), {
        shortMessage: 'An internal error was received.',
        details: 'Provided chainId "1337" must match the active chainId "4663"',
        cause: Object.assign(new Error('Internal JSON-RPC error.'), { data: { message: 'Provided chainId "1337" must match the active chainId "4663"' } }),
      })
      const nodeShaped = Object.assign(new Error('An unknown RPC error occurred.'), { cause: { data: { message: 'insufficient funds for gas * price + value' } } })
      // QA r4's exact MetaMask -32603 shape as viem hands it to the card: the
      // OUTER details = the provider's generic "Internal JSON-RPC error.", the
      // wallet's words nested in cause.data.message — the deepest data.message
      // must win over the shallower generic details.
      const mm32603 = Object.assign(new Error('An internal error was received.\n\nRequest Arguments:\n  from: 0x5eaa…\n  to: 0x8335…\n\nDetails: Internal JSON-RPC error.\nVersion: viem@2.x'), {
        shortMessage: 'An internal error was received.',
        details: 'Internal JSON-RPC error.',
        code: -32603,
        cause: Object.assign(new Error('Internal JSON-RPC error.'), { code: -32603, data: { code: -32000, message: 'insufficient funds for gas * price + value: have 0 want 21000000000000' } }),
      })
      check(
        'wallet refusal words: viem-wrapped MetaMask error → the wallet\'s line; node error → its data.message; plain strings + bare errors pass through',
        walletErrorWords(viemShaped) === 'Provided chainId "1337" must match the active chainId "4663"' &&
          walletErrorWords(nodeShaped) === 'insufficient funds for gas * price + value' &&
          walletErrorWords(mm32603) === 'insufficient funds for gas * price + value: have 0 want 21000000000000' &&
          walletErrorWords(new Error('Internal JSON-RPC error.')) === 'Internal JSON-RPC error.' &&
          walletErrorWords(new Error('MetaMask Tx Signature: User denied transaction signature.')) === 'MetaMask Tx Signature: User denied transaction signature.' &&
          walletErrorWords('plain') === 'plain' && walletErrorWords(null) === 'Wallet error (no message)',
        JSON.stringify([walletErrorWords(viemShaped), walletErrorWords(nodeShaped), walletErrorWords(mm32603)]),
      )
    }
    const refusalInternal = await fetch(`${BASE}/api/ask-failures/wallet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '1' },
      body: JSON.stringify({ wallet: signer.address, artifact: 'hl-order', ask: 'close 1 ETH', detail: 'Provided chainId "1337" must match the active chainId "4663"' }),
    })
    // x-yf-internal-run WITHOUT the opt-out: the row is written but STAMPED
    // (a matrix drill's refusal is visible under the dashboard's internal
    // toggle, never as a stranger's wall).
    const refusalStamped = await fetch(`${BASE}/api/ask-failures/wallet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ wallet: signer.address, artifact: 'hl-order', ask: 'close 1 ETH (stamped drill)', detail: 'Provided chainId "1337" must match the active chainId "4663"' }),
    })
    const refusalStampedBody = (await refusalStamped.json()) as { ok?: boolean; internal?: boolean; id?: string }
    check(
      'wallet refusal beacon: an internal-run drill row is written STAMPED (202, internal:true) — hidden from /dashboard/failures by default',
      refusalStamped.status === 202 && refusalStampedBody.ok === true && refusalStampedBody.internal === true && !!refusalStampedBody.id,
    )
    // These two must reach the rejection/shape gates, so they opt out of the
    // suite-wide internal-run stamp (which would short-circuit them first).
    const refusalRejected = await fetch(`${BASE}/api/ask-failures/wallet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [ORGANIC_PROBE]: '1' },
      body: JSON.stringify({ wallet: signer.address, artifact: 'hl-order', ask: 'close 1 ETH', detail: 'User rejected the request.' }),
    })
    const refusalShape = await fetch(`${BASE}/api/ask-failures/wallet`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', [ORGANIC_PROBE]: '1' },
      body: JSON.stringify({ artifact: 'nope', detail: 'x' }),
    })
    check(
      'wallet refusal beacon: internal-run header → skipped; user rejection → skipped; bad shape → dropped; all 202, never an error',
      refusalInternal.status === 202 && ((await refusalInternal.json()) as { skipped?: string }).skipped === 'internal' &&
        refusalRejected.status === 202 && ((await refusalRejected.json()) as { skipped?: string }).skipped === 'rejection' &&
        refusalShape.status === 202 && ((await refusalShape.json()) as { dropped?: string }).dropped === 'shape',
    )
  }

  // ── Typed-data domain-chain audit (the 2026-08-17 class, pinned) ────────
  // MetaMask refuses eth_signTypedData_v4 whose domain.chainId isn't the
  // wallet's ACTIVE chain. Every component that asks a wallet for a typed-
  // data signature must therefore either (a) switch the wallet onto the
  // domain's chain first, or (b) sit on the allowlist with a reason: the
  // domain has no chainId (Snapshot), the domain IS the wallet's own chain
  // (approveAgent / builder fee), or the venue's chain is unswitchable and
  // the component owns the delegated door (HL L1 actions). A new signer
  // that does neither fails here — before a stranger's wallet finds it.
  {
    const fs = await import('node:fs')
    const path = await import('node:path')
    const walk = (dir: string): string[] =>
      fs.readdirSync(dir, { withFileTypes: true }).flatMap((d) => (d.isDirectory() ? walk(path.join(dir, d.name)) : d.name.endsWith('.tsx') ? [path.join(dir, d.name)] : []))
    const signers = [...walk('components'), ...walk('app')].filter((f) => /signTypedDataAsync\(/.test(fs.readFileSync(f, 'utf8')))
    const ALLOW: Record<string, string> = {
      'components/SignHlActionButton.tsx': 'HL phantom-agent domain is 1337 (unswitchable) — owns the delegated door; builder-fee domain = wallet chain',
      'components/GuardianPanel.tsx': 'approveAgent domain = the wallet\'s own chain by construction',
      'components/SignVoteButton.tsx': 'Snapshot domain carries no chainId',
      'components/VoteChoiceButtons.tsx': 'Snapshot domain carries no chainId',
    }
    const offenders = signers.filter((f) => !(f in ALLOW) && !/switchChainAsync\(/.test(fs.readFileSync(f, 'utf8')))
    check(
      `typed-data audit: every signTypedData caller aligns the wallet chain first or is allowlisted with a reason (${signers.length} signers)`,
      signers.length >= 8 && offenders.length === 0,
      offenders.length ? `unaligned: ${offenders.join(', ')}` : signers.map((f) => path.basename(f)).join(' '),
    )
    // Wallet-refusal wiring audit (squad 2026-08-18 r2): every component
    // that asks the wallet to sign or send (signTypedDataAsync /
    // sendTransactionAsync) must file non-rejection wallet errors through
    // reportWalletRefusal, or the #1 predicted stranger failure ("approve
    // fails — USDC present, zero ETH for gas") lives only in one browser's
    // red text and never reaches /dashboard/failures.
    const senders = [...walk('components'), ...walk('app')].filter((f) => /(signTypedDataAsync|sendTransactionAsync)\(/.test(fs.readFileSync(f, 'utf8')))
    // Allowlisted = consciously queued, not exempt: each entry names WHY it
    // can wait (dashboard/arm surfaces a stranger never meets on /i, x402
    // payment sigs, votes). Wire and delete the entry; never add one silently.
    const REFUSAL_ALLOW: Record<string, string> = {
      'components/GuardianPanel.tsx': 'dashboard arm surface, not a stranger sign path (queued)',
      'components/ArmDcaButton.tsx': 'spend-permission arm (autopilot DCA) — queued',
      'components/ArmSpotGuardButton.tsx': 'spend-permission arm (spot guardian) — queued',
      'components/SignGrantButton.tsx': 'dashboard grant signature — queued',
      'components/SignNftListingButton.tsx': 'Seaport listing (opensea-listing artifact exists) — queued',
      'components/ChatInterface.tsx': 'x402 payment sigs (EIP-3009) — not a native artifact; queued',
      'components/SignVoteButton.tsx': 'Snapshot vote — no money moves (queued)',
      'components/VoteChoiceButtons.tsx': 'Snapshot vote — no money moves (queued)',
    }
    const unwired = senders.filter((f) => !(f in REFUSAL_ALLOW) && !/reportWalletRefusal\(/.test(fs.readFileSync(f, 'utf8')))
    // Sign-card copy pins (squad r4): a refused network switch names the
    // chain and turns the button into "Switch to <chain> & retry" (never
    // just red text); the venue's raw "Must deposit" on the HL delegated
    // door becomes the honest line + the chat's own deposit ask.
    const sendTxSrc = fs.readFileSync('components/SendTxButton.tsx', 'utf8')
    const hlBtnSrc = fs.readFileSync('components/SignHlActionButton.tsx', 'utf8')
    check(
      'sign cards: switch refusal → named chain + "Switch to <chain> & retry" button; HL "Must deposit" → human line with the deposit ask',
      /switchNeeded/.test(sendTxSrc) && /& retry`/.test(sendTxSrc) && /must deposit/i.test(hlBtnSrc) && /deposit 10 usdc to hyperliquid/.test(hlBtnSrc),
    )
    // The moment of truth on /i (squad r5, Visuals' H1 storyboard): the
    // current step's sign/send button is THE primary CTA (one shared class
    // on the three sign buttons), the built reply leads with the human line
    // on the simple surface, the /i door says "Connect a wallet" (no stalled
    // "Starting…"), the CTA leads the cards on phones, and the mint stage
    // eyebrow matches the OG card.
    const orderBtnSrc = fs.readFileSync('components/SignOrderButton.tsx', 'utf8')
    const doorSrc = fs.readFileSync('components/CreateAccountButton.tsx', 'utf8')
    const runtimeSrc = fs.readFileSync('components/IntentRuntime.tsx', 'utf8')
    const mintSrc = fs.readFileSync('components/MintLinkForm.tsx', 'utf8')
    check(
      'moment of truth: SIGN_CTA_CLASS on SendTxButton + SignOrderButton + SignHlActionButton (no ghost sign buttons)',
      [sendTxSrc, orderBtnSrc, hlBtnSrc].every((src) => /className=\{SIGN_CTA_CLASS\}/.test(src) && !/rounded-full border border-\[var\(--line-2\)\] text-\[color:var\(--muted\)\] hover:text-white hover:border-white/.test(src)),
    )
    const sr = splitSimpleReply(
      "🔏 Swap 20 USDC → ~0.010555 ETH via Uniswap v3 on Base (1bps pool), min received 0.01045 (50bps slippage, incl. 0.5% Pantessa fee on the output)\n🔗 Two steps in the card below — sign the USDC approval, and the swap appears automatically once it confirms (re-quoted fresh). Nothing to retype.\n⚠️ Approve USDC to Uniswap's SwapRouter02 first — the approve transaction is attached.",
    )
    const srRun = splitSimpleReply('🔏 Swap 12 USDG → ~0.0512 AAPL on Robinhood Chain via its own settlement venue (LiFi-routed, tool: relay), min received 0.05, incl. 0.024 USDG Pantessa fee (0.2%) 🔗 One step.')
    check(
      'simple reply split: human lead (trade · chain · fee · your wallet signs) + 3 detail lines; LiFi shape; plain answers pass through',
      sr?.lead === 'Swap 20 USDC → ~0.010555 ETH · on Base · fee 0.5% · your wallet signs' && sr?.details.length === 3 && !/🔏|🔗|⚠️/u.test(sr!.details.join(' ')) &&
        srRun?.lead === 'Swap 12 USDG → ~0.0512 AAPL · on Robinhood Chain · fee 0.2% · your wallet signs' && srRun?.details.length === 2 &&
        splitSimpleReply('Here is a plain answer.') === null,
      JSON.stringify({ a: sr?.lead, b: srRun?.lead }),
    )
    // r6 (Ideation N1/N2): the in-flight label is "Confirm in your wallet…"
    // on EVERY sign button (never "Sign in wallet…" — reads as a login), and
    // the /i header exit ramps render only on receipt / flow-nudge.
    const signSrcs = ['SendTxButton', 'SignOrderButton', 'SignHlActionButton', 'ArmDcaButton', 'ArmSpotGuardButton', 'SignNftListingButton', 'SignVoteButton'].map((n) => fs.readFileSync(`components/${n}.tsx`, 'utf8'))
    check(
      'sign buttons: in-flight label reads "Confirm in your wallet…" everywhere; /i exit ramps gated on signed || flowNudge',
      signSrcs.every((src) => /Confirm in your wallet…/.test(src) && !/Sign in wallet…/.test(src)) &&
        /\{\(signed \|\| flowNudge\) && \(/.test(runtimeSrc) && /MAKE A LINK/.test(runtimeSrc),
    )
    check(
      '/i door + splash + mint stage: walletConnectOnly title "Connect a wallet", no "Starting…" stall, CTA leads the cards ≤sm, eyebrow says YOUR WALLET SIGNS',
      /walletConnectOnly \? 'Connect a wallet' : 'Sign in to Pantessa'/.test(doorSrc) && !/'Starting…'/.test(doorSrc) &&
        /className="mt-10 max-sm:order-1"/.test(runtimeSrc) && /max-sm:order-3/.test(runtimeSrc) &&
        /INTENT LINK · YOUR WALLET SIGNS/.test(mintSrc) && !/TAP TO RUN/.test(mintSrc),
    )
    check(
      `wallet-refusal audit: every money sign/send button files wallet refusals (${senders.length} senders)`,
      senders.length >= 8 && unwired.length === 0,
      unwired.length ? `unwired: ${unwired.join(', ')}` : senders.filter((f) => !(f in REFUSAL_ALLOW)).map((f) => path.basename(f)).join(' '),
    )
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

  // ── Wallet briefing (pure composer — the "what Pantessa noticed" tile) ─────
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
    // The downside AUDIT (C4): the bad day gets a dollar figure — 20% of the
    // $412.50 position is $82.50, named in the sub. The crash-day thread
    // generator greps exactly this shape ("no stop armed — … costs $X").
    check(
      'briefing: unprotected sub names the −20% dollar cost (the downside audit)',
      /no stop armed — a 20% move against costs \$82\.50/.test(naked[0].sub ?? ''),
      naked[0].sub,
    )
    // Spot flavor of the same audit: unwatched Base ETH above the floor.
    const spotNaked = composeBriefingItems({
      ...empty,
      funding: {
        readChains: ['Base'],
        failedChains: [],
        sources: [{ token: 'ETH', chainId: 8453, chainWord: 'Base', balance: 0.14, usd: 500 }],
        stranded: [],
      },
    })
    const spotRow = spotNaked.find((r) => /unwatched/.test(r.label))
    check(
      'briefing: unwatched spot ETH sub names the −20% dollar cost',
      !!spotRow && /no stop armed — a 20% dump costs \$100\.00/.test(spotRow.sub ?? ''),
      JSON.stringify(spotRow ?? spotNaked).slice(0, 200),
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

  // ── Mosaic links (executable allocations) ─────────────────────────────────
  // A shape ("tile my wallet 50% ETH, 30% USDC, 20% wstETH") is the whole
  // wire format: percentages in, same-chain-swap SENTENCES out. Two safety
  // contracts get pinned here. Grammar: once the trigger verb matches, the
  // gate OWNS the turn (named problems, never a silent planner fall — the
  // #597 partial-match rule). Planner: every emitted leg MUST round-trip
  // lib/jobs.ts, so a leg that stops compiling is a red build here, not a
  // live 404 at sign time.
  console.log('— mosaic links')
  {
    const shapeOf = (m: string) => {
      const p = parseMosaicAsk(m)
      return p && !('problem' in p) ? p : null
    }
    const problemOf = (m: string) => {
      const p = parseMosaicAsk(m)
      return p && 'problem' in p ? p.problem : ''
    }

    const happy = shapeOf('tile my wallet 50% ETH, 30% USDC, 20% wstETH')
    check(
      'mosaic: happy path parses three tiles, symbols uppercased, no chain word',
      happy?.slices.length === 3 &&
        happy.slices[0].pct === 50 &&
        happy.slices[2].token === 'WSTETH' &&
        happy.chainWord === undefined,
    )
    check('mosaic: tiles that miss 100 refuse naming the sum', /80%/.test(problemOf('tile my wallet 50% ETH, 30% USDC')))
    check("mosaic: one tile isn't a shape — named problem, not a silent drop", /One tile/.test(problemOf('tile my wallet 100% ETH')))
    check('mosaic: duplicate tile refused by name', /ETH appears twice/.test(problemOf('tile my wallet 50% ETH, 50% ETH')))
    // Stock tiles are LIVE (loop iteration 2): 'on robinhood' parses to a
    // real chain word — the old queued-refusal pin flipped consciously.
    const rhParsed = parseMosaicAsk('tile my wallet 50% AAPL, 50% USDG on robinhood')
    check(
      "mosaic: 'on robinhood' parses — stock tiles are a lane, not a refusal",
      rhParsed != null && !('problem' in rhParsed) && rhParsed.chainWord === 'robinhood',
    )
    check(
      "mosaic: the stable rail is per-chain — USDG on robinhood, USDC elsewhere",
      mosaicStableFor('robinhood') === 'USDG' && mosaicStableFor('base') === 'USDC',
    )

    // A stock shape against a USDG wallet: buys sized in USDG, and the
    // joined legs round-trip the jobs compiler WITH stock pairing (the 4663
    // list is primed the same way the stock-pairing section does it).
    primeTokenList(4663, [
      {
        tokens: [
          { chainId: 4663, address: '0xaF3D76f1834A1d425780943C99Ea8A608f8a93f9', symbol: 'AAPL', decimals: 18, name: 'Apple' },
          { chainId: 4663, address: '0x5b68Af1E93a96e7E52D9F43d4CcC0D8b3E93bE39', symbol: 'TSLA', decimals: 18, name: 'Tesla' },
          { chainId: 4663, address: '0x556CccE7E5152F9d5aA26E9e9DE44b0d64eB2B79', symbol: 'USDG', decimals: 6, name: 'Global Dollar' },
        ],
      },
    ])
    const rhPlan = planMosaic({
      slices: [
        { pct: 40, token: 'AAPL' },
        { pct: 30, token: 'TSLA' },
        { pct: 30, token: 'USDG' },
      ],
      chainWord: 'robinhood',
      holdings: [{ symbol: 'USDG', balance: 600, priceUsd: 1, valueUsd: 600 }],
    })
    check(
      'mosaic: a USDG wallet tiles into stocks — buys on the USDG rail, biggest first',
      rhPlan.kind === 'plan' &&
        rhPlan.legs.length === 2 &&
        rhPlan.legs[0] === 'swap 240.00 USDG for AAPL on robinhood' &&
        rhPlan.legs[1] === 'swap 180.00 USDG for TSLA on robinhood',
      rhPlan.kind === 'plan' ? rhPlan.legs.join(' | ') : rhPlan.kind,
    )
    if (rhPlan.kind === 'plan') {
      const rhJob = compileJobAsk(rhPlan.legs.join(' then '))
      check(
        'mosaic: stock legs round-trip the jobs compiler with ticker pairing',
        rhJob != null && !('problem' in rhJob) && !('clarify' in rhJob) && (rhJob as { steps: unknown[] }).steps.length === 2,
      )
    }

    // Sell-side stock tiling waits on a price feed: a HELD stock tile that
    // Alchemy can't price refuses BY NAME instead of planning around a
    // number nobody has.
    const rhUnpriced = planMosaic({
      slices: [
        { pct: 50, token: 'AAPL' },
        { pct: 50, token: 'USDG' },
      ],
      chainWord: 'robinhood',
      holdings: [
        { symbol: 'AAPL', balance: 3, priceUsd: null, valueUsd: null },
        { symbol: 'USDG', balance: 100, priceUsd: 1, valueUsd: 100 },
      ],
    })
    check(
      'mosaic: an unpriced held stock tile refuses by name (sell-side waits on the feed)',
      rhUnpriced.kind === 'problem' && /AAPL/.test(rhUnpriced.problem),
    )

    // The canonical-string pin: mosaicAskString is what mints, forks, and the
    // agent door all write — it must survive its own parser, chain word or not.
    const rtBare = shapeOf(mosaicAskString([{ pct: 50, token: 'ETH' }, { pct: 50, token: 'USDC' }]))
    const rtChain = shapeOf(mosaicAskString([{ pct: 33.5, token: 'eth' }, { pct: 66.5, token: 'usdc' }], 'arbitrum'))
    check(
      'mosaic: mosaicAskString round-trips parseMosaicAsk (with and without the chain word)',
      rtBare?.slices.length === 2 &&
        rtBare.chainWord === undefined &&
        rtChain?.slices[0].pct === 33.5 &&
        rtChain.slices[0].token === 'ETH' &&
        rtChain.chainWord === 'arbitrum',
    )

    // Ladder order pins: the tile ask lands on its own gate, and the rebalance
    // gate (which sits just BELOW mosaic) keeps its claim untouched.
    const lad = simulateLadder('tile my wallet 50% eth, 50% usdc')
    check('mosaic: ladder — tile ask claims the mosaic gate as an action', lad.gate === 'mosaic' && lad.kind === 'action', `gate=${lad.gate}`)
    const ladReb = simulateLadder('rebalance my portfolio')
    check('mosaic: ladder — rebalance keeps its own gate (order pin)', ladReb.gate === 'rebalance')

    // THE round-trip pin: a fabricated over-ETH wallet through the pure
    // planner → sell legs before buy legs, and the joined sentence compiles
    // via the jobs compiler into exactly legs.length steps. This is the whole
    // safety contract — the exec shell refuses when this ever misses.
    const heavy: MosaicHolding[] = [
      { symbol: 'ETH', balance: 0.9, priceUsd: 3500, valueUsd: 3150, native: true },
      { symbol: 'USDC', balance: 200, priceUsd: 1, valueUsd: 200 },
      { symbol: 'SPAMX', balance: 1_000_000, priceUsd: 0.000001, valueUsd: 1 },
    ]
    const shaped = planMosaic({
      slices: [{ pct: 50, token: 'ETH' }, { pct: 30, token: 'USDC' }, { pct: 20, token: 'WSTETH' }],
      chainWord: 'base',
      holdings: heavy,
    })
    const legs = shaped.kind === 'plan' ? shaped.legs : []
    const legsCompiled = legs.length ? compileJobAsk(legs.join(' then ')) : null
    check(
      'mosaic: planner sells before buys and every leg round-trips the jobs compiler',
      shaped.kind === 'plan' &&
        legs.length === 2 &&
        /^swap 0\.42\d+ ETH for USDC on base$/.test(legs[0]) &&
        legs[1] === `swap 669.86 ${MOSAIC_STABLE} for WSTETH on base` &&
        !!legsCompiled &&
        !('problem' in legsCompiled) &&
        legsCompiled.steps.length === legs.length,
      legs.join(' | '),
    )

    // The quiet case: an already-in-shape wallet gets an honest "nothing
    // worth moving", never a gas-eating micro-batch. The native gas keep-back
    // is still said out loud.
    const calm: MosaicHolding[] = [
      { symbol: 'ETH', balance: 0.2, priceUsd: 2500, valueUsd: 500, native: true },
      { symbol: 'USDC', balance: 500, priceUsd: 1, valueUsd: 500 },
    ]
    const quiet = planMosaic({ slices: [{ pct: 50, token: 'ETH' }, { pct: 50, token: 'USDC' }], chainWord: 'base', holdings: calm })
    check(
      'mosaic: already-in-shape wallet plans quiet (no legs) and names the gas keep-back',
      quiet.kind === 'quiet' && !('legs' in quiet) && quiet.notes.some((n) => /stays back for gas/.test(n)),
    )

    // Grammar-safe numbers: the same-chain-swap segment is \d+(\.\d+)?, so an
    // exponent-form amount would silently break the round-trip above. The
    // top end matters too — meme-token balances pass 1e21 units, where
    // String()/toFixed both go exponent (the BigInt path pins this).
    check(
      'mosaic: fmtUnits never emits exponent form (grammar-safe amounts)',
      [1e-7, 0.000015, 0.5, 1234.5678, 2e21, 9.9e15].every((n) => !/e/i.test(fmtUnits(n))) && fmtUnits(1e-7) === '0',
    )

    // One ask, one shape (#595/#597): another money instruction riding the
    // tile message is a NAMED refusal — never a silent drop of the rest.
    // (compileJobAsk nulls on the unparseable tile segment, so without this
    // guard the mosaic gate would claim the compound and eat the send.)
    const rideAlong = parseMosaicAsk('tile my wallet 50% eth, 50% usdc then send 1 USDC on base to 0x9Cc09aD0d6832ffBBFB1b70F1d9E5D0a6d00892A')
    check(
      'mosaic: a ride-along money clause refuses by name, never drops silently',
      rideAlong != null && 'problem' in rideAlong && /send/.test(rideAlong.problem),
    )

    // The chain word is accepted only at the ask's END (the canonical
    // position mosaicAskString writes) — trailing prose once re-routed a
    // plan: "saw it on ethereum twitter" must NOT pick Ethereum.
    const proseChain = parseMosaicAsk('tile my wallet 50% eth, 50% usdc with a shape I saw on ethereum somewhere')
    check(
      'mosaic: mid-prose chain words fall back to the dominant-chain pick',
      proseChain != null && !('problem' in proseChain) && proseChain.chainWord === undefined,
    )

    // A shape is an instruction, not permission to liquidate: the biggest
    // holding sitting OUTSIDE the shape never becomes a leg — it is named in
    // the notes and left exactly where it is.
    const spamHeavy: MosaicHolding[] = [
      { symbol: 'PEPE', balance: 1_000_000_000, priceUsd: 0.000005, valueUsd: 5000 },
      { symbol: 'ETH', balance: 0.2, priceUsd: 2500, valueUsd: 500, native: true },
      { symbol: 'USDC', balance: 100, priceUsd: 1, valueUsd: 100 },
    ]
    const spamPlan = planMosaic({ slices: [{ pct: 50, token: 'ETH' }, { pct: 50, token: 'USDC' }], chainWord: 'base', holdings: spamHeavy })
    check(
      'mosaic: unnamed holdings never become legs — named in the notes, left alone',
      spamPlan.kind === 'plan' &&
        spamPlan.legs.every((l) => !l.includes('PEPE')) &&
        spamPlan.notes.some((n) => /outside the shape stays/.test(n)),
    )

    // ── The HTTP door (/api/mosaics) ──────────────────────────────────────
    const mosaicNoAuth = await fetch(`${BASE}/api/mosaics`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slices: [{ pct: 60, token: 'ETH' }, { pct: 40, token: 'USDC' }] }),
    })
    check('mosaic api: mint without session → 401', mosaicNoAuth.status === 401)

    const tiler = privateKeyToAccount(generatePrivateKey())
    const tilerSession = await signIn(tiler)
    const TJ = { 'content-type': 'application/json', cookie: tilerSession }
    const mintShape = [{ pct: 60, token: 'ETH' }, { pct: 40, token: 'USDC' }]
    const mosaicMint = await fetch(`${BASE}/api/mosaics`, {
      method: 'POST',
      headers: TJ,
      body: JSON.stringify({ slices: mintShape, chain: 'base', agent: 'harness' }),
    })
    const mosaicRow = (await mosaicMint.json()) as { slug?: string; url?: string; ask?: string }
    check(
      'mosaic api: mint returns slug + /i url + the canonical ask',
      mosaicMint.status === 200 && !!mosaicRow.slug && mosaicRow.url === `/i/${mosaicRow.slug}` && mosaicRow.ask === mosaicAskString(mintShape, 'base'),
      mosaicRow.ask,
    )
    const mSlug = mosaicRow.slug ?? 'missing'

    const oneRead = await fetch(`${BASE}/api/mosaics?slug=${mSlug}`)
    const oneBody = (await oneRead.json()) as {
      rows?: Array<{ slug: string; slices?: Array<{ pct: number; token: string }>; chainWord?: string | null; parentSlug?: string | null }>
    }
    const one = oneBody.rows?.[0]
    check(
      'mosaic api: single-slug read returns the row with its parsed slices',
      oneRead.status === 200 &&
        oneBody.rows?.length === 1 &&
        one?.slug === mSlug &&
        one.slices?.length === 2 &&
        one.slices[0].pct === 60 &&
        one.slices[0].token === 'ETH' &&
        one.chainWord === 'base',
    )

    const forkMint = await fetch(`${BASE}/api/mosaics`, {
      method: 'POST',
      headers: TJ,
      body: JSON.stringify({ slices: [{ pct: 50, token: 'ETH' }, { pct: 50, token: 'USDC' }], chain: 'base', parentSlug: mSlug }),
    })
    const forkRow = (await forkMint.json()) as { slug?: string }
    const fSlug = forkRow.slug ?? 'missing'
    const forkRead = await fetch(`${BASE}/api/mosaics?slug=${fSlug}`)
    const forkBody = (await forkRead.json()) as { rows?: Array<{ parentSlug?: string | null }> }
    check(
      'mosaic api: fork mints with parent lineage on the row',
      forkMint.status === 200 && !!forkRow.slug && forkBody.rows?.[0]?.parentSlug === mSlug,
    )

    // The public gallery is a RANKING, so it fences internal rows — these
    // mints are the harness's own. Fork counting keeps its coverage on the
    // targeted ?slug= read, which answers for the row it names.
    const gallery = await fetch(`${BASE}/api/mosaics`)
    const galleryBody = (await gallery.json()) as { rows?: Array<{ slug: string; forks?: number }> }
    check(
      'mosaic api: internal mints never reach the public gallery',
      gallery.status === 200 && !(galleryBody.rows ?? []).some((r) => r.slug === mSlug || r.slug === fSlug),
    )
    const parentRead = (await (await fetch(`${BASE}/api/mosaics?slug=${mSlug}`)).json()) as { rows?: Array<{ slug: string; forks?: number }> }
    check(
      'mosaic api: ?slug= answers for the named row and counts its fork',
      parentRead.rows?.[0]?.slug === mSlug && (parentRead.rows?.[0]?.forks ?? 0) >= 1,
    )

    const badSum = await fetch(`${BASE}/api/mosaics`, {
      method: 'POST',
      headers: TJ,
      body: JSON.stringify({ slices: [{ pct: 50, token: 'ETH' }, { pct: 40, token: 'USDC' }] }),
    })
    const badSumText = await badSum.text()
    check('mosaic api: 90% shape refused 400 quoting the parse problem verbatim', badSum.status === 400 && /90%/.test(badSumText))

    const badAddr = await fetch(`${BASE}/api/mosaics/read?address=not-an-address`)
    check('mosaic api: read with a garbage address → 400', badAddr.status === 400)

    // Cleanup: links get REVOKED through the same door the creator dashboard
    // uses — never deleted (the funnel history stays honest).
    const rv1 = await fetch(`${BASE}/api/intent-links/${mSlug}`, { method: 'DELETE', headers: { cookie: tilerSession } })
    const rv2 = await fetch(`${BASE}/api/intent-links/${fSlug}`, { method: 'DELETE', headers: { cookie: tilerSession } })
    check('mosaic api: both minted links revoked (cleanup)', rv1.status === 200 && rv2.status === 200)
  }

  // ── Agent broker desk (/api/broker/mcp) ──────────────────────────────────
  // The MCP surface other agents negotiate with. Sentences in, sentences and
  // sign links out — the leak check below pins the no-transaction-material
  // contract on the raw wire bytes, not just on our own types.
  console.log('— agent broker desk')
  {
    const MCP_URL = `${BASE}/api/broker/mcp`
    let rpcId = 0
    let mcpSession: string | null = null
    const rpc = async (method: string, params?: unknown, extraHeaders: Record<string, string> = {}): Promise<{ raw: string; result?: any }> => {
      const res = await fetch(MCP_URL, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          accept: 'application/json, text/event-stream',
          ...(mcpSession ? { 'mcp-session-id': mcpSession } : {}),
          ...extraHeaders,
        },
        body: JSON.stringify({ jsonrpc: '2.0', id: ++rpcId, method, params }),
      })
      mcpSession = res.headers.get('mcp-session-id') ?? mcpSession
      const raw = await res.text()
      // Streamable HTTP answers as SSE frames; the payload rides a data: line.
      const data = raw
        .split('\n')
        .filter((l) => l.startsWith('data:'))
        .map((l) => l.slice(5).trim())
        .find((l) => l.includes(`"id":${rpcId}`))
      return { raw, result: data ? JSON.parse(data).result : undefined }
    }
    const call = async (name: string, args: Record<string, unknown> = {}, extraHeaders: Record<string, string> = {}) => {
      const { raw, result } = await rpc('tools/call', { name, arguments: args }, extraHeaders)
      const text: string = result?.content?.find((c: any) => c.type === 'text')?.text ?? ''
      return { raw, isError: !!result?.isError, payload: text && !result?.isError ? JSON.parse(text) : text }
    }

    await rpc('initialize', {
      protocolVersion: '2025-03-26',
      capabilities: {},
      clientInfo: { name: 'harness', version: '0' },
    })
    await rpc('notifications/initialized')

    const caps = await call('broker_capabilities')
    check(
      'broker: capabilities carries the contract + loop',
      !caps.isError &&
        Array.isArray(caps.payload.loop) &&
        /never returns calldata/i.test(caps.payload.contract ?? ''),
    )
    check(
      'broker M6: capabilities advertises the pricing block (free door in this env)',
      !caps.isError && caps.payload?.pricing?.model === 'free' && Array.isArray(caps.payload?.tools),
    )

    const open = await call('broker_open', { ask: 'Buy $15 of AAPL', agent: 'harness' })
    const plan = open.payload?.plan
    check(
      'broker: open quotes the stock ask through a native gate as an action',
      !open.isError && plan?.quote?.kind === 'action' && typeof open.payload.intentId === 'string',
      `gate=${plan?.quote?.gate}`,
    )
    check(
      'broker: composed dapp set rides the quote (robinhood in the mcps)',
      Array.isArray(plan?.quote?.mcps) && plan.quote.mcps.some((m: string) => /robinhood/.test(m)),
      String(plan?.quote?.mcps),
    )
    const intentId = open.payload.intentId as string

    const chosen = await call('broker_choose', { intent_id: intentId, option_id: 'proceed' })
    check(
      'broker: choose(proceed) re-quotes the same working sentence',
      !chosen.isError && chosen.payload?.plan?.ask === 'Buy $15 of AAPL' && chosen.payload.state === 'open',
    )

    const hand = await call('broker_handoff', { intent_id: intentId })
    const slugMatch = typeof hand.payload?.url === 'string' && /\/i\/[a-z0-9]+$/i.test(hand.payload.url)
    const hand2 = await call('broker_handoff', { intent_id: intentId })
    check(
      'broker: handoff mints a durable /i sign link, idempotently',
      !hand.isError && slugMatch && hand2.payload?.url === hand.payload.url,
      hand.payload?.url,
    )

    const status = await call('broker_status', { intent_id: intentId })
    check(
      'broker: status reports handed_off with an untouched funnel',
      !status.isError && status.payload?.state === 'handed_off' && status.payload.funnel?.signed === 0,
    )

    const weather = await call('broker_open', { ask: 'what is the weather in Lisbon' })
    check(
      'broker: non-money ask quotes as planner (cannot move money), never an action',
      !weather.isError && weather.payload?.plan?.quote?.kind === 'planner',
      `kind=${weather.payload?.plan?.quote?.kind}`,
    )

    // The agent-signed path: a SEQUENCED ask compiles to a job owned by the
    // agent's wallet; the MCP returns ids + the drive recipe, never artifacts.
    const seqAsk = 'swap 1 USDC for ETH on base, then send 0.5 USDC on base to 0x2222222222222222222222222222222222222222'
    // The agent's OWN wallet — a real key, because the execute path now
    // demands proof of the wallet (2026-08-18 audit: an unproven wallet let
    // any caller plant a needs-you job in a stranger's Jobs rail).
    const agentWallet = privateKeyToAccount(generatePrivateKey())
    const execOpen = await call('broker_open', {
      ask: seqAsk,
      wallet: agentWallet.address,
      agent: 'harness',
      agent_key: 'harness-desk-key',
    })
    const execIntentId = execOpen.payload.intentId as string
    const noProof = await call('broker_execute', { intent_id: execIntentId })
    check(
      'broker: execute WITHOUT wallet_signature is refused by name (schema) — no job row for an unproven wallet',
      noProof.isError && /wallet_signature/i.test(String(noProof.payload)),
      String(noProof.payload).slice(0, 120),
    )
    const impostor = privateKeyToAccount(generatePrivateKey())
    const impostorSig = await impostor.signMessage({ message: deskExecuteConsentMessage(execIntentId, agentWallet.address) })
    const wrongWallet = await call('broker_execute', { intent_id: execIntentId, wallet_signature: impostorSig })
    check(
      "broker: execute with another wallet's signature over the consent text is refused (recovers to a different wallet)",
      wrongWallet.isError && /recovers to/i.test(String(wrongWallet.payload)),
      String(wrongWallet.payload).slice(0, 120),
    )
    const otherIntentSig = await agentWallet.signMessage({ message: deskExecuteConsentMessage('someotherid', agentWallet.address) })
    const wrongIntent = await call('broker_execute', { intent_id: execIntentId, wallet_signature: otherIntentSig })
    check(
      'broker: a consent signed for a DIFFERENT intent id does not transfer (bound to intent + wallet)',
      wrongIntent.isError && /recovers to|does not verify/i.test(String(wrongIntent.payload)),
    )
    const execSig = await agentWallet.signMessage({ message: deskExecuteConsentMessage(execIntentId, agentWallet.address) })
    const execRes = await call('broker_execute', { intent_id: execIntentId, wallet_signature: execSig })
    const drive = execRes.payload?.drive
    check(
      'broker: execute with the wallet\'s own consent signature compiles the sequenced ask to an agent-owned job + drive recipe',
      !execRes.isError &&
        typeof execRes.payload?.jobId === 'string' &&
        (execRes.payload.steps?.length ?? 0) >= 2 &&
        typeof drive?.poll === 'string' &&
        drive.poll.includes('?t='),
      `${execRes.payload?.steps?.length} legs`,
    )
    check(
      'broker: the consent text is intent+wallet bound, human-readable, and carries no hex material',
      deskExecuteConsentMessage('abc', '0xABCDEF0000000000000000000000000000000001').includes('Intent: abc') &&
        deskExecuteConsentMessage('abc', '0xABCDEF0000000000000000000000000000000001').includes('Wallet: 0xabcdef0000000000000000000000000000000001') &&
        !/0x[0-9a-fA-F]{64,}/.test(deskExecuteConsentMessage('abc', agentWallet.address)),
    )
    const jobPoll = await fetch((drive.poll as string).replace(/^https?:\/\/[^/]+/, BASE))
    const jobBody = (await jobPoll.json()) as { job?: { steps?: unknown[] } }
    check(
      'broker: the capability token drives the job API (the artifact channel)',
      jobPoll.status === 200 && Array.isArray(jobBody.job?.steps) && (jobBody.job?.steps?.length ?? 0) >= 2,
    )

    const single = await call('broker_open', { ask: 'Buy $15 of AAPL', agent: 'harness' })
    const singleExec = await call('broker_execute', { intent_id: single.payload.intentId, wallet_signature: execSig })
    check(
      'broker: execute refuses single-step and wallet-less intents honestly',
      singleExec.isError && /wallet that will SIGN|does not compile/i.test(String(singleExec.payload)),
    )

    // M1 — the agent-tier fence. The agent-signed path refuses an unidentified
    // caller BY NAME: same sequenced ask + wallet, but no agent_key bound.
    const noId = await call('broker_open', {
      ask: seqAsk,
      wallet: '0x3333333333333333333333333333333333333333',
      agent: 'harness',
    })
    const noIdExec = await call('broker_execute', { intent_id: noId.payload.intentId, wallet_signature: execSig })
    check(
      'broker M1: agent-signed execute refuses an intent with no bound identity, by name',
      noIdExec.isError && /bound agent identity|agent_key/i.test(String(noIdExec.payload)),
    )
    await call('broker_close', { intent_id: noId.payload.intentId })

    // M1 — the per-intent notional cap on the agent-signed path (default $500).
    const overCap = await call('broker_open', {
      ask: 'swap $9000 USDC for ETH on base, then send 0.5 USDC on base to 0x2222222222222222222222222222222222222222',
      wallet: '0x4444444444444444444444444444444444444444',
      agent: 'harness',
      agent_key: 'harness-desk-key',
    })
    const overCapExec = await call('broker_execute', { intent_id: overCap.payload.intentId, wallet_signature: execSig })
    check(
      'broker M1: agent-signed execute refuses an intent over the desk cap',
      overCapExec.isError && /desk caps|over/i.test(String(overCapExec.payload)),
    )
    await call('broker_close', { intent_id: overCap.payload.intentId })

    // M3 — the webhook opt-in. A private/SSRF callback is refused server-side;
    // a good https one binds and returns the signing secret ONCE.
    const cbBad = await call('broker_open', {
      ask: 'Buy $15 of AAPL',
      agent: 'harness',
      callback_url: 'http://10.0.0.1/hook',
    })
    check(
      'broker M3: broker_open refuses a private/non-https callback_url (SSRF fence)',
      cbBad.isError && /callback_url rejected/i.test(String(cbBad.payload)),
    )
    const cbGood = await call('broker_open', {
      ask: 'Buy $15 of AAPL',
      agent: 'harness',
      callback_url: 'https://hooks.example.com/pantessa',
    })
    check(
      'broker M3: broker_open binds a good callback and returns the signing secret once',
      !cbGood.isError &&
        cbGood.payload?.callback?.url === 'https://hooks.example.com/pantessa' &&
        /^whsec_[0-9a-f]{48}$/.test(String(cbGood.payload?.callback?.secret ?? '')),
    )
    await call('broker_close', { intent_id: cbGood.payload.intentId })

    // M4 — the track record. Opening with an identity returns the agent's
    // public record URL, and that page renders the honest counts.
    // Internal-run intents (this suite's default) NEVER headline the public
    // credit bureau: a fresh identity opened under the stamp has no record.
    const internalKey = `harness-internal-${Date.now()}`
    const recInternal = await call('broker_open', { ask: 'Buy $15 of AAPL', agent: 'Harness Agent', agent_key: internalKey })
    const recInternalPage = await fetch(`${BASE}/agents/${agentHandleFor(internalKey)}`)
    check(
      'broker M4: an identity whose intents are all internal-run has NO public record (404) — the harness never headlines /agents',
      !recInternal.isError && recInternalPage.status === 404,
    )
    await call('broker_close', { intent_id: recInternal.payload.intentId })
    // The organic path renders (opt this one call out of the suite stamp).
    const organicKey = `harness-organic-${Date.now()}`
    const recOpen = await call('broker_open', { ask: 'Buy $15 of AAPL', agent: 'Harness Agent', agent_key: organicKey }, { [ORGANIC_PROBE]: '1' })
    const expectHandle = agentHandleFor(organicKey)
    check(
      'broker M4: broker_open with an identity returns the agent record URL',
      !recOpen.isError && String(recOpen.payload?.recordUrl ?? '').endsWith(`/agents/${expectHandle}`),
    )
    const recPage = await fetch(`${BASE}/agents/${expectHandle}`)
    const recHtml = flat(await recPage.text())
    check(
      'broker M4: the record page renders the agent, the handle, and honest stats',
      recPage.status === 200 &&
        /clears through Pantessa/i.test(recHtml) &&
        recHtml.includes(expectHandle) &&
        /Money moved/i.test(recHtml),
    )
    const recMissing = await fetch(`${BASE}/agents/${'0'.repeat(16)}`)
    check('broker M4: an unknown agent handle 404s (no phantom records)', recMissing.status === 404)
    // Squad visuals: a shared record renders a CARD in the feed (og:image +
    // twitter:image PNGs), not a bare link — same house palette as /i and /l.
    const recOg = await fetch(`${BASE}/agents/${expectHandle}/opengraph-image`)
    const recTw = await fetch(`${BASE}/agents/${expectHandle}/twitter-image`)
    check(
      'agents OG: /agents/<handle> serves og + twitter PNG cards and declares them',
      recOg.status === 200 &&
        (recOg.headers.get('content-type') ?? '').includes('image/png') &&
        recTw.status === 200 &&
        /twitter:card"[^>]+summary_large_image|summary_large_image[^>]+twitter:card/.test(recHtml) &&
        /\/agents\/[0-9a-f]+\/opengraph-image/.test(recHtml),
    )
    await call('broker_close', { intent_id: recOpen.payload.intentId })

    // M5 — the wallet inbox. broker_send addresses an intent to a wallet; it
    // lands in that wallet's /inbox, one tap from the guarded /i runtime.
    const inboxWallet = '0x5555555555555555555555555555555555555555'
    const sendBad = await call('broker_send', { ask: 'Buy $15 of AAPL', recipient: 'not a wallet', agent: 'harness' })
    check(
      'broker M5: broker_send refuses a recipient that is neither wallet nor claimed handle',
      sendBad.isError && /neither a 0x wallet|is required|No wallet is claimed/i.test(String(sendBad.payload)),
    )
    const sent = await call('broker_send', {
      ask: 'Buy $15 of AAPL',
      recipient: inboxWallet,
      sender_label: 'Harness Bot',
      agent: 'harness',
      agent_key: 'harness-desk-key',
    })
    check(
      'broker M5: broker_send addresses the intent and returns the inbox + /i URLs',
      !sent.isError &&
        sent.payload?.recipient === inboxWallet &&
        String(sent.payload?.inboxUrl ?? '').endsWith(`/inbox/${inboxWallet}`) &&
        /\/i\//.test(String(sent.payload?.url ?? '')),
    )
    const inboxPage = await fetch(`${BASE}/inbox/${inboxWallet}`)
    const inboxHtml = flat(await inboxPage.text())
    check(
      'broker M5: the addressed intent shows in the recipient inbox with its sender',
      inboxPage.status === 200 && /Buy \$15 of AAPL/.test(inboxHtml) && /Harness Bot/.test(inboxHtml) && /Review/.test(inboxHtml),
    )
    // U1 — the rail feed: the same item rides GET /api/inbox for the badge.
    const inboxApi = await fetch(`${BASE}/api/inbox?wallet=${inboxWallet}`)
    const inboxItems = ((await inboxApi.json()) as { items?: { ask?: string; from?: string | null }[] }).items ?? []
    check(
      'broker U1: /api/inbox serves the addressed intent for the rail badge',
      inboxApi.status === 200 && inboxItems.some((i) => i.ask === 'Buy $15 of AAPL' && i.from === 'Harness Bot'),
    )
    const inboxBad = await fetch(`${BASE}/api/inbox?wallet=nope`)
    check('broker U1: /api/inbox refuses a malformed wallet', inboxBad.status === 400)
    // An agent byline can never wear the marks Pantessa stamps itself: human
    // sends carry `@handle` (claimed, server-stamped) or a 0x short address.
    const impersonate = await call('broker_send', {
      ask: 'Buy $15 of AAPL',
      recipient: inboxWallet,
      sender_label: '@nategeier',
      agent: 'harness',
    })
    const impInbox = ((await (await fetch(`${BASE}/api/inbox?wallet=${inboxWallet}`)).json()) as { items?: { slug?: string; from?: string | null }[] }).items ?? []
    const impSlug = String(impersonate.payload?.url ?? '').split('/').pop()
    const impItem = impInbox.find((i) => i.slug === impSlug)
    check(
      'broker M5: sender_label "@handle" / "0x…" shapes are stripped — an agent cannot impersonate a claimed handle in the inbox',
      !impersonate.isError && !!impItem && impItem.from === 'nategeier' &&
        cleanSenderLabel('@@nate') === 'nate' &&
        cleanSenderLabel('0x6626…7257 Nate') === 'Nate' &&
        cleanSenderLabel('0xabcdef') === null &&
        cleanSenderLabel('  Harness  Bot ') === 'Harness Bot' &&
        // QA bypasses (2026-08-18): multi-pass "@@ @nategeier" and fullwidth ＠
        cleanSenderLabel('@@ @nategeier') === 'nategeier' &&
        cleanSenderLabel('\uFF20nategeier') === 'nategeier' &&
        cleanSenderLabel('\uFF20\uFF20 \uFF20nategeier') === 'nategeier' &&
        (() => { try { cleanSenderLabel('Nate \uFF20pantessa'); return false } catch { return true } })() &&
        (() => { try { cleanSenderLabel('sent by 0xdeadbeef1234'); return false } catch { return true } })(),
      `from=${impItem?.from}`,
    )
    // Wire-level: the two bypass strings through broker_send itself.
    const impFull = await call('broker_send', { ask: 'Buy $15 of AAPL', recipient: inboxWallet, sender_label: '\uFF20nategeier', agent: 'harness' })
    const impMulti = await call('broker_send', { ask: 'Buy $15 of AAPL', recipient: inboxWallet, sender_label: '@@ @nategeier', agent: 'harness' })
    const impMid = await call('broker_send', { ask: 'Buy $15 of AAPL', recipient: inboxWallet, sender_label: 'Nate \uFF20pantessa', agent: 'harness' })
    const impInbox2 = ((await (await fetch(`${BASE}/api/inbox?wallet=${inboxWallet}`)).json()) as { items?: { slug?: string; from?: string | null }[] }).items ?? []
    const fromOf = (r: { payload?: { url?: string } }) => impInbox2.find((i) => i.slug === String(r.payload?.url ?? '').split('/').pop())?.from
    check(
      'broker M5: fullwidth ＠ and "@@ @handle" bypasses land as the bare word; a mid-label at-sign is REFUSED (never stored)',
      !impFull.isError && fromOf(impFull) === 'nategeier' &&
        !impMulti.isError && fromOf(impMulti) === 'nategeier' &&
        impMid.isError && /may not contain an @-handle/.test(String(impMid.payload)) &&
        !impInbox2.some((i) => /[@\uFF20]/.test(i.from ?? '')),
      `full=${fromOf(impFull)} multi=${fromOf(impMulti)}`,
    )
    for (const r of [impFull, impMulti]) if (r.payload?.intentId) await call('broker_close', { intent_id: r.payload.intentId })
    if (impersonate.payload?.intentId) await call('broker_close', { intent_id: impersonate.payload.intentId })

    // U2 — the closed-loop receipt seam: the /i page of a desk-bound
    // (addressed) link serializes the notify prop (sender label + push mode)
    // into its RSC payload; the runtime shows it after signing. A plain link
    // must NOT carry a notify label.
    const sentSlug = String(sent.payload.url).split('/').pop()
    const sentPage = await fetch(`${BASE}/i/${sentSlug}`)
    const sentPageHtml = await sentPage.text()
    check(
      'broker U2: an addressed link page carries the sender label for the signed banner',
      sentPage.status === 200 && /Harness Bot/.test(sentPageHtml) && /"push":false/.test(sentPageHtml.replace(/\\/g, '')),
    )
    const plainPage = await fetch(`${BASE}/i/${(hand.payload.url as string).split('/').pop()}`)
    const plainHtml = await plainPage.text()
    check(
      'broker U2: a plain handoff link still resolves its desk sender (agent byline), never a false push',
      plainPage.status === 200 && !/"push":true/.test(plainHtml.replace(/\\/g, '')),
    )
    // Doors run: a NON-addressed link carries no recipient — the runtime's
    // Decline verb never lights on a plain link.
    check(
      'doors: a plain /i link serializes recipient:null (no Decline door)',
      /"recipient":null/.test(plainHtml.replace(/\\/g, '')),
    )
    // The bound /i link is gated to the recipient (allowWallets set).
    const allowed = await fetch(`${BASE}/api/intent-links/${String(sent.payload.url).split('/').pop()}/allowed?wallet=${inboxWallet}`)
    const allowedOther = await fetch(`${BASE}/api/intent-links/${String(sent.payload.url).split('/').pop()}/allowed?wallet=0x6666666666666666666666666666666666666666`)
    check(
      'broker M5: the addressed link targets the recipient (allowlist set to them)',
      ((await allowed.json()) as { allowed?: boolean }).allowed === true &&
        ((await allowedOther.json()) as { allowed?: boolean }).allowed === false,
    )
    await call('broker_close', { intent_id: sent.payload.intentId })

    // ── WAVE-2 discovery: opt-in open-slots feed + slot_token targeting ────
    {
      const J = { 'content-type': 'application/json' }
      const lister = privateKeyToAccount(generatePrivateKey())
      SIGNED_IN_WALLETS.add(lister.address.toLowerCase())
      const mkSlot = async (organic: boolean) => {
        const r = await fetch(`${BASE}/api/roster`, {
          method: 'POST',
          headers: organic ? { ...J, [ORGANIC_PROBE]: '1' } : J,
          body: JSON.stringify({ wallet: lister.address, mandate: 'buy $25 of ETH weekly', capUsd: 50 }),
        })
        return ((await r.json()) as { slot?: { id: string } }).slot?.id ?? ''
      }
      const listSlot = async (slotId: string) => {
        const mint = await fetch(`${BASE}/api/roster/list`, { method: 'POST', headers: J, body: JSON.stringify({ slotId, wallet: lister.address }) })
        const minted = (await mint.json()) as { consentText?: string }
        const sig = await lister.signMessage({ message: minted.consentText ?? '' })
        const done = await fetch(`${BASE}/api/roster/list`, { method: 'POST', headers: J, body: JSON.stringify({ slotId, wallet: lister.address, signature: sig }) })
        return { minted, done: (await done.json()) as { slot?: { listed?: boolean; listToken?: string | null }; error?: string }, status: done.status }
      }
      const organicSlot = await mkSlot(true) // unflagged so the public feed can serve it; released below
      const internalSlot = await mkSlot(false) // suite-stamped — must NEVER reach the feed (T-D4)

      // Listing requires the owner's consent: mallory's signature refuses.
      const preMint = await fetch(`${BASE}/api/roster/list`, { method: 'POST', headers: J, body: JSON.stringify({ slotId: organicSlot, wallet: lister.address }) })
      const preMinted = (await preMint.json()) as { consentText?: string }
      const malSig = await mallory.signMessage({ message: preMinted.consentText ?? '' })
      const malList = await fetch(`${BASE}/api/roster/list`, { method: 'POST', headers: J, body: JSON.stringify({ slotId: organicSlot, wallet: lister.address, signature: malSig }) })
      check(
        "roster discovery: the list consent is server-composed (says 'publishes', hashes the mandate) and a stranger's signature cannot list (T-D2)",
        preMint.status === 200 &&
          /publishes this mandate/.test(preMinted.consentText ?? '') &&
          (preMinted.consentText ?? '').includes(`Slot: ${organicSlot}`) &&
          !(preMinted.consentText ?? '').includes('buy $25 of ETH weekly') &&
          malList.status === 401,
      )
      const orgListed = await listSlot(organicSlot)
      const intListed = await listSlot(internalSlot)
      const orgToken = orgListed.done.slot?.listToken ?? ''
      const intToken = intListed.done.slot?.listToken ?? ''
      const feed = await fetch(`${BASE}/api/roster/feed`)
      const feedBody = (await feed.json()) as { slots?: { slotToken?: string; mandate?: string }[] }
      const feedJson = JSON.stringify(feedBody.slots ?? [])
      check(
        'roster discovery: the owner-listed slot serves on the feed; a stamped (internal) listing NEVER does (T-D4)',
        feed.status === 200 &&
          orgListed.done.slot?.listed === true &&
          /^[A-Za-z0-9_-]{6,24}$/.test(orgToken) &&
          feedJson.includes(orgToken) &&
          intToken.length > 0 &&
          !feedJson.includes(intToken),
        orgListed.done.error ?? '',
      )
      check(
        'roster discovery: the feed NEVER carries a wallet address — the token is the only handle (T-D1)',
        !/0x[0-9a-fA-F]{40}/.test(feedJson),
      )
      // Token-targeted open lands identically to wallet-targeted; the wallet
      // is disclosed only at this engagement. Conflicting targets refuse.
      const tokOpen = await call('broker_open', { ask: 'Buy $15 of AAPL', agent: 'harness', slot_token: orgToken })
      const walOpen = await call('broker_open', { ask: 'Buy $15 of AAPL', agent: 'harness', wallet: lister.address })
      check(
        'roster discovery: broker_open via slot_token == wallet-targeted (same ask/state) + discovery block names the engagement wallet (T-D6)',
        !tokOpen.isError &&
          !walOpen.isError &&
          tokOpen.payload?.state === walOpen.payload?.state &&
          tokOpen.payload?.plan?.ask === walOpen.payload?.plan?.ask &&
          tokOpen.payload?.discovery?.wallet === lister.address.toLowerCase() &&
          tokOpen.payload?.discovery?.slotToken === orgToken,
      )
      const conflict = await call('broker_open', { ask: 'Buy $15 of AAPL', agent: 'harness', slot_token: orgToken, wallet: '0x7777777777777777777777777777777777777777' })
      const badTok = await call('broker_open', { ask: 'Buy $15 of AAPL', agent: 'harness', slot_token: 'nosuchtoken1' })
      check(
        'roster discovery: token+conflicting wallet refuses; an unknown/unlisted token refuses by name',
        conflict.isError && /disagree/.test(String(conflict.payload)) && badTok.isError && /No open listing/.test(String(badTok.payload)),
      )
      for (const r of [tokOpen, walOpen]) if (r.payload?.intentId) await call('broker_close', { intent_id: r.payload.intentId })
      // Release the drill rows (pending slots delete for the session owner —
      // this also proves fire/delete still works on a LISTED slot).
      const listerSession = await signIn(lister)
      for (const id of [organicSlot, internalSlot]) {
        await fetch(`${BASE}/api/roster/fire`, { method: 'POST', headers: { ...J, cookie: listerSession }, body: JSON.stringify({ slotId: id, wallet: lister.address }) })
      }
      const feedAfter = JSON.stringify(((await (await fetch(`${BASE}/api/roster/feed`)).json()) as { slots?: unknown[] }).slots ?? [])
      check('roster discovery: deleting the slot pulls its listing from the feed — drill rows released', !feedAfter.includes(orgToken))
    }

    // ── FIRST-HIRE sprint: the manager cron + the decline verb ─────────────
    {
      const cronAnon = await fetch(`${BASE}/api/cron/roster`)
      const cronWrong = await fetch(`${BASE}/api/cron/roster`, { headers: { authorization: 'Bearer wrong' } })
      check(
        'roster cron: no/wrong CRON_SECRET → 401 (fail closed, guardian pattern)',
        cronAnon.status === 401 && cronWrong.status === 401,
      )
      if (process.env.CRON_SECRET) {
        const cronOk = await fetch(`${BASE}/api/cron/roster`, { headers: { authorization: `Bearer ${process.env.CRON_SECRET}`, 'x-yf-internal-run': '1' } })
        const cronBody = (await cronOk.json()) as { live?: boolean; internal?: unknown }
        check(
          'roster cron: authorized sweep is LIVE by definition — the internal-run header cannot stamp it',
          cronOk.status === 200 && cronBody.live === true && cronBody.internal === undefined,
        )
      }

      // The decline verb: an addressed card can be declined by its recipient
      // (session or stateless consent), leaves the inbox, frees the stacking
      // fence, and the sender reads `declined` — never silence, never a bench.
      const recipient = privateKeyToAccount(generatePrivateKey())
      SIGNED_IN_WALLETS.add(recipient.address.toLowerCase())
      const J2 = { 'content-type': 'application/json' }
      const sent2 = await call('broker_send', { ask: 'Buy $15 of AAPL', recipient: recipient.address, agent: 'harness' })
      const sentSlug2 = String(sent2.payload?.url ?? '').split('/').pop() ?? ''
      const declineAnon = await fetch(`${BASE}/api/roster/decline`, { method: 'POST', headers: J2, body: JSON.stringify({ slug: sentSlug2, wallet: recipient.address }) })
      const declineAnonBody = (await declineAnon.json()) as { consentText?: string }
      check(
        'roster decline: unauthenticated decline refuses (public inbox slugs must not be a griefing verb) and serves the consent text',
        !sent2.isError && declineAnon.status === 401 && /Pantessa inbox — decline/.test(declineAnonBody.consentText ?? '') && (declineAnonBody.consentText ?? '').includes(sentSlug2),
      )
      const malDecline = await fetch(`${BASE}/api/roster/decline`, {
        method: 'POST',
        headers: J2,
        body: JSON.stringify({ slug: sentSlug2, wallet: recipient.address, signature: await mallory.signMessage({ message: declineAnonBody.consentText ?? '' }) }),
      })
      const foreign = await fetch(`${BASE}/api/roster/decline`, {
        method: 'POST',
        headers: J2,
        body: JSON.stringify({ slug: sentSlug2, wallet: mallory.address }),
      })
      check(
        "roster decline: a stranger's signature refuses; a non-recipient wallet refuses (403)",
        malDecline.status === 401 && foreign.status === 403,
      )
      const goodSig = await recipient.signMessage({ message: declineAnonBody.consentText ?? '' })
      const declined = await fetch(`${BASE}/api/roster/decline`, {
        method: 'POST',
        headers: J2,
        body: JSON.stringify({ slug: sentSlug2, wallet: recipient.address, signature: goodSig }),
      })
      const inboxAfterDecline = ((await (await fetch(`${BASE}/api/inbox?wallet=${recipient.address}`)).json()) as { items?: { slug: string }[] }).items ?? []
      const statusAfter = await call('broker_status', { intent_id: sent2.payload.intentId })
      const again = await fetch(`${BASE}/api/roster/decline`, {
        method: 'POST',
        headers: J2,
        body: JSON.stringify({ slug: sentSlug2, wallet: recipient.address, signature: goodSig }),
      })
      check(
        'roster decline: consent decline pulls the card from the inbox, the sender reads `declined` (never silence), replay is a harmless no-op',
        declined.status === 200 &&
          inboxAfterDecline.every((i) => i.slug !== sentSlug2) &&
          !statusAfter.isError &&
          statusAfter.payload?.state === 'declined' &&
          /said no|Declined/i.test(String(statusAfter.payload?.say ?? '')) &&
          again.status === 200,
        JSON.stringify({ d: declined.status, s: statusAfter.payload?.state }),
      )
    }

    // ── RECEIPT VERIFICATION (overnight 2026-09-01, T-R1..T-R7) ────────────
    check(
      'receipts: the pure verdict matrix — reuse/reverted/wrong-from/wrong-target = mismatch; RPC-dark or no expectations = unverified; exact match = verified',
      (() => {
        const W = '0x1111111111111111111111111111111111111111'
        const exp = [{ toAddr: '0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa', selector: '0x12345678' }]
        const tx = { from: W, to: '0xAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA', input: '0x12345678deadbeef' }
        return (
          decideReceiptVerdict({ wallet: W, tx, receiptStatus: 'success', expectations: exp, hashReused: false }) === 'verified' &&
          decideReceiptVerdict({ wallet: W, tx, receiptStatus: 'success', expectations: exp, hashReused: true }) === 'mismatch' &&
          decideReceiptVerdict({ wallet: W, tx: { ...tx, from: '0x2222222222222222222222222222222222222222' }, receiptStatus: 'success', expectations: exp, hashReused: false }) === 'mismatch' &&
          decideReceiptVerdict({ wallet: W, tx, receiptStatus: 'reverted', expectations: exp, hashReused: false }) === 'mismatch' &&
          decideReceiptVerdict({ wallet: W, tx: { ...tx, to: '0xbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb' }, receiptStatus: 'success', expectations: exp, hashReused: false }) === 'mismatch' &&
          decideReceiptVerdict({ wallet: W, tx: { ...tx, input: '0x99999999' }, receiptStatus: 'success', expectations: exp, hashReused: false }) === 'mismatch' &&
          decideReceiptVerdict({ wallet: W, tx: null, receiptStatus: null, expectations: exp, hashReused: false }) === 'unverified' && // RPC dark: delay, never mint (T-R4)
          decideReceiptVerdict({ wallet: W, tx: { ...tx, from: '0x3333333333333333333333333333333333333333' }, receiptStatus: null, expectations: exp, hashReused: false }) === 'mismatch' && // foreign sender is decisive even with no receipt
          decideReceiptVerdict({ wallet: W, tx, receiptStatus: 'success', expectations: [], hashReused: false }) === 'unverified' && // no artifact on record
          decideReceiptVerdict({ wallet: null, tx, receiptStatus: 'success', expectations: exp, hashReused: false }) === 'mismatch' && // signer-less claim never binds
          // a later successful chain read flips the SAME facts to verified — the re-check path (T-R4)
          decideReceiptVerdict({ wallet: W, tx, receiptStatus: 'success', expectations: exp, hashReused: false }) === 'verified'
        )
      })(),
    )
    check(
      'receipts: class comes from the SERVER reading of the ask (T-R5) — jobs/cadence/mosaic/hl/vote/nft/order attested lanes, evm-tx default; legacy NULL counts',
      expectedReceiptClass('swap 1 USDC from base to arbitrum, then send the 1 USDC on arbitrum to 0x2055555555555555555555555555555555555555') === 'job' &&
        expectedReceiptClass('buy $10 of AAPL every week') === 'job' &&
        expectedReceiptClass('anything', 'mosaic') === 'job' &&
        expectedReceiptClass('Protect my ETH long with a 5% stop loss') === 'hl' &&
        expectedReceiptClass('Vote yes on the snapshot proposal') === 'vote' &&
        expectedReceiptClass('Sell my Pudgy NFT on opensea') === 'nft' &&
        expectedReceiptClass('place a limit order: 0.1 ETH at 4000') === 'order' &&
        expectedReceiptClass('Buy $15 of AAPL') === 'evm-tx' &&
        extractTxHash(`https://basescan.org/tx/0x${'ab'.repeat(32)}`) === `0x${'ab'.repeat(32)}` &&
        extractTxHash('junk') === null &&
        COUNTED_EVENT_WHERE.OR.some((c) => 'verification' in c && c.verification === null) &&
        /verification IS NULL/.test(COUNTED_EVENT_SQL),
    )
    {
      // Fail-closed end to end: a fabricated signed beacon (no tx at all,
      // T-R1) flips NOTHING — broker_status stays handed_off, the inbox
      // card stays, and the response says so.
      const rcptWallet = privateKeyToAccount(generatePrivateKey())
      SIGNED_IN_WALLETS.add(rcptWallet.address.toLowerCase())
      const J3 = { 'content-type': 'application/json' }
      const rSent = await call('broker_send', { ask: 'Buy $15 of AAPL', recipient: rcptWallet.address, agent: 'harness' })
      const rSlug = String(rSent.payload?.url ?? '').split('/').pop() ?? ''
      const fab = await fetch(`${BASE}/api/intent-links/${rSlug}/events`, {
        method: 'POST',
        headers: J3,
        body: JSON.stringify({ kind: 'signed', wallet: rcptWallet.address, valueUsd: 15 }),
      })
      const fabBody = (await fab.json()) as { verification?: string }
      const stFab = await call('broker_status', { intent_id: rSent.payload.intentId })
      const inboxFab = ((await (await fetch(`${BASE}/api/inbox?wallet=${rcptWallet.address}`)).json()) as { items?: { slug: string }[] }).items ?? []
      check(
        'receipts T-R1: a fabricated hashless signed beacon stores unverified — status does NOT flip, the inbox card does NOT drop',
        !rSent.isError && fab.status === 200 && fabBody.verification === 'unverified' &&
          !stFab.isError && stFab.payload?.state === 'handed_off' &&
          inboxFab.some((i) => i.slug === rSlug),
        JSON.stringify({ v: fabBody.verification, s: stFab.payload?.state }),
      )
      // T-R2: a spoofed hash pointing at someone ELSE's real Base tx. Best
      // effort to fetch a live foreign tx; RPC-dark degrades to the same
      // fail-closed invariant (unverified — still counts nothing).
      let foreignHash: string | null = null
      try {
        const { createPublicClient: cpc, http: viemHttp } = await import('viem')
        const { base: baseChain } = await import('viem/chains')
        const pub = cpc({ chain: baseChain, transport: viemHttp('https://base-rpc.publicnode.com') })
        // An AGED block — a latest-block tx can lag receipt propagation on
        // the server's own RPC and degrade the assert to the unverified arm.
        const tip = await pub.getBlockNumber()
        const blk = await pub.getBlock({ blockNumber: tip - BigInt(5000) })
        // transactions[0] is the OP-stack L1-deposit SYSTEM tx — skip it;
        // a real user tx is the honest spoof material.
        foreignHash = (blk.transactions[1] ?? blk.transactions[0] ?? null) as string | null
      } catch {
        /* RPC dark — the unverified branch still proves fail-closed */
      }
      const spoof = await fetch(`${BASE}/api/intent-links/${rSlug}/events`, {
        method: 'POST',
        headers: J3,
        body: JSON.stringify({ kind: 'signed', wallet: rcptWallet.address, valueUsd: 15, txHash: foreignHash ?? `0x${'99'.repeat(32)}`, chainId: 8453 }),
      })
      const spoofBody = (await spoof.json()) as { verification?: string }
      const stSpoof = await call('broker_status', { intent_id: rSent.payload.intentId })
      const inboxSpoof = ((await (await fetch(`${BASE}/api/inbox?wallet=${rcptWallet.address}`)).json()) as { items?: { slug: string }[] }).items ?? []
      check(
        "receipts T-R2: a spoofed hash (someone else's real tx / unknown hash) never counts — mismatch or unverified, status still handed_off, card still in the inbox; the status poll ran the lazy re-check without minting anything",
        spoof.status === 200 &&
          (spoofBody.verification === 'mismatch' || spoofBody.verification === 'unverified') &&
          !stSpoof.isError && stSpoof.payload?.state === 'handed_off' &&
          inboxSpoof.some((i) => i.slug === rSlug),
        JSON.stringify({ v: spoofBody.verification, s: stSpoof.payload?.state, live: !!foreignHash }),
      )
      // T-R5 attested lane: a non-EVM-tx-class link (vote) counts on the
      // server's own class read — signed drops the card, status flips.
      const vSent = await call('broker_send', { ask: 'Vote yes on the snapshot proposal', recipient: rcptWallet.address, agent: 'harness' })
      const vSlug = String(vSent.payload?.url ?? '').split('/').pop() ?? ''
      const att = await fetch(`${BASE}/api/intent-links/${vSlug}/events`, {
        method: 'POST',
        headers: J3,
        body: JSON.stringify({ kind: 'signed', wallet: rcptWallet.address }),
      })
      const attBody = (await att.json()) as { verification?: string }
      const stAtt = await call('broker_status', { intent_id: vSent.payload.intentId })
      const inboxAtt = ((await (await fetch(`${BASE}/api/inbox?wallet=${rcptWallet.address}`)).json()) as { items?: { slug: string }[] }).items ?? []
      check(
        "receipts T-R5: a vote-class link attests (no EVM receipt exists) — counted: status flips to signed, the card drops; class came from the ask, not the client",
        att.status === 200 && attBody.verification === 'attested' &&
          !stAtt.isError && stAtt.payload?.state === 'signed' &&
          inboxAtt.every((i) => i.slug !== vSlug),
        JSON.stringify({ v: attBody.verification, s: stAtt.payload?.state }),
      )
      for (const r of [rSent, vSent]) if (r.payload?.intentId) await call('broker_close', { intent_id: r.payload.intentId })
    }

    // broker_tile — MOSAIC on the desk: slices in, a kind='mosaic' /i link
    // out, bound to a broker intent so the funnel reports back. The ask on
    // the wire must round-trip the tile grammar (the sign side's rulebook).
    const tile = await call('broker_tile', {
      slices: [{ pct: 60, token: 'ETH' }, { pct: 40, token: 'USDC' }],
      chain: 'base',
      agent: 'harness',
    })
    const tileSlug = tile.isError ? '' : String(tile.payload.url ?? '').split('/').pop() ?? ''
    check(
      'broker: tile mints a mosaic sign link + fork door off sanitized slices',
      !tile.isError &&
        typeof tile.payload?.intentId === 'string' &&
        /\/i\/.+/.test(String(tile.payload?.url)) &&
        String(tile.payload?.forkUrl ?? '').includes(`/mosaic?from=${tileSlug}`) &&
        tile.payload?.quote?.gate === 'mosaic' &&
        isMosaicAsk(String(tile.payload?.ask)),
      String(tile.payload?.ask ?? tile.payload).slice(0, 80),
    )
    const tileGallery = (await (await fetch(`${BASE}/api/mosaics?slug=${tileSlug}`)).json()) as {
      rows?: { agent?: string | null; slices?: unknown[] }[]
    }
    check(
      "broker: the tile link lands on the mosaic gallery (kind='mosaic') with the desk byline",
      (tileGallery.rows?.length ?? 0) === 1 &&
        /agent desk/.test(tileGallery.rows?.[0]?.agent ?? '') &&
        (tileGallery.rows?.[0]?.slices?.length ?? 0) === 2,
    )
    const tileStatus = await call('broker_status', { intent_id: tile.payload.intentId })
    check(
      'broker: tile intent reports handed_off with the bound link',
      !tileStatus.isError && tileStatus.payload?.state === 'handed_off' && String(tileStatus.payload?.url ?? '').includes(tileSlug),
    )
    const tileBad = await call('broker_tile', { slices: [{ pct: 60, token: 'ETH' }, { pct: 30, token: 'USDC' }] })
    check(
      'broker: a 90% shape refuses with the grammar problem verbatim',
      tileBad.isError && /90%/.test(String(tileBad.payload)),
    )

    // ── THE ROSTER R2 — proposals→inbox binding (lib/roster-propose) ──────
    console.log('— roster R2 (proposals→inbox binding)')
    {
      const employer2 = privateKeyToAccount(generatePrivateKey())
      SIGNED_IN_WALLETS.add(employer2.address.toLowerCase())
      const J = { 'content-type': 'application/json' }
      const rosterAgentKey = 'roster-r2-desk-agent'
      const rosterHash = agentHandleFor(rosterAgentKey)
      const hireSlot = async (acct: PrivateKeyAccount, mandate: string, capUsd: number, hash = rosterHash) => {
        const p = await fetch(`${BASE}/api/roster`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ wallet: acct.address, mandate, capUsd }),
        })
        const slot = ((await p.json()) as { slot?: { id: string } }).slot
        if (!slot) return { slotId: '', ok: false }
        const m = await fetch(`${BASE}/api/roster/hire`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ slotId: slot.id, wallet: acct.address, agentKeyHash: hash }),
        })
        const consentText = ((await m.json()) as { consentText?: string }).consentText ?? ''
        const sig = await acct.signMessage({ message: consentText })
        const h = await fetch(`${BASE}/api/roster/hire`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ slotId: slot.id, wallet: acct.address, signature: sig }),
        })
        return { slotId: slot.id, ok: h.status === 200 }
      }
      const fireSlot = async (acct: PrivateKeyAccount, slotId: string) => {
        const m = await fetch(`${BASE}/api/roster/fire`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ slotId, wallet: acct.address }),
        })
        const consentText = ((await m.json()) as { consentText?: string }).consentText
        if (!consentText) return true // SIWE/pending path resolved in one step
        const sig = await acct.signMessage({ message: consentText })
        const f = await fetch(`${BASE}/api/roster/fire`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ slotId, wallet: acct.address, signature: sig }),
        })
        return f.status === 200
      }

      // 1 — a hired agent's open AUTO-ADDRESSES with the slot badge. The
      // callback_url is bound on purpose: pin 6 proves a STAMPED intent
      // never claims a push even with a callback in place.
      const s1 = await hireSlot(employer2, 'buy $25 of ETH weekly', 50)
      const prop = await call('broker_open', {
        ask: 'Buy $15 of AAPL',
        agent: 'Rebalancer',
        agent_key: rosterAgentKey,
        wallet: employer2.address,
        callback_url: 'https://hooks.example.com/roster',
      })
      const employerLower = employer2.address.toLowerCase()
      check(
        "roster R2: a hired agent's desk open auto-addresses to the employer inbox wearing the slot badge",
        s1.ok &&
          !prop.isError &&
          prop.payload?.state === 'handed_off' &&
          prop.payload?.roster?.slotId === s1.slotId &&
          prop.payload?.roster?.badge?.label === 'Recurring buy' &&
          String(prop.payload?.roster?.inboxUrl ?? '').endsWith(`/inbox/${employerLower}`),
        prop.isError ? String(prop.payload).slice(0, 120) : '',
      )
      const rosterSlug = String(prop.payload?.roster?.url ?? '').split('/').pop() ?? ''
      const rosterInbox = ((await (await fetch(`${BASE}/api/inbox?wallet=${employer2.address}`)).json()) as {
        items?: { slug: string; roster?: { label?: string; mandate?: string; capUsd?: number } }[]
      }).items ?? []
      const rosterItem = rosterInbox.find((i) => i.slug === rosterSlug)
      check(
        'roster R2: the inbox card carries the mandate badge (kind label + canonical sentence + cap)',
        rosterItem?.roster?.label === 'Recurring buy' && rosterItem.roster.mandate === 'buy $25 of ETH weekly' && rosterItem.roster.capUsd === 50,
      )
      // The runtime header badge rides the RSC payload (the splash mounts
      // client-side — same contract as the U2 notify pin): the page must
      // serialize the DB-stored canonical mandate + cap into the roster prop.
      const rosterPageHtml = (await (await fetch(`${BASE}/i/${rosterSlug}`)).text()).replace(/\\/g, '')
      check(
        'roster R2: the /i runtime header wears the slot badge (mandate + cap, DB-stored canonical text)',
        /"roster":\{"label":"Recurring buy","mandate":"buy \$25 of ETH weekly","capUsd":50\}/.test(rosterPageHtml),
      )
      // Doors run: the addressed page serializes its recipient, so the
      // runtime's DECLINE verb can light for exactly that wallet.
      check(
        'doors: an addressed /i page carries the recipient in its RSC payload (the Decline door\'s gate)',
        new RegExp(`"recipient":"${employerLower}"`).test(rosterPageHtml),
      )
      // The inbox PAGE row wears the same badge strings (QA demo-proof
      // finding: the data rode the API but only /i rendered it). Server-
      // rendered, so plain HTML — not the RSC payload.
      const inboxPageHtml = flat(await (await fetch(`${BASE}/inbox/${employer2.address}`)).text())
      check(
        'roster R2: the inbox row wears the mandate badge (same strings as the /i pill)',
        /Recurring buy mandate/.test(inboxPageHtml) && /buy \$25 of ETH weekly/.test(inboxPageHtml) && /\$50 cap/.test(inboxPageHtml),
      )

      // 2 — an UNHIRED agent_key opens a plain desk intent: no addressing.
      const un = await call('broker_open', { ask: 'Buy $15 of AAPL', agent_key: 'never-hired-key', wallet: employer2.address })
      check(
        'roster R2: an unhired agent_key does NOT auto-address — plain open, no roster block',
        !un.isError && un.payload?.state === 'open' && un.payload?.roster === undefined,
      )
      if (un.payload?.intentId) await call('broker_close', { intent_id: un.payload.intentId })

      // 3 — over-cap at OPEN refuses by name AND benches (cap breach is the
      // only bench trigger).
      const over = await call('broker_open', { ask: 'Buy $500 of AAPL', agent_key: rosterAgentKey, wallet: employer2.address })
      const slotsAfterBreach = ((await (await fetch(`${BASE}/api/roster?wallet=${employer2.address}`)).json()) as {
        slots?: { id: string; status: string }[]
      }).slots ?? []
      check(
        'roster R2: an over-cap proposal refuses BY NAME at open and BENCHES the slot',
        over.isError && /caps proposals at \$50/.test(String(over.payload)) && slotsAfterBreach.some((s) => s.id === s1.slotId && s.status === 'benched'),
        String(over.payload).slice(0, 120),
      )
      // 4 — a benched slot refuses new proposals by name.
      const benchedTry = await call('broker_open', { ask: 'Buy $15 of AAPL', agent_key: rosterAgentKey, wallet: employer2.address })
      check('roster R2: a BENCHED slot refuses new proposals by name', benchedTry.isError && /BENCHED/.test(String(benchedTry.payload)))
      check('roster R2: benched slot released (fire)', await fireSlot(employer2, s1.slotId))

      // 5 — the fired-agent race (T5): fire lands AFTER the proposal was
      // addressed → the cascade revokes the pending card and the /i runtime
      // walls; a new proposal refuses by name.
      const s3 = await hireSlot(employer2, 'supply 25 USDC to aave', 50)
      // NB: the proposal must carry a dollar price — 'supply 20 USDC to
      // aave' has no $ figure, and the open gate FAILS CLOSED on unpriceable
      // money asks (proven by the build-gate pin below).
      const prop3 = await call('broker_open', { ask: 'Buy $15 of AAPL', agent_key: rosterAgentKey, wallet: employer2.address })
      const slug3 = String(prop3.payload?.roster?.url ?? '').split('/').pop() ?? ''
      const firedOk = await fireSlot(employer2, s3.slotId)
      const inboxAfterFire = ((await (await fetch(`${BASE}/api/inbox?wallet=${employer2.address}`)).json()) as {
        items?: { slug: string }[]
      }).items ?? []
      const linkAfterFire = await fetch(`${BASE}/i/${slug3}`)
      check(
        'roster R2: firing CASCADES — the pending proposal leaves the inbox and its /i link revokes (T5 human path)',
        s3.ok && !prop3.isError && firedOk && !inboxAfterFire.some((i) => i.slug === slug3) && linkAfterFire.status === 404,
        `link=${linkAfterFire.status}`,
      )
      const firedTry = await call('broker_open', { ask: 'Buy $15 of AAPL', agent_key: rosterAgentKey, wallet: employer2.address })
      check('roster R2: a FIRED slot refuses new proposals by name (terminal)', firedTry.isError && /FIRED/.test(String(firedTry.payload)))

      // 6 — the BUILD gate, mocked build (pure decideProposalGate) + the
      // notify rule: stamped intents never notify.
      check(
        'roster R2: the build gate re-checks status + cap off the build price — fired refuses (race), over-cap refuses by name, unpriceable money fails closed',
        (() => {
          const throws = (fn: () => void, re: RegExp) => {
            try {
              fn()
              return false
            } catch (e) {
              return re.test(String(e))
            }
          }
          const hired = { status: 'hired', capUsd: 50, mandateKind: 'dca' }
          let passes = true
          try {
            decideProposalGate(hired, 25, true, 'build') // under cap → proceeds
            decideProposalGate(hired, null, false, 'build') // non-money unpriceable → proceeds
          } catch {
            passes = false
          }
          return (
            passes &&
            throws(() => decideProposalGate(hired, 75, true, 'build'), /Refused at build.*caps proposals at \$50/) &&
            throws(() => decideProposalGate(hired, null, true, 'build'), /could not be priced/) &&
            throws(() => decideProposalGate({ ...hired, status: 'fired' }, 25, true, 'build'), /Refused at build.*FIRED/) &&
            throws(() => decideProposalGate({ ...hired, status: 'benched' }, 25, true, 'build'), /Refused at build.*BENCHED/)
          )
        })(),
      )
      check(
        'roster R2: stamped intents never notify — notifyEligible refuses internal even with a callback bound; the internal proposal page never claims a push',
        notifyEligible({ isInternal: true, callbackUrl: 'https://hooks.example.com/x' }) === false &&
          notifyEligible({ isInternal: false, callbackUrl: 'https://hooks.example.com/x' }) === true &&
          notifyEligible({ isInternal: false, callbackUrl: null }) === false &&
          !/"push":true/.test(rosterPageHtml.replace(/\\/g, '')),
      )

      // 7 — R2-1 (security finding): a squatter's connect-to-act drafts
      // never block the true owner — quota counts hired/benched only, and
      // pending rows roll (delete-oldest, never refuse).
      const victim = privateKeyToAccount(generatePrivateKey())
      SIGNED_IN_WALLETS.add(victim.address.toLowerCase())
      for (let i = 0; i < 12; i++) {
        await fetch(`${BASE}/api/roster`, {
          method: 'POST',
          headers: J,
          body: JSON.stringify({ wallet: victim.address, mandate: 'buy $10 of ETH weekly' }),
        })
      }
      const victimSlot = await hireSlot(victim, 'stake 0.5 ETH on lido', 40)
      check(
        'roster R2-1: 12 squatter drafts against a wallet — the owner can still draft AND hire (quota counts staffed slots only; drafts roll)',
        victimSlot.ok,
      )

      // 8 — the aggregate fence (§4.4, security r3): a slot bounds UNDECIDED
      // proposals (3) and its trailing-24h estimate sum (3× cap) — both
      // refuse BY NAME, and a budget trip never benches (cap breach only).
      const sB = await hireSlot(employer2, 'buy $25 of ETH weekly', 10)
      const budgetProps: string[] = []
      let threeOk = true
      for (let i = 0; i < 3; i++) {
        const r = await call('broker_open', { ask: 'Buy $9 of AAPL', agent_key: rosterAgentKey, wallet: employer2.address })
        if (r.isError) threeOk = false
        else budgetProps.push(String(r.payload.intentId))
      }
      const fourth = await call('broker_open', { ask: 'Buy $9 of AAPL', agent_key: rosterAgentKey, wallet: employer2.address })
      check(
        'roster R2 §4.4: the 4th undecided proposal refuses by name (3 pending max)',
        threeOk && fourth.isError && /already has 3 undecided proposals/.test(String(fourth.payload)),
        fourth.isError ? String(fourth.payload).slice(0, 100) : 'no refusal',
      )
      for (const id of budgetProps) await call('broker_close', { intent_id: id })
      const overBudget = await call('broker_open', { ask: 'Buy $9 of AAPL', agent_key: rosterAgentKey, wallet: employer2.address })
      const slotAfterBudget = ((await (await fetch(`${BASE}/api/roster?wallet=${employer2.address}`)).json()) as {
        slots?: { id: string; status: string }[]
      }).slots ?? []
      check(
        'roster R2 §4.4: the 3×cap trailing-24h budget refuses by name once pending clears — and a budget trip never benches',
        overBudget.isError &&
          /daily mandate budget \(\$30 = 3× the \$10 cap/.test(String(overBudget.payload)) &&
          slotAfterBudget.some((s) => s.id === sB.slotId && s.status === 'hired'),
        overBudget.isError ? String(overBudget.payload).slice(0, 100) : 'no refusal',
      )
      check('roster R2 §4.4: budget slot released (fire)', await fireSlot(employer2, sB.slotId))

      // 9 — the First Manager (wave 2): the house Rebalancer's brain + its
      // run through the real desk door.
      console.log('— roster manager (lib/roster-manager + the desk door)')
      const managerKey = 'house-manager-drill-key'
      const managerHash = agentHandleFor(managerKey)
      const shapeSlot = { id: 'slot-m', status: 'hired', mandateKind: 'shape', mandateText: 'tile my wallet 60% ETH, 40% USDC', agentKeyHash: managerHash, capUsd: 500 }
      const holdingsOf = (ethUsd: number, usdcUsd: number) => [
        { symbol: 'ETH', balance: ethUsd / 2000, priceUsd: 2000, valueUsd: ethUsd },
        { symbol: 'USDC', balance: usdcUsd, priceUsd: 1, valueUsd: usdcUsd },
      ]
      check(
        'manager: within band proposes NOTHING ("Already in shape" — the mosaic quiet class)',
        (() => {
          const v = decideManagerMove({ slot: shapeSlot, myAgentKeyHash: managerHash, chainWord: 'base', holdings: holdingsOf(600, 400) })
          return v.kind === 'in-shape' && /Already in shape|nothing worth/i.test(v.note)
        })(),
      )
      const drifted = decideManagerMove({ slot: shapeSlot, myAgentKeyHash: managerHash, chainWord: 'base', holdings: holdingsOf(800, 200) })
      check(
        'manager: drift proposes exactly ONE $-priced desk ask targeting the largest drift leg',
        drifted.kind === 'propose' &&
          // The literal $ figure IS the price the desk's askUsd reads — the
          // R2 fail-closed rule would wall an unpriced money ask at open.
          /^Swap \$\d+(?:\.\d+)? of ETH to USDC on base$/.test(drifted.ask) &&
          drifted.driftUsd > 0,
        drifted.kind === 'propose' ? drifted.ask : drifted.note,
      )
      check(
        'manager: wrong-kind / unhired / foreign-hire slots refuse before the desk is even knocked on',
        (() => {
          const dca = decideManagerMove({ slot: { ...shapeSlot, mandateKind: 'dca' }, myAgentKeyHash: managerHash, chainWord: 'base', holdings: [] })
          const fired = decideManagerMove({ slot: { ...shapeSlot, status: 'fired' }, myAgentKeyHash: managerHash, chainWord: 'base', holdings: [] })
          const foreign = decideManagerMove({ slot: { ...shapeSlot, agentKeyHash: 'deadbeefdeadbeef' }, myAgentKeyHash: managerHash, chainWord: 'base', holdings: [] })
          return (
            dca.kind === 'refuse' && /SHAPE mandates only/.test(dca.note) &&
            fired.kind === 'refuse' && /fired/.test(fired.note) &&
            foreign.kind === 'refuse' && /different agent identity/.test(foreign.note)
          )
        })(),
      )
      // The live run: hire the manager into a shape slot, open its proposed
      // ask through the real door → addressed with the Shape badge; a second
      // look while the card is undecided → the one-card fence; fire → the
      // server's FIRED refusal surfaced.
      const sM = await hireSlot(employer2, 'tile my wallet 60% ETH, 40% USDC', 500, managerHash)
      const mOpen = drifted.kind === 'propose'
        ? await call('broker_open', { ask: drifted.ask, agent: 'Pantessa Rebalancer', agent_key: managerKey, wallet: employer2.address })
        : { isError: true, payload: 'no drift ask', raw: '' }
      check(
        "manager: the drift proposal lands ADDRESSED through the real desk door wearing the Shape badge",
        sM.ok && !mOpen.isError && mOpen.payload?.roster?.slotId === sM.slotId && mOpen.payload?.roster?.badge?.label === 'Shape',
        mOpen.isError ? String(mOpen.payload).slice(0, 100) : '',
      )
      const mInbox = ((await (await fetch(`${BASE}/api/inbox?wallet=${employer2.address}`)).json()) as {
        items?: { slug: string; roster?: { slotId?: string } }[]
      }).items ?? []
      const mUndecided = undecidedProposalFor(mInbox, sM.slotId)
      check(
        'manager: a second run while the proposal is undecided refuses to stack (one card at a time)',
        mUndecided !== null && /one card at a time/.test(stackingRefusal(mUndecided?.slug ?? '')),
      )
      check('manager: slot released (fire — cascade clears the card)', await fireSlot(employer2, sM.slotId))
      const mFiredTry = drifted.kind === 'propose'
        ? await call('broker_open', { ask: drifted.ask, agent_key: managerKey, wallet: employer2.address })
        : { isError: false, payload: {}, raw: '' }
      check('manager: after the fire, the server refusal is surfaced by name (FIRED, terminal)', mFiredTry.isError && /FIRED/.test(String(mFiredTry.payload)))

      // Release every roster drill row: fire staffed slots, then SIWE-owned
      // removal of fired history + leftover drafts.
      await fireSlot(victim, victimSlot.slotId)
      for (const [acct, key] of [
        [employer2, null],
        [victim, null],
      ] as [PrivateKeyAccount, null][]) {
        void key
        const session = await signIn(acct)
        const mine = ((await (
          await fetch(`${BASE}/api/roster?wallet=${acct.address}`, { headers: { cookie: session } })
        ).json()) as { slots?: { id: string }[] }).slots ?? []
        for (const s of mine) {
          await fetch(`${BASE}/api/roster/fire`, {
            method: 'POST',
            headers: { ...J, cookie: session },
            body: JSON.stringify({ slotId: s.id, wallet: acct.address }),
          })
          await fetch(`${BASE}/api/roster/fire`, {
            method: 'POST',
            headers: { ...J, cookie: session },
            body: JSON.stringify({ slotId: s.id, wallet: acct.address }),
          })
        }
        const after = ((await (
          await fetch(`${BASE}/api/roster?wallet=${acct.address}`, { headers: { cookie: session } })
        ).json()) as { slots?: unknown[] }).slots ?? []
        check(`roster R2: drill rows released for ${acct.address.slice(0, 8)}…`, after.length === 0)
      }
      if (prop.payload?.intentId) await call('broker_close', { intent_id: prop.payload.intentId })
    }

    // The wire-level pin: nothing any MCP call returned carries 0x-prefixed
    // 64+ hex runs (calldata/typed-data/signature material). Wallet
    // addresses (40) and the bare-hex capability token pass.
    const allRaw = [caps.raw, open.raw, chosen.raw, hand.raw, hand2.raw, status.raw, weather.raw, execOpen.raw, execRes.raw, singleExec.raw, tile.raw, tileStatus.raw, tileBad.raw].join('\n')
    check('broker: no transaction material on the wire (64+ hex scan)', !/0x[0-9a-fA-F]{64,}/.test(allRaw))

    const closed = await call('broker_close', { intent_id: intentId })
    const closedW = await call('broker_close', { intent_id: weather.payload.intentId })
    const closedE = await call('broker_close', { intent_id: execOpen.payload.intentId })
    const closedS = await call('broker_close', { intent_id: single.payload.intentId })
    const closedT = await call('broker_close', { intent_id: tile.payload.intentId })
    const tileGalleryAfter = (await (await fetch(`${BASE}/api/mosaics?slug=${tileSlug}`)).json()) as { rows?: unknown[] }
    check(
      'broker: closing the tile intent revokes its link off the mosaic wall',
      !closedT.isError && (tileGalleryAfter.rows?.length ?? 0) === 0,
    )
    const jobAfter = ((await (
      await fetch((drive.poll as string).replace(/^https?:\/\/[^/]+/, BASE))
    ).json()) as { job?: { status?: string } }).job ?? {}
    const linkGone = await fetch(`${BASE}/i/${(hand.payload.url as string).split('/').pop()}`)
    const linkHtml = flat(await linkGone.text())
    check(
      'broker: close revokes the link, cancels the job, closes every intent',
      !closed.isError &&
        closed.payload.state === 'closed' &&
        !closedW.isError &&
        !closedE.isError &&
        !closedS.isError &&
        jobAfter.status === 'canceled' &&
        !/Connect & build/i.test(linkHtml),
      `job=${jobAfter.status}`,
    )
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

  // ── Honest denominator, suite-wide (2026-08-18) ───────────────────────────
  // A full test:api run must not move ANY stage of the GTM arc. Per-wallet
  // instead of per-total (sibling runs on the shared DB would race a totals
  // diff): every wallet this suite signed in with is read back through the
  // SAME milestone CTEs the dashboard/arc use (`?only=` is admin-gated), and
  // none may appear as an arrival — the burner is a TEST_WALLET (the arc
  // excludes it by name; it never counts as a stranger) and is skipped here.
  {
    const envFs = await import('node:fs')
    const pkRaw = (() => {
      try {
        return envFs.readFileSync('.env.local', 'utf8').match(/^PRIVATE_KEY=(.*)$/m)?.[1]?.trim().replace(/^"|"$/g, '') ?? null
      } catch {
        return null
      }
    })()
    if (pkRaw) {
      const burner = privateKeyToAccount((pkRaw.startsWith('0x') ? pkRaw : `0x${pkRaw}`) as `0x${string}`)
      const adminSession = await signIn(burner)
      const throwaways = [...SIGNED_IN_WALLETS].filter((a) => a !== burner.address.toLowerCase())
      const leaked: string[] = []
      for (let i = 0; i < throwaways.length; i += 64) {
        const slice = throwaways.slice(i, i + 64)
        const r = await fetch(`${BASE}/api/admin/cohorts?days=1&only=${slice.join(',')}`, { headers: { cookie: adminSession } })
        const b = (await r.json()) as { wallets?: ({ address: string; firstSeen?: string } & Record<string, unknown>)[] }
        for (const w of b.wallets ?? []) {
          // A REAL wallet the suite merely replayed read-only (QA drives
          // 0xb74d…/0x6626… through chat bodies) has an ORGANIC first_seen
          // from before this run — that is not a leak. Only a wallet whose
          // first arrival is at/after suite start was minted BY the suite.
          const firstSeen = Date.parse(String(w.firstSeen ?? ''))
          if (Number.isFinite(firstSeen) && firstSeen < SUITE_STARTED_AT - 60_000) continue
          leaked.push(
            `${w.address.slice(0, 10)}…(surface=${w.surface ?? '-'} toggle=${w.firstToggle ? 'y' : '-'} standing=${w.standingKind ?? '-'} links=${w.links ?? 0} via=${w.via ?? '-'})`,
          )
        }
      }
      check(
        `arrivals: a full suite run leaves NO wallet it minted as an arrival on the cohorts/arc view (${throwaways.length} wallets read back; pre-run organic first_seen = replayed real wallet, not a leak)`,
        leaked.length === 0,
        leaked.length ? `LEAKED ${leaked.length}: ${leaked.slice(0, 8).join(' ')}` : '',
      )
      const daysEcho = (await (await fetch(`${BASE}/api/admin/cohorts?days=1&only=${throwaways.slice(0, 1).join(',') || '0x0000000000000000000000000000000000000001'}`, { headers: { cookie: adminSession } })).json()) as { windowDays?: number }
      const daysBad = (await (await fetch(`${BASE}/api/admin/cohorts?days=999&only=0x0000000000000000000000000000000000000001`, { headers: { cookie: adminSession } })).json()) as { windowDays?: number }
      check('cohorts: ?days= is honored for any 1..90 (days=1 → 1, not the 14d default); out of range falls to 14', daysEcho.windowDays === 1 && daysBad.windowDays === 14)
      // ask_failures: the admin feed hides internal-run rows by default and
      // labels them under ?internal=1 (the stamped refusal beacon above).
      const afDefault = (await (await fetch(`${BASE}/api/admin/ask-failures?days=1`, { headers: { cookie: adminSession } })).json()) as { failures?: { internal?: boolean; prompt?: string }[] }
      const afAll = (await (await fetch(`${BASE}/api/admin/ask-failures?days=1&internal=1`, { headers: { cookie: adminSession } })).json()) as { failures?: { internal?: boolean; prompt?: string }[] }
      check(
        'ask_failures: /api/admin/ask-failures hides is_internal rows by default; ?internal=1 shows them labelled internal:true',
        (afDefault.failures ?? []).every((f) => f.internal !== true) &&
          (afAll.failures ?? []).some((f) => f.internal === true && /stamped drill/.test(f.prompt ?? '')),
        `default=${afDefault.failures?.length} all=${afAll.failures?.length}`,
      )
      // Roster observability (doors run): a REAL mandate refusal writes a
      // kind='roster' row through lib/roster-observe. The belt adds
      // x-yf-no-ask-log:'1' to every /api/roster call (this suite provokes
      // refusals by the hundred — the queue stayed empty of them, proven by
      // afAll above containing no roster rows before this probe); sending
      // '0' opts THIS one probe back in, internal-stamped.
      const rosterProbe = `do a cartwheel with my money ${Date.now()}`
      const rp = await fetch(`${BASE}/api/roster`, {
        method: 'POST',
        headers: { 'content-type': 'application/json', 'x-yf-no-ask-log': '0' },
        body: JSON.stringify({ wallet: '0x9999999999999999999999999999999999999999', mandate: rosterProbe }),
      })
      await new Promise((r) => setTimeout(r, 400)) // the write is fire-and-forget
      const afRoster = (await (
        await fetch(`${BASE}/api/admin/ask-failures?days=1&internal=1`, { headers: { cookie: adminSession } })
      ).json()) as { failures?: { internal?: boolean; kind?: string; prompt?: string; buildPath?: string | null; build_path?: string | null }[] }
      const rosterRow = (afRoster.failures ?? []).find((f) => f.kind === 'roster' && (f.prompt ?? '').includes(rosterProbe))
      check(
        "roster observability: a refused mandate lands in ask_failures as kind 'roster' (surface-tagged, internal-stamped, no-ask-log honored)",
        rp.status === 400 &&
          !!rosterRow &&
          rosterRow.internal === true &&
          (rosterRow.prompt ?? '').startsWith('[roster:mandate]') &&
          // the belt held: every roster row in the window is internal-stamped
          // (this suite provokes refusals by the hundred — an unstamped row
          // would mean the opt-out or the stamp leaked; runs on the shared DB
          // stack probe rows, so count is not asserted)
          (afRoster.failures ?? []).filter((f) => f.kind === 'roster').every((f) => f.internal === true),
        `row=${rosterRow ? 'found' : 'missing'} rosterRows=${(afRoster.failures ?? []).filter((f) => f.kind === 'roster').length}`,
      )
    }
  }

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
