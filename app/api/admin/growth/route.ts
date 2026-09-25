import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress, isTestWallet, TEST_WALLETS } from '@/lib/admin'
import { REAL_TRAFFIC_SQL } from '@/lib/value-origin'
import { COUNTED_EVENT_SQL } from '@/lib/link-receipt-verify'
import { isCdpListingConfigured, listCdpEndUsers, type CdpEndUser } from '@/lib/cdp'
import {
  GROWTH_JOB_JOIN_SQL,
  GROWTH_SOURCE_SQL,
  GROWTH_WINDOWS,
  NO_ACTIVITY,
  dailySeries,
  dayKey,
  deltaPct,
  earningsByCreator,
  feesByVenue,
  mergePeople,
  sourceMix,
  sumSplit,
  windowRows,
  type GrowthSource,
  type GrowthTurnRow,
  type PersonActivity,
  type WalletArrival,
} from '@/lib/admin-growth'
import { countedDeskRows, deskGrowthSummary, type DeskGrowth } from '@/lib/desk-activity'
import { deskSince, readDeskRows } from '@/app/api/admin/desk/read'

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
  `SELECT * FROM embed_turns
   WHERE outcome = 'signed' AND value_usd > 0 AND session_id NOT LIKE 'harness-%' AND ${REAL_TRAFFIC_SQL}`,
)
/** Where each signed dollar was asked for (lib/admin-growth growthSourceOf):
 *  a job's steps join their job, so they land on the surface it was asked on. */
