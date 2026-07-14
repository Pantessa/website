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
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'
import { grantTypedData } from '../lib/grant-typed-data'
import { grantViolation, type GrantPolicy } from '../lib/spend-grant'
import { routerPrompt, parseRouterDecision, selectInferenceProvider, routeMessage, shortlistEndpoints } from '../lib/router'
import { buildSmartRequest, computeRating, type PlannableEndpoint } from '../lib/endpoint-planner'
import { buildSignableArtifact, isActionIntent, orderRequestOf, txRequestOf, txChainOf } from '../lib/transaction-layer'
import { resolveToken, buildCowOrderTypedData, cowOrderAction, buildCowLimitOrder, buildCowSubmitBody, describeCowOrder, describeAmount, formatAtoms, tokenDecimals, tokenLabel, humanToAtoms, applySlippage, COW_APP_DATA_JSON, GPV2_SETTLEMENT, type CowQuoteResult } from '../lib/cow'
import { primeTokenList } from '../lib/token-list'
import { pureChecks, policyCheck, orderValueUsd, buildReport } from '../lib/cow-guardrails'
import { parseSwapIntent } from '../lib/swap-intent'
import { usdToTokenAmount } from '../lib/usd-probe'
import { parseRobinhoodBridge, guardRobinhoodBridge, RH_L1_INBOX, ARB_SYS } from '../lib/robinhood-bridge'
import { keccak256, stringToBytes } from 'viem'
import { isCacheable, routeCacheKey, getCached, setCached, clearRouteCache } from '../lib/route-cache'
import { routeSavings } from '../lib/route-telemetry'
import { portfolioFromToolResult, portfolioOf } from '../lib/portfolio-display'
import { crossChainAgentOf, detectCrossChain, swapWorkingContext } from '../lib/swap-intent'
import { encodeV4SwapCalldata, guardUniswapV4Build, type V4BuiltStep, type V4GuardExpectations, type V4PoolKey } from '../lib/uniswap-v4'
import { APP_CHAINS, chainById, chainNamedIn, sanitizeChainId } from '../lib/chains'
import { parseCrossChainSwap, guardCrossChainBuild, expectedOriginChainId, parseCrossChainFollowUp } from '../lib/cross-chain-swap'
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
  type GuardianPolicyParams,
  type GuardianPosition,
} from '../lib/hl-guardian'
import {
  parseHlIntent,
  buildHlOrderAction,
  guardHlExecBuild,
  buildHlDeposit,
  hlActionTypedData,
  HL_BRIDGE2_ARBITRUM,
  ARBITRUM_USDC,
  type HlOrderIntent,
} from '../lib/hyperliquid-exec'
import { compileJobAsk } from '../lib/jobs'
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
      planBody.usage?.allowance === 2500 &&
      planBody.usage?.used === 0 &&
      planBody.usage?.remaining === 2500,
    `plan=${planBody.usage?.plan} used=${planBody.usage?.used}`,
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
    ins.totals?.turns === 4 &&
      ins.totals?.deadEndSessions === 1 &&
      Array.isArray(ins.deadEnds) &&
      ins.deadEnds[0]?.turns?.[0]?.prompt === 'swap 5 USDC to WETH on my chain',
    `turns=${ins.totals?.turns} deadEnds=${ins.totals?.deadEndSessions}`,
  )
  check(
    'insights: money moved sums the notional (builtUsd + signedUsd = 25.5 each)',
    ins.totals?.builtUsd === 25.5 && ins.totals?.signedUsd === 25.5,
    `builtUsd=${ins.totals?.builtUsd} signedUsd=${ins.totals?.signedUsd}`,
  )
  check(
    'insights: transactions carry valueUsd + per-site signedUsd rolls up',
    (ins.transactions as { valueUsd: number | null }[])?.some((x) => x.valueUsd === 25.5) &&
      (ins.perSite as { origin: string; signedUsd: number }[])?.find((s) => s.origin === 'https://harness-embed.test')?.signedUsd === 25.5,
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
  // The pivot (2026-07-07, website#326) retold the homepage: compose MCPs →
  // one embeddable agent. The old expectation ("routing") is the pre-pivot story.
  check(
    'router: descriptive <title> (the pivot story: compose + embed)',
    /<title>[^<]*(embeddable|[Cc]ompose)[^<]*<\/title>/.test(homeHtml),
  )
  const sitemapXml = await (await fetch(`${BASE}/sitemap.xml`)).text()
  check('sitemap: site root is listed', /<loc>https?:\/\/[^</]+\/?<\/loc>/.test(sitemapXml))

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
  // The spend policy now defaults OFF (unrestricted), so the enforcement tests
  // below must opt the owner's grant INTO the policy first — otherwise the gate
  // short-circuits and nothing is blocked (that bypass is covered above).
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

    // Follow-ups.
    const pend = { kind: 'xchain', data: { amount: '1', originToken: 'USDC', originChain: 'base', destinationToken: 'USDC', destinationChain: 'arbitrum', depositAddress: DEPOSIT } }
    check('xchain follow-up: "cancel" drops it', parseCrossChainFollowUp('cancel', pend)?.kind === 'cancel')
    check('xchain follow-up: "confirm" is a noop (button already there)', parseCrossChainFollowUp('confirm', pend)?.kind === 'noop')
    const amend = parseCrossChainFollowUp('make it 2', pend)
    check('xchain follow-up: "make it 2" re-amount', amend?.kind === 'amend' && amend.params.amount === '2' && amend.params.originChain === 'base')
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
      validTo: 1893456000, appData: '0x' + '0'.repeat(64), feeAmount: '250000',
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
  // The core is venue-neutral: the same gate refuses a host outside the
  // allowlist — what Uniswap's adapter (A10) plugs into unchanged.
  check('guardrails: core policyCheck gates by HOST (venue-neutral)', policyCheck(10, gPolicy, 0, 'uniswap.yeetful.com').violation === 'NOT_ALLOWED')
  const slipped = applySlippage(cowFixture, 100) // 1%
  check(
    'guardrails: applySlippage lowers the signed min-buy by bps',
    slipped.order.buyAmount === '24750000000000000' && cowFixture.order.buyAmount === '25000000000000000',
  )
  check('guardrails: applySlippage rejects out-of-range bps', (() => {
    try { applySlippage(cowFixture, 20000); return false } catch { return true }
  })())

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
  // Native swap tool: fires with NO service shortlisted (Nate 2026-07-02 —
  // swap building is Yeetful's own tool, not gated on CoW being active).
  // Deterministic paths only (clarify + connect-wallet); the live build is a
  // manual smoke (real CoW quote).
  const nativeClarify = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'swap USDC for WETH', activeServers: [], walletAddress: '0x1111111111111111111111111111111111111111' }),
  }).then((r) => r.json())
  check('native swap: clarifies with zero services active', typeof nativeClarify.reply === 'string' && nativeClarify.reply.includes('amount and pair'))
  const nativeNoWallet = await fetch(`${BASE}/api/chat`, {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'swap 2 USDC for WETH', activeServers: [] }),
  }).then((r) => r.json())
  check('native swap: asks to connect a wallet (not a Claude lecture)', typeof nativeNoWallet.reply === 'string' && /connect your wallet/i.test(nativeNoWallet.reply))

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

    const snap = { assetIndex: 4, szDecimals: 4, markPx: 3000, positionSzi: 0 }
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
