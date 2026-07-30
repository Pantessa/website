#!/usr/bin/env tsx
/**
 * The daily content digest (HANDOFF-yeetcall-gtm C5) — the house wallet's
 * last-24h activity as PASTE-READY tweet drafts. Semi-manual by design:
 * nothing posts anywhere; the owner curates and posts by hand (no X
 * automation at launch — the account survives that way).
 *
 *   npx tsx scripts/content-digest.ts                        # burner, 24h
 *   npx tsx scripts/content-digest.ts --wallet 0x… --hours 48
 *   flags: --base https://www.yeetful.com
 *
 * Reads Neon directly (read-only): signed turns by the wallet, guardian
 * fires, DCA runs, and existing /r share receipts (their links ride the
 * drafts — the receipt page IS the proof).
 */
import { config } from 'dotenv'
config({ path: '.env.local' })
import fs from 'node:fs'
import { privateKeyToAccount } from 'viem/accounts'

const arg = (name: string, dflt: string): string => {
  const i = process.argv.indexOf(`--${name}`)
  return i > -1 && process.argv[i + 1] ? process.argv[i + 1] : dflt
}

async function main() {
  const BASE = arg('base', 'https://www.yeetful.com')
  const HOURS = Number(arg('hours', '24'))
  const env = Object.fromEntries(
    fs.readFileSync('.env.local', 'utf8').split('\n').filter((l) => l.includes('=') && !l.startsWith('#')).map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1)]),
  )
  const pk = (env.PRIVATE_KEY.startsWith('0x') ? env.PRIVATE_KEY : `0x${env.PRIVATE_KEY}`) as `0x${string}`
  const wallet = arg('wallet', privateKeyToAccount(pk).address).toLowerCase()
  const since = new Date(Date.now() - HOURS * 3600 * 1000)

  const { default: prisma } = await import('../lib/db')
  const [turns, fires, dcaRuns, receipts] = await Promise.all([
    prisma.embedTurn.findMany({
      where: { walletAddress: wallet, outcome: 'signed', createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      select: { valueUsd: true, buildPath: true, detail: true, chain: true },
    }),
    prisma.hlGuardianRun.findMany({
      where: { wallet, action: 'closed', createdAt: { gte: since } },
      include: { policy: { select: { coin: true, side: true, kind: true } } },
      orderBy: { createdAt: 'desc' },
    }),
    prisma.dcaRun.findMany({
      where: { wallet, createdAt: { gte: since } },
      include: { schedule: { select: { buyToken: true, buyUsd: true, cadence: true } } },
      orderBy: { createdAt: 'desc' },
      take: 5,
    }),
    prisma.shareReceipt.findMany({
      where: { wallet, revoked: false, createdAt: { gte: since } },
      orderBy: { createdAt: 'desc' },
      take: 5,
      select: { id: true, kind: true, headline: true, standing: true },
    }),
  ])

  const moved = turns.reduce((s, t) => s + (t.valueUsd ?? 0), 0)
  const usd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
  const rlink = (id: string) => `${BASE}/r/${id}`

  console.log(`── HOUSE DIGEST · ${wallet.slice(0, 8)}… · last ${HOURS}h ─────────────\n`)
  console.log(`signed turns: ${turns.length} · moved: ${usd(moved)} · guardian fires: ${fires.length} · dca runs: ${dcaRuns.length} · fresh receipts: ${receipts.length}\n`)

  const drafts: string[] = []
  if (fires.length > 0) {
    for (const f of fires) {
      const r = receipts.find((x) => x.kind === 'guardian')
      drafts.push(
        `the machine fired while nobody watched: ${f.policy.coin} ${f.policy.side} ${f.policy.kind === 'stop_loss' ? 'stop' : 'take-profit'} closed autonomously — delegated key, no custody, every guard check green.${r ? `\n\nreceipt: ${rlink(r.id)}` : ''}`,
      )
    }
  }
  const cadenceWord = (c: string) => ({ day: 'daily', week: 'weekly', month: 'monthly' } as Record<string, string>)[c] ?? c
  for (const d of dcaRuns) {
    const r = receipts.find((x) => x.kind === 'dca')
    drafts.push(
      `${usd(d.schedule.buyUsd)} into ${d.schedule.buyToken} — the ${cadenceWord(d.schedule.cadence)} buy just ran. same time next ${d.schedule.cadence}, no reminder needed, my wallet signs.${r ? `\n\nreceipt: ${rlink(r.id)}` : ''}`,
    )
  }
  if (turns.length > 0 && drafts.length === 0) {
    drafts.push(
      `quiet day, working machine: ${turns.length} signed transaction${turns.length === 1 ? '' : 's'}, ${usd(moved)} moved, all guarded, all receipted.${receipts[0] ? `\n\nlatest receipt: ${rlink(receipts[0].id)}` : ''}`,
    )
  }
  if (drafts.length === 0) {
    console.log('Nothing happened in the window — no drafts today (never post filler).')
    process.exit(2)
  }
  drafts.slice(0, 3).forEach((d, i) => {
    console.log(`── DRAFT ${i + 1} ─────────────────────────────────\n${d}\n`)
  })
  console.log('curate before posting — never post all of them.')
}

void main()
