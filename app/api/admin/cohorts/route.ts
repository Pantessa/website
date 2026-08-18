import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress, isTestWallet, TEST_WALLETS } from '@/lib/admin'
import { linkDailySeries } from '@/lib/links-board'
import { addrsUnion, arcQuery } from '@/lib/gtm-arc'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Recent-users progress — the marketing leak-phase cohort view. Admin-gated.
 *
 * One row per wallet FIRST SEEN inside the window (7/14/30 days), with the
 * pivot-era journey milestones, all derived from existing tables (no DDL).
 * Milestone sources were chosen against what the data ACTUALLY records:
 *
 *   · first chat turn — first USER message in the wallet's own chats
 *     (first-party surface), ∪ the first turn under an embed key the wallet
 *     OWNS (embed surface — embed_turns.owner_address is the KEY owner;
 *     embed VISITORS are anonymous session ids by design, so the embed lane
 *     tracks the host's journey, not the visitor's).
 *   · first MCP toggle — agent_toggle_events with an address (a deliberate
 *     add). wallet_working_sets is NOT a signal here: /chat auto-mirrors the
 *     pre-seeded default fleet for every signed-in visit, so a row exists
 *     for ~every wallet that ever opened chat. (It still counts toward
 *     first-seen.)
 *   · first signed value artifact — messages carrying meta.signed (the
 *     durable per-message signing log, store.ts → /messages/[msgId]/signed)
 *     ∪ DONE sign-kind job steps. First-party signed embed_turns carry no
 *     wallet, so they can't attribute here (they stay in the global
 *     money-moved number on /dashboard/embeds).
 *   · first standing intent — earliest of jobs / dca_schedules /
 *     hl_guardian_policies (what the user set up to run BETWEEN turns).
 *   · money moved — the wallet-ATTRIBUTABLE slice: Σ value_usd of done sign
 *     job steps + guardian protective closes.
 *
 * `?days=7|14|30` picks the window (default 14). `?external=1` drops
 * Pantessa's own test wallets so the leak-phase numbers are honest.
 * Everything is aggregate SQL — nothing fetches whole tables into JS.
 */

const WINDOWS = new Set([7, 14, 30])
const ROW_CAP = 300

// addrsUnion + arcQuery moved to lib/gtm-arc.ts (L2-Q3) so the daily digest
// reads the IDENTICAL queries — the dashboard and the digest can never
// disagree. Imported above; behavior pinned by the Q5 harness checks.

/** The milestone CTEs, shared by the funnel + the per-wallet rows. `excl` is
 *  always non-empty ('' sentinel) so `<> ALL(...)` types cleanly. */
