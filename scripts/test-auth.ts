#!/usr/bin/env tsx
/**
 * End-to-end test of the SIWE auth + scoped chat API against a running dev
 * server (npm run dev). Proves: valid sign-in works, a spoofed signature is
 * rejected, chats are isolated per wallet, and public sharing works.
 *
 *   npm run dev          # in one terminal
 *   npm run test:auth    # in another
 */
import { generatePrivateKey, privateKeyToAccount, type PrivateKeyAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

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

/** Run the SIWE flow; returns the session cookie (or null) + verify status. */
async function signIn(
  account: PrivateKeyAccount,
  opts: { signWith?: PrivateKeyAccount } = {},
): Promise<{ status: number; session: string | null }> {
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
  // Sign with a different key to simulate a spoof.
  const signature = await (opts.signWith ?? account).signMessage({ message })

  const headers: Record<string, string> = { 'content-type': 'application/json' }
  if (nonceCookie) headers.cookie = nonceCookie
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ message, signature }),
  })
  return { status: res.status, session: getCookie(res, 'yf_session') }
}

const J = (session: string | null): Record<string, string> => (session ? { cookie: session } : {})

async function main() {
  console.log(`\nTesting SIWE auth @ ${BASE}\n`)
  const alice = privateKeyToAccount(generatePrivateKey())
  const bob = privateKeyToAccount(generatePrivateKey())

  // 1. Spoof: Alice's message, Bob's signature → must be rejected.
  const spoof = await signIn(alice, { signWith: bob })
  check('spoofed signature rejected', spoof.status === 401 && !spoof.session, `status ${spoof.status}`)

  // 2. Valid sign-in for Alice and Bob.
  const a = await signIn(alice)
  const b = await signIn(bob)
  check('Alice signs in', a.status === 200 && !!a.session)
  check('Bob signs in', b.status === 200 && !!b.session)

  // 3. Unauthenticated list is 401.
  const anon = await fetch(`${BASE}/api/chats`)
  check('no session → 401 on /api/chats', anon.status === 401)

  // 4. Alice creates a chat.
  const created = await fetch(`${BASE}/api/chats`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...J(a.session) },
    body: JSON.stringify({ title: 'Trip to Lisbon', activeServerIds: ['yeetful-claude', 'tripadvisor'] }),
  })
  const chat = await created.json()
  check('Alice creates a chat', created.status === 201 && !!chat.id)

  // 5. Alice sees it; Bob does not.
  const aList = await (await fetch(`${BASE}/api/chats`, { headers: J(a.session) })).json()
  const bList = await (await fetch(`${BASE}/api/chats`, { headers: J(b.session) })).json()
  check('Alice lists her chat', Array.isArray(aList) && aList.some((c: { id: string }) => c.id === chat.id))
  check('Bob does NOT see Alice’s chat', Array.isArray(bList) && !bList.some((c: { id: string }) => c.id === chat.id))

  // 6. Bob can't read Alice's private chat.
  const bobGet = await fetch(`${BASE}/api/chats/${chat.id}`, { headers: J(b.session) })
  check('Bob blocked from Alice’s private chat (404)', bobGet.status === 404)

  // 7. Append a message (owner only).
  const msg = await fetch(`${BASE}/api/chats/${chat.id}/messages`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...J(a.session) },
    body: JSON.stringify({ role: 'user', content: 'best things to do in Lisbon?' }),
  })
  check('Alice appends a message', msg.status === 201)

  // 8. Share it publicly → public slug → readable without auth.
  const shared = await (
    await fetch(`${BASE}/api/chats/${chat.id}`, {
      method: 'PATCH',
      headers: { 'content-type': 'application/json', ...J(a.session) },
      body: JSON.stringify({ isPublic: true }),
    })
  ).json()
  check('Alice shares the chat (gets publicSlug)', shared.isPublic === true && !!shared.publicSlug)

  const pub = await fetch(`${BASE}/api/p/${shared.publicSlug}`)
  const pubBody = await pub.json()
  check('public link readable with no auth', pub.status === 200 && pubBody.title === 'Trip to Lisbon')
  check('public payload hides owner address', pubBody.ownerAddress === undefined)

  // 9. Now Bob CAN read it (public), but as non-owner.
  const bobPublic = await fetch(`${BASE}/api/chats/${chat.id}`, { headers: J(b.session) })
  const bobPublicBody = await bobPublic.json()
  check('Bob can read once public', bobPublic.status === 200 && bobPublicBody.isOwner === false)

  // 10. Bob still can't delete it.
  const bobDel = await fetch(`${BASE}/api/chats/${chat.id}`, { method: 'DELETE', headers: J(b.session) })
  check('Bob cannot delete Alice’s chat', bobDel.status === 404)

  // 11. Alice deletes it (cleanup).
  const del = await fetch(`${BASE}/api/chats/${chat.id}`, { method: 'DELETE', headers: J(a.session) })
  check('Alice deletes her chat', del.status === 200)

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
