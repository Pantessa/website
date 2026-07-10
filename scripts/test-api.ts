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
import { buildSignableArtifact, isActionIntent, orderRequestOf, txRequestOf } from '../lib/transaction-layer'
import { resolveToken, buildCowOrderTypedData, cowOrderAction, buildCowLimitOrder, buildCowSubmitBody, describeCowOrder, describeAmount, formatAtoms, tokenDecimals, humanToAtoms, applySlippage, COW_APP_DATA_JSON, GPV2_SETTLEMENT, type CowQuoteResult } from '../lib/cow'
import { pureChecks, policyCheck, orderValueUsd, buildReport } from '../lib/cow-guardrails'
import { parseSwapIntent } from '../lib/swap-intent'
import { keccak256, stringToBytes } from 'viem'
import { isCacheable, routeCacheKey, getCached, setCached, clearRouteCache } from '../lib/route-cache'
import { routeSavings } from '../lib/route-telemetry'
import { portfolioFromToolResult, portfolioOf } from '../lib/portfolio-display'
import { crossChainAgentOf, detectCrossChain } from '../lib/swap-intent'
import { parseCrossChainSwap, guardCrossChainBuild, expectedOriginChainId, parseCrossChainFollowUp } from '../lib/cross-chain-swap'
import { parseAaveSupply, pickSupplyReserve, guardAaveSupplyBuild, parseAaveSupplyFollowUp } from '../lib/aave-supply'
import { encodeFunctionData, erc20Abi } from 'viem'

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
  const insNoAuth = await fetch(`${BASE}/api/embeds/insights`)
  check('insights require auth → 401', insNoAuth.status === 401)
  const ins = await (await fetch(`${BASE}/api/embeds/insights`, { headers: C })).json()
  check(
    'insights: the refused turn lands as a dead-end session with the verbatim ask',
    ins.totals?.turns === 1 &&
      ins.totals?.deadEndSessions === 1 &&
      Array.isArray(ins.deadEnds) &&
      ins.deadEnds[0]?.turns?.[0]?.prompt === 'swap 5 USDC to WETH on my chain',
    `turns=${ins.totals?.turns} deadEnds=${ins.totals?.deadEndSessions}`,
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
