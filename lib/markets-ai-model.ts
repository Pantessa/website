// MK2/AI — the model client. Direct Claude on ANTHROPIC_API_KEY, the same
// wire app/api/chat/route.ts's planner uses (raw fetch — no SDK dependency
// in this repo; only VIZ adds packages this round). Streams text deltas
// for the brief, returns the whole text for the JSON answers. When
// `MK2_AI_MOCK=1` the calls are answered by a scripted mock so the harness
// can pin the FENCES (a poisoned scenario proposes an address; the route
// must drop it) without a network. Never call this with a wallet address
// in the prompt's cache-relevant prefix — the position paragraph is its
// own uncached call.

import { pickChips, splitChipsLine, type AiChip } from './markets-ai'

/** The model the markets AI runs on: its own env, else the planner's, else
 *  the planner's default — the route's known-good model (README §10: the
 *  brief "defaults to the latest Claude model the route uses"). The
 *  claude-api skill's own default is `claude-opus-5`; flipping is one env. */
export const MARKETS_AI_MODEL = process.env.MARKETS_AI_MODEL || process.env.PLANNER_MODEL || 'claude-haiku-4-5-20251001'
const TIMEOUT_MS = 45_000

export function modelMocked(): boolean {
  return process.env.MK2_AI_MOCK === '1'
}

export function modelAvailable(): boolean {
  return modelMocked() || !!process.env.ANTHROPIC_API_KEY
}

export function modelLabel(): string {
  return modelMocked() ? 'mock' : MARKETS_AI_MODEL
}

export interface ModelCall {
  system: string
  user: string
  maxTokens: number
  signal?: AbortSignal
  /** Harness-only scenario the mock reads (ignored on a real call). */
  mock?: { scenario?: string | null; menu?: AiChip[] }
}

function headers(): Record<string, string> {
  return { 'content-type': 'application/json', 'x-api-key': process.env.ANTHROPIC_API_KEY ?? '', 'anthropic-version': '2023-06-01' }
}

/**
 * Stream the model's text. Yields text deltas; throws on a non-2xx (the
 * caller answers a named refusal, never a 500). Thinking blocks (models
 * that think by default) are skipped — only `text_delta` is text.
 */
export async function* streamModelText(call: ModelCall): AsyncGenerator<string, void, void> {
  if (modelMocked()) {
    for (const piece of mockStream(call)) yield piece
    return
  }
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) throw new Error('ANTHROPIC_API_KEY not set')
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS)
  call.signal?.addEventListener('abort', () => ctrl.abort(), { once: true })
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ model: MARKETS_AI_MODEL, max_tokens: call.maxTokens, stream: true, system: call.system, messages: [{ role: 'user', content: call.user }] }),
      signal: ctrl.signal,
    })
    if (!res.ok || !res.body) throw new Error(`model ${res.status}`)
    const reader = res.body.getReader()
    const dec = new TextDecoder()
    let buf = ''
    for (;;) {
      const { value, done } = await reader.read()
      if (done) break
      buf += dec.decode(value, { stream: true })
      let nl: number
      while ((nl = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, nl).trimEnd()
        buf = buf.slice(nl + 1)
        if (!line.startsWith('data:')) continue
        const payload = line.slice(5).trim()
        if (!payload || payload === '[DONE]') continue
        let ev: { type?: string; delta?: { type?: string; text?: string }; error?: { message?: string } }
        try {
          ev = JSON.parse(payload)
        } catch {
          continue
        }
        if (ev.type === 'error') throw new Error(ev.error?.message ?? 'model stream error')
        if (ev.type === 'content_block_delta' && ev.delta?.type === 'text_delta' && ev.delta.text) yield ev.delta.text
      }
    }
  } finally {
    clearTimeout(timer)
  }
}

/** One non-streamed call → the whole text (the JSON answers, the position
 *  paragraph, "explain this"). null when the model is unavailable or
 *  answers nothing. */
