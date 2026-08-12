#!/usr/bin/env npx tsx
/**
 * The daily GTM digest + reputation watch (L2-Q3; §2.2 + §1.1 of
 * HANDOFF-gtm-bulletproof.md).
 *
 * One page, checked daily during the ten-users phase: the strangers-only
 * arc (the IDENTICAL query the admin dashboard renders — lib/gtm-arc.ts),
 * honest money-moved (real vs internal, the Q3 split), the ask_failures
 * queue, the link economy, and the blocklist feeds that carry our history
 * (MetaMask stalelist + diffs, SEAL domain.txt). Writes
 * digests/<date>-gtm.md and prints it.
 *
 *   DATABASE_URL=<from .env.local> npm run digest:gtm
 *
 * Read-only everywhere. Feeds fail SOFT (a down feed reads UNKNOWN, never
 * a crash) — but a NEW listing of a serving domain exits 2 so a wrapper
 * can alarm. The uniswap-embed delisting, when it lands, shows up in the
 * MetaMask DIFFS as isRemoval — that, not the GitHub issue closing, is
 * the signal it really happened (memory: phishing-listing-fork-demos).
 */
import fs from 'node:fs'
import path from 'node:path'
import { PrismaClient, Prisma } from '@prisma/client'
import { arcQuery, type ArcRow } from '../lib/gtm-arc'
import { INTERNAL_ORIGIN_SQL } from '../lib/value-origin'

const prisma = new PrismaClient()
const OUT_DIR = path.join(process.cwd(), 'digests')

const STALELIST = 'https://phishing-detection.api.cx.metamask.io/v1/stalelist'
const SEAL_LIST = 'https://raw.githubusercontent.com/security-alliance/blocklists/main/domain.txt'
const WATCH = [
  'pantessa.com',
  'www.pantessa.com',
  'yeetful.com',
  'www.yeetful.com',
  'uniswap-embed.yeetful.com',
] as const
/** Domains that SERVE the product — a new listing here is an alarm. */
const SERVING = new Set(['pantessa.com', 'www.pantessa.com', 'yeetful.com', 'www.yeetful.com'])

const usd = (n: number | null | undefined) => `$${(n ?? 0).toLocaleString('en-US', { maximumFractionDigits: 0 })}`

type FeedVerdict = Record<string, 'LISTED' | 'clean' | 'UNKNOWN'>

async function metamaskFeed(): Promise<{ verdicts: FeedVerdict; removals: string[]; note: string }> {
  const verdicts = Object.fromEntries(WATCH.map((d) => [d, 'UNKNOWN' as const])) as FeedVerdict
  try {
    const res = await fetch(STALELIST)
    const payload = (await res.json()) as { data?: Record<string, unknown> }
    const data = payload.data ?? {}
    // Shape-defensive: block-flavored arrays only (never the allowlist).
    const blocked = new Set<string>()
    for (const [key, v] of Object.entries(data)) {
      if (!Array.isArray(v)) continue
      if (/allow|white/i.test(key)) continue
      for (const item of v) if (typeof item === 'string') blocked.add(item.toLowerCase())
    }
    for (const d of WATCH) verdicts[d] = blocked.has(d) ? 'LISTED' : 'clean'
    // The diffs are where fresh listings AND delistings actually appear.
    const removals: string[] = []
    let note = `stalelist ${blocked.size} domains`
    const lastUpdated = Number((data as { lastUpdated?: unknown }).lastUpdated)
    if (Number.isFinite(lastUpdated) && lastUpdated > 0) {
      try {
        const diffRes = await fetch(`${STALELIST.replace('/stalelist', '')}/diffsSince/${lastUpdated}`)
        const diffs = (await diffRes.json()) as { data?: Array<Record<string, unknown>> }
        for (const diff of diffs.data ?? []) {
          const url = String(diff.url ?? diff.domain ?? '').toLowerCase()
          const hit = WATCH.find((d) => url === d)
          if (!hit) continue
          if (diff.isRemoval === true) removals.push(hit)
          else verdicts[hit] = 'LISTED'
        }
        note += `, diffs checked`
      } catch {
        note += ', diffs UNREACHABLE'
      }
    }
    return { verdicts, removals, note }
  } catch {
    return { verdicts, removals: [], note: 'feed UNREACHABLE — verdicts unknown' }
  }
}

async function sealFeed(): Promise<{ verdicts: FeedVerdict; note: string }> {
  const verdicts = Object.fromEntries(WATCH.map((d) => [d, 'UNKNOWN' as const])) as FeedVerdict
  try {
    const res = await fetch(SEAL_LIST)
    const lines = new Set(
      (await res.text())
        .split('\n')
        .map((l) => l.trim().toLowerCase())
        .filter(Boolean),
    )
    for (const d of WATCH) verdicts[d] = lines.has(d) ? 'LISTED' : 'clean'
    return { verdicts, note: `domain.txt ${lines.size} domains` }
  } catch {
    return { verdicts, note: 'feed UNREACHABLE — verdicts unknown' }
  }
}