function milestoneCtes(days: number, excl: string[]) {
  return Prisma.sql`
    WITH addrs AS (
      ${addrsUnion()}
    ),
    fs AS (SELECT a, min(created_at) AS first_seen FROM addrs WHERE a <> ALL(${excl}) GROUP BY a),
    recent AS (SELECT a, first_seen FROM fs WHERE first_seen >= now() - make_interval(days => ${days}::int)),
    -- First-party chat turn: the first USER message in any of the wallet's
    -- chats (a chats row alone can be an empty chat — messages is the turn).
    chat_fp AS (
      SELECT lower(c.owner_address) AS a, min(m.created_at) AS t
      FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE m.role = 'user' AND c.owner_address IS NOT NULL AND NOT c.is_internal
      GROUP BY 1
    ),
    -- Embed-surface turn: first turn under an embed key this wallet OWNS
    -- (embed_key_id '' is yeetful.com's own keyless first-party value lane).
    chat_embed AS (
      SELECT lower(owner_address) AS a, min(created_at) AS t
      FROM embed_turns WHERE owner_address IS NOT NULL AND embed_key_id <> ''
      GROUP BY 1
    ),
    -- Deliberate MCP toggles only (see the header note on working sets).
    toggles AS (
      SELECT lower(address) AS a, min(created_at) AS t
      FROM agent_toggle_events WHERE address IS NOT NULL AND active
      GROUP BY 1
    ),
    signed AS (
      SELECT a, min(t) AS t FROM (
        SELECT lower(c.owner_address) AS a, m.created_at AS t
        FROM messages m JOIN chats c ON c.id = m.chat_id
        WHERE c.owner_address IS NOT NULL AND jsonb_exists(m.meta, 'signed') AND NOT c.is_internal
        UNION ALL
        SELECT lower(j.wallet), s.updated_at
        FROM job_steps s JOIN jobs j ON j.id = s.job_id
        WHERE s.kind = 'sign' AND s.status = 'done' AND NOT j.is_internal
      ) z GROUP BY 1
    ),
    -- Wallet-attributable money moved: signed job steps + guardian closes.
    moved AS (
      SELECT a, sum(usd)::float AS usd, count(*)::int AS n FROM (
        SELECT lower(j.wallet) AS a, coalesce(s.value_usd, 0) AS usd
        FROM job_steps s JOIN jobs j ON j.id = s.job_id
        WHERE s.kind = 'sign' AND s.status = 'done' AND NOT j.is_internal
        UNION ALL
        SELECT lower(wallet), coalesce(value_usd, 0)
        FROM hl_guardian_runs WHERE action = 'closed'
      ) z GROUP BY 1
    ),
    standing AS (
      SELECT a, min(t) AS t, (array_agg(kind ORDER BY t))[1] AS kind FROM (
        SELECT lower(wallet) AS a, created_at AS t, 'job'::text AS kind FROM jobs WHERE NOT is_internal
        UNION ALL SELECT lower(wallet), created_at, 'dca' FROM dca_schedules WHERE NOT is_internal
        UNION ALL SELECT lower(wallet), created_at, 'guardian' FROM hl_guardian_policies
      ) z GROUP BY 1
    ),
    hosts AS (
      SELECT lower(owner_address) AS a, array_agg(DISTINCT origin) AS origins
      FROM embed_turns WHERE owner_address IS NOT NULL AND embed_key_id <> ''
      GROUP BY 1
    ),
    -- Share-loop attribution: the wallet's first sign-in carried a ?via=
    -- cookie (wallet_arrivals is insert-only, first writer wins).
    arrivals AS (
      SELECT lower(address) AS a, via FROM wallet_arrivals
    ),
    -- ── The link economy (links-first milestones) ─────────────────────────
    -- Creator side: minted a link → someone opened it → it produced a
    -- signed conversion (server truth: embed_turns, never client events).
    minted AS (
      SELECT lower(creator) AS a, min(created_at) AS t, count(*)::int AS n
      FROM intent_links WHERE creator IS NOT NULL AND NOT is_internal GROUP BY 1
    ),
    link_open AS (
      SELECT lower(il.creator) AS a, min(e.created_at) AS t
      FROM intent_link_events e JOIN intent_links il ON il.id = e.slug
      WHERE il.creator IS NOT NULL AND e.kind = 'open' GROUP BY 1
    ),
    link_conv AS (
      SELECT lower(il.creator) AS a, min(t.created_at) AS t,
             sum(coalesce(t.value_usd, 0))::float AS usd, count(*)::int AS n
      FROM embed_turns t JOIN intent_links il ON il.id = t.intent_link_slug
      WHERE il.creator IS NOT NULL AND t.outcome = 'signed' AND t.value_usd > 0
      GROUP BY 1
    ),
    -- Visitor side: this wallet CONNECTED on someone's /i page — the link
    -- economy brought them in.
    via_link AS (
      SELECT lower(wallet) AS a, min(created_at) AS t
      FROM intent_link_events WHERE wallet IS NOT NULL AND kind = 'connect'
      GROUP BY 1
    )
  `
}

const JOINS = Prisma.sql`
  FROM recent r
  LEFT JOIN chat_fp cf ON cf.a = r.a
  LEFT JOIN chat_embed ce ON ce.a = r.a
  LEFT JOIN toggles tg ON tg.a = r.a
  LEFT JOIN signed sg ON sg.a = r.a
  LEFT JOIN moved mv ON mv.a = r.a
  LEFT JOIN standing st ON st.a = r.a
  LEFT JOIN arrivals av ON av.a = r.a
  LEFT JOIN minted mi ON mi.a = r.a
  LEFT JOIN link_open lo ON lo.a = r.a
  LEFT JOIN link_conv lc ON lc.a = r.a
  LEFT JOIN via_link vl ON vl.a = r.a
`