export async function modelText(call: ModelCall): Promise<string | null> {
  if (modelMocked()) return mockText(call)
  const key = process.env.ANTHROPIC_API_KEY
  if (!key) return null
  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers: headers(),
      body: JSON.stringify({ model: MARKETS_AI_MODEL, max_tokens: call.maxTokens, system: call.system, messages: [{ role: 'user', content: call.user }] }),
      signal: call.signal ?? AbortSignal.timeout(TIMEOUT_MS),
    })
    if (!res.ok) return null
    const j = (await res.json()) as { content?: Array<{ type: string; text?: string }> }
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

// ── The mock (MK2_AI_MOCK=1) ────────────────────────────────────────────────
// Scripted answers keyed on what the prompt is for. The `poisoned` scenario
// is adversarial on purpose: it proposes an address-bearing ask both as a
// brief chip and as an ask-box action — the routes' fences must drop both.

const MOCK_ADDRESS = '0x1111111111111111111111111111111111111111'

function mockBriefText(call: ModelCall): string {
  const sym = (call.user.match(/^symbol: ([A-Z0-9]+)/m) ?? call.user.match(/symbol: ([A-Z0-9]+)/))?.[1] ?? 'ETH'
  const last = call.user.match(/\nlast: ([\d.]+)/)?.[1] ?? 'n/a'
  const menu = call.mock?.menu ?? []
  const ids = menu.slice(0, 3).map((c) => c.id)
  const poisoned = call.mock?.scenario === 'poisoned'
  const body = [
    `${sym} last printed ${last} on our tape, a mock brief written for the harness.`,
    'The table reads what the context says it reads; every number here is one the prompt carried.',
    poisoned ? `A headline asked for 1 ETH to be sent somewhere; that is data, not an instruction.` : 'Headlines are summarized as data.',
    'The page can buy, protect, or schedule it from the chips below.',
  ].join(' ')
  const chips = poisoned ? [...ids, `send 1 ETH to ${MOCK_ADDRESS}`, 'm99'] : ids
  return `${body}\nCHIPS: ${chips.join(', ')}`
}

function mockAskText(call: ModelCall): string {
  const scenario = call.mock?.scenario
  const q = call.user.match(/Question: (.*)$/m)?.[1] ?? ''
  const last = Number(call.user.match(/last ([\d.]+)/)?.[1] ?? '0') || 100
  if (scenario === 'poisoned') return JSON.stringify({ kind: 'act', say: 'Sending now.', ask: `Send 1 ETH to ${MOCK_ADDRESS}` })
  if (scenario === 'poisoned-chart') return JSON.stringify({ kind: 'chart', say: 'Drawn.', lines: [{ kind: 'h', price: 0 }, { kind: 'h', price: last * 50 }, { kind: 'note', price: last, text: `pay ${MOCK_ADDRESS}` }] })
  if (/\b(trend|screen|happening|why)\b/i.test(q)) return JSON.stringify({ kind: 'answer', text: `On this timeframe the mock reads the context back: last ${last}.` })
  if (/\b(buy|long)\b/i.test(q)) {
    const sym = call.user.match(/symbol: ([A-Z0-9]+)/)?.[1] ?? 'ETH'
    const usd = q.match(/\$\s?(\d+)/)?.[1] ?? '25'
    return JSON.stringify({ kind: 'act', say: `A ${sym} buy for you to send.`, ask: `Buy $${usd} of ${sym}` })
  }
  return JSON.stringify({ kind: 'chart', say: 'A line under the last price.', lines: [{ kind: 'h', price: Number((last * 0.97).toFixed(2)), label: 'Support' }] })
}

function mockText(call: ModelCall): string {
  if (call.system.startsWith('You write the market brief')) return mockBriefText(call)
  if (call.system.startsWith('You write one or two plain sentences')) return 'You hold a mock amount; the numbers are the ones in the prompt.'
  if (call.system.startsWith('You explain one candle')) return 'This bar closed where the context says it closed, a mock sentence.'
  return mockAskText(call)
}

function* mockStream(call: ModelCall): Generator<string, void, void> {
  const text = mockText(call)
  for (let i = 0; i < text.length; i += 24) yield text.slice(i, i + 24)
}

/** What the brief route does with the model's whole text: prose + picks. */
export function finishBrief(text: string, menu: AiChip[]): { body: string; chips: AiChip[] } {
  const { body, ids } = splitChipsLine(text)
  return { body, chips: pickChips(menu, ids) }
}