async function main() {
  const today = new Date().toISOString().slice(0, 10)
  const L: string[] = []
  const say = (s = '') => L.push(s)

  say(`# GTM digest — ${today}`)
  say()
  say('Strangers-only server truth (test wallets + internal-stamped/internal-origin')
  say('rows excluded everywhere; the arc is the IDENTICAL query the admin dashboard')
  say('renders — lib/gtm-arc.ts).')

  // ── The arc ────────────────────────────────────────────────────────────
  for (const days of [7, 30]) {
    const rows = await prisma.$queryRaw<ArcRow[]>(arcQuery(days))
    say()
    say(`## The arc — last ${days} days`)
    say()
    say('| source | arrived | asked | built | signed | returned |')
    say('|---|---|---|---|---|---|')
    const tot = { arrived: 0, asked: 0, built: 0, signed: 0, returned: 0 }
    for (const r of rows) {
      say(`| ${r.source} | ${r.arrived} | ${r.asked} | ${r.built} | ${r.signed} | ${r.returned} |`)
      tot.arrived += r.arrived
      tot.asked += r.asked
      tot.built += r.built
      tot.signed += r.signed
      tot.returned += r.returned
    }
    say(`| **all** | **${tot.arrived}** | **${tot.asked}** | **${tot.built}** | **${tot.signed}** | **${tot.returned}** |`)
  }

  // ── Money, honest ──────────────────────────────────────────────────────
  const money = await prisma.$queryRaw<
    Array<{ win: string; real_signed: number; real_usd: number; internal_signed: number; internal_usd: number }>
  >(Prisma.sql`
    SELECT w.win,
           count(*) FILTER (WHERE outcome = 'signed' AND NOT ${Prisma.raw(INTERNAL_ORIGIN_SQL)} AND created_at >= w.since)::int AS real_signed,
           coalesce(sum(value_usd) FILTER (WHERE outcome = 'signed' AND NOT ${Prisma.raw(INTERNAL_ORIGIN_SQL)} AND created_at >= w.since), 0)::float AS real_usd,
           count(*) FILTER (WHERE outcome = 'signed' AND ${Prisma.raw(INTERNAL_ORIGIN_SQL)} AND created_at >= w.since)::int AS internal_signed,
           coalesce(sum(value_usd) FILTER (WHERE outcome = 'signed' AND ${Prisma.raw(INTERNAL_ORIGIN_SQL)} AND created_at >= w.since), 0)::float AS internal_usd
    FROM embed_turns,
         (VALUES ('7d', now() - interval '7 days'), ('lifetime', 'epoch'::timestamptz)) AS w(win, since)
    GROUP BY w.win ORDER BY w.win
  `)
  say()
  say('## Money moved (signed turns)')
  say()
  say('| window | real signs | real $ | internal signs | internal $ |')
  say('|---|---|---|---|---|')
  for (const m of money)
    say(`| ${m.win} | ${m.real_signed} | ${usd(m.real_usd)} | ${m.internal_signed} | ${usd(m.internal_usd)} |`)

  // ── The failure queue ──────────────────────────────────────────────────
  const fails = await prisma.askFailure.findMany({
    where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } },
    orderBy: { createdAt: 'desc' },
    select: { prompt: true, kind: true, hadFunds: true, fundsUsd: true, createdAt: true },
  })
  const funded = fails.filter((f) => f.hadFunds)
  say()
  say(`## Ask failures — last 7 days: ${fails.length} (${funded.length} FUNDED — fix these first)`)
  for (const f of (funded.length ? funded : fails).slice(0, 5)) {
    say(
      `- ${f.createdAt.toISOString().slice(0, 10)} [${f.kind}${f.hadFunds ? ` · ${usd(f.fundsUsd)} idle` : ''}] ${f.prompt.slice(0, 90)}`,
    )
  }
  if (fails.length === 0) say('- (none — either nobody is trying, or nothing walls them)')

  // ── The link economy ───────────────────────────────────────────────────
  const [links7, linksAll, claims, handles] = await Promise.all([
    prisma.intentLink.count({ where: { createdAt: { gte: new Date(Date.now() - 7 * 86_400_000) } } }),
    prisma.intentLink.count(),
    prisma.intentLinkClaim.count(),
    prisma.creatorHandle.count(),
  ])
  say()
  say('## The link economy')
  say(`- links minted: ${links7} this week (${linksAll} lifetime) · claims EVER: ${claims} · handles: ${handles}`)

  // ── Reputation watch ───────────────────────────────────────────────────
  const [mm, seal] = await Promise.all([metamaskFeed(), sealFeed()])
  say()
  say('## Reputation watch (the feeds that matter — never config.json)')
  say()
  say('| domain | MetaMask | SEAL |')
  say('|---|---|---|')
  for (const d of WATCH) say(`| ${d} | ${mm.verdicts[d]} | ${seal.verdicts[d]} |`)
  say()
  say(`MetaMask: ${mm.note}. SEAL: ${seal.note}.`)
  if (mm.removals.length) say(`🎉 DELISTING LANDED (isRemoval in the diffs): ${mm.removals.join(', ')}`)
  const alarms = WATCH.filter(
    (d) => SERVING.has(d) && (mm.verdicts[d] === 'LISTED' || seal.verdicts[d] === 'LISTED'),
  )
  if (alarms.length) say(`\n🚨 A SERVING DOMAIN IS LISTED: ${alarms.join(', ')} — drop everything, §1.1.`)

  const doc = L.join('\n') + '\n'
  fs.mkdirSync(OUT_DIR, { recursive: true })
  const file = path.join(OUT_DIR, `${today}-gtm.md`)
  fs.writeFileSync(file, doc)
  console.log(doc)
  console.log(`→ ${path.relative(process.cwd(), file)}`)
  await prisma.$disconnect()
  process.exit(alarms.length ? 2 : 0)
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
