// lib/roster-propose.ts — R2: proposals→inbox binding for THE ROSTER.
//
// A hired agent's desk intent doesn't dead-end at a share link: when the
// agent_key presented at broker_open HASHES to a hired roster slot, the
// intent AUTO-ADDRESSES to the employer wallet's inbox (the M5 rails —
// an intent_link with recipient + allowWallets), wearing the slot badge
// (mandate kind + the canonical mandate sentence) so the human sees WHICH
// mandate is speaking before they tap. Only the employer's own signature
// ever moves anything — the binding changes where the card lands, never
// who holds the pen.
//
// Enforcement (security CONTRACTS v1 §4, amended by the 2026-08-25
// ideation verdict):
//   • the server derives the hash from the presented agent_key ITSELF
//     (agentHandleFor at the desk) — a caller-supplied hash is never proof;
//   • cap at OPEN (askUsd(ask) vs cap_usd) AND at BUILD
//     (guardrails.valueUsd vs cap_usd), both FAIL-CLOSED on unpriceable
//     money-shaped asks — the cap is the product promise the wallet signed;
//   • bench on CAP BREACH ONLY (decline counting is KILLED — an ignored
//     card is a busy human, not a verdict);
//   • benched/fired slots refuse new proposals BY NAME;
//   • the fired-agent race (T5) closes twice: firing CASCADES revocation
//     over the slot's unsigned addressed links (the /i runtime's
//     revoked-link refusal is the human-path backstop), and the build gate
//     re-checks slot status before any agent-signed compile.
//
// decideProposalGate is PURE (harness mocks a build with it); the DB
// wrappers live below it.

import prisma from '@/lib/db'
import { MANDATE_KIND_LABELS, type MandateKind, type SlotStatus } from '@/lib/roster-client'
import { assertUnderSlotCap } from '@/lib/roster-policy'
import { moneyShaped } from '@/lib/ask-failure'

export interface RosterBadge {
  slotId: string
  kind: MandateKind
  label: string
  /** The CANONICAL mandate sentence (grammar-constrained — safe to render). */
  mandate: string
  capUsd: number
}

export interface RosterSlotLite {
  id: string
  walletAddress: string
  mandateText: string
  mandateKind: string
  capUsd: number
  status: string
  isInternal: boolean
}

const SLOT_SELECT = {
  id: true,
  walletAddress: true,
  mandateText: true,
  mandateKind: true,
  capUsd: true,
  status: true,
  isInternal: true,
} as const

export function slotBadge(slot: RosterSlotLite): RosterBadge {
  const kind = (slot.mandateKind in MANDATE_KIND_LABELS ? slot.mandateKind : 'shape') as MandateKind
  return {
    slotId: slot.id,
    kind,
    label: MANDATE_KIND_LABELS[kind],
    mandate: slot.mandateText.slice(0, 120),
    capUsd: slot.capUsd,
  }
}

/** The PURE proposal gate — shared by open and build so the two stages can
 *  never disagree on the rules, and the harness can mock a build against it.
 *  Throws the named refusal; returns void when the proposal may proceed.
 *  `stage` names the wall (CONTRACTS v1 §4). Cap math (incl. the
 *  fail-closed unpriceable rule) is roster-policy's assertUnderSlotCap. */
export function decideProposalGate(
  slot: Pick<RosterSlotLite, 'status' | 'capUsd' | 'mandateKind'>,
  estUsd: number | null,
  isMoneyShaped: boolean,
  stage: 'open' | 'build',
): void {
  if (slot.status === 'benched')
    throw new Error(
      `Refused at ${stage}: this desk identity's mandate slot is BENCHED (a cap breach benches immediately). ` +
        'The wallet owner un-benches or fires; new proposals do not run from the bench.',
    )
  if (slot.status === 'fired')
    throw new Error(
      `Refused at ${stage}: this desk identity was FIRED from its mandate slot. Fired is terminal — ` +
        'a new hire is a new slot, signed by the wallet owner. Nothing was proposed.',
    )
  if (slot.status !== 'hired')
    throw new Error(`Refused at ${stage}: the mandate slot is ${slot.status} — only a hired slot receives proposals.`)
  assertUnderSlotCap(estUsd, slot.capUsd, { moneyShaped: isMoneyShaped, stage })
}

/** Bench a slot (cap breach — the only trigger). Fail-soft: the refusal the
 *  caller is already throwing is the contract; the bench is the record. */
export async function benchSlot(slotId: string): Promise<void> {
  await prisma.rosterSlot
    .update({ where: { id: slotId, status: 'hired' }, data: { status: 'benched' } })
    .catch(() => {})
}

