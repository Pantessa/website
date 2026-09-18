import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress, isTestWallet, TEST_WALLETS } from '@/lib/admin'
import { REAL_TRAFFIC_SQL, STANDING_TURN_SQL } from '@/lib/value-origin'
import { COUNTED_EVENT_SQL } from '@/lib/link-receipt-verify'
import { isCdpListingConfigured, listCdpEndUsers, type CdpEndUser } from '@/lib/cdp'
import {
  GROWTH_WINDOWS,
  accountStage,
  dailySeries,
  dayKey,
  deltaPct,
  earningsByCreator,
  feesByVenue,
  sourceMix,
  sumSplit,
  windowRows,
  type GrowthSource,
  type GrowthTurnRow,
} from '@/lib/admin-growth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Growth — the go-to-market books, admin-gated.
 *
 * Who signed up (the Coinbase embedded-wallet accounts, with the email each
 * one used — that lives at CDP, nowhere in our DB), how much money moved,
 * what it earned, and how that fee splits between Pantessa and link creators.
 *
 * Every money number is a fold over ONE query of real, receipt-counted signed
 * turns (lib/admin-growth), fenced the way the public scoreboard is:
 * REAL_TRAFFIC_SQL plus the harness session prefix. `?external=1` also drops
 * Pantessa's own wallets — strictly: a turn with no wallet on it can't be
 * shown to be a stranger's, so it goes too.
 */

const REAL = Prisma.raw(`session_id NOT LIKE 'harness-%' AND ${REAL_TRAFFIC_SQL}`)
// Real signed money, as a subquery: the fence's column names are unqualified,
// so it has to run before anything with its own `is_internal` is joined on.
const SIGNED = Prisma.raw(
  `SELECT *, ${STANDING_TURN_SQL} AS standing FROM embed_turns
   WHERE outcome = 'signed' AND value_usd > 0 AND session_id NOT LIKE 'harness-%' AND ${REAL_TRAFFIC_SQL}`,
)
const COUNTED_EVENT = Prisma.raw(COUNTED_EVENT_SQL)
/** Every arrival table has carried `is_internal` since #650 (2026-08-18). */
const INTERNAL_STAMP_SINCE = Date.parse('2026-08-19T00:00:00Z')
const r2 = (n: number) => Math.round(n * 100) / 100
const r4 = (n: number) => Math.round(n * 1e4) / 1e4

/** A section that fails reads as empty; the page still loads. */
async function soft<T>(label: string, q: Promise<T>, fallback: T): Promise<T> {
  try {
    return await q
  } catch (e) {
    console.warn(`[admin/growth] ${label} failed:`, e instanceof Error ? e.message.split('\n')[0] : e)
    return fallback
  }
}

