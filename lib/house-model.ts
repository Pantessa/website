// The house model caller — ONE place that talks to Anthropic for the chat
// route and the lint grader (pricing v2). It owns three things the scattered
// fetches never did:
//
//   1. WHOSE KEY: a request-scoped BYOK key (lib/inference-context) beats the
//      house key. A refused BYOK key never falls back to the house key — that
//      is how we would end up paying for someone else's traffic.
//   2. PROMPT CACHING: a prompt that opens with a large stable block (the
//      planner's endpoint menu) is split at PROMPT_CACHE_BREAK and the stable
//      half is sent as a cached system block. Cache reads bill at 0.1× input;
//      the menu is ~80% of a planner call's input.
//   3. THE METER: every call reports its real token usage
//      (lib/inference-meter) so a house answer's cost is measured, not
//      guessed.

import { inferenceScope } from '@/lib/inference-context'
import { recordInferenceCall, type InferenceSurface, type ModelUsage } from '@/lib/inference-meter'
import { PROMPT_CACHE_BREAK } from '@/lib/prompt-cache-break'

export { PROMPT_CACHE_BREAK }

export const HOUSE_MODEL = process.env.PLANNER_MODEL || 'claude-haiku-4-5-20251001'

/** Split a prompt at the cache break. Below ~4,096 tokens Haiku silently
 *  won't cache (the API minimum), so a short stable half is sent inline —
 *  same words, one block. ~3.2 chars/token is a conservative estimate. */
const MIN_CACHEABLE_CHARS = 4096 * 3.2
export function splitForCache(prompt: string): { stable: string | null; rest: string } {
  const at = prompt.indexOf(PROMPT_CACHE_BREAK)
  if (at < 0) return { stable: null, rest: prompt }
  const stable = prompt.slice(0, at)
  if (stable.length < MIN_CACHEABLE_CHARS) return { stable: null, rest: prompt }
  return { stable, rest: prompt.slice(at + PROMPT_CACHE_BREAK.length) }
}

/** The request body for one house call — pure, so the harness pins the wire
 *  shape (the cached block, the model, no SDK). */
export function houseRequestBody(prompt: string, model: string, maxTokens: number): Record<string, unknown> {
  const { stable, rest } = splitForCache(prompt)
  return {
    model,
    max_tokens: maxTokens,
    ...(stable
      ? { system: [{ type: 'text', text: stable, cache_control: { type: 'ephemeral' } }] }
      : {}),
    messages: [{ role: 'user', content: stable ? `=== THIS TURN ===\n${rest}` : prompt }],
  }
}

export interface HouseCallOpts {
  surface: InferenceSurface
  maxTokens?: number
  timeoutMs?: number
  /** Override the model (BYOK synthesis may run sharper than the planner). */
  model?: string
}

/**
 * One house-model call → its text, or null on any failure (callers already
 * treat null as "unavailable"). Never throws.
 */
export async function houseModelText(prompt: string, opts: HouseCallOpts): Promise<string | null> {
  const scope = inferenceScope()
  const byok = scope?.apiKey
  const key = byok ?? process.env.ANTHROPIC_API_KEY
  if (!key) return null
  const model = opts.model ?? HOUSE_MODEL
  const keySource = byok ? 'byok' : 'house'
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: { 'content-type': 'application/json', 'x-api-key': key, 'anthropic-version': '2023-06-01' },
      body: JSON.stringify(houseRequestBody(prompt, model, opts.maxTokens ?? 1024)),
      signal: AbortSignal.timeout(opts.timeoutMs ?? 30_000),
    })
    if (!res.ok) {
      if (byok && scope) scope.byokFailure = { status: res.status }
      recordInferenceCall({ surface: opts.surface, model, keySource, owner: scope?.owner, usage: {}, ok: false })
      return null
    }
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }>; usage?: ModelUsage }
    recordInferenceCall({ surface: opts.surface, model, keySource, owner: scope?.owner, usage: j.usage ?? {}, ok: true })
    const text = (j.content ?? [])
      .filter((c) => c.type === 'text')
      .map((c) => c.text ?? '')
      .join('')
      .trim()
    return text || null
  } catch {
    return null
  }
}
