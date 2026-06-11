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
 *   • Chat receipts: Message.meta round-trip + public share-page render
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
