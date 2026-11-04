// components/desk/policy-check.ts — the console's client-side shape check for
// a proposed policy document (squad five-million, CONSOLE lane, 2026-11-03).
//
// The API is the judge: POST /api/tenants/:id/policy runs lib/tenant/policy
// validatePolicyDoc and answers 400 naming the field, and the console prints
// that answer verbatim. This check runs first so an admin sees the same field
// name BEFORE a round trip — it follows the validator rule for rule (strict
// keys, the vocabulary, a venue's own chains, desk ids, hours) and names the
// same `field`. It is pure and takes the vocabulary as an argument (the
// server hands it down from spec), so it never imports spec at runtime.
// scripts/console-pins.ts holds the two together over a corpus of documents.

import type { DeskVocab } from './types'

export type PolicyCheck = { ok: true } | { ok: false; field: string; error: string }

type Vocab = Pick<DeskVocab, 'venues' | 'ops' | 'sides' | 'lanes' | 'venueChains' | 'deskIdRe'>

const DOC_KEYS = ['version', 'default', 'venues', 'desks', 'hooks', 'signing']
const RULE_KEYS = ['venue', 'chains', 'ops', 'tokens', 'sides', 'maxOrderUsd', 'maxPriceImpactBps', 'maxLeverage']
const DESK_KEYS = ['id', 'perOrderUsd', 'perDayUsd', 'approvals', 'hours']
const TOKEN_RE = /^(0x[0-9a-fA-F]{40}|[A-Za-z0-9.]{1,15})$/
const WALLET_RE = /^0x[0-9a-fA-F]{40}$/
const HHMM_RE = /^([01]\d|2[0-3]):([0-5]\d)$/

class Bad extends Error {
  constructor(public field: string, msg: string) {
    super(msg)
  }
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v)

function strictKeys(o: Record<string, unknown>, allowed: string[], at: string) {
  for (const k of Object.keys(o)) if (!allowed.includes(k)) throw new Bad(at ? `${at}.${k}` : k, `unknown field "${k}" — allowed: ${allowed.join(', ')}.`)
}
function posUsd(v: unknown, field: string) {
  if (typeof v !== 'number' || !Number.isFinite(v) || v <= 0 || v > 1e12) throw new Bad(field, 'must be a positive dollar amount.')
}
function list(v: unknown, field: string, each: (x: unknown, f: string) => void, opts: { min?: number; max?: number } = {}): unknown[] {
  if (!Array.isArray(v)) throw new Bad(field, 'must be an array.')
  if (v.length < (opts.min ?? 0)) throw new Bad(field, `must list at least ${opts.min}.`)
  if (v.length > (opts.max ?? 200)) throw new Bad(field, `lists more than ${opts.max ?? 200}.`)
  v.forEach((x, i) => each(x, `${field}[${i}]`))
  return v
}
const oneOf = (vocab: string[], what: string) => (x: unknown, f: string) => {
  if (typeof x !== 'string' || !vocab.includes(x)) throw new Bad(f, `unknown ${what} ${JSON.stringify(x)} — the vocabulary is: ${vocab.join(', ')}.`)
}

/** A zone this browser can read (the server checks again with its own runtime). */
function validTimeZone(tz: unknown): boolean {
  if (typeof tz !== 'string' || !tz || tz.length > 64) return false
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: tz })
    return true
  } catch {
    return false
  }
}

/** Check a parsed document. Names the first bad field the way the API does. */
export function checkPolicyDoc(raw: unknown, vocab: Vocab): PolicyCheck {
  try {
    readDoc(raw, vocab)
    return { ok: true }
  } catch (e) {
    if (e instanceof Bad) return { ok: false, field: e.field, error: `${e.field}: ${e.message}` }
    return { ok: false, field: 'document', error: e instanceof Error ? e.message : 'invalid policy document.' }
  }
}

/** Parse the textarea, then check it. A JSON syntax error names `document`
 *  with the parser's own words (they carry the position). */
export function checkPolicyText(text: string, vocab: Vocab): PolicyCheck & { doc?: unknown } {
  let raw: unknown
  try {
    raw = JSON.parse(text)
  } catch (e) {
    return { ok: false, field: 'document', error: `document: not JSON — ${e instanceof Error ? e.message : 'parse error'}.` }
  }
  const c = checkPolicyDoc(raw, vocab)
  return c.ok ? { ok: true, doc: raw } : c
}

