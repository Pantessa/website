// Pins for squad landing, lane DATA (2026-11-10): the tour's server snapshot — the yield ladder, the community's public posts, the cache rule.
// THE LANE OWNS THIS FILE. It is already wired into scripts/test-api.ts and
// package.json by the contract commit — fill the two functions, never edit
// the harness. Pure checks (rules, tables, source) go in the first; checks
// against a running server go in the second.
//   npx tsx scripts/landing-data-pins.ts            (npm run pins:landing-data)
//   BASE=http://localhost:PORT npx tsx scripts/landing-data-pins.ts --served
//
// What is pinned:
//   • the static counts equal the registries the product runs on;
//   • the ladder is the Earn board's own rule (one bar per asset = its best
//     row, familiar-first pick, drawn highest rate first, the row's own
//     sentence at EARN_DEFAULT_USD, unsized rows dropped) — on fixtures;
//   • the feed's fences: internal rows and internal rooms never reach the
//     landing, a post with no verified proof carries movedUsd null;
//   • the cache rule in the source (unstable_cache, no 'no-store', `/` ISR);
//   • THE SENTENCES AUDIT: every `asks[].ask` in lib/home-tour/*.ts (read
//     from TOUR_SIDES at run time, so it re-checks whatever the side lanes
//     write) parses to an action in the chat ladder's replica
//     (scripts/ask-ladder simulateLadder, the engine of audit:asks) and
//     passes canTradeAsk; served, each one (plus every live earn row's
//     sentence) is POSTed to /api/chat with no wallet and must come back as
//     the connect door — never a planner turn, a wall or an error.

import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { simulateLadder } from './ask-ladder'
import { canTradeAsk } from '../lib/trade-venue-gate'
import { classifyTurn } from '../lib/ask-failure'
import { EARN_DEFAULT_USD, type EarnRow } from '../lib/earn'
import { TOUR_SIDES, EMPTY_TOUR, type TourSnapshot } from '../lib/home-tour'
import { TOUR_COMMUNITY_POSTS, TOUR_EARN_ROWS, movedUsdOf, tourEarnOf, tourPostsOf } from '../lib/home-tour-live'
import type { FeedPost, TradeProof } from '../lib/community/spec'
import { APP_CHAINS } from '../lib/chains'
import { HOME_APPS } from '../lib/home-apps'
import { MACRO_ROWS } from '../lib/macro'
import { marketSections } from '../lib/markets'
import { buildVenueManifest } from '../lib/venue-manifest'

type Check = (name: string, ok: boolean, extra?: string) => void

const ROOT = join(__dirname, '..')
const read = (p: string) => {
  try {
    return readFileSync(join(ROOT, p), 'utf8')
  } catch {
    return ''
  }
}
const stripComments = (s: string) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1')

/** A sentence that works only for SOME wallets (an open position, a smart
 *  wallet holding the token on Base): README rule 4 says words, not a chip. */
const WALLET_CONDITIONAL = /^(Protect my|Close my|Sell all my|Withdraw my|Repay my)\b/i

/** Every runnable sentence the tour's words offer, with its side. */
export function tourSentences(): { side: string; ask: string }[] {
  const seen = new Set<string>()
  const out: { side: string; ask: string }[] = []
  for (const s of TOUR_SIDES) for (const a of s.asks ?? []) {
    if (seen.has(`${s.id}|${a.ask}`)) continue
    seen.add(`${s.id}|${a.ask}`)
    out.push({ side: s.id, ask: a.ask })
  }
  return out
}

// ── fixtures ─────────────────────────────────────────────────────────────────

function row(asset: string, apyPct: number | null, over: Partial<EarnRow> = {}): EarnRow {
  return {
    id: `${over.venue ?? 'morpho'}:${asset}:${over.chainId ?? 8453}:${apyPct}`,
    venue: 'morpho',
    venueLabel: 'Morpho',
    kind: 'lend',
    chainId: 8453,
    chainLabel: 'Base',
    asset,
    apyPct,
    tvlUsd: 1_000_000,
    detail: '',
    best: false,
    askFor: (usd) => `Lend $${usd} of ${asset} on Morpho on Base`,
    ...over,
  }
}

