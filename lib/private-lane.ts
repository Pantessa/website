// ─────────────────────────────────────────────────────────────────────────
//  Private mode (NEAR Confidential Intents) — the proof gate.
//
//  The venue's word is not proof. 1Click prices a `confidentiality: basic`
//  quote for every size and route we have ever asked, echoes the level back
//  (which is what the guard checks), mints a deposit address — and then the
//  swap does not complete.
//
//  2026-09-22, prod, measured: the first two live private swaps ($1 USDC
//  Base → Ethereum) both came back `REFUNDED` / `INTENT_SUBMIT_FAILED`
//  about 55 seconds after the deposit landed. The NEAR trail shows the
//  deposit reaching the confidential relay and being sent straight back.
//  No confidential fill has ever been proven, at any size, on any route.
//
//  So the lane is CLOSED until a real one settles. A private ask refuses by
//  name and offers the same swap public as a chip — it never silently
//  becomes a public swap (that was the #827 rule and it still holds), and it
//  never becomes a deposit that bounces. Flip `NEAR_PRIVATE_MODE=on` to
//  reopen it after a live fill; every other value, and the absence of the
//  variable, keeps it closed (fail closed, the way every money gate here
//  works).
// ─────────────────────────────────────────────────────────────────────────

import { prettyChainWord } from '@/lib/chain-lexicon'
import { crossChainAskSentence, type CrossChainSwapParams } from '@/lib/cross-chain-swap'

export const PRIVATE_LANE_ENV = 'NEAR_PRIVATE_MODE'

/** True only when an operator has explicitly reopened the lane. */
export function privateLaneOpen(env: Record<string, string | undefined> = process.env): boolean {
  return String(env[PRIVATE_LANE_ENV] ?? '').trim().toLowerCase() === 'on'
}

/** The one-line reason, reused by the job compiler and the runner. */
export const PRIVATE_LANE_CLOSED_NOTE =
  'Private mode is turned off: the venue quotes it, takes the deposit and then refunds it minutes later instead of delivering. Ask for the swap without “privately” and I\'ll build the ordinary one.'

/** What a private ask gets while the lane is closed: the refusal, and the
 *  same swap public as a chip. The chip is a complete ask (it SENDS on
 *  click), and it round-trips the cross-chain grammar — harness-pinned. */
export function privateLaneClosedTurn(params: CrossChainSwapParams): { reply: string; question: string; options: string[] } {
  const publicAsk = crossChainAskSentence(params)
  const origin = prettyChainWord(params.originChain)
  const lines = [
    `🚫 **Private mode isn't filling right now** — so I built nothing rather than hand you a swap that bounces.`,
    '',
    `The venue still quotes a private route and takes the deposit, then refunds it a minute later without delivering. Both live attempts did exactly that. You'd have paid the deposit gas and waited for nothing: the money comes back to this wallet on ${origin}, minus the venue's refund fee, and never reaches ${prettyChainWord(params.destinationChain)}.`,
    '',
    `The public route is unaffected — same price, same single signature, same guard. The only difference is that the path from your deposit to the payout is on the public record.`,
  ]
  if (params.recipient) {
    lines.push('', `Delivering to a different address rides on private mode, so that's off too — a public swap pays out to the wallet that signs it.`)
  }
  return { reply: lines.join('\n'), question: 'Send it public instead?', options: [publicAsk] }
}

/** Said BEFORE the signature, on every cross-chain swap. A refund lands on
 *  the ORIGIN chain, so "the destination balance never moved" is exactly
 *  what a refund looks like — the 2026-09-22 private-mode failures read as
 *  a lost swap for hours because nothing in the card said this. */
export function refundDisclosureLine(p: { originChain: string; destinationChain: string; refundFee?: string }): string {
  const cost = p.refundFee ? `, minus the venue's refund fee (${p.refundFee})` : ", minus the venue's refund fee"
  return `**If it can't be filled:** the deposit refunds itself to this wallet on ${prettyChainWord(p.originChain)}${cost} — nothing lands on ${prettyChainWord(p.destinationChain)}, and the deposit gas you paid is gone.`
}

/** The same fact as a warn-level check, so it sits directly above the sign
 *  button on a private build — the last thing read before signing. */
export function privateRefundCheck(p: { originChain: string; destinationChain: string; refundFee?: string }): { id: string; level: 'warn'; note: string } {
  const cost = p.refundFee ? ` minus ${p.refundFee}` : " minus the venue's refund fee"
  return {
    id: 'private-refund',
    level: 'warn',
    note: `Private mode: if the confidential route can't fill this, the deposit refunds to this wallet on ${prettyChainWord(p.originChain)}${cost} — nothing arrives on ${prettyChainWord(p.destinationChain)}. Check the origin chain before reporting it missing.`,
  }
}
