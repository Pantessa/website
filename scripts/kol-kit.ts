#!/usr/bin/env tsx
/**
 * KOL kit minting tool (HANDOFF-yeetcall-gtm C6) — one command turns a
 * target KOL into a FINISHED outreach artifact: their call link (minted
 * with their byline), the OG preview, and a filled DM ready to paste.
 *
 *   npx tsx scripts/kol-kit.ts --handle cryptojoe --ask "Long $50 of ETH on Hyperliquid, then protect my ETH long with a 5% stop"
 *   flags: --base https://www.pantessa.com   (default prod)
 *          --dry                            (print without minting)
 *
 * Mints as the .env.local burner (OWNER_WALLETS admin → uncapped, house
 * discipline: revoke unused outreach links after the campaign). The DM
 * leads with the artifact, not the pitch — the research lesson: KOLs
 * answer finished things, not decks.
 */
import fs from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const DRY = process.argv.includes('--dry')
const BASE = arg('base', 'https://www.pantessa.com')
const HANDLE = arg('handle', '').replace(/^@/, '')
const ASK = arg('ask', '')

const env = Object.fromEntries(
  fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
)

async function signIn(): Promise<string> {
  const pk = (env.PRIVATE_KEY.startsWith('0x') ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`) as `0x${string}`
  const account = privateKeyToAccount(pk)
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`)
  const nonceCookie = (nonceRes.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_siwe_nonce=([^;]+)/)?.[1]).find(Boolean)
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
  const signature = await account.signMessage({ message })
  const res = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: `yf_siwe_nonce=${nonceCookie}` } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = (res.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_session=([^;]+)/)?.[1]).find(Boolean)
  if (!session) throw new Error(`SIWE failed (${res.status}): ${await res.text()}`)
  return `yf_session=${session}`
}

function dm(handle: string, url: string): string {
  return `hey — built you something.

${url}

it's your call ("${ASK}") as a one-tap link: anyone who opens it gets the exact trade built + guarded, signs from their own wallet, done. no deposits, no custody, receipts on-chain.

you earn 50% of our fee on every trade it produces — and on every later trade from any wallet it brings, for life (first touch). the deal is disclosed right on the page, which is the point: paid calls that say so.

your earnings vs your ref codes, side by side, on your dashboard. if it doesn't out-earn them in 30 days, kill it. want it under your own branding? takes 2 min — I'll set it up.`
}

async function main() {
  if (!HANDLE || !ASK) {
    console.error('usage: npx tsx scripts/kol-kit.ts --handle <x-handle> --ask "<the call>" [--base url] [--dry]')
    process.exit(1)
  }
  if (DRY) {
    console.log(`[dry] would mint for @${HANDLE}: "${ASK}" on ${BASE}\n`)
    console.log(dm(HANDLE, `${BASE}/i/<slug>`))
    return
  }
  const cookie = await signIn()
  const res = await fetch(`${BASE}/api/intent-links`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie },
    body: JSON.stringify({ ask: ASK, agent: `@${HANDLE}` }),
  })
  const body = (await res.json()) as { slug?: string; url?: string; error?: string }
  if (!res.ok || !body.slug) throw new Error(body.error ?? `mint failed (${res.status})`)
  const url = `${BASE}/i/${body.slug}`
  console.log(`minted for @${HANDLE}: ${url}`)
  console.log(`OG preview:        ${url}/opengraph-image`)
  console.log(`funnel (yours):    ${BASE}/dashboard/links`)
  console.log(`\n── PASTE-READY DM ──────────────────────────────\n`)
  console.log(dm(HANDLE, url))
}

void main()