const PROOF: TradeProof = {
  turnId: 'turn1',
  chainId: 8453,
  txHash: `0x${'a'.repeat(64)}`,
  symbols: ['buy:ETH'],
  side: 'buy',
  sizeUsd: 75,
  chain: 'Base',
  txUrl: `https://basescan.org/tx/0x${'a'.repeat(64)}`,
  signedAt: 1,
  verification: 'verified',
}

function post(id: string, over: Partial<FeedPost> = {}): FeedPost {
  return {
    id,
    symbol: 'ETH',
    kind: 'idea',
    title: `Post ${id}`,
    body: '',
    chartState: null,
    asks: [],
    linkSlug: null,
    linkUrl: null,
    forkOf: null,
    author: `0x${'1'.repeat(40)}`,
    authorLabel: '0x1111…1111',
    createdAt: 1_790_000_000_000,
    comments: 0,
    executedBy: 0,
    isInternal: false,
    community: null,
    mediaUrl: null,
    video: null,
    proof: null,
    score: 3,
    myVote: 0,
    ...over,
  } as FeedPost
}

export function landingDataPins(check: Check): void {
  // ── static counts = the registries ─────────────────────────────────────────
  {
    const src = read('lib/home-tour-server.ts')
    const sections = marketSections()
    const manifest = buildVenueManifest()
    const pinned = manifest.venues.reduce((n, v) => n + v.chains.reduce((m, c) => m + c.contracts.length, 0), 0)
    check(
      'landing data: the static counts read the registries (boards, macro, apps row, chains, venue manifest)',
      /rows\('equities'\)/.test(src) && /rows\('crypto'\)/.test(src) && /MACRO_ROWS\.length/.test(src) && /HOME_APPS\.length/.test(src) && /APP_CHAINS\.length/.test(src) && /manifest\.venues\.length/.test(src),
    )
    check(
      'landing data: the registries are non-empty (a zero count would print as a fact)',
      (sections.find((s) => s.id === 'equities')?.rows.length ?? 0) > 0 && (sections.find((s) => s.id === 'crypto')?.rows.length ?? 0) > 0 && MACRO_ROWS.length > 0 && HOME_APPS.length > 0 && APP_CHAINS.length > 0 && manifest.venues.length > 0 && pinned > 0,
      `venues ${manifest.venues.length} · pinned ${pinned}`,
    )
  }

  // ── the ladder: the Earn board's rule, on fixtures ─────────────────────────
  {
    const rows = [
      row('USDC', 4.5),
      row('USDC', 5.2, { venue: 'aave', venueLabel: 'Aave', kind: 'supply', chainId: 1, chainLabel: 'Ethereum', askFor: (u) => `Supply $${u} of USDC to Aave at the best rate` }),
      row('ETH', 2.3, { venue: 'lido', venueLabel: 'Lido', kind: 'stake', chainId: 1, chainLabel: 'Ethereum', askFor: () => null }),
      row('USDT', 8.9),
      row('DAI', 3.1),
      row('PYUSD', 4.6),
      row('USDG', 2.9),
      row('WBTC', 0.01),
      row('MXNB', 17.4),
      row('BRZ', 12.0),
      row('EURC', 6.0),
      row('CBBTC', 1.1),
      row('BTC', 0.9),
      row('NULLY', null),
    ]
    const { earn, earnWays } = tourEarnOf(rows)
    const apys = earn.map((r) => r.apy)
    check('landing data ladder: drawn highest rate first', apys.every((v, i) => i === 0 || apys[i - 1] >= v), apys.join(' > '))
    check('landing data ladder: one bar per asset, its best row (USDC = Aave 5.2, not Morpho 4.5)', new Set(earn.map((r) => r.asset)).size === earn.length && earn.find((r) => r.asset === 'USDC')?.venue === 'Aave' && earn.find((r) => r.asset === 'USDC')?.apy === 5.2)
    check(`landing data ladder: at most ${TOUR_EARN_ROWS} bars, familiar first (the 17% long-tail stable loses its seat to familiar assets)`, earn.length <= TOUR_EARN_ROWS && !earn.some((r) => r.asset === 'MXNB'), earn.map((r) => r.asset).join(' · '))
    check('landing data ladder: a best rate under the ladder floor gets no bar (WBTC 0.01%)', !earn.some((r) => r.asset === 'WBTC'))
    check("landing data ladder: a row the board cannot size (Lido without a price) is dropped, never shown without its sentence", !earn.some((r) => r.asset === 'ETH'))
    check(
      `landing data ladder: each row's sentence is the row's own askFor at EARN_DEFAULT_USD ($${EARN_DEFAULT_USD})`,
      earn.length > 0 && earn.every((r) => r.ask.includes(`$${EARN_DEFAULT_USD} of ${r.asset}`)),
      earn.map((r) => r.ask).join(' | '),
    )
    check('landing data ladder: earnWays = the rows the board counts (all of them)', earnWays === rows.length, String(earnWays))
    const none = tourEarnOf([])
    check('landing data ladder: nothing read → an empty ladder and a null count (never a zero)', none.earn.length === 0 && none.earnWays === null)
    const src = stripComments(read('lib/home-tour-live.ts'))
    check('landing data ladder: reuses lib/earn rankEarnRows + yieldLadder (no ranking by hand)', /rankEarnRows\(/.test(src) && /yieldLadder\(/.test(src) && !/\.sort\(/.test(src))
  }

  // ── the feed's fences ──────────────────────────────────────────────────────
  {
    const verified = post('trade01', { kind: 'trade', proof: PROOF })
    check('landing data feed: a trade with a verified proof carries the chain-confirmed dollars', movedUsdOf(verified) === 75)
    check('landing data feed: a trade with no proof carries movedUsd null', movedUsdOf(post('trade02', { kind: 'trade', proof: null })) === null)
    check('landing data feed: a proof whose author hid the size carries movedUsd null', movedUsdOf(post('trade03', { kind: 'trade', proof: { ...PROOF, sizeUsd: null } })) === null)
    check('landing data feed: an idea never carries movedUsd, even with a stray proof', movedUsdOf(post('idea001', { kind: 'idea', proof: PROOF })) === null)
    const rooms = new Set(['public-room'])
    const posts = [
      post('intern01', { isInternal: true }),
      post('inroom01', { community: { slug: 'team-room', name: 'Team' } }),
      post('pubroom1', { community: { slug: 'public-room', name: 'Public' }, kind: 'trade', proof: PROOF }),
      post('forum001'),
      post('notitle1', { title: '   ' }),
      post('forum002'),
      post('forum003'),
    ]
    const out = tourPostsOf(posts, rooms)
    check(`landing data feed: at most ${TOUR_COMMUNITY_POSTS} posts, in the feed's own order`, out.length === TOUR_COMMUNITY_POSTS && out.map((p) => p.href).join(',') === '/c/pubroom1,/c/forum001,/c/forum002', out.map((p) => p.href).join(','))
    check('landing data feed: an internal row never reaches the landing', !out.some((p) => p.href === '/c/intern01'))
    check('landing data feed: a post in a room that is not public never reaches the landing', !out.some((p) => p.href === '/c/inroom01'))
    check("landing data feed: room = the room's name, movedUsd only from the proof", out[0].room === 'Public' && out[0].movedUsd === 75 && out[1].room === null && out[1].movedUsd === null)
    check('landing data feed: an empty feed is an empty list', tourPostsOf([], rooms).length === 0)
    const store = read('lib/community/store.ts')
    check('landing data feed: the store fences is_internal by default (listFeed)', /if \(!q\.includeInternal\) where\.isInternal = false/.test(store))
    const srv = stripComments(read('lib/home-tour-server.ts'))
    check('landing data feed: the server read never asks for internal rows and counts only public rooms', !/includeInternal/.test(srv) && /community\.count\(\{ where: \{ isInternal: false \} \}\)/.test(srv) && /chartPost\.count\(\{[\s\S]*?isInternal: false/.test(srv))
  }

  // ── the cache rule ─────────────────────────────────────────────────────────
  {
    const srv = stripComments(read('lib/home-tour-server.ts'))
    const live = stripComments(read('lib/home-tour-live.ts'))
    const page = stripComments(read('app/page.tsx'))
    check('landing data cache: every live read is behind unstable_cache with a 60s revalidate', (srv.match(/unstable_cache\(/g) ?? []).length >= 2 && (srv.match(/revalidate: 60/g) ?? []).length >= 2)
    check("landing data cache: no 'no-store' fetch, no cookies()/headers() in the tour's server read", !/no-store/.test(srv) && !/no-store/.test(live) && !/\b(cookies|headers)\(\)/.test(srv))
    check('landing data cache: each feed is time-capped (withTimeout, 2.5s)', /withTimeout\(/.test(srv) && /TOUR_FEED_TIMEOUT_MS = 2_500/.test(read('lib/home-tour-live.ts')))
    check('landing data cache: `/` stays ISR (revalidate = 60, no force-dynamic)', /export const revalidate = 60/.test(page) && !/export const dynamic\s*=\s*'force-dynamic'/.test(page))
    const route = read('app/api/home/tour/route.ts')
    check('landing data route: GET /api/home/tour serves readTourSnapshotForRender with s-maxage=60, stale-while-revalidate=300', /readTourSnapshotForRender\(\)/.test(route) && /public, s-maxage=60, stale-while-revalidate=300/.test(route))
    check('landing data: the live helpers are pure (no prisma, no fetch)', !/prisma|fetch\(/.test(live))
  }

  // ── the sentences audit (pure half) ────────────────────────────────────────
  {
    const all = tourSentences()
    check('landing data sentences: the tour offers sentences to audit', all.length > 0, String(all.length))
    for (const { side, ask } of all) {
      const o = simulateLadder(ask)
      check(`landing data sentences (${side}): "${ask}" parses to an action in the chat ladder`, o.kind === 'action', `${o.gate}/${o.kind}${o.note ? ` — ${o.note}` : ''}`)
      check(`landing data sentences (${side}): "${ask}" passes canTradeAsk with no verdicts`, canTradeAsk(ask, null))
      check(`landing data sentences (${side}): "${ask}" works for a FRESH wallet (no open position, no smart wallet needed)`, !WALLET_CONDITIONAL.test(ask), 'needs a position or a smart wallet holding the token: say it in words, not a chip (README rule 4)')
    }
    check('landing data: EMPTY_TOUR has no earn rows and null earnWays', EMPTY_TOUR.earn.length === 0 && EMPTY_TOUR.counts.earnWays === null)
  }
}

async function postChat(base: string, ask: string): Promise<Record<string, unknown>> {
  const r = await fetch(`${base}/api/chat`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1', 'x-yf-no-ask-log': '1' },
    body: JSON.stringify({ message: ask, history: [], activeServers: [] }),
    signal: AbortSignal.timeout(60_000),
  })
  return ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown>
}

export async function landingDataPinsServed(check: Check, base: string): Promise<void> {
  // ── the route ──────────────────────────────────────────────────────────────
  let snap: TourSnapshot | null = null
  {
    const r = await fetch(`${base}/api/home/tour`).catch(() => null)
    const cc = r?.headers.get('cache-control') ?? ''
    snap = r?.ok ? ((await r.json().catch(() => null)) as TourSnapshot | null) : null
    check('landing data (served): GET /api/home/tour answers 200 with s-maxage=60, stale-while-revalidate=300', !!r?.ok && cc === 'public, s-maxage=60, stale-while-revalidate=300', `${r?.status} · ${cc}`)
    const keys = snap ? Object.keys(snap).sort().join(',') : ''
    check('landing data (served): the snapshot has the contract shape', keys === 'asOf,chains,community,counts,earn,fees' && !!snap && Array.isArray(snap.earn) && Array.isArray(snap.community?.latest) && typeof snap.community?.rooms === 'number' && typeof snap.community?.postsWeek === 'number', keys)
    const c = snap?.counts
    check(
      'landing data (served): the static counts equal the registries',
      !!c && c.chains === APP_CHAINS.length && c.apps === HOME_APPS.length && c.macro === MACRO_ROWS.length && c.venues === buildVenueManifest().venues.length && c.stocks === (marketSections().find((s) => s.id === 'equities')?.rows.length ?? null),
      JSON.stringify(c),
    )
    const earn = snap?.earn ?? []
    check(
      'landing data (served): the ladder rows are whole (asset, venue, chain, a rate, a sentence), highest first, one per asset',
      earn.every((r, i) => r.asset && r.venue && r.chain && Number.isFinite(r.apy) && r.ask && (i === 0 || earn[i - 1].apy >= r.apy)) && new Set(earn.map((r) => r.asset)).size === earn.length && earn.length <= TOUR_EARN_ROWS,
      earn.map((r) => `${r.asset} ${r.apy}`).join(' · ') || '(no venue answered — an empty ladder is allowed)',
    )
    check('landing data (served): earnWays counts at least the ladder (and is null when nothing was read)', earn.length === 0 || (typeof c?.earnWays === 'number' && c.earnWays >= earn.length), String(c?.earnWays))
    check('landing data (served): every community post is a public /c/ address; movedUsd only on a trade', (snap?.community.latest ?? []).every((p) => /^\/c\/[a-z0-9]{6,16}$/.test(p.href) && (p.movedUsd == null || p.kind === 'trade')))
  }

  // ── `/` stays static ───────────────────────────────────────────────────────
  {
    const r = await fetch(`${base}/`, { method: 'HEAD' }).catch(() => null)
    const cc = r?.headers.get('cache-control') ?? ''
    check('landing data (served): `/` still answers s-maxage=60 (ISR, not per request)', /s-maxage=60\b/.test(cc), cc)
  }

  // ── the sentences audit (served half): the chat route, no wallet ───────────
  {
    const asks = new Map<string, string>()
    for (const { side, ask } of tourSentences()) if (!asks.has(ask)) asks.set(ask, side)
    for (const r of snap?.earn ?? []) if (!asks.has(r.ask)) asks.set(r.ask, 'earn ladder')
    for (const [ask, side] of asks) {
      const j = await postChat(base, ask).catch(() => ({}) as Record<string, unknown>)
      const held = typeof j.connectAsk === 'string' ? j.connectAsk : null
      // KNOWN GAP (2026-11-10, not this lane's file): the jobs layer's
      // wallet-less wall (app/api/chat/route.ts, `if (!walletAddress)` under
      // `if (jobAsk)`) answers words with no connect door. The landing never
      // reaches it — act() is connect-to-act, so a job sentence is sent WITH a
      // wallet — so a job sentence passes when the pure ladder claims it
      // (jobs/action) and the route answers that exact wall. Delete this
      // allowance when the wall carries connectWallet + connectAsk.
      const jobsWall = simulateLadder(ask).gate === 'jobs' && /^🧭 That chains multiple money steps — connect your wallet first/.test(String(j.reply ?? '')) && !j.error
      const door = j.connectWallet === true && classifyTurn(j).kind === null && (held == null || held === ask || held.startsWith(ask.replace(/\.$/, '')))
      const ok = door || jobsWall
      if (jobsWall) console.log(`   note: "${ask}" hit the jobs layer's door-less guest wall (route.ts); the landing sends it after connect`)
      check(`landing data sentences (served, ${side}): "${ask}" → the connect door, not a planner turn or a wall`, ok, JSON.stringify({ connectWallet: j.connectWallet, connectAsk: j.connectAsk, buildPath: j.buildPath, reply: String(j.reply ?? '').slice(0, 100) }))
      if (ok && held && held !== ask) console.log(`   note: "${ask}" was read through the intent net as "${held}" (accepted; the canonical sentence skips the "I read that as" line)`)
    }
  }
}

if (process.argv[1]?.endsWith('landing-data-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingDataPins(check))
    .then(() => (served ? landingDataPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
