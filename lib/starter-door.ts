// lib/starter-door.ts — the deterministic answer to a stranger's FIRST words
// when they are not an ask at all: "help", "what can you do", "how do i
// start", "hi", or a bare asset ("eth", "aapl", "apple stock").
//
// Found 2026-10-06 (squad pre-gtm, DEADENDS wave 2). All of these fell to the
// house model: prose on a good day, the model-down line on a bad one. Neither
// is a door. This module answers without a model — three chips the native
// ladder builds and the two public surfaces (the chart, the docs) — so the
// first ninety seconds never depend on inference. The model keeps every real
// question ("is aapl a buy", "why is eth moving", "what is a stop loss"):
// those need its data tools, and a canned door there would be a lie.
//
// PURE. Mirrored in scripts/ask-ladder.ts (gate 'starter'); every chip is
// pinned through the ladder by scripts/deadends-pins.ts and audit:asks.

import { chartPairFor, chartSymbolByName, isMoneyAssetWord, normalizeChartSymbol } from '@/lib/charts'
import type { ClarifyRequest } from '@/lib/clarify'

export interface StarterTurn {
  reply: string
  clarify: ClarifyRequest
  /** Which door answered, for the trace and the pins. */
  kind: 'help' | 'greeting' | 'asset'
  buildPath: 'native-starter'
}

// "help", "help me", "what can you do", "how do i start", "how does this
// work", "what is this", "what is pantessa", "start", "get started", "demo".
const HELP_RE =
  /^(?:(?:please\s+)?help(?:\s+me)?(?:\s+(?:out|please|start|get\s+started))?|what\s+can\s+(?:you|this|pantessa)\s+do|what\s+do\s+you\s+do|how\s+do\s+i\s+(?:start|begin|use\s+(?:this|it|pantessa))|how\s+does\s+(?:this|it|pantessa)\s+work|what\s+is\s+(?:this|pantessa)(?:\s+(?:site|app|thing))?|what\s+(?:is\s+this|are\s+you)|(?:get\s+)?start(?:ed)?|show\s+me\s+(?:around|what\s+you\s+can\s+do)|demo|tutorial|onboard(?:ing)?\s*me|where\s+do\s+i\s+(?:start|begin))[\s?!.]*$/i
const GREETING_RE = /^(?:hi|hello|hey|hey\s+there|yo|sup|gm|gn|good\s+(?:morning|evening|afternoon)|hola|bonjour|hallo|ciao|olá|ola|привет|你好|こんにちは|wassup|what'?s\s+up|test|testing|ping)[\s!.,?]*$/i
// A bare asset, with at most a hint of what about it: "eth", "AAPL", "$COIN",
// "apple stock", "tesla shares", "eth price", "bitcoin chart".
const ASSET_TAIL = /\s+(?:stock|stocks|shares?|price|chart|token|coin|crypto)\b/i

/** The ticker a bare word means on the chart, or null. */
function assetOf(word: string): string | null {
  const bare = word.replace(/^\$/, '')
  if (!/^[a-z][a-z0-9.]{1,11}$/i.test(bare)) return null
  const named = chartSymbolByName(bare)
  if (named) return named
  const norm = normalizeChartSymbol(bare)
  // A bare ticker has to be typed as one: all caps or $-prefixed for anything
  // that is also a word ("on", "run", "now", "path"); 3+ letters lower-case is
  // fine for the coins everyone types ("eth", "btc", "sol").
  const pair = chartPairFor(norm)
  if (!pair) return null
  // A stock ticker typed in lower case counts when it is not also an English
  // word ("aapl", "nvda" yes; "now", "run", "path" no — lib/charts isMoneyAssetWord).
  if (pair.source === 'robinhood' && bare !== bare.toUpperCase() && !word.startsWith('$') && !isMoneyAssetWord(bare)) return null
  return pair.symbol
}

const STARTER_LINE =
  'Say what should happen and your wallet signs what it builds — a buy, a stop, a stake, a bridge. Looking is free; a wallet is asked for at the action. Try one of these, or open any chart and ask it.'

/** The door, or null when the message is a real ask or a real question. */
export function starterDoor(message: string): StarterTurn | null {
  const text = message.trim()
  if (!text || text.length > 80 || /\n/.test(text) || /0x[0-9a-f]{6,}|\.eth\b|https?:\/\//i.test(text)) return null
  if (GREETING_RE.test(text)) {
    return {
      kind: 'greeting',
      buildPath: 'native-starter',
      reply: `👋 ${STARTER_LINE}`,
      clarify: { question: 'Try one', options: STARTER_CHIPS.map((c) => ({ ...c })) },
    }
  }
  if (HELP_RE.test(text)) {
    return {
      kind: 'help',
      buildPath: 'native-starter',
      reply: `🧭 ${STARTER_LINE} The docs are at /docs if you'd rather read first.`,
      clarify: { question: 'Try one', options: STARTER_CHIPS.map((c) => ({ ...c })) },
    }
  }
  // One asset word, optionally followed by stock/price/chart.
  const bare = text.replace(ASSET_TAIL, '').replace(/[?!.]+$/, '').trim()
  if (!/\s/.test(bare)) {
    const sym = assetOf(bare)
    if (sym) {
      const wantsChart = /\b(?:price|chart)\b/i.test(text)
      return {
        kind: 'asset',
        buildPath: 'native-starter',
        reply: wantsChart
          ? `📈 ${sym} — the chart has the price and every way to act on it. Open it, or buy straight from here.`
          : `📈 ${sym} — open its chart, or buy it straight from here; the wallet signs what it builds.`,
        clarify: {
          question: `${sym}: what next?`,
          options: [
            { label: `Show me the ${sym} chart`, resume: `Show me the ${sym} chart` },
            { label: `Buy $10 of ${sym}`, resume: `Buy $10 of ${sym}` },
            { label: `Buy $25 of ${sym}`, resume: `Buy $25 of ${sym}` },
          ],
        },
      }
    }
  }
  return null
}

/** The three sentences a stranger can press with no model and no reading —
 *  the hero's own $10 buy, the chart, a stock. Each builds through the ladder
 *  (pinned). */
export const STARTER_CHIPS = [
  { label: 'Buy $10 of ETH', resume: 'Buy $10 of ETH' },
  { label: 'Show me the ETH chart', resume: 'Show me the ETH chart' },
  { label: 'Buy $10 of AAPL', resume: 'Buy $10 of AAPL' },
] as const
