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

  // ── Wallet-mode plan gate (policy enforced BEFORE signature requests) ─────
  console.log('— wallet plan gate')
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
          ],
        },
      }),
    })
  ).json()
  const loaded = await (await fetch(`${BASE}/api/chats/${chat.id}`, { headers: C })).json()
  const loadedMsg = loaded.messages?.find((m: { id: string }) => m.id === msg.id)
  check('meta.receipts + payer round-trip', loadedMsg?.meta?.payer === 'your wallet' && loadedMsg.meta.receipts.length === 2)

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

  // ── Cleanup (verified) ────────────────────────────────────────────────────
  console.log('— cleanup')
  const delChat = await fetch(`${BASE}/api/chats/${chat.id}`, { method: 'DELETE', headers: C })
  const delGrant = await fetch(`${BASE}/api/grants/${grant.id}`, { method: 'DELETE', headers: C })
  const left = await Promise.all([
    (await fetch(`${BASE}/api/keys`, { headers: C })).json(),
    (await fetch(`${BASE}/api/grants`, { headers: C })).json(),
    (await fetch(`${BASE}/api/chats`, { headers: C })).json(),
  ])
  check(
    'all rows cleaned (keys, grants+ledger, chats)',
    delChat.status === 200 && delGrant.status === 200 && left.every((l) => Array.isArray(l) && l.length === 0),
  )

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
