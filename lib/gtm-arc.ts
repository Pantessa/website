import { Prisma } from '@prisma/client'
import { TEST_WALLETS } from '@/lib/admin'
import { INTERNAL_ORIGIN_SQL } from '@/lib/value-origin'

/**
 * The GTM arc — the one screen GTM is judged by (HANDOFF-gtm-bulletproof
 * §2.2), extracted from app/api/admin/cohorts so the dashboard and the daily
 * digest (scripts/gtm-digest.ts) read the IDENTICAL query and can never
 * disagree. Moved verbatim in L2-Q3; behavior pinned by the Q5 harness
 * checks.
 */

/** Every wallet-attributable arrival signal — shared by the milestone view
 *  and the GTM arc so "arrived" means the same thing on both. The arc passes
 *  prodJobsOnly: local harness runs create REAL jobs rows for throwaway
 *  wallets (originEnv 'dev' — no VERCEL_ENV locally), and each gate run was
 *  inflating the arc's arrivals (caught by the arc's own harness check going
 *  red between two suite runs, 2026-08-12). */
export function addrsUnion(opts?: { prodJobsOnly?: boolean }) {
  // is_internal (lib/internal-run.ts): our own harness/drill rows on the
  // arrival tables — intent_links, wallet_working_sets, jobs (+ embed_turns
  // via Q3) — never count as an arrival. The 2026-08-17 audit: 690 wallets /
  // 3,026 links in 30d were us; the curve matched gate-run days exactly.
  const jobsLine = opts?.prodJobsOnly
    ? Prisma.sql`SELECT lower(wallet), created_at FROM jobs WHERE origin_env = 'production' AND NOT is_internal`
    : Prisma.sql`SELECT lower(wallet), created_at FROM jobs WHERE NOT is_internal`
  return Prisma.sql`
      SELECT lower(owner_address) AS a, created_at FROM chats WHERE owner_address IS NOT NULL AND NOT is_internal
      UNION ALL SELECT lower(owner_address), created_at FROM embed_turns WHERE owner_address IS NOT NULL AND NOT is_internal
      UNION ALL SELECT lower(address), created_at FROM agent_toggle_events WHERE address IS NOT NULL
      UNION ALL SELECT lower(owner_address), created_at FROM wallet_working_sets WHERE NOT is_internal
      UNION ALL ${jobsLine}
      UNION ALL SELECT lower(wallet), created_at FROM dca_schedules
      UNION ALL SELECT lower(wallet), created_at FROM hl_guardian_policies
      UNION ALL SELECT lower(owner_address), created_at FROM api_keys
      -- agent_approvals is deliberately absent: a preference toggle is not an
      -- arrival, and every real one mints a grant (see the note on ADDRS in
      -- app/api/admin/overview). agent_toggle_events above already carries the
      -- honest version of that signal.
      UNION ALL SELECT lower(address), created_at FROM org_members
      UNION ALL SELECT lower(owner_address), created_at FROM spend_grants WHERE owner_address NOT LIKE 'org:%'
      UNION ALL SELECT lower(creator), created_at FROM intent_links WHERE creator IS NOT NULL AND NOT is_internal
      UNION ALL SELECT lower(wallet), created_at FROM intent_link_events e WHERE wallet IS NOT NULL
        AND NOT EXISTS (SELECT 1 FROM intent_links il WHERE il.id = e.slug AND il.is_internal)
`
}

/** One arc row: a first-touch source and its five cumulative stops. */
export type ArcRow = {
  source: string
  arrived: number
  asked: number
  built: number
  signed: number
  returned: number
}

/**
 * The GTM arc (HANDOFF-gtm-bulletproof §2.2): arrived → asked → built →
 * signed → returned, split by FIRST-TOUCH source, strangers only. Unlike the
 * milestone view this ALWAYS excludes Pantessa's own test wallets AND every
 * internal-stamped or internal-origin turn (Q3's is_internal + the origin
 * mirror) — this is the screen GTM is judged by, so it never gets to count
 * us. Stops are wallet-attributed server truth:
 *   asked    — first user message in own chats ∪ any attributed turn beacon
 *   built    — a signable artifact existed: turn outcome tx-built/signed ∪
 *              an artifact-bearing assistant message ∪ a sign-kind job step
 *   signed   — the durable signing log ∪ done sign steps ∪ signed turns
 *   returned — activity on ≥2 distinct days (the retention stop)
 * Source: earliest of a link connect (house vs creator by the link's
 * creator) or an embed-key turn; nothing → direct.
 */
