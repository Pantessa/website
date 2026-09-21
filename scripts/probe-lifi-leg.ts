// npm run probe:lifi-leg — re-measure what one LiFi value leg costs.
//
// LIFI_LEG_FLAT_USD (lib/lifi-bridge) is a MEASUREMENT, and the venue moves:
// $0.16–0.46 a leg on 2026-09-03, $0.02–0.06 on 2026-09-21. The planner's
// smallest offer (MIN_VALUE_LEG_USD) derives from it, so a stale constant
// either refuses legs that fill or offers legs the parity guard withholds.
//
// Read-only: quotes only, nothing is built or signed. Shortfall = dollars in
// minus the route's guaranteed minimum (toAmountMin), the number the guard
// reads. Exits 2 when any stable leg at or above the floor guarantees less
// than the guard allows, or costs more than the constant carries.
//
//   SIZES=1,3,9 npm run probe:lifi-leg      # other sizes
import fs from 'node:fs'
import path from 'node:path'
import { chainById } from '../lib/chains'
import { ARC_BRIDGE_TOOLS, FUNDING_ALT_USDC, FUNDING_ORIGIN_CHAINS, FUNDING_ORIGIN_WORD, LIFI_LEG_FLAT_USD, MIN_VALUE_LEG_USD, STABLE_LEG_MIN_OUT_BPS } from '../lib/lifi-bridge'
import { ARC_CHAIN_ID, ROBINHOOD_CHAIN_ID } from '../lib/lifi-destinations'
import { TREASURY_ADDRESS } from '../lib/fees'

