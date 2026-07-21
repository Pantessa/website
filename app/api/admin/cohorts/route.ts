import { NextRequest, NextResponse } from 'next/server'
import { Prisma } from '@prisma/client'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { isAdminAddress, isTestWallet, TEST_WALLETS } from '@/lib/admin'

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
 * Yeetful's own test wallets so the leak-phase numbers are honest.
 * Everything is aggregate SQL — nothing fetches whole tables into JS.
 */

const WINDOWS = new Set([7, 14, 30])
const ROW_CAP = 300

/** The milestone CTEs, shared by the funnel + the per-wallet rows. `excl` is
 *  always non-empty ('' sentinel) so `<> ALL(...)` types cleanly. */
function milestoneCtes(days: number, excl: string[]) {
  return Prisma.sql`
    WITH addrs AS (
      SELECT lower(owner_address) AS a, created_at FROM chats WHERE owner_address IS NOT NULL
      UNION ALL SELECT lower(owner_address), created_at FROM embed_turns WHERE owner_address IS NOT NULL
      UNION ALL SELECT lower(address), created_at FROM agent_toggle_events WHERE address IS NOT NULL
      UNION ALL SELECT lower(owner_address), created_at FROM wallet_working_sets
      UNION ALL SELECT lower(wallet), created_at FROM jobs
      UNION ALL SELECT lower(wallet), created_at FROM dca_schedules
      UNION ALL SELECT lower(wallet), created_at FROM hl_guardian_policies
      UNION ALL SELECT lower(owner_address), created_at FROM api_keys
      UNION ALL SELECT lower(owner_address), created_at FROM agent_approvals
      UNION ALL SELECT lower(address), created_at FROM org_members
      UNION ALL SELECT lower(owner_address), created_at FROM spend_grants WHERE owner_address NOT LIKE 'org:%'
    ),
    fs AS (SELECT a, min(created_at) AS first_seen FROM addrs WHERE a <> ALL(${excl}) GROUP BY a),
    recent AS (SELECT a, first_seen FROM fs WHERE first_seen >= now() - make_interval(days => ${days}::int)),
    -- First-party chat turn: the first USER message in any of the wallet's
    -- chats (a chats row alone can be an empty chat — messages is the turn).
    chat_fp AS (
      SELECT lower(c.owner_address) AS a, min(m.created_at) AS t
      FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE m.role = 'user' AND c.owner_address IS NOT NULL
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
        WHERE c.owner_address IS NOT NULL AND jsonb_exists(m.meta, 'signed')
        UNION ALL
        SELECT lower(j.wallet), s.updated_at
        FROM job_steps s JOIN jobs j ON j.id = s.job_id
        WHERE s.kind = 'sign' AND s.status = 'done'
      ) z GROUP BY 1
    ),
    -- Wallet-attributable money moved: signed job steps + guardian closes.
    moved AS (
      SELECT a, sum(usd)::float AS usd, count(*)::int AS n FROM (
        SELECT lower(j.wallet) AS a, coalesce(s.value_usd, 0) AS usd
        FROM job_steps s JOIN jobs j ON j.id = s.job_id
        WHERE s.kind = 'sign' AND s.status = 'done'
        UNION ALL
        SELECT lower(wallet), coalesce(value_usd, 0)
        FROM hl_guardian_runs WHERE action = 'closed'
      ) z GROUP BY 1
    ),
    standing AS (
      SELECT a, min(t) AS t, (array_agg(kind ORDER BY t))[1] AS kind FROM (
        SELECT lower(wallet) AS a, created_at AS t, 'job'::text AS kind FROM jobs
        UNION ALL SELECT lower(wallet), created_at, 'dca' FROM dca_schedules
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
`

export async function GET(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return NextResponse.json({ error: 'Not signed in.' }, { status: 401 })
  if (!isAdminAddress(addr)) return NextResponse.json({ error: 'Forbidden.' }, { status: 403 })

  const raw = Number(req.nextUrl.searchParams.get('days'))
  const days = WINDOWS.has(raw) ? raw : 14
  const external = req.nextUrl.searchParams.get('external') === '1'
  const excl = external ? Array.from(TEST_WALLETS) : ['']

  const base = milestoneCtes(days, excl)
  const [funnelRows, walletRows] = await Promise.all([
    prisma.$queryRaw<FunnelRow[]>(Prisma.sql`
      ${base}
      SELECT count(*)::int AS wallets,
             count(*) FILTER (WHERE cf.t IS NOT NULL OR ce.t IS NOT NULL)::int AS chatted,
             count(*) FILTER (WHERE tg.t IS NOT NULL)::int AS toggled,
             count(*) FILTER (WHERE sg.t IS NOT NULL)::int AS signed,
             count(*) FILTER (WHERE st.t IS NOT NULL)::int AS standing,
             count(*) FILTER (WHERE av.via IS NOT NULL)::int AS via_share,
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
             av.via AS via,
             coalesce(h.origins, '{}') AS embed_origins
      ${JOINS}
      LEFT JOIN hosts h ON h.a = r.a
      ORDER BY r.first_seen DESC
      LIMIT ${ROW_CAP}
    `),
  ])

  const f = funnelRows[0]
  const iso = (d: Date | null) => (d ? d.toISOString() : null)
  const cents = (n: number) => Math.round(n * 100) / 100
  return NextResponse.json({
    windowDays: days,
    external,
    funnel: [
      { key: 'arrived', label: 'Arrived (first seen)', value: f.wallets },
      { key: 'chatted', label: 'First chat turn', value: f.chatted },
      { key: 'toggled', label: 'Toggled an MCP', value: f.toggled },
      { key: 'signed', label: 'Signed a transaction', value: f.signed },
      { key: 'standing', label: 'Standing intent (job · DCA · guardian)', value: f.standing },
      { key: 'viaShare', label: 'Arrived via a share link', value: f.via_share },
    ],
    moneyMovedUsd: cents(f.money_moved),
    movedEvents: f.moved_events,
    wallets: walletRows.map((r) => ({
      address: r.address,
      firstSeen: r.first_seen.toISOString(),
      surface: r.surface,
      firstChat: iso(r.first_chat),
      firstToggle: iso(r.first_toggle),
      firstSigned: iso(r.first_signed),
      firstStanding: iso(r.first_standing),
      standingKind: r.standing_kind,
      via: r.via,
      moneyMovedUsd: cents(r.money_moved),
      movedEvents: r.moved_events,
      embedOrigins: (r.embed_origins ?? []).slice(0, 3),
      test: isTestWallet(r.address),
    })),
  })
}

interface FunnelRow {
  wallets: number
  chatted: number
  toggled: number
  signed: number
  standing: number
  via_share: number
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
  via: string | null
  embed_origins: string[] | null
}