function readDoc(raw: unknown, v: Vocab) {
  if (!isObj(raw)) throw new Bad('document', 'must be a JSON object (the TenantPolicyDoc).')
  strictKeys(raw, DOC_KEYS, '')
  if (raw.version !== 1) throw new Bad('version', 'must be 1.')
  if (raw.default !== 'deny') throw new Bad('default', 'must be "deny" — a tenant policy is default-deny in v1.')
  list(raw.venues, 'venues', (x, f) => readRule(x, f, v), { max: 64 })
  const desks = list(raw.desks, 'desks', (x, f) => readDesk(x, f, v), { min: 1, max: 64 }) as { id: string }[]
  const seen = new Set<string>()
  desks.forEach((d, i) => {
    if (seen.has(d.id)) throw new Bad(`desks[${i}].id`, `desk id "${d.id}" appears twice.`)
    seen.add(d.id)
  })
  if (raw.hooks !== undefined) {
    if (!isObj(raw.hooks)) throw new Bad('hooks', 'must be an object { preTrade?, postTrade? }.')
    strictKeys(raw.hooks, ['preTrade', 'postTrade'], 'hooks')
    for (const k of ['preTrade', 'postTrade'] as const) {
      const h = raw.hooks[k]
      if (h === undefined) continue
      if (typeof h !== 'string' || h.length > 400 || !/^https:\/\/[^\s]+$/.test(h)) throw new Bad(`hooks.${k}`, 'must be an https URL.')
    }
  }
  if (raw.signing !== undefined) {
    if (!isObj(raw.signing)) throw new Bad('signing', 'must be an object { lane, wallets }.')
    strictKeys(raw.signing, ['lane', 'wallets'], 'signing')
    oneOf(v.lanes, 'signing lane')(raw.signing.lane, 'signing.lane')
    list(
      raw.signing.wallets,
      'signing.wallets',
      (x, f) => {
        if (typeof x !== 'string' || !WALLET_RE.test(x)) throw new Bad(f, 'must be a 0x wallet address.')
      },
      { max: 50 },
    )
  }
}

function readRule(x: unknown, at: string, v: Vocab) {
  if (!isObj(x)) throw new Bad(at, 'must be a venue rule object.')
  strictKeys(x, RULE_KEYS, at)
  oneOf(v.venues, 'venue')(x.venue, `${at}.venue`)
  const venue = x.venue as string
  if (x.chains !== undefined) {
    const venueChains = v.venueChains[venue]
    if (venueChains === null || venueChains === undefined) throw new Bad(`${at}.chains`, `${venue} settles off-chain — omit chains.`)
    list(
      x.chains,
      `${at}.chains`,
      (c, f) => {
        if (typeof c !== 'number' || !Number.isInteger(c)) throw new Bad(f, 'must be an integer chain id.')
        if (!venueChains.includes(c)) throw new Bad(f, `${venue} does not run on chain ${c} — it runs on ${venueChains.join(', ')}.`)
      },
      { min: 1, max: 16 },
    )
  }
  if (x.ops !== undefined) list(x.ops, `${at}.ops`, oneOf(v.ops, 'op'), { min: 1, max: v.ops.length })
  if (x.tokens !== undefined) {
    list(
      x.tokens,
      `${at}.tokens`,
      (t, f) => {
        if (typeof t !== 'string' || !TOKEN_RE.test(t.trim())) throw new Bad(f, 'must be a token symbol or a 0x address.')
      },
      { min: 1, max: 200 },
    )
  }
  if (x.sides !== undefined) list(x.sides, `${at}.sides`, oneOf(v.sides, 'side'), { min: 1, max: v.sides.length })
  if (x.maxOrderUsd !== undefined) posUsd(x.maxOrderUsd, `${at}.maxOrderUsd`)
  if (x.maxPriceImpactBps !== undefined) {
    const n = x.maxPriceImpactBps
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 0 || n > 10_000) throw new Bad(`${at}.maxPriceImpactBps`, 'must be 0–10000 bps.')
  }
  if (x.maxLeverage !== undefined) {
    const n = x.maxLeverage
    if (typeof n !== 'number' || !Number.isFinite(n) || n < 1 || n > 100) throw new Bad(`${at}.maxLeverage`, 'must be 1–100.')
  }
}

