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
