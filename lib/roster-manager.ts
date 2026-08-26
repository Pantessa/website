// lib/roster-manager.ts — the First Manager's brain (pure).
//
// THE ROSTER's supply-side seed: a house Rebalancer that actually WORKS a
// 'shape' mandate. Given the hired slot + the wallet's chain-scoped
// holdings, it re-runs the mandate's own grammar (parseMosaicAsk on the
// stored CANONICAL sentence) and the mosaic planner's own math
// (planMosaic — same band, same gas keep-back, same skip rules), then:
//
//   · within band → "Already in shape" (the mosaic quiet verdict class) —
//     a good employee proposes NOTHING when there is nothing to do;
//   · drifted    → exactly ONE $-priced desk ask targeting the LARGEST
//     drift leg. One card, one decision, one signature — never a spray.
//
// No LLM, no DB, no RPC in this module: the script (scripts/house-manager)
// owns I/O, and the server's own gates (cap, budget, benched/fired, the
// R2 fail-closed unpriceable rule) remain the enforcement — the manager
// never assumes it is trusted. The stacking fence here is TIGHTER than the
// server's 3-pending bound on purpose: one undecided card at a time is how
// an employee behaves; three is how spam behaves.

import { parseMosaicAsk, planMosaic, MOSAIC_CHAIN_LABELS, mosaicStableFor, type MosaicChainWord, type MosaicHolding, type MosaicRow } from '@/lib/mosaic'

export type ManagerVerdict =
  | { kind: 'in-shape'; note: string }
  | { kind: 'propose'; ask: string; driftUsd: number; note: string }
  | { kind: 'refuse'; note: string }

export interface ManagerSlot {
  id: string
  status: string
  mandateKind: string
  mandateText: string
  agentKeyHash: string | null
  capUsd: number
}

const round2 = (n: number) => Math.round(n * 100) / 100

/** The one-card-at-a-time fence: an undecided proposal from THIS slot is
 *  already in the employer's inbox → the manager refuses to stack. */
export function undecidedProposalFor(
  inboxItems: { slug: string; roster?: { slotId?: string } }[],
  slotId: string,
): { slug: string } | null {
  const hit = inboxItems.find((i) => i.roster?.slotId === slotId)
  return hit ? { slug: hit.slug } : null
}

export function stackingRefusal(slug: string): string {
  return `Your last proposal is still waiting in the inbox (/i/${slug}) — one card at a time. Decide that one (sign it, or let it lapse) and the manager will look again.`
}

/**
 * The decision. Holdings must be CHAIN-SCOPED to `chainWord` (the script
 * scopes the multichain read exactly like the mosaic exec shell).
 */
export function decideManagerMove(a: {
  slot: ManagerSlot
  myAgentKeyHash: string
  chainWord: MosaicChainWord
  holdings: MosaicHolding[]
}): ManagerVerdict {
  const { slot, myAgentKeyHash, chainWord, holdings } = a

  // The manager checks what the server will re-check — it should not even
  // knock when it can see the door is closed.
  if (slot.mandateKind !== 'shape')
    return { kind: 'refuse', note: `This manager works SHAPE mandates only — the slot is a "${slot.mandateKind}" mandate.` }
  if (slot.status !== 'hired')
    return { kind: 'refuse', note: `The slot is ${slot.status} — a manager only works a HIRED mandate.` }
  if ((slot.agentKeyHash ?? '') !== myAgentKeyHash)
    return { kind: 'refuse', note: 'The slot is hired to a different agent identity — this manager holds no mandate here.' }

  const parsed = parseMosaicAsk(slot.mandateText)
  if (!parsed || 'problem' in parsed)
    return { kind: 'refuse', note: `The stored mandate no longer parses with the tile grammar — refusing rather than guessing. (${parsed && 'problem' in parsed ? parsed.problem : 'no tile verb'})` }

  const plan = planMosaic({ slices: parsed.slices, chainWord, holdings })
  if (plan.kind === 'problem') return { kind: 'refuse', note: plan.problem }
  if (plan.kind === 'quiet') {
    return {
      kind: 'in-shape',
      note: `Already in shape — every drift sits within the band. ${plan.notes[0] ?? ''}`.trim(),
    }
  }

  // Drifted: ONE $-priced ask off the LARGEST drift leg. The sentence rides
  // the dollar-swap grammar ("Swap $X of A to B on <chain>") so the /i
  // runtime compiles it and the desk's askUsd prices it (the R2 fail-closed
  // rule: an unpriced money ask never rides a cap).
  const stable = mosaicStableFor(chainWord)
  const actionable = plan.rows.filter((r): r is MosaicRow => (r.action === 'buy' || r.action === 'sell') && r.token !== stable)
  if (actionable.length === 0) {
    // Only the rail itself moved (rare) — the planner's legs exist but no
    // named tile drifted; treat as in-shape rather than invent a rail trade.
    return { kind: 'in-shape', note: 'Only the settlement rail drifted — nothing worth a signature.' }
  }
  const worst = actionable.reduce((a2, r) => (Math.abs(r.deltaUsd) > Math.abs(a2.deltaUsd) ? r : a2))
  const usd = round2(Math.abs(worst.deltaUsd))
  const ask =
    worst.action === 'sell'
      ? `Swap $${usd} of ${worst.token} to ${stable} on ${chainWord}`
      : `Swap $${usd} of ${stable} to ${worst.token} on ${chainWord}`
  return {
    kind: 'propose',
    ask,
    driftUsd: usd,
    note:
      `${worst.token} is ${worst.action === 'sell' ? 'over' : 'under'} its ${worst.pct}% tile by ~$${usd} ` +
      `(held $${round2(worst.heldUsd)}, target $${round2(worst.targetUsd)} on ${MOSAIC_CHAIN_LABELS[chainWord]}). One leg puts the worst drift back.`,
  }
}
