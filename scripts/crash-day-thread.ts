#!/usr/bin/env tsx
/**
 * The crash-day thread generator (HANDOFF-yeetcall-gtm C4) — pre-written
 * red-day content, run BY THE OWNER when the market is down:
 *
 *   npx tsx scripts/crash-day-thread.ts 0xabc… 0xdef… [--base https://www.yeetful.com]
 *
 * For each PUBLIC wallet it runs the real briefing composer (read-only:
 * live HL positions + balances + guardian/spot-guard policy existence) and
 * pulls the downside-audit rows — "no stop armed — a 20% move against
 * costs $X". Output is a paste-ready thread: one tweet per wallet with its
 * /w link, plus an opener and a closer. Nothing is posted anywhere; the
 * owner reads, curates, and posts by hand (no X automation at launch).
 *
 * Tone guard: these are PUBLIC addresses being discussed publicly — the
 * copy names exposure, never identity, and every tweet's fix is one tap.
 */
import { config } from 'dotenv'
config({ path: '.env.local' })

async function main() {
  const args = process.argv.slice(2)
  const baseIdx = args.indexOf('--base')
  const base = baseIdx > -1 ? args[baseIdx + 1] : 'https://www.yeetful.com'
  const wallets = args.filter((a, i) => /^0x[0-9a-fA-F]{40}$/.test(a) && i !== baseIdx + 1)
  if (wallets.length === 0) {
    console.error('usage: npx tsx scripts/crash-day-thread.ts <wallet…> [--base url]')
    process.exit(1)
  }
  // Deferred import: dotenv must load before lib/db reads DATABASE_URL.
  const { briefingTileFor } = await import('../lib/briefing-exec')

  const entries: { wallet: string; line: string; cost: string }[] = []
  for (const wallet of wallets) {
    const tile = await briefingTileFor(wallet)
    const audit = tile?.rows.find((r) => r.tone === 'neg' && /no stop armed/.test(r.sub ?? ''))
    if (!audit) {
      console.error(`· ${wallet.slice(0, 10)}… — nothing unprotected above the floors (skipped)`)
      continue
    }
    const cost = (audit.sub ?? '').match(/costs (\$[\d,.]+[kKmM]?)/)?.[1] ?? 'real money'
    entries.push({
      wallet,
      cost,
      line: `${audit.label} — ${audit.sub}`,
    })
  }
  if (entries.length === 0) {
    console.error('No unprotected exposure found across the given wallets — no thread today.')
    process.exit(2)
  }

  const short = (w: string) => `${w.slice(0, 6)}…${w.slice(-4)}`
  console.log('── PASTE-READY THREAD ──────────────────────────────────────\n')
  console.log(
    `1/ Red day. Here's what "no stop-loss" costs, on real public wallets, right now — every one of these is fixable with one signature. 🧵\n`,
  )
  entries.forEach((e, i) => {
    console.log(
      `${i + 2}/ ${short(e.wallet)}: ${e.line}\n\nThe audit is public — anyone can run it on any wallet:\n${base}/w/${e.wallet}\n`,
    )
  })
  console.log(
    `${entries.length + 2}/ Yeetful watches so you don't have to: a guarded stop, armed in one signature, your keys the whole time. Paste YOUR address:\n${base}/w/\n`,
  )
  console.log('────────────────────────────────────────────────────────────')
  console.log(`\n${entries.length} wallet(s) with unprotected exposure; costs named: ${entries.map((e) => e.cost).join(', ')}`)
}

void main()
