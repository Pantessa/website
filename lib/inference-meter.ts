// The inference meter (pricing v2) — what a model call COST, measured.
//
// Before this module, every number about inference was an estimate in a
// comment ("~$0.03/turn"). Every direct model call now reports its token
// usage here; the cost is priced from a small rate table and written to
// `inference_calls`, fire-and-forget. It answers three questions:
//   - what does a house answer really cost (so allowances are sized on data),
//   - which surface is burning (chat vs the markets AI vs the lint grader),
//   - how much rode a user's OWN key (`keySource: 'byok'` — costs us nothing).
//
// Pure pricing lives at the top (no imports) so the API harness can pin it
// without a database. The write FAILS OPEN and never blocks a turn.

/** USD per million tokens. Cache reads bill at 0.1× input, 5-minute cache
 *  writes at 1.25× input (Anthropic's published multipliers). A model that
 *  is not in the table prices at the most expensive row — an unknown model
 *  must never read as free. */
export const MODEL_RATES: Record<string, { inUsd: number; outUsd: number }> = {
  'claude-haiku-4-5': { inUsd: 1, outUsd: 5 },
  'claude-sonnet-5': { inUsd: 2, outUsd: 10 },
  'claude-sonnet-4-6': { inUsd: 3, outUsd: 15 },
  'claude-opus-5': { inUsd: 5, outUsd: 25 },
  'claude-opus-4-8': { inUsd: 5, outUsd: 25 },
  'claude-fable-5-1': { inUsd: 10, outUsd: 50 },
}
const CACHE_READ_MULT = 0.1
const CACHE_WRITE_MULT = 1.25

/** `claude-haiku-4-5-20251001` and `claude-haiku-4-5` are one price row. */
export function rateFor(model: string): { inUsd: number; outUsd: number } {
  const bare = model.replace(/-\d{8}$/, '')
  if (MODEL_RATES[bare]) return MODEL_RATES[bare]
  const known = Object.keys(MODEL_RATES).find((k) => bare.startsWith(k))
  if (known) return MODEL_RATES[known]
  return Object.values(MODEL_RATES).reduce((a, b) => (b.inUsd > a.inUsd ? b : a))
}

/** The `usage` block of a Messages API response (or a stream's final usage). */
export interface ModelUsage {
  input_tokens?: number
  output_tokens?: number
  cache_read_input_tokens?: number
  cache_creation_input_tokens?: number
}

/** Dollars for one call. `input_tokens` is the UNCACHED remainder; cache
 *  reads and writes are separate counters on the wire. */
export function costUsd(model: string, usage: ModelUsage): number {
  const r = rateFor(model)
  const inTok = Math.max(0, usage.input_tokens ?? 0)
  const outTok = Math.max(0, usage.output_tokens ?? 0)
  const readTok = Math.max(0, usage.cache_read_input_tokens ?? 0)
  const writeTok = Math.max(0, usage.cache_creation_input_tokens ?? 0)
  const usd =
    (inTok * r.inUsd + readTok * r.inUsd * CACHE_READ_MULT + writeTok * r.inUsd * CACHE_WRITE_MULT + outTok * r.outUsd) / 1_000_000
  return Math.round(usd * 1e6) / 1e6
}

export type InferenceSurface =
  | 'chat-plan'
  | 'chat-synth'
  | 'auto-router'
  | 'governance'
  | 'markets-brief'
  | 'markets-tape'
  | 'markets-position'
  | 'markets-ask'
  | 'markets-explain'
  | 'mcp-lint'

export interface InferenceCallRecord {
  surface: InferenceSurface
  model: string
  keySource: 'house' | 'byok'
  owner?: string | null
  usage: ModelUsage
  ok: boolean
}

/** Record one call. Fire-and-forget: the caller never awaits the write. */
export function recordInferenceCall(rec: InferenceCallRecord): void {
  void (async () => {
    try {
      const { default: prisma } = await import('@/lib/db')
      await prisma.inferenceCall.create({
        data: {
          surface: rec.surface,
          model: rec.model,
          keySource: rec.keySource,
          ownerAddress: rec.owner ? rec.owner.toLowerCase() : null,
          inputTokens: Math.max(0, rec.usage.input_tokens ?? 0),
          outputTokens: Math.max(0, rec.usage.output_tokens ?? 0),
          cacheReadTokens: Math.max(0, rec.usage.cache_read_input_tokens ?? 0),
          cacheWriteTokens: Math.max(0, rec.usage.cache_creation_input_tokens ?? 0),
          costUsd: costUsd(rec.model, rec.usage),
          ok: rec.ok,
        },
      })
    } catch {
      // a meter hiccup never touches the turn
    }
  })()
}
