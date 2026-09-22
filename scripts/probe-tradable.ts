// ─────────────────────────────────────────────────────────────────────────
//  probe:tradable — which listed symbols can a venue actually FILL?
//
//  Read-only. Runs the real cascade (lib/venue-preflight → lib/swap-exec)
//  over every row on the /markets board and prints the verdict table the
//  tradability cache is built on. Nothing is signed, nothing is sent, no
//  wallet is read: the verdict is the venue's (measured 2026-09-21 over all
//  201 Robinhood Chain listings, an empty address and a whale agreed
//  201/201).
//
//    npm run probe:tradable                 # the whole board
//    SYMBOLS=AMBA,AAPL npm run probe:tradable
//    SECTION=equities SIZES=25,50 npm run probe:tradable
//    JSON=out.json npm run probe:tradable   # machine-readable
//
//  Exits 0 always — this is a measurement, not a gate.
// ─────────────────────────────────────────────────────────────────────────
import fs from 'node:fs'
import path from 'node:path'
import { marketSections } from '../lib/markets'
import { chartPairFor } from '../lib/charts'
import { tradeLegsFor } from '../lib/tradability'
import { preflightFundedBuy } from '../lib/venue-preflight'

// The harness idiom: this process doesn't load .env.local on its own.
for (const key of ['ALCHEMY_API_KEY', 'LIFI_API_KEY']) {
  if (process.env[key]) continue
  try {
    const m = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').match(new RegExp(`^${key}=(.*)$`, 'm'))
    if (m) process.env[key] = m[1].replace(/^["']|["']$/g, '').trim()
  } catch {}
}

const SIZES = (process.env.SIZES ?? '25').split(',').map(Number).filter((n) => n > 0)
const CONCURRENCY = Number(process.env.CONCURRENCY ?? 8)
const only = (process.env.SYMBOLS ?? '').split(',').map((s) => s.trim().toUpperCase()).filter(Boolean)
const section = process.env.SECTION ?? ''

type Row = { symbol: string; section: string; leg: string; usd: number; verdict: string; reason: string; ms: number }

async function main() {
  const rows: { symbol: string; section: string }[] = []
  for (const s of marketSections()) {
    if (section && s.id !== section) continue
    for (const r of s.rows) {
      if (only.length && !only.includes(r.symbol)) continue
      rows.push({ symbol: r.symbol, section: s.id })
    }
  }

  const jobs: (() => Promise<Row>)[] = []
  for (const r of rows) {
    const pair = chartPairFor(r.symbol)
    if (!pair) continue
    for (const leg of tradeLegsFor(r.symbol, pair)) {
      for (const usd of SIZES) {
        jobs.push(async () => {
          const t0 = Date.now()
          const v = await preflightFundedBuy({ chainId: leg.chainId, sellToken: leg.sellToken, buyToken: leg.buyToken, amountHuman: usd.toFixed(2) })
          return {
            symbol: r.symbol, section: r.section, usd,
            leg: `${leg.sellToken}→${leg.buyToken}@${leg.chainId}`,
            verdict: v.kind,
            reason: v.kind === 'no-venue' ? v.reason : v.kind === 'unknown' ? v.why : '',
            ms: Date.now() - t0,
          }
        })
      }
    }
  }

  console.log(`probe:tradable — ${jobs.length} reads over ${rows.length} symbols at $${SIZES.join('/$')}\n`)
  const out: Row[] = []
  let done = 0
  await Promise.all(
    Array.from({ length: Math.min(CONCURRENCY, jobs.length) }, async () => {
      for (;;) {
        const job = jobs.shift()
        if (!job) return
        const row = await job()
        out.push(row)
        done++
        const mark = row.verdict === 'fillable' ? '✅' : row.verdict === 'no-venue' ? '⛔' : '· '
        console.log(`${mark} ${String(done).padStart(4)}/${out.length + jobs.length}  ${row.symbol.padEnd(9)} ${row.leg.padEnd(22)} $${String(row.usd).padStart(4)}  ${String(row.ms).padStart(5)}ms  ${row.reason.slice(0, 96)}`)
      }
    }),
  )

  out.sort((a, b) => a.symbol.localeCompare(b.symbol) || a.leg.localeCompare(b.leg))
  const by = (k: string) => out.filter((r) => r.verdict === k)
  console.log(`\n── verdicts ──`)
  for (const k of ['fillable', 'no-venue', 'unknown']) console.log(`${k.padEnd(10)} ${by(k).length}`)
  const ms = out.map((r) => r.ms).sort((a, b) => a - b)
  if (ms.length) console.log(`latency    p50 ${ms[Math.floor(ms.length / 2)]}ms · p95 ${ms[Math.floor(ms.length * 0.95)]}ms · max ${ms[ms.length - 1]}ms`)
  const blocked = by('no-venue')
  if (blocked.length) {
    console.log(`\n── no venue (${blocked.length}) ──`)
    for (const r of blocked) console.log(`  ${r.symbol.padEnd(9)} ${r.leg.padEnd(22)} $${r.usd}  ${r.reason.slice(0, 120)}`)
  }
  if (process.env.JSON) {
    fs.writeFileSync(process.env.JSON, JSON.stringify(out, null, 2))
    console.log(`\nwrote ${process.env.JSON}`)
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(0)
})