/** Find the roster slot a desk proposal binds to. The hash comes from the
 *  desk's own agentHandleFor over the PRESENTED key — never caller-supplied.
 *  Match rules: with a wallet, the newest non-fired-or-fired slot for
 *  (hash, wallet); without one, a single unambiguous match across wallets
 *  (two employers = ambiguous = no binding, the agent must name the wallet).
 *  Returns null when the desk should behave exactly as before (no roster). */
export async function rosterSlotFor(agentKeyHash: string | null, wallet: string | null): Promise<RosterSlotLite | null> {
  if (!agentKeyHash) return null
  const rows = await prisma.rosterSlot
    .findMany({
      where: { agentKeyHash, status: { in: ['hired', 'benched', 'fired'] }, ...(wallet ? { walletAddress: wallet } : {}) },
      select: SLOT_SELECT,
      orderBy: { createdAt: 'desc' },
      take: 10,
    })
    .catch(() => [] as RosterSlotLite[])
  if (rows.length === 0) return null
  // Prefer the live hire; else the newest record (its named refusal is the answer).
  const hired = rows.filter((r) => r.status === 'hired')
  if (!wallet && new Set(rows.map((r) => r.walletAddress)).size > 1) {
    // Ambiguous across employers — bind only when the agent names the wallet.
    return hired.length === 1 ? hired[0] : null
  }
  return hired[0] ?? rows[0]
}

/** The OPEN gate: bind (or refuse) a new desk proposal. On a cap breach the
 *  slot benches BEFORE the refusal throws (probing the cap is the offense —
 *  CONTRACTS v1 §4). Returns null = not a roster proposal. */
export async function bindProposalAtOpen(
  agentKeyHash: string | null,
  wallet: string | null,
  ask: string,
  estUsd: number | null,
): Promise<{ slot: RosterSlotLite; badge: RosterBadge } | null> {
  const slot = await rosterSlotFor(agentKeyHash, wallet)
  if (!slot) return null
  try {
    decideProposalGate(slot, estUsd, moneyShaped(ask), 'open')
  } catch (e) {
    if (slot.status === 'hired' && /caps proposals at|could not be priced/.test(String(e))) await benchSlot(slot.id)
    throw e
  }
  return { slot, badge: slotBadge(slot) }
}

/** The BUILD gate (T5): reload the slot and re-run the SAME pure gate off
 *  the build's own price (guardrails.valueUsd). A fire that landed between
 *  open and build refuses here; an over-cap build benches then refuses. */
export async function recheckSlotAtBuild(slotId: string, valueUsd: number | null, isMoneyShaped: boolean): Promise<void> {
  const slot = await prisma.rosterSlot.findUnique({ where: { id: slotId }, select: SLOT_SELECT }).catch(() => null)
  if (!slot)
    throw new Error('Refused at build: the mandate slot behind this proposal no longer exists. Nothing was built.')
  try {
    decideProposalGate(slot, valueUsd, isMoneyShaped, 'build')
  } catch (e) {
    if (slot.status === 'hired' && /caps proposals at|could not be priced/.test(String(e))) await benchSlot(slot.id)
    throw e
  }
}

/** The fire cascade (T5, human path): revoke every UNSIGNED addressed link
 *  bound to the slot and close its broker intents — a fired agent's pending
 *  cards vanish from the inbox, and the /i runtime's revoked-link refusal
 *  walls anyone mid-flow. Signed history is never touched. */
export async function fireCascade(slotId: string): Promise<void> {
  try {
    const links = await prisma.intentLink.findMany({
      where: { rosterSlotId: slotId, revoked: false },
      select: { id: true },
    })
    if (links.length > 0) {
      const slugs = links.map((l) => l.id)
      const signed = await prisma.intentLinkEvent.findMany({
        where: { slug: { in: slugs }, kind: 'signed' },
        select: { slug: true },
      })
      const signedSet = new Set(signed.map((s) => s.slug))
      const revoke = slugs.filter((s) => !signedSet.has(s))
      if (revoke.length > 0) await prisma.intentLink.updateMany({ where: { id: { in: revoke } }, data: { revoked: true } })
    }
    await prisma.brokerIntent.updateMany({
      where: { rosterSlotId: slotId, state: { in: ['open', 'handed_off'] } },
      data: { state: 'closed' },
    })
  } catch {
    // Fail-soft: the slot flip to 'fired' is the authority; the cascade is
    // hygiene. A missed revocation still walls at the build re-check.
  }
}

export type { SlotStatus }
