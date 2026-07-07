#!/usr/bin/env tsx
/**
 * One-shot smoke: SIWE-sign-in with a throwaway wallet, then POST
 * /api/billing/checkout for each paid plan and confirm Stripe answers with a
 * real checkout.stripe.com URL. Creating a Checkout Session is free — no
 * charge happens until a card is entered. Needs STRIPE_SECRET_KEY on the
 * server under test.
 *
 *   BASE=http://localhost:3223 npx tsx scripts/smoke-stripe-checkout.ts
 */
import { generatePrivateKey, privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const BASE = process.env.BASE ?? 'http://localhost:3223'
const DOMAIN = new URL(BASE).host

function getCookie(res: Response, name: string): string | null {
  for (const c of res.headers.getSetCookie?.() ?? []) {
    const m = c.match(new RegExp(`^${name}=([^;]+)`))
    if (m) return `${name}=${m[1]}`
  }
  return null
}

async function main() {
  const account = privateKeyToAccount(generatePrivateKey())
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`)
  const nonceCookie = getCookie(nonceRes, 'yf_siwe_nonce')
  const { nonce } = await nonceRes.json()
  const message = createSiweMessage({
    address: account.address,
    chainId: 8453,
    domain: DOMAIN,
    nonce,
    uri: `${BASE}/`,
    version: '1',
  })
  const signature = await account.signMessage({ message })
  const verifyRes = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = getCookie(verifyRes, 'yf_session')
  if (!verifyRes.ok || !session) throw new Error(`SIWE sign-in failed: ${verifyRes.status}`)
  console.log(`signed in as throwaway ${account.address.slice(0, 8)}…`)

  for (const plan of ['growth', 'scale']) {
    const res = await fetch(`${BASE}/api/billing/checkout`, {
      method: 'POST',
      headers: { 'content-type': 'application/json', cookie: session },
      body: JSON.stringify({ plan }),
    })
    const body = (await res.json()) as { url?: string; error?: string }
    const ok = res.ok && typeof body.url === 'string' && /^https:\/\/checkout\.stripe\.com\//.test(body.url)
    console.log(`${ok ? '✅' : '❌'} checkout(${plan}) → ${res.status} ${ok ? body.url!.slice(0, 48) + '…' : JSON.stringify(body)}`)
    if (!ok) process.exitCode = 1
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
