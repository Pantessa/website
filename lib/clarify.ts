// ─────────────────────────────────────────────────────────────────────────
//  Clarify-question artifact (RR17) — §1b's "one missing primitive".
//
//  Mid-route, the PLANNER may decide the request's target is ambiguous
//  ("which of these 3 DAOs?", "which token?"). Instead of guessing on a
//  money/governance action, it returns a clarify payload; the route breaks
//  (exactly like signable artifacts), the chat renders CHIPS, and the
//  user's pick RESUMES the flow — each option carries the user's request
//  fully resolved, sent as the next message, so the working context and
//  every downstream stage see a normal turn.
//
//  The policy (decided 2026-07-03, cost-of-being-wrong): read-only + cheap
//  → best-guess and SAY which was picked, never ask; MONEY or GOVERNANCE +
//  ambiguous target → always ask. The prompt line below encodes it; the
//  model decides per turn.
// ─────────────────────────────────────────────────────────────────────────

export interface ClarifyOption {
  /** The choice as the user would say it — the chip label. */
  label: string
  /** The user's request fully resolved with this choice — sent as the next
   *  user message when the chip is clicked. */
  resume: string
}

export interface ClarifyRequest {
  question: string
  /** 2–4 options, planner's best guess first. */
  options: ClarifyOption[]
}

const MAX_OPTIONS = 4
const MAX_CHARS = 200

/** The shared prompt rule — appended to BOTH planner prompts (invariant 6). */
export function clarifyPromptLine(): string {
  return `CLARIFY RULE: when the request would move MONEY or cast a GOVERNANCE action (swap, order, send, transfer, vote, delegate) and its TARGET is genuinely ambiguous from the conversation (which token, which DAO, which proposal), do NOT guess and do NOT pick any endpoint — respond with ONLY {"picks":[],"clarify":{"question":"<one short question>","options":[{"label":"<the choice as the user would say it>","resume":"<the user's request restated with this choice resolved>"}]}} using 2-4 options with your best guess FIRST. For read-only data requests, NEVER ask a clarifying question — take the best interpretation, proceed, and let the answer say which was chosen.`
}

/** Narrow a model reply's (or persisted meta's) clarify payload, or null. */
export function clarifyOf(raw: unknown): ClarifyRequest | null {
  if (!raw || typeof raw !== 'object') return null
  const d = raw as Record<string, unknown>
  if (typeof d.question !== 'string' || !d.question.trim() || !Array.isArray(d.options)) return null
  const options: ClarifyOption[] = []
  for (const o of d.options) {
    if (!o || typeof o !== 'object') continue
    const opt = o as Record<string, unknown>
    if (typeof opt.label !== 'string' || typeof opt.resume !== 'string') continue
    const label = opt.label.trim().slice(0, MAX_CHARS)
    const resume = opt.resume.trim().slice(0, MAX_CHARS * 2)
    if (label && resume) options.push({ label, resume })
    if (options.length >= MAX_OPTIONS) break
  }
  if (options.length < 2) return null // one option is not a question
  return { question: d.question.trim().slice(0, MAX_CHARS * 2), options }
}

/** Extract a clarify payload from a raw planner reply (JSON-in-text). */
export function parseClarify(text: string): ClarifyRequest | null {
  const match = text.match(/\{[\s\S]*\}/)
  if (!match) return null
  try {
    const parsed = JSON.parse(match[0]) as { clarify?: unknown }
    return clarifyOf(parsed.clarify)
  } catch {
    return null
  }
}

/** Read a persisted Message.meta's clarify payload (ClarifyChips renders it). */
export function clarifyRequestOf(meta: unknown): ClarifyRequest | null {
  if (!meta || typeof meta !== 'object') return null
  return clarifyOf((meta as Record<string, unknown>).clarify)
}
