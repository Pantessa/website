// lib/roster-policy.ts — the security fences for THE ROSTER (overnight
// 2026-08-25, CONTRACTS v1 in squad-overnight-2026-08-25/security.md).
//
// A roster slot lets a wallet HIRE an agent into a mandate. The core safety
// story is unchanged from the desk: agents only ever PROPOSE guarded builds,
// the wallet's signature is the only pen. This module owns everything that
// keeps the SURFACE safe, lane-independent of the R1 grammar work:
//
//   1. Kill switch — fail-closed. Roster writes are OFF unless
//      ROSTER_ENABLED === 'true' (broker-policy pattern). FIRE is exempt:
//      removing an agent's mandate must never be walled, even mid-incident.
//   2. Consent messages — hire/fire are personal_sign (EIP-191) texts, never
//      typed data (the MetaMask 1337 lesson: no domain chainId to mismatch).
//      Every field that matters is IN the signed bytes: slot id (cross-slot
//      reuse dead), agent hash + mandate hash (server can't swap either after
//      signing), cap, nonce + expiry (replay dead). Nothing user-authored
//      enters the text — the mandate rides as a HASH, so a hostile sentence
//      can't inject "Nonce:" lines into what the wallet signs.
//   3. Cap math — guardrails.valueUsd is the price source at build time and
//      the gate FAILS CLOSED on null for money-shaped asks: the slot cap is
//      the product promise, so unpriceable = refused by name (deliberately
//      stricter than the desk's execute cap, where the human signature is
//      the ceiling and null passes).
//   4. Aggregate fences — per-proposal cap alone invites death-by-a-thousand
//      $4.99 proposals: max pending per slot + a trailing-24h estimate budget.
//   5. Rate fence — per-IP hourly bucket on roster POSTs, own `rp:` prefix in
//      unsigned_turn_windows (turn-limits pattern, fail-open, loopback exempt).
//
// Pure except the rate fence (lazy prisma import, harness-safe without a
// DATABASE_URL). UI/UX lane imports from here — these helpers are the
// contract, not a suggestion.

import { createHash, randomBytes } from 'node:crypto'
import { clientIpFrom, hashIp } from '@/lib/turn-limits'

// ---------------------------------------------------------------------------
// Constants (CONTRACTS v1 §3–4)

/** Hard ceiling on non-fired slots per wallet — roster-table spam fence. */
export const ROSTER_MAX_SLOTS_PER_WALLET = 12
/** Per-IP hourly cap on roster POSTs (create/hire/fire). */
export const ROSTER_POST_HOURLY_IP_CAP = 30
/** Consent texts go stale after this — mint, sign, submit in one sitting. */
export const ROSTER_CONSENT_TTL_MS = 10 * 60 * 1000
/** Unhired drafts self-clean after this (pending-delegation pattern). */
export const ROSTER_DRAFT_TTL_MS = 24 * 60 * 60 * 1000
/** Length cap enforced BEFORE any mandate grammar runs (DoS fence, T7). */
export const ROSTER_MAX_MANDATE_CHARS = 300
/** Max undecided proposals a hired agent may stack per slot. */
export const ROSTER_MAX_PENDING_PROPOSALS = 3
/** Trailing-24h proposal-estimate budget, as a multiple of the slot cap. */
export const ROSTER_DAILY_BUDGET_MULT = 3

// ---------------------------------------------------------------------------
// Kill switch (fail-closed)

/** Roster surface flag. FAIL-CLOSED: writes serve only when ROSTER_ENABLED
 *  is exactly 'true'. Prod stays dark until Nate flips it. */
export function rosterEnabled(): boolean {
  return process.env.ROSTER_ENABLED === 'true'
}

/** Guard a roster WRITE. `action: 'fire'`, `'unlist'`, and `'decline'` are
 *  always allowed — exits that REDUCE exposure or say NO never close, kill
 *  switch or not. */
