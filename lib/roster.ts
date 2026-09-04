// lib/roster.ts — THE ROSTER's mandate grammar + slot policy (R1, pure).
//
// A roster slot is a JOB LISTING a wallet posts for an AI agent: a mandate
// SENTENCE, a dollar cap, and (once hired) the agent's public track-record
// handle. The moat is the #639 discipline carried over whole: a mandate is
// only accepted when it ROUND-TRIPS the executor's own parser — the exact
// stored sentence will be fed back to that same grammar when a hired agent's
// proposal is compiled, so nothing that cannot execute can ever be hired
// for. No LLM anywhere in this file; garbage refuses BY NAME.
//
// Four launch mandate kinds, each riding an executor that already exists:
//   shape   → lib/mosaic.ts        parseMosaicAsk   ("tile my wallet 60% ETH, 40% USDC")
//   dca     → lib/dca.ts           parseDcaCreate   ("buy $25 of ETH weekly")
//   protect → lib/spot-guard.ts    parseSpotGuardArm ("protect my ETH in my wallet with a 10% stop")
//   yield   → lib/aave-supply.ts / lib/lido-stake.ts ("supply 25 USDC to aave", "stake 0.5 ETH on lido")
//
// Pure + client-safe: no DB, no fetch; env reads only in the kill switch
// (the broker-policy pattern — fail-closed, dark unless ROSTER_ENABLED).

import { cleanAsk } from '@/lib/intent-links'
import { parseMosaicAsk, mosaicAskString } from '@/lib/mosaic'
import { parseDcaCreate, parseCadence, cadenceLabel } from '@/lib/dca'
import { parseSpotGuardArm } from '@/lib/spot-guard'
import { parseAaveSupply } from '@/lib/aave-supply'
import { parseLidoStake } from '@/lib/lido-stake'
import { MANDATE_KIND_LABELS, type MandateKind, type SlotStatus } from '@/lib/roster-client'

// Types/labels/sanitizers shared with the client live in lib/roster-client
// (this module's grammar imports drag the server-only venue stack — the
// rail must never bundle it). Re-exported so server code imports one name.
export { cleanAgentKeyHash, MANDATE_KIND_LABELS, ROSTER_DEFAULT_CAP_USD, rosterEnabledClient } from '@/lib/roster-client'
export type { MandateKind, SlotStatus }

export interface ParsedMandate {
  kind: MandateKind
  /** The CANONICAL recomposed sentence — what gets stored and rendered
   *  (threat T2: raw input is parsed then dropped; every rendered surface,
   *  satori included, only ever sees grammar-constrained output). Proven to
   *  re-parse with the executor's own grammar before this returns. */
  mandateText: string
  /** One human line saying what was understood — the slot row's subtitle. */
  summary: string
}

const MANDATE_EXAMPLES = [
  '"tile my wallet 60% ETH, 40% USDC" (keep a shape)',
  '"buy $25 of ETH weekly" (recurring buy)',
  '"protect my ETH in my wallet with a 10% stop" (protection floor)',
  '"supply 25 USDC to aave" or "stake 0.5 ETH on lido" (yield park)',
]

const MANDATE_MAX = 280

/** chainId → the canonical chain word parseDcaCreate reads back. */
const DCA_CHAIN_WORDS: Record<number, string> = {
  8453: 'base',
  1: 'ethereum',
  42161: 'arbitrum',
  10: 'optimism',
  4663: 'robinhood',
}

/** Protect-ish evidence without a full parse — used only to aim the refusal
 *  at the right grammar, never to accept. */
const PROTECTISH_RE = /\bprotect\b|\bstop[\s-]?loss\b/i
/** Yield-ish evidence for the same purpose. */
const YIELDISH_RE = /\b(?:aave|lido|supply|lend|park|stake|yield)\b/i

// ── The two flagship shapes NO executor parses yet (ideation verdict,
// 2026-08-25): they must refuse BY NAME at slot creation — "isn't executable
// yet" — never be stored, and never half-match (the #595 partial-claim bug:
// parseDcaCreate would happily read "buy $25 of ETH weekly, double on red
// weeks" as a plain weekly buy and silently DROP the condition the user
// thought they hired for).
const CONDITIONAL_RIDER_RE =
  /\b(?:double|triple|halve|half|skip|pause|more|extra)\b[^.]*\b(?:red|green|dip|drop|down|up|crash)\b|\bon\s+(?:red|green)\s+(?:weeks?|days?)\b|\bwhen\s+(?:it|the\s+price|price)\s+(?:is\s+)?(?:down|up|drops?|dips?)\b/i
const YIELD_HUNT_RE = /\b(?:hunt|find|chase|search|best|highest|max(?:imi[sz]e)?)\b[^.]*\byield\b|\byield[\s-]?hunt/i

/** Natural rebalance phrasing — "keep me 60/40 ETH/USDC" (ideation: must
 *  parse, not just "tile"). Recomposed into the tile grammar's own canonical
 *  sentence, so the executor round-trip stays the one source of truth. */
