#!/usr/bin/env tsx
/**
 * Jobs API quickstart — the exact walkthrough from the docs, runnable, $0.
 *
 * An "external agent" is anything that can make two HTTP calls. This script
 * plays one: it authenticates, submits a compound intent as a DRY RUN, and
 * prints the compiled plan + step 1's real, guard-checked artifact. Nothing
 * is created, nothing can be signed, nothing costs anything.
 *
 *   YF_API_KEY=yf_…      npx tsx scripts/jobs-api-demo.ts        # Bearer key (mint at /dashboard/keys)
 *   (or .env.local PRIVATE_KEY → SIWE, the wallet-native path)
 *   flags: --base https://www.yeetful.com   --ask "…"   --live (create for real)
 */
import fs from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const BASE = arg('base', 'https://www.yeetful.com')
const ASK = arg(
  'ask',
  'deposit 12 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop',
)
const LIVE = process.argv.includes('--live')

async function authHeaders(): Promise<Record<string, string>> {
  // Path 1: a yf_ API key (how a headless agent authenticates).
  if (process.env.YF_API_KEY) return { authorization: `Bearer ${process.env.YF_API_KEY}` }
  // Path 2: SIWE with a local key (the wallet-native path — same auth chat uses).
  const env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
  const account = privateKeyToAccount((env.PRIVATE_KEY.startsWith('0x') ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`) as `0x${string}`)
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
  if (!session) throw new Error(`SIWE failed (${res.status})`)
  return { cookie: `yf_session=${session}` }
}

async function main() {
  const headers = { 'content-type': 'application/json', ...(await authHeaders()) }
  console.log(`\nPOST ${BASE}/api/jobs ${LIVE ? '(LIVE — creates the job)' : '(dryRun — costs nothing, creates nothing)'}\nask: "${ASK}"\n`)
  const res = await fetch(`${BASE}/api/jobs`, {
    method: 'POST',
    headers,
    body: JSON.stringify({ ask: ASK, dryRun: !LIVE }),
  })
  const data = await res.json().catch(() => null)
  if (!res.ok || !data) {
    console.error(`✖ ${res.status}:`, data?.error ?? '(no JSON body — is POST /api/jobs deployed at this base?)')
    process.exit(1)
  }
  if (data.dryRun) {
    console.log(`compiled: ${data.title}\n`)
    for (const s of data.steps) console.log(`  ${s.seq}. [${s.kind}${s.kind === 'wait' ? `:${s.waitPredicate?.kind}` : ''}] ${s.title}  (${s.builder})`)
    console.log('\nfirst signable step, built + guarded against LIVE venues:')
    console.log(JSON.stringify(data.firstSignPreview, null, 2).slice(0, 1500))
    console.log(`\n${data.note}`)
  } else {
    console.log(`job created: ${data.job.id} (${data.job.status})`)
    console.log(`watch it: ${BASE}/dashboard/guardian — sign steps from the chat JobCard or GET /api/jobs/${data.job.id}`)
  }
}

main().catch((e) => {
  console.error('✖', (e as Error).message)
  process.exit(1)
})