export function assertRosterOpen(action?: 'create' | 'hire' | 'fire' | 'propose' | 'list' | 'unlist' | 'decline'): void {
  if (action === 'fire' || action === 'unlist' || action === 'decline') return
  if (!rosterEnabled())
    throw new Error(
      'The Pantessa roster is not open yet. Existing hires can still be viewed and FIRED at any time — firing is never walled.',
    )
}

// ---------------------------------------------------------------------------
// Consent messages (CONTRACTS v1 §1) — personal_sign, chain-agnostic

/** sha256(canonical mandate sentence)[:16] — the form the consent text signs
 *  over. Same shape as agentHandleFor so the two hashes read alike. */
export function mandateHash(canonicalMandate: string): string {
  return createHash('sha256').update(canonicalMandate).digest('hex').slice(0, 16)
}

/** Server-minted, single-use consent nonce. */
export function mintRosterNonce(): string {
  return randomBytes(16).toString('hex')
}

export interface HireConsentInput {
  slotId: string
  wallet: string
  /** agentHandleFor(agent_key) — the PUBLIC hash, never the raw key (T8). */
  agentKeyHash: string
  /** mandateHash(canonical sentence) — never the sentence itself (T9). */
  mandateHash: string
  capUsd: number
  nonce: string
  expiresAt: Date
}

/** The exact text a wallet personal_signs to hire an agent into a slot.
 *  Pure + exported so UI and harness build identical bytes. */
export function rosterHireConsentMessage(i: HireConsentInput): string {
  return [
    'Pantessa roster — hire consent',
    `Slot: ${i.slotId}`,
    `Wallet: ${i.wallet.toLowerCase()}`,
    `Agent: ${i.agentKeyHash}`,
    `Mandate: ${i.mandateHash}`,
    `Cap: $${i.capUsd} per proposal`,
    `Nonce: ${i.nonce}`,
    `Expires: ${i.expiresAt.toISOString()}`,
    'Signing hires this agent into this mandate slot. It moves nothing by itself; every proposal still needs this wallet\'s own signature.',
  ].join('\n')
}

export interface ListConsentInput {
  slotId: string
  wallet: string
  /** mandateHash(canonical sentence) — never the sentence (T9). */
  mandateHash: string
  capUsd: number
  nonce: string
  expiresAt: Date
}

/** The exact text a wallet personal_signs to LIST a slot on the public
 *  open-slots feed (WAVE-2 discovery, T-D2). Publishing owner data is a
 *  state change, so it is owner-signed; the text says exactly what goes
 *  public — and that the wallet address never does. */
export function rosterListConsentMessage(i: ListConsentInput): string {
  return [
    'Pantessa roster — list consent',
    `Slot: ${i.slotId}`,
    `Wallet: ${i.wallet.toLowerCase()}`,
    `Mandate: ${i.mandateHash}`,
    `Cap: $${i.capUsd} per proposal`,
    `Nonce: ${i.nonce}`,
    `Expires: ${i.expiresAt.toISOString()}`,
    'Signing publishes this mandate on the public open-slots feed — its kind, sentence, and cap, NEVER your wallet address — until you unlist, hire, or delete the slot. It moves nothing by itself.',
  ].join('\n')
}

/** The decline verb's consent text (FIRST-HIRE sprint) — deliberately
 *  STATELESS (no server nonce): declining is idempotent, single-object
 *  (the slug is in the signed bytes), and value-free, so a replay can only
 *  re-decline the same already-declined card. This keeps the door open to
 *  connect-to-act recipients who never SIWE'd — declining must be easier
 *  than ignoring. A session owner skips the signature entirely. */
export function inboxDeclineConsentMessage(slug: string, wallet: string): string {
  return [
    'Pantessa inbox — decline',
    `Link: ${slug}`,
    `Wallet: ${wallet.toLowerCase()}`,
    'Signing declines this proposal card. It removes the card and tells the sender no; it moves nothing and never benches the agent.',
  ].join('\n')
}