const KEEP_ME_RE =
  /\bkeep\s+(?:me|my\s+(?:wallet|portfolio|bags?))\s+(?:at\s+)?(\d+(?:\.\d+)?)\s*\/\s*(\d+(?:\.\d+)?)\s+\$?([A-Za-z]{2,12})\s*\/\s*\$?([A-Za-z]{2,12})\b/i

/**
 * Parse a mandate sentence into its kind, or refuse BY NAME. The ladder
 * mirrors the chat route's discipline: shape first (its trigger verb belongs
 * to nobody else), then cadence (a recurring buy must never be read as a
 * one-shot), then protection, then yield. A parser that returns a `problem`
 * OWNS the refusal — the mandate was recognizably its shape and gets that
 * grammar's own words back, never a silent fall-through.
 */
export function parseMandate(raw: string): ParsedMandate | { problem: string } {
  const text = cleanAsk(raw)
  if (text.length < 8 || text.length > MANDATE_MAX) {
    return { problem: `A mandate is one plain sentence (8–${MANDATE_MAX} characters). Try ${MANDATE_EXAMPLES[0]}.` }
  }

  // The round-trip seal every branch passes through: the CANONICAL sentence
  // (composed by us, never the user — threat T2) must re-parse with the
  // executor's own grammar, or the mandate refuses by name. A drifting
  // grammar fails closed here rather than stranding a hired slot.
  const sealed = (kind: MandateKind, canonical: string, summary: string, roundTrips: boolean): ParsedMandate | { problem: string } =>
    roundTrips
      ? { kind, mandateText: canonical, summary }
      : { problem: `${MANDATE_KIND_LABELS[kind]} mandate: the sentence failed its executor's own round-trip — not hireable.` }

  // 0 — the not-yet-executable flagships refuse BY NAME before anything can
  // half-claim them (ideation verdict: never store what can't execute).
  if (YIELD_HUNT_RE.test(text)) {
    return {
      problem:
        'Yield-hunting isn\'t an executable mandate yet — no deterministic grammar picks venues for you. Name the venue and amount instead: ' +
        MANDATE_EXAMPLES[3] +
        '.',
    }
  }

  // 1 — shape (mosaic). Natural "keep me 60/40 ETH/USDC" phrasing recomposes
  // into the tile grammar's own sentence first; then the tile verb ladder.
  const keep = text.match(KEEP_ME_RE)
  let shapeText = text
  if (keep) {
    const [, a, b, t1, t2] = keep
    if (Math.abs(Number(a) + Number(b) - 100) > 0.5) {
      return { problem: `Shape mandate: ${a}/${b} doesn't cover the whole wallet — the two sides must sum to 100 (e.g. "keep me 60/40 ETH/USDC").` }
    }
    shapeText = `tile my wallet ${a}% ${t1.toUpperCase()}, ${b}% ${t2.toUpperCase()}`
  }
  const mosaic = parseMosaicAsk(shapeText)
  if (mosaic) {
    if ('problem' in mosaic) return { problem: `Shape mandate: ${mosaic.problem}` }
    const canonical = mosaicAskString(mosaic.slices, mosaic.chainWord)
    const rt = parseMosaicAsk(canonical)
    const tiles = mosaic.slices.map((s) => `${s.pct}% ${s.token}`).join(', ')
    return sealed(
      'shape',
      canonical,
      `Keep this wallet shaped ${tiles}${mosaic.chainWord ? ` on ${mosaic.chainWord}` : ''}.`,
      rt != null && !('problem' in rt),
    )
  }

  // 2 — DCA (cadence-gated; a cadence word means this grammar owns the turn).
  const cadence = parseCadence(text)
  if (cadence) {
    // Conditional riders ("double on red weeks") have NO executor yet —
    // refuse by name rather than store a plain schedule that silently drops
    // the condition the user thought they hired for (the #595 class).
    if (CONDITIONAL_RIDER_RE.test(text)) {
      return {
        problem:
          'Conditional recurring buys aren\'t executable yet — a schedule runs the same dollar amount every period, so the "on red/when it drops" part would be silently ignored. Post the plain schedule (' +
          MANDATE_EXAMPLES[1] +
          ') or wait for conditional mandates.',
      }
    }
    const dca = parseDcaCreate(text)
    if (dca && 'problem' in dca) return { problem: `Recurring-buy mandate: ${dca.problem}` }
    if (dca) {
      const cadenceWord = dca.cadence === 'day' ? 'daily' : dca.cadence === 'week' ? 'weekly' : 'monthly'
      const chainWord = dca.chainId ? DCA_CHAIN_WORDS[dca.chainId] : null
      const canonical = `buy $${dca.buyUsd} of ${dca.buyToken} ${cadenceWord}${chainWord ? ` on ${chainWord}` : ''}`
      const rt = parseDcaCreate(canonical)
      const rtOk =
        rt != null && !('problem' in rt) && rt.buyUsd === dca.buyUsd && rt.buyToken === dca.buyToken && rt.cadence === dca.cadence && rt.chainId === dca.chainId
      return sealed('dca', canonical, `Buy $${dca.buyUsd} of ${dca.buyToken} ${cadenceLabel(dca.cadence)}.`, rtOk)
    }
    return {
      problem: `That reads as a recurring mandate but not a buy I can compile — say it like ${MANDATE_EXAMPLES[1]}.`,
    }
  }

  // 3 — protection floor (spot guard).
  const guard = parseSpotGuardArm(text)
  if (guard) {
    const amt = guard.amountHuman ? `${guard.amountHuman} ` : ''
    const canonical =
      guard.triggerMode === 'price_move_pct'
        ? `protect my ${amt}spot ${guard.token} with a ${guard.triggerValue}% stop`
        : `protect my ${amt}spot ${guard.token} if it drops to $${guard.triggerValue}`
    const rt = parseSpotGuardArm(canonical)
    const rtOk =
      rt != null && rt.token === guard.token && rt.triggerMode === guard.triggerMode && rt.triggerValue === guard.triggerValue && rt.amountHuman === guard.amountHuman
    const trigger =
      guard.triggerMode === 'price_move_pct' ? `it drops ${guard.triggerValue}%` : `it drops to $${guard.triggerValue}`
    return sealed('protect', canonical, `Sell ${amt}${guard.token} to stable if ${trigger}.`, rtOk)
  }
  if (PROTECTISH_RE.test(text)) {
    return {
      problem: `Protection mandate: I couldn't read the floor — say it like ${MANDATE_EXAMPLES[2]} (the word "spot" or "in my wallet" keeps it off the perps desk).`,
    }
  }

  // 4 — yield park (Aave supply, or Lido stake). The venue must be NAMED —
  // a mandate is a standing hire, and "park 25 USDC" with no venue would
  // leave the agent to guess where the money goes.
  const lido = parseLidoStake(text)
  if (lido) {
    if ('problem' in lido) return { problem: `Yield mandate: ${lido.problem}` }
    const canonical = `stake ${lido.amount === 'max' ? 'all my' : lido.amount} ETH on lido${lido.receive === 'wstETH' ? ' for wstETH' : ''}`
    const rt = parseLidoStake(canonical)
    const rtOk = rt != null && !('problem' in rt) && rt.amount === lido.amount && rt.receive === lido.receive
    return sealed('yield', canonical, `Stake ${lido.amount === 'max' ? 'all movable' : lido.amount} ETH with Lido for ${lido.receive}.`, rtOk)
  }
  const aave = parseAaveSupply(text)
  if (aave) {
    if ('problem' in aave) return { problem: `Yield mandate: ${aave.problem}` }
    if (!aave.explicitAave) {
      return { problem: `Yield mandate: name the venue so the hire is exact — ${MANDATE_EXAMPLES[3]}.` }
    }
    const amountWord = aave.amountIsUsd ? `$${aave.amount} of` : aave.amount
    const canonical = `supply ${amountWord} ${aave.token} to aave${aave.otherChain ? ` on ${aave.otherChain}` : ''}${aave.bestRate ? ' at the best rate' : ''}`
    const rt = parseAaveSupply(canonical)
    const rtOk =
      rt != null && !('problem' in rt) && rt.amount === aave.amount && rt.token === aave.token && rt.explicitAave === true &&
      !!rt.amountIsUsd === !!aave.amountIsUsd && !!rt.bestRate === !!aave.bestRate
    return sealed('yield', canonical, `Park ${amountWord} ${aave.token} at Aave${aave.bestRate ? ' at the best rate' : ''}.`, rtOk)
  }
  if (YIELDISH_RE.test(text)) {
    return { problem: `Yield mandate: name the venue and the amount — ${MANDATE_EXAMPLES[3]}.` }
  }

  return {
    problem:
      'Not a mandate I can hire for. A mandate must compile with one of the four launch grammars: ' +
      MANDATE_EXAMPLES.join(', ') +
      '. Nothing an agent proposes can ever exceed the sentence you post.',
  }
}

