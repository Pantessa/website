// lib/journey-events.ts — what a browser is allowed to tell the journey log.
//
// Pure and shared: the client (lib/journey.ts) builds these, the endpoint
// (app/api/journey) accepts exactly these and nothing else. Everything a
// stranger sends is untrusted, so the sanitizer is a closed door: a fixed set
// of kinds, short strings, a small flat detail bag, and a hard cap per batch.

/** Kinds a BROWSER may send. The server adds 'ask' and 'reply' itself. */
export const JOURNEY_KINDS = ['view', 'leave', 'click', 'event', 'error', 'api-error'] as const
export type JourneyKind = (typeof JOURNEY_KINDS)[number]

/** Kinds only our own API writes (lib/journey-server recordTurn). */
export const SERVER_KINDS = ['ask', 'reply'] as const

export const MAX_BATCH = 30
export const MAX_BODY_BYTES = 24_000
export const MAX_LABEL = 200
export const MAX_PATH = 160
/** An event older than this when its batch arrives is a stale tab's backlog. */
export const MAX_AGO_MS = 15 * 60_000

export interface JourneyEventIn {
  k: JourneyKind
  /** pathname only — never a query string */
  p: string
  l?: string
  d?: Record<string, string | number | boolean>
  /** ms between the event and the batch being sent */
  ago?: number
}

export interface JourneyBatchIn {
  events: JourneyEventIn[]
  /** the connected wallet, if any */
  w?: string
  /** an admin has signed in on this browser before */
  team?: boolean
  /** external referrer + campaign words, sent with the first view of a load */
  ref?: string
  utm?: string
  internalRun?: boolean
}

export interface CleanEvent {
  kind: JourneyKind
  path: string
  label: string | null
  detail: Record<string, string | number | boolean> | null
  agoMs: number
}

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/
// Secrets have no business in a label. A seed phrase pasted into the wrong
// box, a key in an error string: cut the event rather than keep the text.
const SECRET_RE = /\b(?:0x)?[0-9a-fA-F]{64}\b|\b(?:sk|pk|rk|yf|yfe)_[A-Za-z0-9_-]{16,}\b|eyJ[A-Za-z0-9_-]{20,}\.[A-Za-z0-9_-]{10,}/
const looksLikeSeedPhrase = (s: string) => {
  const words = s.trim().split(/\s+/)
  return words.length >= 12 && words.length <= 24 && words.every((w) => /^[a-z]{3,8}$/.test(w))
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@[A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+/g

export function scrub(text: string, max: number): string | null {
  const flat = text.replace(/\s+/g, ' ').trim()
  if (!flat) return null
  if (SECRET_RE.test(flat) || looksLikeSeedPhrase(flat)) return '[redacted]'
  // A button can carry an address book entry or an account email as its
  // label. The log has no use for either.
  const masked = flat.replace(EMAIL_RE, '[email]')
  return masked.length > max ? `${masked.slice(0, max - 1)}…` : masked
}

/** A pathname, and only a pathname: no origin, no query, no fragment. */
export function cleanPath(p: unknown): string {
  if (typeof p !== 'string' || !p.startsWith('/')) return ''
  return p.split(/[?#]/)[0].slice(0, MAX_PATH)
}

function cleanDetail(d: unknown): Record<string, string | number | boolean> | null {
  if (!d || typeof d !== 'object' || Array.isArray(d)) return null
  const out: Record<string, string | number | boolean> = {}
  let n = 0
  for (const [k, v] of Object.entries(d as Record<string, unknown>)) {
    if (n >= 8 || !/^[a-zA-Z][a-zA-Z0-9_]{0,23}$/.test(k)) continue
    if (typeof v === 'number' && Number.isFinite(v)) out[k] = Math.round(v * 100) / 100
    else if (typeof v === 'boolean') out[k] = v
    else if (typeof v === 'string') {
      const s = scrub(v, 160)
      if (s == null) continue
      out[k] = s
    } else continue
    n++
  }
  return n ? out : null
}

/** Pure: a batch off the wire → the rows worth keeping. Never throws. */
export function sanitizeBatch(raw: unknown): { events: CleanEvent[]; wallet: string | null; team: boolean; ref: string | null; utm: string | null } {
  const empty = { events: [], wallet: null, team: false, ref: null, utm: null }
  if (!raw || typeof raw !== 'object') return empty
  const b = raw as Partial<JourneyBatchIn>
  const list = Array.isArray(b.events) ? b.events.slice(0, MAX_BATCH) : []
  const events: CleanEvent[] = []
  for (const e of list) {
    if (!e || typeof e !== 'object') continue
    const kind = (e as JourneyEventIn).k
    if (!(JOURNEY_KINDS as readonly string[]).includes(kind)) continue
    const path = cleanPath((e as JourneyEventIn).p)
    if (!path) continue
    const label = typeof e.l === 'string' ? scrub(e.l, MAX_LABEL) : null
    const ago = typeof e.ago === 'number' && Number.isFinite(e.ago) ? Math.min(Math.max(0, e.ago), MAX_AGO_MS) : 0
    events.push({ kind, path, label, detail: cleanDetail(e.d), agoMs: ago })
  }
  const wallet = typeof b.w === 'string' && ADDRESS_RE.test(b.w) ? b.w.toLowerCase() : null
  const ref = typeof b.ref === 'string' ? (scrub(b.ref, 120) ?? null) : null
  const utm = typeof b.utm === 'string' ? (scrub(b.utm, 160) ?? null) : null
  return { events, wallet, team: b.team === true, ref, utm }
}
