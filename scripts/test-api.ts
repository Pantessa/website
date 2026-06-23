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
import { routerPrompt, parseRouterDecision, selectInferenceProvider } from '../lib/router'
import type { PlannableEndpoint } from '../lib/endpoint-planner'

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
  check(
    'router: descriptive <title> (the routing-engine flagship)',
    /<title>[^<]*routing[^<]*<\/title>/.test(homeHtml),
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
        },
      }),
    })
  ).json()
  const loaded = await (await fetch(`${BASE}/api/chats/${chat.id}`, { headers: C })).json()
  const loadedMsg = loaded.messages?.find((m: { id: string }) => m.id === msg.id)
  check('meta.receipts + payer round-trip', loadedMsg?.meta?.payer === 'your wallet' && loadedMsg.meta.receipts.length === 3)

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
