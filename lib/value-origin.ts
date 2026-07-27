/**
 * ATTENDED vs STANDING — the falsifiable-test split of the money-moved metric.
 *
 * The company thesis is a take-rate on money that moves WITHOUT anyone
 * watching. So the scoreboard splits every signed dollar by what fired it:
 *
 * - ATTENDED — a human typed the ask and signed in the moment:
 *     `chat`      first-party yeetful.com chat turn
 *     `embed`     a keyed embed's chat turn
 * - STANDING — a standing intent fired it:
 *     `job-step`  a job's step (the orchestrator advanced, human co-signed)
 *     `dca-run`   a DCA schedule's periodic buy (schedule fired it)
 *     …plus, from their own receipt tables (never in embed_turns):
 *     guardian fires (hl_guardian_runs) and x402 agent calls (spend_ledger).
 *
 * `embed_turns.origin_kind` is stamped server-side at the single telemetry
 * write site (app/api/embed/telemetry/route.ts). Rows from before the column
 * existed are NULL and get classified at read time by
 * {@link classifyLegacyTurn} / {@link STANDING_TURN_SQL} — keep those two in
 * lockstep: one is the Prisma-where mirror of the other.
 */

export const ORIGIN_KINDS = ['chat', 'embed', 'job-step', 'dca-run'] as const
export type OriginKind = (typeof ORIGIN_KINDS)[number]

/** origin_kind values that count as STANDING within embed_turns. */
export const STANDING_ORIGIN_KINDS: readonly OriginKind[] = ['job-step', 'dca-run']

export function isOriginKind(v: unknown): v is OriginKind {
  return typeof v === 'string' && (ORIGIN_KINDS as readonly string[]).includes(v)
}

/** Artifacts that mark a turn as job-driven regardless of origin_kind. */
const JOB_ARTIFACTS = ['job', 'job-step'] as const

/**
 * Classify a legacy row (origin_kind NULL). DCA runs sign through one-step
 * jobs, so pre-column history can't tell dca-run from job-step — both are
 * standing, which is all the split needs.
 */
export function classifyLegacyTurn(t: {
  artifact?: string | null
  buildPath?: string | null
  embedKeyId?: string | null
}): OriginKind {
  if ((JOB_ARTIFACTS as readonly string[]).includes(t.artifact ?? '') || t.buildPath === 'native-job')
    return 'job-step'
  return t.embedKeyId ? 'embed' : 'chat'
}

/**
 * Raw-SQL predicate for "this embed_turns row is STANDING" — the SQL mirror
 * of origin_kind + {@link classifyLegacyTurn}. Interpolate as a fragment
 * inside FILTER/WHERE; references the bare column names.
 */
export const STANDING_TURN_SQL = `(origin_kind IN ('job-step','dca-run') OR (origin_kind IS NULL AND (artifact IN ('job','job-step') OR build_path = 'native-job')))`

/**
 * Prisma `where` fragment for STANDING embed_turns rows (compose with
 * outcome/date filters via AND). The Prisma mirror of {@link STANDING_TURN_SQL}.
 */
export const STANDING_TURN_WHERE = {
  OR: [
    { originKind: { in: [...STANDING_ORIGIN_KINDS] } },
    {
      AND: [
        { originKind: null },
        { OR: [{ artifact: { in: [...JOB_ARTIFACTS] } }, { buildPath: 'native-job' }] },
      ],
    },
  ],
}

// ── Internal traffic — dev/harness rows that must never read as growth ──────
//
// Localhost prod builds, harness fixture origins, and this project's own
// Vercel previews all write real embed_turns rows — by design: dev drives
// exercise the REAL pipeline. But the scoreboard reads (money moved, funnels,
// the public activity feed, the links board) must exclude them: in the 7 days
// to 2026-07-27, ~$62k of a $79.8k "money moved" week was localhost dev
// sessions — the north-star metric was unusable as a launch instrument.
// Three mirrors, kept in lockstep like STANDING_TURN_*: the TS predicate
// (row-level classification), the Prisma `where`, and the raw-SQL fragment.
// Real embed hosts are arbitrary third-party origins and must NEVER match —
// which is why plain `.vercel.app` is NOT internal, only this project's own
// preview-deployment naming.

const INTERNAL_HOST_RE = /^(localhost|127\.0\.0\.1|\[?::1\]?|0\.0\.0\.0)$/
const INTERNAL_TLD_RE = /\.(test|localhost|local|example|invalid)$/
/** This project's own Vercel previews (team slug / git-branch prefix). */
const OWN_PREVIEW_RE = /^website-git-.*\.vercel\.app$|-nate-4683s-projects\.vercel\.app$/

/** True when an embed_turns origin is Yeetful's own dev/test traffic. */
export function isInternalOrigin(origin: string | null | undefined): boolean {
  if (!origin) return false
  let host: string
  try {
    host = new URL(origin).hostname.toLowerCase()
  } catch {
    return false
  }
  return INTERNAL_HOST_RE.test(host) || INTERNAL_TLD_RE.test(host) || OWN_PREVIEW_RE.test(host)
}

/** Prisma `where` matching internal-traffic embed_turns rows — the Prisma
 *  mirror of {@link isInternalOrigin} over the stored origin string
 *  ('http://localhost:3477', 'https://harness-embed.test', …). */
export const INTERNAL_TRAFFIC_WHERE = {
  OR: [
    { origin: 'http://localhost' },
    { origin: 'https://localhost' },
    { origin: { startsWith: 'http://localhost:' } },
    { origin: { startsWith: 'https://localhost:' } },
    { origin: { startsWith: 'http://127.0.0.1' } },
    { origin: { startsWith: 'https://127.0.0.1' } },
    { origin: { startsWith: 'http://[::1]' } },
    { origin: { startsWith: 'http://0.0.0.0' } },
    { origin: { endsWith: '.test' } },
    { origin: { endsWith: '.localhost' } },
    { origin: { endsWith: '.local' } },
    { origin: { endsWith: '.example' } },
    { origin: { endsWith: '.invalid' } },
    { origin: { endsWith: '-nate-4683s-projects.vercel.app' } },
    { origin: { startsWith: 'https://website-git-' } },
  ],
}

/** Compose into any embed_turns `where` to keep only REAL traffic. */
export const REAL_TRAFFIC_WHERE = { NOT: INTERNAL_TRAFFIC_WHERE }

/**
 * Raw-SQL predicate for "this embed_turns row is internal traffic" — the SQL
 * mirror of {@link isInternalOrigin}. Interpolate via Prisma.raw inside a
 * WHERE as `NOT ${…}`; references the bare `origin` column.
 */
export const INTERNAL_ORIGIN_SQL = `(origin ~* '^https?://(localhost|127\\.0\\.0\\.1|\\[::1\\]|0\\.0\\.0\\.0)([:/]|$)' OR origin ~* '^https?://[^/]*\\.(test|localhost|local|example|invalid)(:[0-9]+)?$' OR origin ~* '^https?://(website-git-[^/]*|[^/]*-nate-4683s-projects)\\.vercel\\.app$')`