export interface FireConsentInput {
  slotId: string
  wallet: string
  nonce: string
  expiresAt: Date
}

/** The exact text a wallet personal_signs to fire an agent from a slot. */
export function rosterFireConsentMessage(i: FireConsentInput): string {
  return [
    'Pantessa roster — fire consent',
    `Slot: ${i.slotId}`,
    `Wallet: ${i.wallet.toLowerCase()}`,
    `Nonce: ${i.nonce}`,
    `Expires: ${i.expiresAt.toISOString()}`,
    'Signing fires the agent from this slot immediately. Nothing to withdraw — the agent never held anything.',
  ].join('\n')
}

/** True when a consent's expiry has passed (or is unreadable — fail closed). */
export function consentExpired(expiresAt: Date | string | null | undefined, now = new Date()): boolean {
  const t = expiresAt instanceof Date ? expiresAt.getTime() : expiresAt ? Date.parse(expiresAt) : NaN
  return !Number.isFinite(t) || t <= now.getTime()
}

/** Verify a personal_sign consent: shape-check the signature, recover the
 *  signer over the EXACT message bytes, refuse any signer but the slot's
 *  wallet. Throws a caller-facing message on every failure path. */
export async function verifyRosterConsent(message: string, wallet: string, signature: unknown): Promise<void> {
  const refuse = (why: string): never => {
    throw new Error(
      `Roster consent refused — ${why}. Sign the exact consent text the API returned (personal_sign / EIP-191) with the slot's own wallet; the server recovers the signer and refuses any other.`,
    )
  }
  if (typeof signature !== 'string' || !/^0x[0-9a-fA-F]{130}$/.test(signature))
    return refuse('a 65-byte 0x signature over the consent text is required')
  let signer: string
  try {
    const { recoverMessageAddress } = await import('viem')
    signer = await recoverMessageAddress({ message, signature: signature as `0x${string}` })
  } catch {
    return refuse('the signature does not verify against the consent text')
  }
  if (signer.toLowerCase() !== wallet.toLowerCase())
    return refuse(`the signature recovers to ${signer.toLowerCase()}, not the slot's wallet`)
}

// ---------------------------------------------------------------------------
// Mandate input hygiene (T2/T7 — runs BEFORE any grammar)

/** Normalize + bound a caller-supplied mandate sentence before it reaches a
 *  parser. NFKC (homoglyphs fold), whitespace collapsed to single spaces
 *  (mandates are one line by definition), control chars dropped, length
 *  refused — not truncated — over the cap (a silently-truncated mandate
 *  could parse to a DIFFERENT intent than the user typed). The value this
 *  returns is parse INPUT only; what gets stored is the grammar's own
 *  recomposed canonical sentence, never this string. */
export function cleanMandateInput(raw: unknown): string {
  if (typeof raw !== 'string' || !raw.trim()) throw new Error('A mandate is a sentence — send mandate_text.')
  // eslint-disable-next-line no-control-regex
  const s = raw.normalize('NFKC').replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()
  if (s.length > ROSTER_MAX_MANDATE_CHARS)
    throw new Error(
      `Mandates are sentences, not essays — ${s.length} chars is over the ${ROSTER_MAX_MANDATE_CHARS}-char cap. Shorten it.`,
    )
  return s
}

// ---------------------------------------------------------------------------
// Cap math (CONTRACTS v1 §4) — guardrails.valueUsd is the build-time source

/** The per-proposal cap gate. FAIL-CLOSED on null when the ask is
 *  money-shaped: the slot cap is the promise the wallet signed over, so an
 *  unpriceable money proposal refuses by name rather than sliding through.
 *  (Deliberately stricter than assertUnderDeskCap, where null passes because
 *  the human signature is the ceiling.) `stage` names the gate in the
 *  refusal so open-time and build-time walls read differently. */