// The harness idiom: this process doesn't load .env.local on its own.
if (!process.env.LIFI_API_KEY) {
  try {
    const m = fs.readFileSync(path.join(process.cwd(), '.env.local'), 'utf8').match(/^LIFI_API_KEY=(.*)$/m)
    if (m) process.env.LIFI_API_KEY = m[1].replace(/^["']|["']$/g, '').trim()
  } catch {}
}

const SIZES = (process.env.SIZES ?? '1,1.5,2,3,5,9').split(',').map(Number).filter((n) => n > 0)
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

interface Row { lane: string; origin: string; usd: number; tool?: string; min?: number; short?: number; pct?: number; error?: string }

async function quote(fromChain: number, fromToken: string, toChain: number, toToken: string, usd: number, allowBridges?: readonly string[]) {
  const url = new URL('https://li.quest/v1/quote')
  const q: Record<string, string> = { fromChain: String(fromChain), toChain: String(toChain), fromToken, toToken, fromAmount: String(Math.round(usd * 1e6)), fromAddress: TREASURY_ADDRESS, slippage: '0.005' }
  if (allowBridges) q.allowBridges = allowBridges.join(',')
  for (const [k, v] of Object.entries(q)) url.searchParams.set(k, v)
  for (let attempt = 0; attempt < 3; attempt++) {
    const res = await fetch(url, { headers: { accept: 'application/json', ...(process.env.LIFI_API_KEY ? { 'x-lifi-api-key': process.env.LIFI_API_KEY } : {}) }, signal: AbortSignal.timeout(20_000) })
    if (res.status === 429) { await sleep(8_000); continue }
    const body = await res.json()
    if (!res.ok) return { error: `${res.status} ${String(body?.message ?? '').slice(0, 80)}` }
    return { tool: String(body.tool), min: Number(body.estimate.toAmountMin) / 1e6 }
  }
  return { error: 'rate limited' }
}

async function main() {
  const usdg = chainById(ROBINHOOD_CHAIN_ID)?.tokens.USDG?.address
  const arcUsdc = chainById(ARC_CHAIN_ID)?.tokens.USDC?.address
  if (!usdg || !arcUsdc) throw new Error('registry is missing USDG or Arc USDC')
  const lanes: { lane: string; origin: number; from: string; toChain: number; to: string; allow?: readonly string[] }[] = []
  for (const origin of FUNDING_ORIGIN_CHAINS) {
    const usdc = chainById(origin)?.tokens.USDC?.address
    if (usdc) lanes.push({ lane: 'USDC → USDG', origin, from: usdc, toChain: ROBINHOOD_CHAIN_ID, to: usdg })
  }
  for (const [id, alt] of Object.entries(FUNDING_ALT_USDC)) lanes.push({ lane: `${alt.symbol} → USDG`, origin: Number(id), from: alt.address, toChain: ROBINHOOD_CHAIN_ID, to: usdg })
  for (const origin of FUNDING_ORIGIN_CHAINS) {
    const usdc = chainById(origin)?.tokens.USDC?.address
    if (usdc) lanes.push({ lane: 'USDC → Arc USDC', origin, from: usdc, toChain: ARC_CHAIN_ID, to: arcUsdc, allow: ARC_BRIDGE_TOOLS })
  }

  const rows: Row[] = []
  console.log(`# LiFi value-leg probe · ${new Date().toISOString()}`)
  console.log(`# constant $${LIFI_LEG_FLAT_USD} → floor $${MIN_VALUE_LEG_USD} · guard ${STABLE_LEG_MIN_OUT_BPS / 100}%\n`)
  for (const l of lanes) {
    for (const usd of SIZES) {
      const r = await quote(l.origin, l.from, l.toChain, l.to, usd, l.allow).catch((e) => ({ error: String(e?.message ?? e).slice(0, 80) }))
      const row: Row = { lane: l.lane, origin: FUNDING_ORIGIN_WORD[l.origin] ?? String(l.origin), usd }
      if ('error' in r) row.error = r.error
      else Object.assign(row, { tool: r.tool, min: r.min, short: Number((usd - r.min).toFixed(4)), pct: Number(((100 * r.min) / usd).toFixed(2)) })
      rows.push(row)
      console.log(`${row.lane.padEnd(16)} ${row.origin.padEnd(9)} $${String(usd).padEnd(4)} ${row.error ? `— ${row.error}` : `${String(row.tool).padEnd(16)} short $${row.short!.toFixed(4)}  min-out ${row.pct!.toFixed(2)}%`}`)
      await sleep(1_200)
    }
  }

  const ok = rows.filter((r) => r.short !== undefined)
  const atFloor = ok.filter((r) => r.usd >= MIN_VALUE_LEG_USD)
  const worstNear = ok.filter((r) => r.usd <= MIN_VALUE_LEG_USD).sort((a, b) => b.short! - a.short!)[0]
  const belowGuard = atFloor.filter((r) => r.pct! < STABLE_LEG_MIN_OUT_BPS / 100)
  const smallestClean = SIZES.find((s) => ok.filter((r) => r.usd >= s).every((r) => r.pct! >= STABLE_LEG_MIN_OUT_BPS / 100))
  console.log(`\nworst shortfall at or under the $${MIN_VALUE_LEG_USD} floor: ${worstNear ? `$${worstNear.short} (${worstNear.lane}, ${worstNear.origin}, $${worstNear.usd}, ${worstNear.tool})` : 'n/a'} vs the constant's $${LIFI_LEG_FLAT_USD}`)
  console.log(`smallest probed size every lane clears the guard from: ${smallestClean ? `$${smallestClean}` : 'none'}`)
  console.log(`rows with no quote: ${rows.length - ok.length} of ${rows.length}`)
  const over = worstNear && worstNear.short! > LIFI_LEG_FLAT_USD
  if (belowGuard.length > 0 || over) {
    console.log(`\n✗ the floor is too low: ${belowGuard.length} leg(s) at or above it guarantee under ${STABLE_LEG_MIN_OUT_BPS / 100}%${over ? ', and the worst shortfall is over the constant' : ''}. Raise LIFI_LEG_FLAT_USD.`)
    process.exit(2)
  }
  console.log('\n✓ every leg at or above the floor clears the guard.')
}

main().catch((err) => { console.error(err); process.exit(1) })