export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(addr)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const daysRaw = Number(req.nextUrl.searchParams.get('days'))
  const days = (GROWTH_WINDOWS as readonly number[]).includes(daysRaw) ? daysRaw : 30
  const external = req.nextUrl.searchParams.get('external') === '1'
  const testers = Array.from(TEST_WALLETS).map((w) => w.toLowerCase())
  const now = Date.now()
  const since = new Date(now - (days - 1) * 86_400_000)
  since.setUTCHours(0, 0, 0, 0)

  const [turnRows, traderRows, weeklyRows, creatorRows, claimRows, engagement, topWatched, topTraded, linkFunnel, subscribers, alertEmails, failures, cdp] =
    await Promise.all([
      // THE money query. `creator` = who is owed half the fee: the link's
      // creator, else (no link on the turn) whoever first referred the wallet.
      soft('turns', prisma.$queryRaw<TurnRow[]>(Prisma.sql`
        SELECT to_char(date_trunc('day', t.created_at), 'YYYY-MM-DD') AS day,
               CASE WHEN t.standing THEN 'standing'
                    WHEN t.intent_link_slug IS NOT NULL THEN 'link'
                    WHEN t.origin_kind = 'embed' OR t.embed_key_id <> '' THEN 'embed'
                    ELSE 'chat' END AS source,
               t.build_path, t.fee_bps,
               CASE WHEN t.intent_link_slug IS NOT NULL THEN il.creator ELSE rw.creator END AS creator,
               coalesce(t.wallet_address = ANY(${testers}), false) AS tester,
               (t.wallet_address IS NULL) AS anonymous,
               sum(t.value_usd)::float AS usd, count(*)::int AS n
        FROM (${SIGNED}) t
        LEFT JOIN intent_links il ON il.id = t.intent_link_slug
        LEFT JOIN referred_wallets rw ON rw.wallet = t.wallet_address
        GROUP BY 1, 2, 3, 4, 5, 6, 7
      `), []),
      // One row per signing wallet — traders, whales, new vs returning.
      soft('traders', prisma.$queryRaw<TraderRow[]>(Prisma.sql`
        SELECT t.wallet_address AS wallet,
               min(t.created_at) AS first_at, max(t.created_at) AS last_at,
               count(*)::int AS n, sum(t.value_usd)::float AS usd,
               count(*) FILTER (WHERE t.created_at >= ${since})::int AS n_win,
               coalesce(sum(t.value_usd) FILTER (WHERE t.created_at >= ${since}), 0)::float AS usd_win,
               count(DISTINCT date_trunc('day', t.created_at))::int AS active_days,
               max(rw.creator) AS referred_by
        FROM (${SIGNED}) t LEFT JOIN referred_wallets rw ON rw.wallet = t.wallet_address
        WHERE t.wallet_address IS NOT NULL
        GROUP BY 1 ORDER BY usd DESC LIMIT 2000
      `), []),
      // Weekly traders, split by whether this was the wallet's first trading week.
      soft('weekly', prisma.$queryRaw<WeeklyRow[]>(Prisma.sql`
        WITH s AS (
          SELECT t.wallet_address AS w, date_trunc('week', t.created_at) AS wk, sum(t.value_usd)::float AS usd
          FROM embed_turns t
          WHERE t.outcome = 'signed' AND t.value_usd > 0 AND t.wallet_address IS NOT NULL AND ${REAL}
            AND (NOT ${external} OR t.wallet_address <> ALL(${testers}))
          GROUP BY 1, 2
        ), f AS (SELECT w, min(wk) AS first_wk FROM s GROUP BY 1)
        SELECT to_char(s.wk, 'YYYY-MM-DD') AS week,
               count(*) FILTER (WHERE s.wk = f.first_wk)::int AS new_traders,
               count(*) FILTER (WHERE s.wk > f.first_wk)::int AS returning_traders,
               sum(s.usd)::float AS usd
        FROM s JOIN f ON f.w = s.w
        WHERE s.wk >= date_trunc('week', now()) - interval '11 weeks'
        GROUP BY 1 ORDER BY 1
      `), []),
      // Creators: links, funnel, handle, referred wallets.
      soft('creators', prisma.$queryRaw<CreatorRow[]>(Prisma.sql`
        WITH l AS (
          SELECT creator, count(*)::int AS links, max(created_at) AS last_mint,
                 count(*) FILTER (WHERE created_at >= ${since})::int AS links_win
          FROM intent_links WHERE creator IS NOT NULL AND NOT is_internal GROUP BY 1
        ), e AS (
          SELECT il.creator,
                 count(*) FILTER (WHERE ev.kind = 'open')::int AS opens,
                 count(*) FILTER (WHERE ev.kind = 'connect')::int AS connects,
                 count(*) FILTER (WHERE ev.kind = 'signed' AND ${COUNTED_EVENT})::int AS signs
          FROM intent_link_events ev JOIN intent_links il ON il.id = ev.slug
          WHERE il.creator IS NOT NULL AND NOT il.is_internal AND NOT ev.is_internal GROUP BY 1
        ), r AS (SELECT creator, count(*)::int AS referred FROM referred_wallets GROUP BY 1)
        SELECT l.creator, l.links, l.links_win, l.last_mint, h.handle, h.brand_name,
               coalesce(e.opens, 0) AS opens, coalesce(e.connects, 0) AS connects, coalesce(e.signs, 0) AS signs,
               coalesce(r.referred, 0) AS referred
        FROM l LEFT JOIN e ON e.creator = l.creator LEFT JOIN r ON r.creator = l.creator
        LEFT JOIN creator_handles h ON h.creator = l.creator
        ORDER BY l.last_mint DESC LIMIT 500
      `), []),
      soft('claims', prisma.$queryRaw<{ creator: string; status: string; usd: number; n: number }[]>(Prisma.sql`
        SELECT creator, status, sum(amount_usd)::float AS usd, count(*)::int AS n
        FROM intent_link_claims GROUP BY 1, 2
      `), []),
      // The product's pulse — one row of counts, each "total / in the window".
      soft('engagement', prisma.$queryRaw<EngagementRow[]>(Prisma.sql`
        SELECT
          (SELECT count(*)::int FROM watchlists WHERE NOT is_internal) AS watchlists,
          (SELECT count(DISTINCT owner)::int FROM watchlists WHERE NOT is_internal) AS watchlist_owners,
          (SELECT count(*)::int FROM watchlists WHERE NOT is_internal AND created_at >= ${since}) AS watchlists_win,
          (SELECT count(*)::int FROM watchlist_items i JOIN watchlists w ON w.id = i.watchlist_id WHERE NOT w.is_internal) AS watch_items,
          (SELECT count(*)::int FROM watchlists WHERE NOT is_internal AND is_public) AS public_lists,
          (SELECT count(*)::int FROM price_alerts WHERE NOT is_internal AND status = 'active') AS alerts_active,
          (SELECT count(*)::int FROM price_alerts WHERE NOT is_internal AND fired_at IS NOT NULL) AS alerts_fired,
          (SELECT count(*)::int FROM price_alerts WHERE NOT is_internal AND created_at >= ${since}) AS alerts_win,
          (SELECT count(*)::int FROM chart_posts WHERE NOT is_internal) AS posts,
          (SELECT count(*)::int FROM chart_posts WHERE NOT is_internal AND created_at >= ${since}) AS posts_win,
          (SELECT count(*)::int FROM chart_post_comments WHERE NOT is_internal) AS comments,
          (SELECT count(*)::int FROM intent_links WHERE NOT is_internal) AS links,
          (SELECT count(*)::int FROM intent_links WHERE NOT is_internal AND created_at >= ${since}) AS links_win,
          (SELECT count(*)::int FROM creator_handles) AS handles,
          (SELECT count(*)::int FROM chats WHERE NOT is_internal AND created_at >= ${since}) AS chats_win,
          (SELECT count(*)::int FROM messages m JOIN chats c ON c.id = m.chat_id
             WHERE NOT c.is_internal AND m.role = 'user' AND m.created_at >= ${since}) AS turns_win,
          (SELECT count(*)::int FROM embed_turns t WHERE ${REAL} AND t.outcome = 'tx-built' AND t.created_at >= ${since}) AS built_win,
          (SELECT count(*)::int FROM jobs WHERE NOT is_internal AND origin_env = 'production'
             AND status IN ('running', 'waiting_signature', 'waiting_settlement')) AS jobs_live,
          (SELECT count(*)::int FROM jobs WHERE NOT is_internal AND origin_env = 'production' AND status = 'done') AS jobs_done,
          (SELECT count(*)::int FROM dca_schedules WHERE NOT is_internal AND origin_env = 'production' AND status = 'active') AS dca_active,
          (SELECT count(*)::int FROM hl_guardian_policies WHERE NOT is_internal AND status = 'active') AS guardians_active,
          (SELECT count(*)::int FROM spot_guard_policies WHERE origin_env = 'production' AND status = 'active') AS spot_guards_active
      `), []),
      soft('topWatched', prisma.$queryRaw<{ symbol: string; n: number }[]>(Prisma.sql`
        SELECT i.symbol, count(DISTINCT w.owner)::int AS n
        FROM watchlist_items i JOIN watchlists w ON w.id = i.watchlist_id
        WHERE NOT w.is_internal GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 12
      `), []),
      // `symbols` are side-tagged ("buy:ETH"); the ticker is what's after the colon.
      soft('topTraded', prisma.$queryRaw<{ symbol: string; n: number; usd: number }[]>(Prisma.sql`
        SELECT split_part(s, ':', 2) AS symbol, count(*)::int AS n, sum(t.value_usd)::float AS usd
        FROM embed_turns t, unnest(t.symbols) AS s
        WHERE t.outcome = 'signed' AND t.value_usd > 0 AND ${REAL} AND s LIKE 'buy:%'
        GROUP BY 1 ORDER BY 3 DESC LIMIT 12
      `), []),
      // Every link's funnel in the window, strangers' events only.
      soft('linkFunnel', prisma.$queryRaw<{ kind: string; n: number; wallets: number }[]>(Prisma.sql`
        SELECT ev.kind, count(*)::int AS n, count(DISTINCT ev.wallet)::int AS wallets
        FROM intent_link_events ev JOIN intent_links il ON il.id = ev.slug
        WHERE NOT ev.is_internal AND NOT il.is_internal AND ev.created_at >= ${since}
          AND (ev.kind <> 'signed' OR ${COUNTED_EVENT})
        GROUP BY 1
      `), []),
      soft('subscribers', prisma.$queryRaw<{ email: string; status: string; created_at: Date }[]>(Prisma.sql`
        SELECT email, status, created_at FROM subscribers
        WHERE email !~* '\\.(invalid|test|example)$' ORDER BY created_at DESC LIMIT 200
      `), []),
      soft('alertEmails', prisma.$queryRaw<{ email: string; owner: string; n: number; last_at: Date }[]>(Prisma.sql`
        SELECT lower(email) AS email, max(owner) AS owner, count(*)::int AS n, max(created_at) AS last_at
        FROM price_alerts WHERE email IS NOT NULL AND email <> '' AND NOT is_internal
        GROUP BY 1 ORDER BY 4 DESC LIMIT 200
      `), []),
      soft('failures', prisma.$queryRaw<{ kind: string; n: number; funded: number; funds_usd: number }[]>(Prisma.sql`
        SELECT kind, count(*)::int AS n, count(*) FILTER (WHERE had_funds)::int AS funded,
               coalesce(sum(funds_usd) FILTER (WHERE had_funds), 0)::float AS funds_usd
        FROM ask_failures WHERE NOT is_internal AND created_at >= ${since} GROUP BY 1 ORDER BY 2 DESC
      `), []),
      loadCdp(),
    ])

  // ── Money ────────────────────────────────────────────────────────────────
  const rows: GrowthTurnRow[] = turnRows
    .filter((r) => !external || (!r.tester && !r.anonymous))
    .map((r) => ({
      day: r.day,
      source: r.source as GrowthSource,
      buildPath: r.build_path,
      feeBps: r.fee_bps,
      creator: r.creator,
      tester: r.tester,
      usd: r.usd,
      n: r.n,
    }))
  const { current, previous } = windowRows(rows, days, now)
  const cur = sumSplit(current)
  const prev = sumSplit(previous)
  const all = sumSplit(rows)
  // The team split always reads the unfiltered rows, so the toggle never
  // hides how much of the window was us.
  const winStartDay = dayKey(now, days - 1)
  const teamUsd = turnRows.filter((r) => r.tester && r.day >= winStartDay).reduce((s, r) => s + r.usd, 0)
  const anonUsd = turnRows.filter((r) => r.anonymous && r.day >= winStartDay).reduce((s, r) => s + r.usd, 0)

  const traders = traderRows.filter((t) => !external || !isTestWallet(t.wallet))
  const winStart = since.getTime()
  const prevStart = winStart - days * 86_400_000
  const activeTraders = traders.filter((t) => t.n_win > 0).length
  const newTraders = traders.filter((t) => t.first_at.getTime() >= winStart).length
  const prevNewTraders = traders.filter((t) => t.first_at.getTime() >= prevStart && t.first_at.getTime() < winStart).length
  const repeatTraders = traders.filter((t) => t.active_days >= 2).length

  // ── Creators ─────────────────────────────────────────────────────────────
  const earned = earningsByCreator(rows)
  const claimsBy = new Map<string, { requested: number; paid: number }>()
  for (const c of claimRows) {
    const cur = claimsBy.get(c.creator) ?? { requested: 0, paid: 0 }
    if (c.status === 'paid') cur.paid += c.usd
    else if (c.status === 'requested') cur.requested += c.usd
    claimsBy.set(c.creator, cur)
  }
  const creators = creatorRows
    .filter((c) => !external || !isTestWallet(c.creator))
    // Harness mints from before the is_internal stamp are still unflagged in
    // prod (scripts/backfill-internal-arrivals.ts is an owner step), and they
    // outnumber real creators 100:1. A creator from that era shows only with
    // something the harness never had: a claimed page or fenced volume. (Not
    // a referred wallet — the old referral fixtures minted those too.)
    .filter((c) => c.last_mint.getTime() >= INTERNAL_STAMP_SINCE || !!c.handle || (earned.get(c.creator)?.volumeUsd ?? 0) > 0)
    .map((c) => {
      const e = earned.get(c.creator) ?? { volumeUsd: 0, trades: 0, earnedUsd: 0 }
      const cl = claimsBy.get(c.creator) ?? { requested: 0, paid: 0 }
      return {
        creator: c.creator,
        handle: c.handle,
        brandName: c.brand_name,
        test: isTestWallet(c.creator),
        links: c.links,
        linksWindow: c.links_win,
        lastMint: c.last_mint.toISOString(),
        opens: c.opens,
        connects: c.connects,
        signs: c.signs,
        referred: c.referred,
        volumeUsd: r2(e.volumeUsd),
        trades: e.trades,
        earnedUsd: r4(e.earnedUsd),
        claimRequestedUsd: r2(cl.requested),
        claimPaidUsd: r2(cl.paid),
        owedUsd: r4(Math.max(0, e.earnedUsd - cl.paid)),
      }
    })
    .sort((a, b) => b.volumeUsd - a.volumeUsd || b.signs - a.signs || b.opens - a.opens)
  const claimTotals = [...claimsBy.values()].reduce((s, c) => ({ requested: s.requested + c.requested, paid: s.paid + c.paid }), { requested: 0, paid: 0 })

  // ── Accounts (Coinbase) joined to what each wallet did here ──────────────
  const accountWallets = cdp.users.flatMap((u) => u.wallets)
  const activity = accountWallets.length
    ? await soft('accountActivity', prisma.$queryRaw<AccountActivityRow[]>(Prisma.sql`
        WITH w AS (SELECT unnest(${accountWallets}::text[]) AS a)
        SELECT w.a AS wallet,
          -- An ask = a message the person sent, or a walled money ask. First-party
          -- chat only beacons built/signed turns, so embed_turns alone reads as
          -- "never asked" for someone with a dozen chats (the arc counts the same way).
          (SELECT count(*)::int FROM messages m JOIN chats c ON c.id = m.chat_id
             WHERE lower(c.owner_address) = w.a AND m.role = 'user')
            + (SELECT count(*)::int FROM ask_failures f WHERE lower(f.wallet) = w.a AND NOT f.is_internal) AS turns,
          (SELECT count(*)::int FROM embed_turns t WHERE t.wallet_address = w.a AND NOT t.is_internal AND t.outcome IN ('tx-built', 'signed'))
            + (SELECT count(*)::int FROM messages m JOIN chats c ON c.id = m.chat_id
                 WHERE lower(c.owner_address) = w.a
                   AND m.meta ?| array['txRequest', 'txChain', 'orderRequest', 'jobId', 'guardianPolicyId', 'dcaScheduleId']) AS built,
          (SELECT count(*)::int FROM embed_turns t WHERE t.wallet_address = w.a AND t.outcome = 'signed' AND t.value_usd > 0 AND ${REAL}) AS signed,
          (SELECT coalesce(sum(t.value_usd), 0)::float FROM embed_turns t WHERE t.wallet_address = w.a AND t.outcome = 'signed' AND t.value_usd > 0 AND ${REAL}) AS usd,
          (SELECT max(t.created_at) FROM embed_turns t WHERE t.wallet_address = w.a) AS last_turn,
          (SELECT count(*)::int FROM chats c WHERE lower(c.owner_address) = w.a) AS chats,
          (SELECT count(*)::int FROM intent_links l WHERE l.creator = w.a AND NOT l.is_internal) AS links,
          (SELECT count(*)::int FROM watchlist_items i JOIN watchlists wl ON wl.id = i.watchlist_id WHERE wl.owner = w.a) AS watching,
          (SELECT prompt FROM ask_failures f WHERE lower(f.wallet) = w.a ORDER BY f.created_at DESC LIMIT 1) AS last_wall
        FROM w
      `), [])
    : []
  const actBy = new Map(activity.map((a) => [a.wallet, a]))
  const accounts = cdp.users.map((u) => {
    const acts = u.wallets.map((w) => actBy.get(w)).filter((a): a is AccountActivityRow => !!a)
    const sum = (k: 'turns' | 'built' | 'signed' | 'usd' | 'chats' | 'links' | 'watching') => acts.reduce((s, a) => s + a[k], 0)
    const lastTurn = acts.map((a) => a.last_turn?.getTime() ?? 0).reduce((m, t) => Math.max(m, t), 0)
    const a = { turns: sum('turns'), built: sum('built'), signed: sum('signed') }
    return {
      email: u.email,
      name: u.name,
      method: u.method,
      wallet: u.wallets[0] ?? null,
      test: u.wallets.some((w) => isTestWallet(w)),
      createdAt: u.createdAt,
      lastSignInAt: u.lastAuthenticatedAt,
      lastTurnAt: lastTurn ? new Date(lastTurn).toISOString() : null,
      ...a,
      usd: r2(sum('usd')),
      chats: sum('chats'),
      links: sum('links'),
      watching: sum('watching'),
      lastWall: acts.find((x) => x.last_wall)?.last_wall ?? null,
      stage: accountStage(a),
    }
  })
  const shownAccounts = external ? accounts.filter((a) => !a.test) : accounts
  const inWin = (iso: string) => Date.parse(iso) >= winStart
  const inPrev = (iso: string) => Date.parse(iso) >= prevStart && Date.parse(iso) < winStart
  const signupsDaily = new Map<string, number>()
  for (const a of shownAccounts) if (inWin(a.createdAt)) signupsDaily.set(a.createdAt.slice(0, 10), (signupsDaily.get(a.createdAt.slice(0, 10)) ?? 0) + 1)

  const emailByWallet = new Map<string, string>()
  for (const u of cdp.users) if (u.email) for (const w of u.wallets) emailByWallet.set(w, u.email)

  const eng = engagement[0] ?? null
  const funnelOf = (k: string) => linkFunnel.find((f) => f.kind === k) ?? { n: 0, wallets: 0 }

  return NextResponse.json({
    windowDays: days,
    external,
    generatedAt: new Date(now).toISOString(),
    tiles: {
      volumeUsd: r2(cur.volumeUsd),
      volumeDelta: deltaPct(cur.volumeUsd, prev.volumeUsd),
      volumeAllTimeUsd: r2(all.volumeUsd),
      trades: cur.trades,
      tradesDelta: deltaPct(cur.trades, prev.trades),
      avgTradeUsd: cur.trades > 0 ? r2(cur.volumeUsd / cur.trades) : null,
      feeUsd: r4(cur.feeUsd),
      feeDelta: deltaPct(cur.feeUsd, prev.feeUsd),
      feeAllTimeUsd: r4(all.feeUsd),
      pantessaUsd: r4(cur.pantessaUsd),
      creatorUsd: r4(cur.creatorUsd),
      takeRateBps: cur.volumeUsd > 0 ? r2((cur.feeUsd / cur.volumeUsd) * 10_000) : null,
      activeTraders,
      newTraders,
      newTradersDelta: deltaPct(newTraders, prevNewTraders),
      tradersAllTime: traders.length,
      repeatTraders,
      teamUsd: r2(teamUsd),
      anonymousUsd: r2(anonUsd),
      signups: shownAccounts.filter((a) => inWin(a.createdAt)).length,
      signupsDelta: deltaPct(shownAccounts.filter((a) => inWin(a.createdAt)).length, shownAccounts.filter((a) => inPrev(a.createdAt)).length),
      accountsAllTime: shownAccounts.length,
    },
    series: dailySeries(rows, days, now).map((p) => ({
      ...p,
      signups: signupsDaily.get(p.day) ?? 0,
    })),
    sources: sourceMix(current).map((s) => ({ ...s, usd: r2(s.usd) })),
    fees: {
      window: feesByVenue(current),
      allTime: feesByVenue(rows),
      totals: { window: cur, allTime: all },
      claims: { requestedUsd: r2(claimTotals.requested), paidUsd: r2(claimTotals.paid) },
      creatorOwedUsd: r4(Math.max(0, all.creatorUsd - claimTotals.paid)),
    },
    weekly: weeklyRows.map((w) => ({ week: w.week, newTraders: w.new_traders, returningTraders: w.returning_traders, usd: r2(w.usd) })),
    traders: traders.slice(0, 50).map((t) => ({
      wallet: t.wallet,
      email: emailByWallet.get(t.wallet) ?? null,
      test: isTestWallet(t.wallet),
      usd: r2(t.usd),
      trades: t.n,
      usdWindow: r2(t.usd_win),
      activeDays: t.active_days,
      firstAt: t.first_at.toISOString(),
      lastAt: t.last_at.toISOString(),
      referredBy: t.referred_by,
    })),
    creators: creators.slice(0, 100),
    creatorCount: creators.length,
    linkFunnel: {
      opens: funnelOf('open').n,
      connects: funnelOf('connect').n,
      built: funnelOf('built').n,
      signed: funnelOf('signed').n,
      signers: funnelOf('signed').wallets,
    },
    accounts: { ok: cdp.ok, reason: cdp.reason, rows: shownAccounts },
    subscribers: subscribers.map((s) => ({ email: s.email, status: s.status, createdAt: s.created_at.toISOString() })),
    alertEmails: alertEmails.map((a) => ({ email: a.email, owner: a.owner, alerts: a.n, lastAt: a.last_at.toISOString() })),
    engagement: eng,
    topWatched,
    topTraded: topTraded.map((t) => ({ ...t, usd: r2(t.usd) })),
    failures: failures.map((f) => ({ kind: f.kind, n: f.n, funded: f.funded, fundsUsd: r2(f.funds_usd) })),
  })
}

