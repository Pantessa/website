#!/usr/bin/env tsx
/**
 * Live-money burner test of the routing engine across many MCP services.
 *
 * Sends realistic, service-specific user questions through the BURNER auto-router
 * (POST /api/chat { autoRouter: true }) — the exact path the chat UI uses, so
 * every turn ALSO streams to the public /activity live feed. Rotates the
 * inference engine per turn (ChatGPT / DeepSeek / Gemini / Claude (non-Yeetful);
 * Groq is listed-only and expected to fall back) via the `inferenceSlug` pin.
 *
 *   npm run test:live                 # hit local http://localhost:3000
 *   npm run test:live -- --base=https://www.yeetful.com
 *   npm run test:live -- --only=1     # run a single case (1-indexed)
 *   npm run test:live -- --delay=4000 # ms between turns (default 3000)
 *   npm run test:live -- --dry        # print the plan + balance, send NOTHING
 *
 * ⚠️ SPENDS REAL HOUSE USDC (burner). Each turn pays the picked data endpoint(s)
 * + the answer inference (~$0.001–0.05 each). ~15 turns ≈ well under $1.
 * The burner USDC balance is checked first (read-only); the run aborts if it
 * looks too low. Nothing is paid in --dry mode.
 */
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { createPublicClient, http, getAddress } from 'viem'
import { base } from 'viem/chains'

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(process.cwd(), file), 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (m && !line.trimStart().startsWith('#') && !(m[1] in process.env)) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
      }
    } catch {
      /* no env file */
    }
  }
}
loadEnv()

const arg = (name: string, def?: string) => {
  const a = process.argv.find((x) => x.startsWith(`--${name}=`))
  return a ? a.split('=').slice(1).join('=') : def
}
const has = (name: string) => process.argv.includes(`--${name}`)

const BASE = (arg('base', 'http://localhost:3000') as string).replace(/\/$/, '')
const DELAY = Number(arg('delay', '3000'))
const ONLY = arg('only') ? Number(arg('only')) : undefined
const DRY = has('dry')

const USDC = '0x833589fCD6eDb6E08f4c7C32D4f71b54bdA02913' // USDC on Base
const ERC20_BALANCE_ABI = [
  { name: 'balanceOf', type: 'function', stateMutability: 'view', inputs: [{ name: 'a', type: 'address' }], outputs: [{ name: '', type: 'uint256' }] },
] as const

// Each case: the question a real user would ask of the intended service, plus
// the inference engine to pin for the answer. `service` is the EXPECTED pick —
// the engine chooses freely, so the report shows actual picks vs this.
interface Case {
  service: string
  inference: string // slug: chatgpt | deepseek | google-gemini | claude | groq
  q: string
}
const CASES: Case[] = [
  { service: 'CoinMarketCap', inference: 'deepseek', q: 'What is the current price of the VIRTUAL token?' }, // the 402 repro
  { service: 'CoinGecko', inference: 'chatgpt', q: 'What is the price of ETH right now and its 24-hour change?' },
  { service: 'Messari', inference: 'google-gemini', q: "Give me Bitcoin's latest market metrics — price, market cap, and 24h volume." },
  { service: 'Zapper', inference: 'claude', q: 'What is the total portfolio value of wallet 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045?' },
  { service: 'Alchemy', inference: 'chatgpt', q: 'What is the ETH balance of address 0xd8dA6BF26964aF9D7eEd9e03E53415D37aA96045 on Base?' },
  { service: 'RentCast', inference: 'deepseek', q: 'What is the estimated monthly rent for 5500 Grand Lake Dr, San Antonio, TX 78244?' },
  { service: 'FlightAware', inference: 'google-gemini', q: 'What is the current status of United Airlines flight UA328?' },
  { service: 'Tripadvisor', inference: 'claude', q: 'Find a few highly rated restaurants near the Eiffel Tower in Paris.' },
  { service: 'Wolfram|Alpha', inference: 'chatgpt', q: 'What is the integral of x squared from 0 to 5?' },
  { service: 'Tavily', inference: 'deepseek', q: 'Search the web for the latest news about the Base blockchain network.' },
  { service: 'Exa', inference: 'google-gemini', q: 'Find recent articles about x402 agent payments.' },
  { service: 'Firecrawl', inference: 'claude', q: 'Scrape https://example.com and summarize what the page says.' },
  { service: 'Nansen', inference: 'chatgpt', q: 'Show recent smart-money flows for USDC on Base.' },
  { service: 'Perplexity', inference: 'deepseek', q: 'What are the leading AI agent frameworks in 2026?' },
  { service: 'Groq (inference)', inference: 'groq', q: 'Explain what an x402 payment is in two sentences.' },
]

