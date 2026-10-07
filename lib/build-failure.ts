// lib/build-failure.ts — the words a native layer says when its BUILD threw,
// and the chip that rides along.
//
// Found 2026-10-06 (squad pre-gtm, DEADENDS): with the database unreachable,
// "buy $10 of ETH" from a connected wallet answered
//
//   🔄 Couldn't build the Uniswap swap:
//   Invalid `prisma.spendGrant.findFirst()` invocation:
//   Can't reach database server at `host:5432` …
//
// Ten `Couldn't build the <thing>: ${msg}` sites in app/api/chat/route.ts
// printed whatever the thrown error said. A venue's own words ("no pool deep
// enough", "quote failed") are written for a person and stay; plumbing
// (Prisma, a pool timeout, an RPC transport, a stack) is not, and on prod a
// Neon P2024 would have put the same text in a stranger's thread, with no
// way forward. Every build failure now carries ONE chip: the ask itself, as
// a "Try again" that re-enters the ladder unchanged (a chip SENDS; the
// signature is still the gate).
//
// PURE. The harness pins the leak fence and the chip's round trip.

import type { ClarifyRequest } from '@/lib/clarify'

/** Words that belong in a log line, never in a chat bubble. */
const PLUMBING_RE =
  /prisma|Can't reach database|database server|connection pool|Timed out fetching a new connection|P\d{4}\b|ECONNREFUSED|ECONNRESET|ETIMEDOUT|ENOTFOUND|socket hang up|fetch failed|HTTP request failed|RPC Request failed|The request took too long|Missing or invalid parameters|Internal Server Error|\bat\s+\S+\s+\(.*:\d+:\d+\)|Unexpected token|is not valid JSON|undefined is not|Cannot read propert|is not a function|\.(?:ts|tsx|js|mjs):\d+/i

/** True when an error's text would read as plumbing to a stranger. */
export function leaksBuildPlumbing(msg: string): boolean {
  return !msg.trim() || PLUMBING_RE.test(msg)
}

/** The one line a stranger reads in place of plumbing. Names the thing that
 *  failed and what is true: nothing was built, nothing was signed. */
export function buildUnavailableLine(thing: string): string {
  return `I couldn't build the ${thing} just now: one of the services it reads from didn't answer. Nothing was built and nothing was signed. Try again in a moment.`
}

export interface BuildFailedTurn {
  reply: string
  /** Omitted when the site had no ask text to restate (then the line stands alone). */
  clarify?: ClarifyRequest
}

/** The asks that need no model — offered when the house model is down. Each
 *  is a sentence the native ladder builds (audit:asks pins them). */
export const HOUSE_DOWN_CHIPS = [
  { label: 'Buy $25 of ETH', resume: 'Buy $25 of ETH' },
  { label: 'Buy $10 of AAPL', resume: 'Buy $10 of AAPL' },
  { label: 'Show me the ETH chart', resume: 'Show me the ETH chart' },
] as const

/**
 * The turn for a build that threw. `thing` is what the site was building
 * ("Uniswap swap", "transfer"); `err` the thrown error; `ask` the user's
 * message, which becomes the retry chip. `prefix` keeps each site's emoji.
 */
export function buildFailedTurn(thing: string, err: unknown, ask: string, prefix = ''): BuildFailedTurn {
  const raw = err instanceof Error ? err.message : typeof err === 'string' ? err : ''
  const body = leaksBuildPlumbing(raw) ? buildUnavailableLine(thing) : `Couldn't build the ${thing}: ${raw}`
  const resume = ask.trim().slice(0, 280)
  if (!resume) return { reply: `${prefix}${body}` }
  return {
    reply: `${prefix}${body}`,
    clarify: { question: 'Next step', options: [{ label: 'Try again', resume }] },
  }
}

/** The swap ask restated for a retry chip from the intent the layer built
 *  from (SwapIntent carries no raw text). A dollar buy stays a dollar buy; a
 *  token-amount swap keeps its amount; both pin the chain. Null when the
 *  intent can't be restated (then no chip rides, and the line stands alone). */
export function swapAskSentence(i: { sellAmountUsd?: string; sellAmountHuman?: string; sellToken?: string; buyToken?: string; sellAll?: boolean }, chainWord?: string): string | null {
  const on = chainWord ? ` on ${chainWord}` : ''
  const buy = i.buyToken?.toUpperCase()
  const sell = i.sellToken?.toUpperCase()
  if (i.sellAmountUsd && buy && Number(i.sellAmountUsd) > 0) return `Buy $${i.sellAmountUsd} of ${buy}${on}`
  if (i.sellAll && sell) return `Sell all my ${sell}${on}`
  if (i.sellAmountHuman && sell && buy) return `Swap ${i.sellAmountHuman} ${sell} for ${buy}${on}`
  return null
}