// ── Slot policy (caps, statuses, kill switch — the broker-policy pattern) ──

/** Per-slot notional ceiling (USD) a hired agent's proposals may total per
 *  proposal. Mirrors the desk's own default ceiling. */
export const ROSTER_MAX_CAP_USD = (() => {
  const n = Number(process.env.ROSTER_MAX_CAP_USD)
  return Number.isFinite(n) && n > 0 ? n : 500
})()

// The kill switch, slot-count fence, consent messages, cap math, and rate
// fence live in lib/roster-policy.ts (the security lane's CONTRACTS v1
// module — server-only). Consent text is minted by the API and signed
// verbatim; the client never composes it (CONTRACTS v1 §1).

/** Sanitize a caller-supplied cap. Refuses over-cap BY NAME; null/absent
 *  takes the default. */
export function cleanCapUsd(raw: unknown): number | { problem: string } {
  if (raw == null || raw === '') return 200
  const n = Number(raw)
  if (!Number.isFinite(n) || n <= 0) return { problem: 'The slot cap must be a positive dollar amount.' }
  if (n > ROSTER_MAX_CAP_USD)
    return { problem: `Roster slots cap at $${ROSTER_MAX_CAP_USD} per proposal — pick a smaller cap or split the mandate.` }
  return Math.round(n * 100) / 100
}