export function arcQuery(days: number) {
  const excl = ['', ...Array.from(TEST_WALLETS).map((w) => w.toLowerCase())]
  const notInternal = Prisma.raw(`NOT ${INTERNAL_ORIGIN_SQL}`)
  return Prisma.sql`
    WITH turns AS (
      SELECT lower(wallet_address) AS a, outcome, created_at, (embed_key_id <> '') AS is_embed
      FROM embed_turns
      WHERE wallet_address IS NOT NULL AND ${notInternal}
    ),
    user_msgs AS (
      SELECT lower(c.owner_address) AS a, m.created_at, m.role, m.meta
      FROM messages m JOIN chats c ON c.id = m.chat_id
      WHERE c.owner_address IS NOT NULL AND NOT c.is_internal
    ),
    addrs AS (
      ${addrsUnion({ prodJobsOnly: true })}
    ),
    fs AS (SELECT a, min(created_at) AS first_seen FROM addrs WHERE a <> ALL(${excl}) GROUP BY a),
    recent AS (SELECT a, first_seen FROM fs WHERE first_seen >= now() - make_interval(days => ${days}::int)),
    asked AS (
      SELECT a, min(t) AS t FROM (
        SELECT a, created_at AS t FROM user_msgs WHERE role = 'user'
        UNION ALL SELECT a, created_at FROM turns
      ) z GROUP BY 1
    ),
    built AS (
      SELECT a, min(t) AS t FROM (
        SELECT a, created_at AS t FROM turns WHERE outcome IN ('tx-built', 'signed')
        UNION ALL
        SELECT a, created_at FROM user_msgs
        WHERE meta ?| array['txRequest', 'txChain', 'orderRequest', 'jobId', 'guardianPolicyId', 'dcaScheduleId']
        UNION ALL
        SELECT lower(j.wallet), s.created_at FROM job_steps s JOIN jobs j ON j.id = s.job_id
        WHERE s.kind = 'sign' AND j.origin_env = 'production' AND NOT j.is_internal
      ) z GROUP BY 1
    ),
    signed_arc AS (
      SELECT a, min(t) AS t FROM (
        SELECT a, created_at AS t FROM user_msgs WHERE jsonb_exists(meta, 'signed')
        UNION ALL
        SELECT lower(j.wallet), s.updated_at FROM job_steps s JOIN jobs j ON j.id = s.job_id
        WHERE s.kind = 'sign' AND s.status = 'done' AND j.origin_env = 'production' AND NOT j.is_internal
        UNION ALL
        SELECT a, created_at FROM turns WHERE outcome = 'signed'
      ) z GROUP BY 1
    ),
    activity_days AS (
      SELECT a, count(DISTINCT created_at::date)::int AS d FROM (
        SELECT a, created_at FROM user_msgs WHERE role = 'user'
        UNION ALL SELECT a, created_at FROM turns
      ) z GROUP BY 1
    ),
    src AS (
      SELECT DISTINCT ON (a) a, src FROM (
        SELECT lower(e.wallet) AS a, e.created_at AS t,
               CASE WHEN il.creator IS NULL THEN 'house link' ELSE 'creator link' END AS src
        FROM intent_link_events e JOIN intent_links il ON il.id = e.slug
        WHERE e.wallet IS NOT NULL AND e.kind = 'connect' AND NOT il.is_internal
        UNION ALL
        SELECT a, created_at, 'embed' FROM turns WHERE is_embed
      ) z ORDER BY a, t ASC
    )
    SELECT coalesce(s.src, 'direct') AS source,
           count(*)::int AS arrived,
           -- cumulative stops: a wallet that built or signed necessarily
           -- asked — the ask just wasn't attributable. Monotone by
           -- construction, so an attribution gap can never invert the arc.
           count(*) FILTER (WHERE least(ak.t, b.t, sg.t) IS NOT NULL)::int AS asked,
           count(*) FILTER (WHERE least(b.t, sg.t) IS NOT NULL)::int AS built,
           count(*) FILTER (WHERE sg.t IS NOT NULL)::int AS signed,
           count(*) FILTER (WHERE coalesce(ad.d, 0) >= 2)::int AS returned
    FROM recent r
    LEFT JOIN src s ON s.a = r.a
    LEFT JOIN asked ak ON ak.a = r.a
    LEFT JOIN built b ON b.a = r.a
    LEFT JOIN signed_arc sg ON sg.a = r.a
    LEFT JOIN activity_days ad ON ad.a = r.a
    GROUP BY 1
    ORDER BY 2 DESC
  `
}