interface TraceEv { type: string; [k: string]: unknown }
interface TurnResult {
  picks: string[]
  receipts: { name: string; ok: boolean; priceUsd?: string; txHash?: string; note?: string }[]
  error?: string
  replyPayer?: string
  answered: boolean
  ms: number
}

async function runTurn(c: Case): Promise<TurnResult> {
  const t0 = Date.now()
  const res = await fetch(`${BASE}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ autoRouter: true, message: c.q, inferenceSlug: c.inference, history: [] }),
  })
  const out: TurnResult = { picks: [], receipts: [], answered: false, ms: 0 }
  if (!res.ok || !res.body) {
    out.error = `HTTP ${res.status} ${res.statusText}`
    out.ms = Date.now() - t0
    return out
  }
  // Parse the SSE stream (`data: {json}\n\n`).
  const reader = res.body.getReader()
  const dec = new TextDecoder()
  let buf = ''
  for (;;) {
    const { value, done } = await reader.read()
    if (done) break
    buf += dec.decode(value, { stream: true })
    let idx
    while ((idx = buf.indexOf('\n\n')) !== -1) {
      const chunk = buf.slice(0, idx)
      buf = buf.slice(idx + 2)
      const line = chunk.split('\n').find((l) => l.startsWith('data: '))
      if (!line) continue
      let ev: TraceEv
      try {
        ev = JSON.parse(line.slice(6))
      } catch {
        continue
      }
      switch (ev.type) {
        case 'select':
          if (typeof ev.service === 'string') out.picks.push(ev.service)
          break
        case 'receipt': {
          const r = ev.receipt as TurnResult['receipts'][number]
          if (r) out.receipts.push(r)
          break
        }
        case 'error':
          out.error = String(ev.message ?? 'error')
          break
        case 'reply':
          out.answered = true
          if (typeof ev.payer === 'string') out.replyPayer = ev.payer
          break
      }
    }
  }
  out.ms = Date.now() - t0
  return out
}

function verdict(r: TurnResult): 'PASS' | 'FAIL' | 'WARN' {
  if (r.error) return 'FAIL'
  const failed = r.receipts.filter((x) => !x.ok)
  const settled = r.receipts.filter((x) => x.ok && x.note !== 'cached')
  if (failed.length) return 'FAIL'
  if (settled.length === 0 && !r.answered) return 'FAIL'
  if (settled.length === 0) return 'WARN' // answered with no paid call (general answer / no data needed)
  return 'PASS'
}

async function preflightBalance() {
  const key = process.env.PRIVATE_KEY?.trim()
  if (!key || !/^0x[0-9a-fA-F]{64}$/.test(key)) {
    console.log('⚠️  PRIVATE_KEY not set locally — cannot read burner balance (the SERVER pays, so this is just a heads-up).')
    return
  }
  try {
    const { privateKeyToAccount } = await import('viem/accounts')
    const acct = privateKeyToAccount(key as `0x${string}`)
    const client = createPublicClient({ chain: base, transport: http() })
    const [usdc, eth] = await Promise.all([
      client.readContract({ address: USDC, abi: ERC20_BALANCE_ABI, functionName: 'balanceOf', args: [getAddress(acct.address)] }),
      client.getBalance({ address: getAddress(acct.address) }),
    ])
    const usdcNum = Number(usdc) / 1e6
    console.log(`Burner ${acct.address}: ${usdcNum.toFixed(4)} USDC · ${(Number(eth) / 1e18).toFixed(5)} ETH`)
    if (usdcNum < 0.2) {
      console.log(`⚠️  USDC balance looks low (${usdcNum.toFixed(4)}). Fund the burner before a full run.`)
    }
  } catch (e) {
    console.log('⚠️  Could not read burner balance:', e instanceof Error ? e.message : e)
  }
}

async function main() {
  const cases = ONLY ? [CASES[ONLY - 1]].filter(Boolean) : CASES
  console.log(`\n▶ Live-service routing test`)
  console.log(`  base: ${BASE}   cases: ${cases.length}   delay: ${DELAY}ms   ${DRY ? '(DRY — nothing sent)' : '(LIVE — spends house USDC)'}\n`)
  await preflightBalance()

  if (DRY) {
    console.log('\nPlanned turns:')
    cases.forEach((c, i) => console.log(`  ${i + 1}. [${c.inference}] ${c.service} — "${c.q}"`))
    console.log('\n(dry run — no requests sent)')
    return
  }

  const results: { c: Case; r: TurnResult; v: string }[] = []
  for (let i = 0; i < cases.length; i++) {
    const c = cases[i]
    process.stdout.write(`  ${String(i + 1).padStart(2)}. [${c.inference.padEnd(13)}] ${c.service.padEnd(16)} … `)
    let r: TurnResult
    try {
      r = await runTurn(c)
    } catch (e) {
      r = { picks: [], receipts: [], answered: false, ms: 0, error: e instanceof Error ? e.message : 'request failed' }
    }
    const v = verdict(r)
    results.push({ c, r, v })
    const settled = r.receipts.filter((x) => x.ok && x.note !== 'cached')
    const tag = v === 'PASS' ? '✓ PASS' : v === 'WARN' ? '~ WARN' : '✗ FAIL'
    console.log(`${tag}  picked: ${r.picks.join(', ') || '—'}  · ${settled.length} settled · ${(r.ms / 1000).toFixed(1)}s`)
    for (const f of r.receipts.filter((x) => !x.ok)) console.log(`        ✗ ${f.name}: ${f.note ?? 'failed'}`)
    if (r.error) console.log(`        ✗ error: ${r.error}`)
    if (i < cases.length - 1) await new Promise((res) => setTimeout(res, DELAY))
  }

  // ── Summary ────────────────────────────────────────────────────────────────
  const pass = results.filter((x) => x.v === 'PASS').length
  const warn = results.filter((x) => x.v === 'WARN').length
  const fail = results.filter((x) => x.v === 'FAIL').length
  const spent = results.reduce((a, x) => a + x.r.receipts.filter((y) => y.ok && y.note !== 'cached').reduce((b, y) => b + (Number(y.priceUsd) || 0), 0), 0)
  console.log(`\n${'─'.repeat(64)}`)
  console.log(`  ${pass} PASS · ${warn} WARN · ${fail} FAIL · ~$${spent.toFixed(4)} settled`)
  console.log(`${'─'.repeat(64)}`)
  if (fail) {
    console.log('\nFailures (copy/paste-ready):')
    for (const { c, r } of results.filter((x) => x.v === 'FAIL')) {
      const reason = r.error ?? r.receipts.filter((x) => !x.ok).map((x) => `${x.name}: ${x.note}`).join(' | ')
      console.log(`  • [${c.inference}] ${c.service} — "${c.q}"\n      → ${reason}`)
    }
  }
  console.log('\nWatch it live: ' + BASE + '/activity')
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