async function loadCdp(): Promise<{ ok: boolean; reason: string | null; users: CdpEndUser[] }> {
  if (!isCdpListingConfigured()) return { ok: false, reason: 'CDP_API_KEY_ID / CDP_API_KEY_SECRET are not set here.', users: [] }
  try {
    return { ok: true, reason: null, users: await listCdpEndUsers() }
  } catch (e) {
    const reason = e instanceof Error ? e.message.split('\n')[0] : 'Coinbase did not answer.'
    console.warn('[admin/growth] CDP end users failed:', reason)
    return { ok: false, reason, users: [] }
  }
}

interface TurnRow {
  day: string
  source: string
  build_path: string | null
  fee_bps: number | null
  creator: string | null
  tester: boolean
  anonymous: boolean
  usd: number
  n: number
}
interface TraderRow {
  wallet: string
  first_at: Date
  last_at: Date
  n: number
  usd: number
  n_win: number
  usd_win: number
  active_days: number
  referred_by: string | null
}
interface WeeklyRow {
  week: string
  new_traders: number
  returning_traders: number
  usd: number
}
interface CreatorRow {
  creator: string
  links: number
  links_win: number
  last_mint: Date
  handle: string | null
  brand_name: string | null
  opens: number
  connects: number
  signs: number
  referred: number
}
interface EngagementRow {
  [k: string]: number
}
interface AccountActivityRow {
  wallet: string
  turns: number
  built: number
  signed: number
  usd: number
  last_turn: Date | null
  chats: number
  links: number
  watching: number
  last_wall: string | null
}