function readDesk(x: unknown, at: string, v: Vocab) {
  if (!isObj(x)) throw new Bad(at, 'must be a desk object.')
  strictKeys(x, DESK_KEYS, at)
  if (typeof x.id !== 'string' || !new RegExp(v.deskIdRe).test(x.id)) throw new Bad(`${at}.id`, 'must be a desk id: lowercase letters, digits and dashes, 1–32 chars.')
  if (x.perOrderUsd !== undefined) posUsd(x.perOrderUsd, `${at}.perOrderUsd`)
  if (x.perDayUsd !== undefined) posUsd(x.perDayUsd, `${at}.perDayUsd`)
  if (x.approvals !== undefined) {
    const a = x.approvals
    if (!isObj(a)) throw new Bad(`${at}.approvals`, 'must be { overUsd, approvers }.')
    strictKeys(a, ['overUsd', 'approvers'], `${at}.approvals`)
    if (typeof a.overUsd !== 'number' || !Number.isFinite(a.overUsd) || a.overUsd < 0) throw new Bad(`${at}.approvals.overUsd`, 'must be a dollar amount ≥ 0.')
    if (typeof a.approvers !== 'number' || !Number.isInteger(a.approvers) || a.approvers < 1 || a.approvers > 10) throw new Bad(`${at}.approvals.approvers`, 'must be an integer 1–10.')
  }
  if (x.hours !== undefined) {
    const h = x.hours
    if (!isObj(h)) throw new Bad(`${at}.hours`, 'must be { tz, from, to, days }.')
    strictKeys(h, ['tz', 'from', 'to', 'days'], `${at}.hours`)
    if (!validTimeZone(h.tz)) throw new Bad(`${at}.hours.tz`, `${JSON.stringify(h.tz)} is not an IANA time zone (e.g. "America/New_York").`)
    if (typeof h.from !== 'string' || !HHMM_RE.test(h.from)) throw new Bad(`${at}.hours.from`, 'must be "HH:MM" (24h).')
    if (typeof h.to !== 'string' || !HHMM_RE.test(h.to)) throw new Bad(`${at}.hours.to`, 'must be "HH:MM" (24h).')
    const days = list(
      h.days,
      `${at}.hours.days`,
      (d, f) => {
        if (typeof d !== 'number' || !Number.isInteger(d) || d < 0 || d > 6) throw new Bad(f, 'must be a weekday 0–6 (Sunday = 0).')
      },
      { min: 1, max: 7 },
    )
    if (new Set(days).size !== days.length) throw new Bad(`${at}.hours.days`, 'lists a day twice.')
  }
}

/** The document as the textarea shows it: two-space JSON with arrays of
 *  scalars on one line (`"chains": [8453]`), so it reads like a policy. */
export function policyJson(doc: unknown): string {
  const SCALARS = /\[\s*((?:(?:"[^"]*"|-?\d+(?:\.\d+)?|true|false|null)\s*,?\s*)+)\]/g
  return JSON.stringify(doc, null, 2).replace(SCALARS, (_m, inner: string) => `[${inner.trim().split(/\s*,\s*/).join(', ')}]`)
}

/** The policy's keys in the spec's order. Postgres jsonb stores object keys
 *  SORTED, so a document read back from the API opens "default" first and
 *  "version" last; the console prints it the way compliance wrote it. Unknown
 *  keys keep their place after the known ones (the validator refuses them). */
const ORDER: Record<string, string[]> = {
  doc: ['version', 'default', 'venues', 'desks', 'hooks', 'signing'],
  rule: RULE_KEYS,
  desk: DESK_KEYS,
  approvals: ['overUsd', 'approvers'],
  hours: ['tz', 'from', 'to', 'days'],
  hooks: ['preTrade', 'postTrade'],
  signing: ['lane', 'wallets'],
}
function ordered(o: unknown, keys: string[]): unknown {
  if (!isObj(o)) return o
  const out: Record<string, unknown> = {}
  for (const k of keys) if (k in o) out[k] = o[k]
  for (const k of Object.keys(o)) if (!(k in out)) out[k] = o[k]
  return out
}
export function orderPolicyDoc(doc: unknown): unknown {
  if (!isObj(doc)) return doc
  const d = ordered(doc, ORDER.doc) as Record<string, unknown>
  if (Array.isArray(d.venues)) d.venues = d.venues.map((r) => ordered(r, ORDER.rule))
  if (Array.isArray(d.desks)) {
    d.desks = d.desks.map((x) => {
      const desk = ordered(x, ORDER.desk) as Record<string, unknown>
      if (isObj(desk)) {
        if (desk.approvals !== undefined) desk.approvals = ordered(desk.approvals, ORDER.approvals)
        if (desk.hours !== undefined) desk.hours = ordered(desk.hours, ORDER.hours)
      }
      return desk
    })
  }
  if (d.hooks !== undefined) d.hooks = ordered(d.hooks, ORDER.hooks)
  if (d.signing !== undefined) d.signing = ordered(d.signing, ORDER.signing)
  return d
}

/** A policy document as the console prints and edits it. */
export const policyDocJson = (doc: unknown): string => policyJson(orderPolicyDoc(doc))
