#!/usr/bin/env tsx
/**
 * x402 payer demo — an external agent walks in with money and leaves with a
 * guarded plan. Two HTTP calls, both against the SAME rails the chat uses:
 *
 *   1. POST /api/route  — the routing engine as a service (Bearer yf_ key).
 *      The ask routes to a paid x402 endpoint; the engine pays it (≤$0.05,
 *      x402-receipted) and streams select → pay → receipt → reply.
 *   2. POST /api/jobs   — the same key submits a compound intent as a DRY
 *      RUN: full plan + step 1 built and guard-checked live, $0, no rows.
 *
 *   YF_API_KEY=yf_…  npx tsx scripts/x402-payer-demo.ts
 *   (or .env.local PRIVATE_KEY → SIWE mints a demo key for you)
 *   flags: --base https://www.pantessa.com   --ask "…"   --job "…"
 */
import fs from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'
import { createSiweMessage } from 'viem/siwe'

const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}
const BASE = arg('base', 'https://www.pantessa.com')
const ASK = arg('ask', 'What are the top crypto news headlines right now?')
const JOB = arg(
  'job',
  'swap 5 usdc from base to arbitrum, then deposit 5 usdc to hyperliquid, then long $12 of eth on hyperliquid, then protect my eth long with a 5% stop',
)

/** A yf_ key from the env, or minted via SIWE with the local burner. */
async function apiKey(): Promise<string> {
  if (process.env.YF_API_KEY) return process.env.YF_API_KEY
  const env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
  if (!env.PRIVATE_KEY) throw new Error('Set YF_API_KEY (mint at /dashboard/keys) or provide .env.local PRIVATE_KEY.')
  const account = privateKeyToAccount((env.PRIVATE_KEY.startsWith('0x') ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`) as `0x${string}`)
  const nonceRes = await fetch(`${BASE}/api/auth/nonce`)
  const nonceCookie = (nonceRes.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_siwe_nonce=[^;]+/)?.[0]).find(Boolean)
  const { nonce } = (await nonceRes.json()) as { nonce: string }
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
  const signature = await account.signMessage({ message })
  const verify = await fetch(`${BASE}/api/auth/verify`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...(nonceCookie ? { cookie: nonceCookie } : {}) },
    body: JSON.stringify({ message, signature }),
  })
  const session = (verify.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_session=[^;]+/)?.[0]).find(Boolean)
  if (!session) throw new Error(`SIWE failed (${verify.status})`)
  const mint = await fetch(`${BASE}/api/keys`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', cookie: session },
    body: JSON.stringify({ label: 'x402-payer-demo' }),
  })
  const minted = (await mint.json()) as { secret?: string }
  if (!minted.secret) throw new Error(`key mint failed (${mint.status})`)
  console.log('(minted a demo yf_ key via SIWE — it lives on /dashboard/keys)')
  return minted.secret
}

async function main() {
  const key = await apiKey()
  const auth = { authorization: `Bearer ${key}`, 'content-type': 'application/json' }

  // ── 1. Pay for data through the router ─────────────────────────────────────
  console.log(`\n① POST ${BASE}/api/route — "${ASK}"\n`)
  const res = await fetch(`${BASE}/api/route`, { method: 'POST', headers: auth, body: JSON.stringify({ message: ASK }) })
  if (!res.ok || !res.body) {
    console.error(`✖ ${res.status}:`, (await res.text()).slice(0, 300))
    process.exit(1)
  }
  let paidUsd = 0
  let reply = ''
  const reader = res.body.getReader()
  const decoder = new TextDecoder()
  let buf = ''
  for (;;) {
    const { done, value } = await reader.read()
    if (done) break
    buf += decoder.decode(value, { stream: true })
    // Pop complete frames, keep the trailing partial INTACT — slicing on
    // lastIndexOf('\n\n') returns -1 for a partial-only buffer and eats its
    // first byte, which silently drops any frame that spans reads.
    const frames = buf.split('\n\n')
    buf = frames.pop() ?? ''
    for (const line of frames) {
      const data = line.split('\n').find((l) => l.startsWith('data:'))?.slice(5).trim()
      if (!data) continue
      try {
        const ev = JSON.parse(data) as Record<string, unknown>
        if (ev.type === 'select') console.log(`  → selected ${(ev as { service?: string }).service ?? '?'} ($${(ev as { priceUsd?: number }).priceUsd ?? 0})`)
        if (ev.type === 'pay') console.log(`  💸 paying…`)
        if (ev.type === 'receipt') {
          const r = (ev as { receipt?: { name?: string; priceUsd?: number | string; ok?: boolean; txHash?: string } }).receipt
          if (r) {
            // priceUsd can arrive as a string; only SETTLED calls count as paid.
            if (r.ok) paidUsd += Number(r.priceUsd) || 0
            console.log(`  🧾 receipt: ${r.name} — $${r.priceUsd}${r.txHash ? ` — tx ${r.txHash.slice(0, 18)}…` : ''} — ${r.ok ? 'ok' : 'failed (not settled)'}`)
          }
        }
        if (ev.type === 'reply') reply = String((ev as { content?: unknown }).content ?? '')
        if (ev.type === 'error') console.error(`  ✖ ${(ev as { message?: string }).message}`)
      } catch {
        /* keep-alives */
      }
    }
  }
  console.log(`\n  ${reply ? reply.slice(0, 400) : '(no reply)'}\n`)

  // ── 2. Leave with a guarded plan — $0 ──────────────────────────────────────
  console.log(`② POST ${BASE}/api/jobs (dryRun) — "${JOB.slice(0, 60)}…"\n`)
  const jobRes = await fetch(`${BASE}/api/jobs`, { method: 'POST', headers: auth, body: JSON.stringify({ ask: JOB, dryRun: true }) })
  const job = (await jobRes.json().catch(() => null)) as { title?: string; steps?: { seq: number; kind: string; title: string; builder: string }[]; firstSignPreview?: Record<string, unknown>; error?: string } | null
  if (!jobRes.ok || !job?.steps) {
    console.error(`✖ ${jobRes.status}:`, job?.error ?? '(no body)')
    process.exit(1)
  }
  console.log(`  compiled: ${job.title}`)
  for (const s of job.steps) console.log(`    ${s.seq}. [${s.kind}] ${s.title}`)
  const preview = job.firstSignPreview ?? {}
  console.log(`  step 1 ${('artifact' in preview) ? 'built + guarded against live venues ✓' : `refused honestly: ${String((preview as { refused?: string }).refused ?? '')}`}`)

  console.log(`\n∑ walked in with money, left with a guarded plan: paid $${paidUsd.toFixed(4)} for data, committed $0.\n`)
}

main().catch((e) => {
  console.error('✖', (e as Error).message)
  process.exit(1)
})