export function assertUnderSlotCap(
  estUsd: number | null,
  capUsd: number,
  opts: { moneyShaped: boolean; stage: 'open' | 'build'; slotLabel?: string },
): void {
  const slot = opts.slotLabel ? ` slot "${opts.slotLabel}"` : ' this slot'
  if (estUsd == null) {
    if (opts.moneyShaped)
      throw new Error(
        `Refused at ${opts.stage}:${slot} caps proposals at $${capUsd}, and this money-shaped proposal could not be priced. An unpriceable proposal never rides a cap — restate it with an explicit dollar amount.`,
      )
    return
  }
  if (estUsd > capUsd)
    throw new Error(
      `Refused at ${opts.stage}:${slot} caps proposals at $${capUsd}; this one prices at ~$${Math.round(estUsd * 100) / 100}. Over-cap proposals bench the agent — ask the wallet owner to raise the cap instead.`,
    )
}

/** Pure aggregate decision (cap-evasion fence, T4): which fence trips for a
 *  NEW proposal, if any. `sum24hUsd` = trailing-24h sum of proposal
 *  estimates for the slot INCLUDING this one. */
export function decideProposalBudget(i: {
  estUsd: number | null
  capUsd: number
  pendingCount: number
  sum24hUsd: number
}): 'pending-full' | 'daily-budget' | null {
  if (i.pendingCount >= ROSTER_MAX_PENDING_PROPOSALS) return 'pending-full'
  if (i.sum24hUsd > i.capUsd * ROSTER_DAILY_BUDGET_MULT) return 'daily-budget'
  return null
}

/**
 * The DB-backed aggregate fence (CONTRACTS v1 §4.4 — REQUIRED for R2):
 * counts the slot's UNDECIDED proposals (open/handed_off broker intents
 * whose bound link has no signed event) and the trailing-24h sum of
 * proposal estimates (the ask's own $ figure — the only sentences that can
 * bind are explicitly $-priced, so the figure is the estimate), adds THIS
 * proposal's estimate, and throws the named refusal when a fence trips.
 *
 * Wire in lib/roster-propose.ts bindProposalAtOpen, after decideProposalGate:
 *   await assertProposalBudget(slot.id, slot.capUsd, estUsd)
 *
 * Fails OPEN on store hiccups (fence semantics, like the rp: bucket): the
 * per-proposal cap — fail-closed — remains the hard promise; this bounds
 * evasion via many small proposals.
 */
export async function assertProposalBudget(slotId: string, capUsd: number, estUsd: number | null): Promise<void> {
  let pendingCount = 0
  let sum24hUsd = estUsd ?? 0
  try {
    const { default: prisma } = await import('@/lib/db')
    const rows = await prisma.$queryRaw<{ pending: number; sum24: number }[]>`
      SELECT
        count(*) FILTER (
          WHERE state IN ('open', 'handed_off')
            AND NOT EXISTS (
              -- Only COUNTED signed events decide (receipt verification,
              -- 2026-09-01 — keep in sync with COUNTED_EVENT_SQL in
              -- lib/receipt-verify; inlined so this module stays light).
              SELECT 1 FROM intent_link_events e WHERE e.slug = broker_intents.link_slug AND e.kind = 'signed'
                AND (e.verification IS NULL OR e.verification IN ('verified','attested'))
            )
        )::int AS pending,
        coalesce(sum((substring(ask from '\\$\\s?([0-9]+(?:\\.[0-9]+)?)'))::float)
          FILTER (WHERE created_at > now() - interval '24 hours'), 0)::float AS sum24
      FROM broker_intents WHERE roster_slot_id = ${slotId}
    `
    pendingCount = Number(rows[0]?.pending ?? 0)
    sum24hUsd += Number(rows[0]?.sum24 ?? 0)
  } catch {
    return // fail-open: fence, not promise
  }
  const tripped = decideProposalBudget({ estUsd, capUsd, pendingCount, sum24hUsd })
  if (tripped) throw new Error(proposalBudgetRefusal(tripped, capUsd))
}