export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(addr)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  // ?days= honors any 1..90 (the UI offers 7/14/30; the harness's per-wallet
  // pin reads days=1 — it used to fall silently to 14d, so an organic
  // arrival from last week read as a leak).
  const raw = Number(req.nextUrl.searchParams.get('days'))
  const days = WINDOWS.has(raw) ? raw : Number.isInteger(raw) && raw >= 1 && raw <= 90 ? raw : 14
  const external = req.nextUrl.searchParams.get('external') === '1'
  const excl = external ? Array.from(TEST_WALLETS) : ['']
  // ?only=0x…,0x… (admin-only like the rest): restrict the per-wallet rows to
  // named addresses — the harness's per-wallet "did this suite leave a
  // stranger behind?" pin reads exactly the wallets it signed in with,
  // race-free against sibling runs on the shared DB. Empty = the usual cap.
  const only = (req.nextUrl.searchParams.get('only') ?? '')
    .split(',')
    .map((a) => a.trim().toLowerCase())
    .filter((a) => /^0x[0-9a-f]{40}$/.test(a))
    .slice(0, 64)
  const onlyWhere = only.length ? Prisma.sql`WHERE r.a = ANY(${only})` : Prisma.empty

  const base = milestoneCtes(days, excl)
  const [funnelRows, walletRows, linksDaily, arcRows] = await Promise.all([
    prisma.$queryRaw<FunnelRow[]>(Prisma.sql`
      ${base}
      SELECT count(*)::int AS wallets,
             count(*) FILTER (WHERE cf.t IS NOT NULL OR ce.t IS NOT NULL)::int AS chatted,
             count(*) FILTER (WHERE tg.t IS NOT NULL)::int AS toggled,
             count(*) FILTER (WHERE sg.t IS NOT NULL)::int AS signed,
             count(*) FILTER (WHERE st.t IS NOT NULL)::int AS standing,
             count(*) FILTER (WHERE mi.t IS NOT NULL)::int AS minted,
             count(*) FILTER (WHERE lo.t IS NOT NULL)::int AS link_opened,
             count(*) FILTER (WHERE lc.t IS NOT NULL)::int AS link_converted,
             count(*) FILTER (WHERE vl.t IS NOT NULL)::int AS via_link,
             count(*) FILTER (WHERE av.via IS NOT NULL)::int AS via_share,
             coalesce(sum(mi.n), 0)::int AS links_minted,
             coalesce(sum(lc.usd), 0)::float AS link_moved,
             coalesce(sum(lc.n), 0)::int AS link_convs,
             coalesce(sum(mv.usd), 0)::float AS money_moved,
             coalesce(sum(mv.n), 0)::int AS moved_events
      ${JOINS}
    `),
    prisma.$queryRaw<WalletRow[]>(Prisma.sql`
      ${base}
      SELECT r.a AS address, r.first_seen,
             least(cf.t, ce.t) AS first_chat,
             CASE WHEN cf.t IS NULL AND ce.t IS NULL THEN NULL
                  WHEN ce.t IS NULL OR (cf.t IS NOT NULL AND cf.t <= ce.t) THEN 'chat'
                  ELSE 'embed' END AS surface,
             tg.t AS first_toggle,
             sg.t AS first_signed,
             coalesce(mv.usd, 0)::float AS money_moved,
             coalesce(mv.n, 0)::int AS moved_events,
             st.t AS first_standing, st.kind AS standing_kind,
             mi.t AS first_link, coalesce(mi.n, 0)::int AS links_n,
             coalesce(lc.usd, 0)::float AS link_moved,
             (vl.t IS NOT NULL) AS via_link,
             av.via AS via,
             coalesce(h.origins, '{}') AS embed_origins
      ${JOINS}
      LEFT JOIN hosts h ON h.a = r.a
      ${onlyWhere}
      ORDER BY r.first_seen DESC
      LIMIT ${ROW_CAP}
    `),
    // The link economy per day (30d, window-independent — the pulse chart).
    linkDailySeries(30),
    // The GTM arc — strangers only, always (no ?external toggle here).
    prisma.$queryRaw<ArcRow[]>(arcQuery(days)),
  ])

  const f = funnelRows[0]
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  const cents = (n: number) => Math.round(n * 100) / 100
  const arcTotal = arcRows.reduce(
    (t, r) => ({ arrived: t.arrived + r.arrived, asked: t.asked + r.asked, built: t.built + r.built, signed: t.signed + r.signed, returned: t.returned + r.returned }),
    { arrived: 0, asked: 0, built: 0, signed: 0, returned: 0 },
  )
  return NextResponse.json({
    windowDays: days,
    external,
    // §2.2: the five-stop arc, strangers only (test wallets + internal
    // turns excluded UNCONDITIONALLY — this screen never counts us).
    arc: {
      total: arcTotal,
      bySource: arcRows.map((r) => ({ source: r.source, arrived: r.arrived, asked: r.asked, built: r.built, signed: r.signed, returned: r.returned })),
    },
    funnel: [
      { key: 'arrived', label: 'Arrived (first seen)', value: f.wallets },
      { key: 'chatted', label: 'First chat turn', value: f.chatted },
      { key: 'signed', label: 'Signed a transaction', value: f.signed },
      { key: 'standing', label: 'Standing intent (job · DCA · guardian)', value: f.standing },
      { key: 'minted', label: 'Minted an intent link', value: f.minted },
      { key: 'linkOpened', label: 'Their link got opened', value: f.link_opened },
      { key: 'linkConverted', label: 'Link produced a signed conversion', value: f.link_converted },
      { key: 'viaLink', label: 'Connected through someone’s link', value: f.via_link },
      { key: 'viaShare', label: 'Arrived via a share link', value: f.via_share },
      { key: 'toggled', label: 'Toggled an MCP', value: f.toggled },
    ],
    moneyMovedUsd: cents(f.money_moved),
    movedEvents: f.moved_events,
    linksMinted: f.links_minted,
    linkConversions: f.link_convs,
    linkMovedUsd: cents(f.link_moved),
    linksDaily,
    wallets: walletRows.map((r) => ({
      address: r.address,
      firstSeen: r.first_seen.toISOString(),
      surface: r.surface,
      firstChat: iso(r.first_chat),
      firstToggle: iso(r.first_toggle),
      firstSigned: iso(r.first_signed),
      firstStanding: iso(r.first_standing),
      standingKind: r.standing_kind,
      firstLink: iso(r.first_link),
      links: r.links_n,
      linkMovedUsd: cents(r.link_moved),
      viaLink: r.via_link,
      via: r.via,
      moneyMovedUsd: cents(r.money_moved),
      movedEvents: r.moved_events,
      embedOrigins: (r.embed_origins ?? []).slice(0, 3),
      test: isTestWallet(r.address),
    })),
  })
}

interface ArcRow {
  source: 'house link' | 'creator link' | 'embed' | 'direct'
  arrived: number
  asked: number
  built: number
  signed: number
  returned: number
}
interface FunnelRow {
  wallets: number
  chatted: number
  toggled: number
  signed: number
  standing: number
  minted: number
  link_opened: number
  link_converted: number
  via_link: number
  via_share: number
  links_minted: number
  link_moved: number
  link_convs: number
  money_moved: number
  moved_events: number
}
interface WalletRow {
  address: string
  first_seen: Date
  first_chat: Date | null
  surface: 'chat' | 'embed' | null
  first_toggle: Date | null
  first_signed: Date | null
  money_moved: number
  moved_events: number
  first_standing: Date | null
  standing_kind: 'job' | 'dca' | 'guardian' | null
  first_link: Date | null
  links_n: number
  link_moved: number
  via_link: boolean
  via: string | null
  embed_origins: string[] | null
}