const SOURCE = Prisma.raw(GROWTH_SOURCE_SQL)
const JOB_JOIN = Prisma.raw(GROWTH_JOB_JOIN_SQL)
const COUNTED_EVENT = Prisma.raw(COUNTED_EVENT_SQL)
/** Every arrival table has carried `is_internal` since #650 (2026-08-18). */
const INTERNAL_STAMP_SINCE = Date.parse('2026-08-19T00:00:00Z')
/** The people list is capped; it reads newest-seen first. */
const ARRIVAL_LIMIT = 600
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

  const [turnRows, traderRows, weeklyRows, creatorRows, claimRows, engagement, topWatched, topTraded, linkFunnel, subscribers, alertEmails, failures, cdp, arrivals] =
    await Promise.all([
      // THE money query. `creator` = who is owed half the fee: the link's
      // creator, else (no link on the turn) whoever first referred the wallet.
      // It reads the ROW's own link, never the job's: a step the runner wrote
      // carries none, the creator routes pay nothing on it, and the books
      // show what is owed, not what should be.
      soft('turns', prisma.$queryRaw<TurnRow[]>(Prisma.sql`
        SELECT to_char(date_trunc('day', t.created_at), 'YYYY-MM-DD') AS day,
               ${SOURCE} AS source,
               t.build_path, t.fee_bps,
               CASE WHEN t.intent_link_slug IS NOT NULL THEN il.creator ELSE rw.creator END AS creator,
               coalesce(t.wallet_address = ANY(${testers}), false) AS tester,
               (t.wallet_address IS NULL) AS anonymous,
               sum(t.value_usd)::float AS usd, count(*)::int AS n
        FROM (${SIGNED}) t
        ${JOB_JOIN}
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
      // Everyone a native wallet lane brought in. Nobody signs up with
      // MetaMask or Phantom — they connect and start acting — so our own
      // arrival tables are the only record they exist, and the first/last
      // sighting across them is their whole account history.
      //
      // The legacy-harness fence is the creators list's, for the same reason:
      // every pre-stamp test:api run minted links and working sets from
      // throwaway wallets, and the backfill is still an owner step. A wallet
      // from that era shows only with something the harness never had — real
      // fenced money, or a claimed page.
      soft('arrivals', prisma.$queryRaw<ArrivalRow[]>(Prisma.sql`
        WITH seen AS (
          SELECT lower(owner_address) AS w, min(created_at) AS f, max(updated_at) AS l
            FROM chats WHERE NOT is_internal AND owner_address <> '' GROUP BY 1
          UNION ALL
          SELECT lower(owner_address), min(created_at), max(updated_at)
            FROM wallet_working_sets WHERE NOT is_internal GROUP BY 1
          UNION ALL
          SELECT lower(owner), min(created_at), max(updated_at)
            FROM watchlists WHERE NOT is_internal GROUP BY 1
          UNION ALL
          SELECT lower(creator), min(created_at), max(created_at)
            FROM intent_links WHERE creator IS NOT NULL AND NOT is_internal GROUP BY 1
          UNION ALL
          SELECT lower(wallet_address), min(created_at), max(created_at)
            FROM embed_turns WHERE wallet_address IS NOT NULL AND ${REAL} GROUP BY 1
          UNION ALL
          SELECT lower(wallet), min(created_at), max(created_at)
            FROM ask_failures WHERE wallet IS NOT NULL AND NOT is_internal GROUP BY 1
        ), money AS (
          SELECT DISTINCT wallet_address AS w FROM (${SIGNED}) t WHERE t.wallet_address IS NOT NULL
        ), handles AS (
          SELECT DISTINCT creator AS w FROM creator_handles
        ), agg AS (
          SELECT w AS wallet, min(f) AS first_at, max(l) AS last_at
          FROM seen WHERE w LIKE '0x%' GROUP BY 1
        )
        SELECT a.wallet, a.first_at, a.last_at FROM agg a
        WHERE a.first_at >= ${new Date(INTERNAL_STAMP_SINCE)}
           OR a.wallet IN (SELECT w FROM money)
           OR a.wallet IN (SELECT w FROM handles)
        ORDER BY a.last_at DESC LIMIT ${ARRIVAL_LIMIT}
      `), []),
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

  // ── People: everyone who showed up, both lanes ───────────────────────────
  // Coinbase holds the email + Google accounts; a native wallet has no
  // account at all. Both are people. One activity read covers every wallet on
  // the page, and lib/admin-growth joins the two lanes into one list.
  const accountWallets = cdp.users.flatMap((u) => u.wallets.map((w) => w.toLowerCase()))
  const walletUniverse = [...new Set([...accountWallets, ...arrivals.map((a) => a.wallet.toLowerCase())])]
  // Pre-aggregated per table and joined, not nine correlated subqueries per
  // row: this list is hundreds of wallets now, not the nine CDP accounts.
  const activity = walletUniverse.length
    ? await soft('accountActivity', prisma.$queryRaw<AccountActivityRow[]>(Prisma.sql`
        WITH w AS (SELECT unnest(${walletUniverse}::text[]) AS a),
        -- An ask = a message the person sent, or a walled money ask. First-party
        -- chat only beacons built/signed turns, so embed_turns alone reads as
        -- "never asked" for someone with a dozen chats (the arc counts the same way).
        msgs AS (
          SELECT lower(c.owner_address) AS a,
                 count(*) FILTER (WHERE m.role = 'user')::int AS turns,
                 count(*) FILTER (WHERE m.meta ?| array['txRequest', 'txChain', 'orderRequest', 'jobId', 'guardianPolicyId', 'dcaScheduleId'])::int AS built
          FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE lower(c.owner_address) = ANY(${walletUniverse}::text[])
          GROUP BY 1
        ),
        -- The last thing they typed, and the last ask that walled. Whichever
        -- is newer is the path they tried; both fenced, because a drill's wall
        -- is not a person's attempt.
        last_msg AS (
          SELECT DISTINCT ON (lower(c.owner_address)) lower(c.owner_address) AS a,
                 left(m.content, 200) AS text, m.created_at AS at
          FROM messages m JOIN chats c ON c.id = m.chat_id
          WHERE m.role = 'user' AND NOT c.is_internal AND lower(c.owner_address) = ANY(${walletUniverse}::text[])
          ORDER BY 1, m.created_at DESC
        ),
        walls AS (
          SELECT lower(f.wallet) AS a, count(*)::int AS n FROM ask_failures f
          WHERE lower(f.wallet) = ANY(${walletUniverse}::text[]) AND NOT f.is_internal GROUP BY 1
        ),
        last_wall AS (
          SELECT DISTINCT ON (lower(f.wallet)) lower(f.wallet) AS a,
                 left(f.prompt, 200) AS text, f.created_at AS at
          FROM ask_failures f
          WHERE lower(f.wallet) = ANY(${walletUniverse}::text[]) AND NOT f.is_internal
          ORDER BY 1, f.created_at DESC
        ),
        et AS (
          SELECT t.wallet_address AS a,
                 count(*) FILTER (WHERE NOT t.is_internal AND t.outcome IN ('tx-built', 'signed'))::int AS built,
                 count(*) FILTER (WHERE t.outcome = 'signed' AND t.value_usd > 0 AND ${REAL})::int AS signed,
                 coalesce(sum(t.value_usd) FILTER (WHERE t.outcome = 'signed' AND t.value_usd > 0 AND ${REAL}), 0)::float AS usd,
                 max(t.created_at) AS last_turn
          FROM embed_turns t WHERE t.wallet_address = ANY(${walletUniverse}::text[]) GROUP BY 1
        ),
        ch AS (
          SELECT lower(owner_address) AS a, count(*)::int AS n FROM chats
          WHERE lower(owner_address) = ANY(${walletUniverse}::text[]) GROUP BY 1
        ),
        lk AS (
          SELECT creator AS a, count(*)::int AS n FROM intent_links
          WHERE creator = ANY(${walletUniverse}::text[]) AND NOT is_internal GROUP BY 1
        ),
        wl AS (
          SELECT l.owner AS a, count(*)::int AS n FROM watchlist_items i JOIN watchlists l ON l.id = i.watchlist_id
          WHERE l.owner = ANY(${walletUniverse}::text[]) GROUP BY 1
        )
        SELECT w.a AS wallet,
               coalesce(msgs.turns, 0) + coalesce(walls.n, 0) AS turns,
               coalesce(et.built, 0) + coalesce(msgs.built, 0) AS built,
               coalesce(et.signed, 0) AS signed,
               coalesce(et.usd, 0)::float AS usd,
               et.last_turn,
               coalesce(ch.n, 0) AS chats,
               coalesce(lk.n, 0) AS links,
               coalesce(wl.n, 0) AS watching,
               last_msg.text AS last_msg, last_msg.at AS last_msg_at,
               last_wall.text AS last_wall, last_wall.at AS last_wall_at
        FROM w
        LEFT JOIN msgs ON msgs.a = w.a
        LEFT JOIN last_msg ON last_msg.a = w.a
        LEFT JOIN walls ON walls.a = w.a
        LEFT JOIN last_wall ON last_wall.a = w.a
        LEFT JOIN et ON et.a = w.a
        LEFT JOIN ch ON ch.a = w.a
        LEFT JOIN lk ON lk.a = w.a
        LEFT JOIN wl ON wl.a = w.a
      `), [])
    : []
  const actBy = new Map<string, PersonActivity>(activity.map((a) => [a.wallet, activityOf(a)]))
  const people = mergePeople(
    cdp.users.map((u) => ({
      id: u.userId, email: u.email, name: u.name, method: u.method, wallets: u.wallets,
      createdAt: u.createdAt, lastAuthenticatedAt: u.lastAuthenticatedAt,
    })),
    arrivals.map<WalletArrival>((a) => ({
      wallet: a.wallet, firstAt: a.first_at.toISOString(), lastAt: a.last_at.toISOString(),
    })),
    (w) => actBy.get(w),
    isTestWallet,
  ).map((p) => ({ ...p, usd: r2(p.usd) }))
  const accounts = people
  const shownAccounts = external ? accounts.filter((a) => !a.test) : accounts
  // The signups tile and the series line stay what they always were — people
  // who made an ACCOUNT — so the number keeps its meaning now that the table
  // below it also lists wallets that never signed up for anything.
  const signedUpAccounts = shownAccounts.filter((a) => !!a.email)
  const inWin = (iso: string) => Date.parse(iso) >= winStart
  const inPrev = (iso: string) => Date.parse(iso) >= prevStart && Date.parse(iso) < winStart
  const signupsDaily = new Map<string, number>()
  for (const a of signedUpAccounts) if (inWin(a.createdAt)) signupsDaily.set(a.createdAt.slice(0, 10), (signupsDaily.get(a.createdAt.slice(0, 10)) ?? 0) + 1)

  const emailByWallet = new Map<string, string>()
  for (const u of cdp.users) if (u.email) for (const w of u.wallets) emailByWallet.set(w, u.email)

  const eng = engagement[0] ?? null
  const funnelOf = (k: string) => linkFunnel.find((f) => f.kind === k) ?? { n: 0, wallets: 0 }

  // The Desk section (squad agent-desk, C5): the same loader /api/admin/desk reads, so the
  // two screens can never disagree. Fail-soft like every other section.
  const desk = await soft<DeskGrowth | null>(
    'desk',
    (async () => {
      const read = await readDeskRows(deskSince(days, now))
      return deskGrowthSummary(countedDeskRows(read.rows, external), days, now)
    })(),
    null,
  )

  return NextResponse.json({
    windowDays: days,
    external,
    generatedAt: new Date(now).toISOString(),
    desk,
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
      signups: signedUpAccounts.filter((a) => inWin(a.createdAt)).length,
      signupsDelta: deltaPct(signedUpAccounts.filter((a) => inWin(a.createdAt)).length, signedUpAccounts.filter((a) => inPrev(a.createdAt)).length),
      accountsAllTime: signedUpAccounts.length,
      // Everyone, both lanes — the table's own headline.
      peopleAllTime: shownAccounts.length,
      newPeople: shownAccounts.filter((a) => inWin(a.createdAt)).length,
      walletOnlyAllTime: shownAccounts.filter((a) => !a.email).length,
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
    accounts: { ok: cdp.ok, reason: cdp.reason, truncated: arrivals.length >= ARRIVAL_LIMIT, rows: shownAccounts },
    subscribers: subscribers.map((s) => ({ email: s.email, status: s.status, createdAt: s.created_at.toISOString() })),
    alertEmails: alertEmails.map((a) => ({ email: a.email, owner: a.owner, alerts: a.n, lastAt: a.last_at.toISOString() })),
    engagement: eng,
    topWatched,
    topTraded: topTraded.map((t) => ({ ...t, usd: r2(t.usd) })),
    failures: failures.map((f) => ({ kind: f.kind, n: f.n, funded: f.funded, fundsUsd: r2(f.funds_usd) })),
  })
}

/** One wallet's row as the page reads it. The path they tried is the newest
 *  of what they typed and what walled — a trader has one too, which is the
 *  point: every person shows what they were trying to do. */
function activityOf(a: AccountActivityRow): PersonActivity {
  const msgAt = a.last_msg_at?.getTime() ?? 0
  const wallAt = a.last_wall_at?.getTime() ?? 0
  const walled = wallAt > 0 && wallAt >= msgAt
  const text = (walled ? a.last_wall : a.last_msg) ?? null
  const at = walled ? a.last_wall_at : a.last_msg_at
  return {
    ...NO_ACTIVITY,
    turns: a.turns,
    built: a.built,
    signed: a.signed,
    usd: a.usd,
    chats: a.chats,
    links: a.links,
    watching: a.watching,
    lastTurnAt: a.last_turn?.toISOString() ?? null,
    lastAsk: text,
    lastAskAt: at?.toISOString() ?? null,
    lastAskWalled: !!text && walled,
  }
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
  last_msg: string | null
  last_msg_at: Date | null
  last_wall: string | null
  last_wall_at: Date | null
}
interface ArrivalRow {
  wallet: string
  first_at: Date
  last_at: Date
}
