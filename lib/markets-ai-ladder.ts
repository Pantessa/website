// MK2/AI — the ladder half of the chip fence (server). Every sentence a
// chip carries — the menu's (ours) and a model-proposed act — goes through
// the ONE ladder replica (scripts/ask-ladder.ts, the same file audit:asks
// and the harness replay) before it renders. A sentence that would fall to
// the planner, clarify, or land on a gate the symbol page has no business
// on (a transfer, a bridge, an NFT, a vote) is dropped, never shown.

import { simulateLadder } from '../scripts/ask-ladder'
import { fenceAsk, type AiChip } from './markets-ai'

/** Gates a symbol-page chip may land on. Everything else is refused even
 *  when the ladder calls it an action. */
export const CHIP_GATES = new Set(['swap', 'dca', 'guardian', 'spot-guard', 'hyperliquid', 'jobs', 'lido', 'aave-supply', 'morpho-lend'])

export type LadderVerdict = { ok: true; gate: string } | { ok: false; why: string; gate?: string }

/** Pure on the replica: does this sentence build natively on an allowed gate? */
export function ladderVerdict(ask: string): LadderVerdict {
  const out = simulateLadder(ask)
  if (out.kind !== 'action') return { ok: false, why: `${out.kind} on ${out.gate}${out.note ? ` (${out.note})` : ''}`, gate: out.gate }
  if (!CHIP_GATES.has(out.gate)) return { ok: false, why: `gate ${out.gate} is not a symbol-page chip`, gate: out.gate }
  return { ok: true, gate: out.gate }
}

/** The menu, minus anything the ladder would not build today (a grammar
 *  drift can never reach the page — the chip is dropped and the drop is
 *  visible in the route's `dropped` log line). */
export function ladderFilterMenu(menu: AiChip[]): { chips: AiChip[]; dropped: { ask: string; why: string }[] } {
  const chips: AiChip[] = []
  const dropped: { ask: string; why: string }[] = []
  for (const c of menu) {
    const v = ladderVerdict(c.ask)
    if (v.ok) chips.push(c)
    else dropped.push({ ask: c.ask, why: v.why })
  }
  return { chips, dropped }
}

/** A model-proposed act for THIS symbol: the regex fence, then the ladder. */
export function validateProposedAsk(raw: string, symbol: string): { ok: true; ask: string; gate: string } | { ok: false; why: string } {
  const f = fenceAsk(raw, symbol)
  if (!f.ok) return f
  const v = ladderVerdict(f.ask)
  if (!v.ok) return { ok: false, why: v.why }
  return { ok: true, ask: f.ask, gate: v.gate }
}