export function proposalBudgetRefusal(kind: 'pending-full' | 'daily-budget', capUsd: number): string {
  return kind === 'pending-full'
    ? `This slot already has ${ROSTER_MAX_PENDING_PROPOSALS} undecided proposals — the wallet owner decides those first. Stacking more is refused.`
    : `This slot's daily mandate budget ($${capUsd * ROSTER_DAILY_BUDGET_MULT} = ${ROSTER_DAILY_BUDGET_MULT}× the $${capUsd} cap, trailing 24h of estimates) is spent. Resubmit tomorrow or ask the wallet owner to raise the cap.`
}

/** Pure bench decision: ANY over-cap attempt benches immediately — probing
 *  the cap is itself the offense. That is the ONLY auto-bench trigger:
 *  decline-streak benching was KILLED by the ideation judges (2026-08-25) —
 *  a decline is a signal, not an offense; a quota-based propose right (M3)
 *  may meter noisy agents later. `consecutiveDeclines` is accepted (and
 *  ignored) so callers can keep passing their streak counters without a
 *  breaking change when M3 lands. */
export function decideBench(i: { capBreach: boolean; consecutiveDeclines?: number }): boolean {
  return i.capBreach
}

// ---------------------------------------------------------------------------
// Rate fence (turn-limits pattern: own bucket, fail-open, loopback exempt)

export { clientIpFrom } // route convenience — same trust boundary as turn-limits

/**
 * Bump the per-IP hourly roster-POST window and decide. Own `rp:` prefix in
 * unsigned_turn_windows — never shares the chat (`i:`/`w:`) or desk buckets.
 * Direct/loopback traffic (no platform-stamped IP) skips the fence — local
 * dev + harness; prod always stamps. Fails OPEN on store hiccups.
 */
export async function bumpAndCheckRosterPost(ip: string | null): Promise<boolean> {
  if (!ip) return false
  try {
    const { default: prisma } = await import('@/lib/db')
    const windowStart = new Date()
    windowStart.setUTCMinutes(0, 0, 0)
    const key = `rp:${hashIp(ip)}`
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + 1
      RETURNING count
    `
    return Number(rows[0]?.count ?? 0) > ROSTER_POST_HOURLY_IP_CAP
  } catch {
    return false
  }
}

/** Per-IP hourly cap on the public open-slots feed (reads are cheap but the
 *  feed must not be a bulk-recon endpoint — T-D3). */
export const ROSTER_FEED_HOURLY_IP_CAP = 120

/** Feed-read fence: own `rf:` bucket in unsigned_turn_windows — same
 *  trust boundary and fail-open semantics as the `rp:` write fence. */
export async function bumpAndCheckRosterFeed(ip: string | null): Promise<boolean> {
  if (!ip) return false
  try {
    const { default: prisma } = await import('@/lib/db')
    const windowStart = new Date()
    windowStart.setUTCMinutes(0, 0, 0)
    const key = `rf:${hashIp(ip)}`
    const rows = await prisma.$queryRaw<{ count: number }[]>`
      INSERT INTO unsigned_turn_windows (key, window_start, count)
      VALUES (${key}, ${windowStart}, 1)
      ON CONFLICT (key, window_start)
      DO UPDATE SET count = unsigned_turn_windows.count + 1
      RETURNING count
    `
    return Number(rows[0]?.count ?? 0) > ROSTER_FEED_HOURLY_IP_CAP
  } catch {
    return false
  }
}

/** The walled answer for a tripped roster fence (200-shaped, never a 429
 *  scare — the turn-limits voice). */
export const ROSTER_RATE_WALL =
  'The roster is taking a breather for this connection — too many roster changes this hour. Existing hires keep working; try again in a bit.'
