// What the chat says when a house answer is refused (pricing v2). Pure, so
// the harness pins every sentence. Two rules for all of it:
//   1. Name what STILL WORKS. A refused answer is never a broken product:
//      everything that builds a transaction runs without the model.
//   2. Name every door out, cheapest first — trading (free), your own key
//      (free), then the two things that cost money.

import { ANSWER_PACK, EARN_CENTS_PER_ANSWER, PLAN_BY_ID } from '@/lib/plans'
import type { AnswerGate } from '@/lib/billing'

export const PRICING_HREF = '/pricing'
export const AI_KEY_HREF = '/dashboard/plan#ai-key'

/** "$100 you swap earns 10" — derived, so the copy can never drift from the
 *  rate (0.20% organic fee → 20¢ → 20 / EARN_CENTS_PER_ANSWER). */
export const EARN_PER_100_USD = Math.floor(20 / EARN_CENTS_PER_ANSWER)

const STILL_WORKS = 'Trades, DCA, guardians and jobs keep working — they never use the model.'

const DOORS =
  `**Sign a trade** — every $100 you swap earns ${EARN_PER_100_USD} answers that never expire · ` +
  `[bring your own API key](${AI_KEY_HREF}) — free and unlimited · ` +
  `[Plus](${PRICING_HREF}), $${PLAN_BY_ID.plus.priceUsd} a month · ` +
  `[${ANSWER_PACK.answers.toLocaleString('en-US')} answers for $${ANSWER_PACK.priceUsd}](${PRICING_HREF})`

export function answerGateReply(gate: AnswerGate, opts: { waiting?: number } = {}): string {
  switch (gate) {
    case 'sign-in':
      return `🪙 That’s today’s free answers — and this wallet has **${(opts.waiting ?? 0).toLocaleString('en-US')} more banked**. **Sign in** (one free signature) to use them: banked answers are only spent for a wallet that proves it’s yours. ${STILL_WORKS}`
    case 'taste-fuse':
      return `🪙 Pantessa’s free answers are resting for today — a lot of people asked at once. They’re back at midnight UTC. ${STILL_WORKS}\n\nNot affected: ${DOORS}.`
    case 'house':
      return `🪙 Pantessa’s house model is at its daily safety limit — back at midnight UTC. ${STILL_WORKS} [Your own API key](${AI_KEY_HREF}) works right now, and so does a paid engine like **Pantessa · Claude**, pay-per-call from your wallet.`
    case 'host':
      return `🪙 This site’s included Pantessa answers are used up for now. ${STILL_WORKS} Connect a paid engine to keep asking, pay-per-call from your own wallet.`
    case 'taste':
    default:
      return `🪙 That’s today’s free answers — they reset at midnight UTC. ${STILL_WORKS}\n\nTo keep asking: ${DOORS}.`
  }
}
