// components/desk/derive.ts — the desk console's pure helpers (squad
// five-million, CONSOLE lane, 2026-11-03): money and time words, the plan
// line, a desk's rules in a sentence, the blotter query, and the approvals
// queue read off the blotter. No React, no fetch — scripts/console-pins.ts
// imports this file and pins each rule.

import type { BlotterRowJson, DeskVocab, EntitlementsJson, TenantPolicyDoc } from './types'

type DeskRule = TenantPolicyDoc['desks'][number]
type VenueRule = TenantPolicyDoc['venues'][number]

export const fmtUsd = (n: number | null | undefined, digits = 2): string =>
  typeof n === 'number' && Number.isFinite(n) ? `${n < 0 ? '−' : ''}$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: digits, maximumFractionDigits: digits })}` : '—'

/** Whole dollars when the amount is whole ("$500", "$5,000"), cents otherwise. */
export const fmtCap = (n: number | null | undefined): string => (typeof n === 'number' && Number.isInteger(n) ? fmtUsd(n, 0) : fmtUsd(n))

export const planWord = (id: string): string => (id ? `${id.charAt(0).toUpperCase()}${id.slice(1)}` : 'Free')

export const shortAddr = (a: string | null | undefined): string => (a && /^0x[0-9a-fA-F]{40}$/.test(a) ? `${a.slice(0, 6)}…${a.slice(-4)}` : (a ?? '—'))

export const shortHash = (h: string | null | undefined, n = 10): string => (h ? (h.length > n + 2 ? `${h.slice(0, n)}…` : h) : '—')

/** "used of cap", an unlimited (null) cap spelled out. */
export const capWords = (used: number, cap: number | null): string => (cap === null ? `${used} · unlimited` : `${used} of ${cap}`)

/** UTC "YYYY-MM" for `now`. */
export const currentYm = (now = new Date()): string => now.toISOString().slice(0, 7)

/** Is `ym` a month that has ended (UTC)? */
export const ymClosed = (ym: string, now = new Date()): boolean => /^\d{4}-\d{2}$/.test(ym) && ym < currentYm(now)

export const when = (iso: string | null | undefined): string => {
  if (!iso) return '—'
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return '—'
  return d.toISOString().replace('T', ' ').slice(0, 16) + 'Z'
}

const DAY = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
/** [1,2,3,4,5] → "Mon–Fri"; a gap lists the days. */
export function daysWords(days: number[]): string {
  const d = [...new Set(days)].filter((n) => Number.isInteger(n) && n >= 0 && n <= 6).sort((a, b) => a - b)
  if (d.length === 7) return 'every day'
  if (d.length > 2 && d.every((n, i) => i === 0 || n === d[i - 1] + 1)) return `${DAY[d[0]]}–${DAY[d[d.length - 1]]}`
  return d.map((n) => DAY[n]).join(', ')
}

export const chainWord = (id: number | null | undefined, vocab: Pick<DeskVocab, 'chainNames'>): string =>
  id == null ? 'off-chain' : (vocab.chainNames[String(id)] ?? `chain ${id}`)

/** One desk's rules as short lines (the Desks section prints these). */
export function deskLines(d: DeskRule): { k: string; v: string }[] {
  const out: { k: string; v: string }[] = []
  out.push({ k: 'per order', v: d.perOrderUsd !== undefined ? fmtCap(d.perOrderUsd) : 'the venue rule’s cap only' })
  out.push({ k: 'per day', v: d.perDayUsd !== undefined ? `${fmtCap(d.perDayUsd)} (UTC day, signed rows)` : 'no day cap' })
  out.push({
    k: 'approvals',
    v: d.approvals ? `over ${fmtCap(d.approvals.overUsd)} → ${d.approvals.approvers} distinct admin${d.approvals.approvers === 1 ? '' : 's'}` : 'none needed',
  })
  out.push({ k: 'hours', v: d.hours ? `${d.hours.from}–${d.hours.to} ${d.hours.tz}, ${daysWords(d.hours.days)}` : 'any time' })
  return out
}

/** One venue rule in words: what it admits, on which chains. */
export function ruleLines(r: VenueRule, vocab: Pick<DeskVocab, 'chainNames' | 'venueChains'>): { k: string; v: string }[] {
  const venueChains = vocab.venueChains[r.venue]
  const chains = venueChains === null ? 'off-chain' : (r.chains ?? venueChains ?? []).map((c) => chainWord(c, vocab)).join(', ') + (r.chains ? '' : ' (every chain it runs on)')
  const out: { k: string; v: string }[] = [
    { k: 'chains', v: chains },
    { k: 'ops', v: r.ops ? r.ops.join(', ') : 'every op the venue has' },
    { k: 'tokens', v: r.tokens ? r.tokens.join(', ') : 'any token' },
    { k: 'sides', v: r.sides ? r.sides.join(', ') : 'any side' },
  ]
  if (r.maxOrderUsd !== undefined) out.push({ k: 'max order', v: fmtCap(r.maxOrderUsd) })
  if (r.maxPriceImpactBps !== undefined) out.push({ k: 'max impact', v: `${r.maxPriceImpactBps} bps` })
  if (r.maxLeverage !== undefined) out.push({ k: 'max leverage', v: `${r.maxLeverage}x` })
  return out
}

/** The plan line: what the owner's plan lets this console do. */
export function planLine(plan: string, ent: EntitlementsJson, counts: { tenants?: number; keys?: number } = {}): string[] {
  const parts = [`${planWord(plan)} plan`]
  if (counts.tenants !== undefined) parts.push(`tenants ${capWords(counts.tenants, ent.tenants)}`)
  if (counts.keys !== undefined) parts.push(`live keys ${capWords(counts.keys, ent.keysPerTenant)}`)
  else parts.push(`${ent.keysPerTenant === null ? 'unlimited' : ent.keysPerTenant} key${ent.keysPerTenant === 1 ? '' : 's'} per tenant`)
  parts.push(ent.mainnet ? 'mainnet' : 'sandbox only')
  parts.push(ent.approvals ? 'maker-checker on' : 'no maker-checker')
  parts.push(ent.blotterExport ? 'CSV export' : 'no CSV export')
  parts.push(ent.statement ? 'monthly statement' : 'statement preview')
  return parts
}

/** The cheapest desk plan in `order` that switches on `flag` (the console
 *  names the way forward next to a refusal). Mirrors lib/tenant/entitlements
 *  cheapestPlanAllowing, which is the source; this is display only. */
export function upgradeWord(upgrade: unknown): string | null {
  return typeof upgrade === 'string' && upgrade ? `the ${planWord(upgrade)} plan` : null
}

/** The blotter's query string (only the fields that are set). */
export function blotterQuery(q: { kind?: string; from?: string; to?: string; after?: number | null; limit?: number; format?: 'json' | 'csv' }): string {
  const sp = new URLSearchParams()
  if (q.kind) sp.set('kind', q.kind)
  if (q.from) sp.set('from', q.from)
  if (q.to) sp.set('to', q.to)
  if (q.after) sp.set('after', String(q.after))
  if (q.limit) sp.set('limit', String(q.limit))
  if (q.format && q.format !== 'json') sp.set('format', q.format)
  const s = sp.toString()
  return s ? `?${s}` : ''
}

/** The download name the route put in content-disposition, else a fallback. */
export function fileNameOf(disposition: string | null, fallback: string): string {
  const m = disposition ? /filename="?([^";]+)"?/i.exec(disposition) : null
  return m?.[1] ?? fallback
}

export function explorerTx(chainId: number | null, tx: string | null, vocab: Pick<DeskVocab, 'explorers'>): string | null {
  if (!tx || chainId == null || !/^0x[0-9a-fA-F]{64}$/.test(tx)) return null
  const base = vocab.explorers[String(chainId)]
  return base ? `${base}${tx}` : null
}

/* ── the approvals queue, read off the blotter ─────────────────────────────
   There is no "intents awaiting approval" list route (CONSOLE.md Spec asks).
   The blotter carries everything needed: a `policy_verdict` row with
   `needsApproval: true` (+ `approvers`) names the intent and the threshold,
   each `approval` row names one admin (+ have/needed/satisfied), the
   `intent` row carries the ask. The LATEST verdict for an intent decides:
   a later refusal (a re-gate at handoff under a changed policy) takes it out
   of the queue. */

export interface ApprovalItem {
  intentId: string
  ask: string | null
  usd: number | null
  deskId: string | null
  needed: number
  have: number
  approvers: string[]
  /** The signed-in admin already approved it. */
  mine: boolean
  state: 'awaiting' | 'approved' | 'refused'
  /** The refusal's reason when a later verdict refused it. */
  reason: string | null
  lastSeq: number
  lastAt: string
}

const payloadOf = (r: BlotterRowJson): Record<string, unknown> => (r.payload && typeof r.payload === 'object' ? r.payload : {})

export function approvalQueue(rows: BlotterRowJson[], viewer: string | null): ApprovalItem[] {
  const me = viewer?.toLowerCase() ?? null
  const by = new Map<string, BlotterRowJson[]>()
  for (const r of [...rows].sort((a, b) => a.seq - b.seq)) {
    if (!r.intentId) continue
    if (r.kind !== 'intent' && r.kind !== 'policy_verdict' && r.kind !== 'approval') continue
    const list = by.get(r.intentId) ?? []
    list.push(r)
    by.set(r.intentId, list)
  }
  const out: ApprovalItem[] = []
  for (const [intentId, list] of by) {
    const verdicts = list.filter((r) => r.kind === 'policy_verdict')
    const asking = verdicts.filter((r) => payloadOf(r).allowed === true && payloadOf(r).needsApproval === true)
    if (!asking.length) continue
    const latest = verdicts[verdicts.length - 1]
    const approvals = list.filter((r) => r.kind === 'approval')
    const approvers = [...new Set(approvals.map((r) => String(payloadOf(r).approver ?? '').toLowerCase()).filter(Boolean))]
    const lastAsk = asking[asking.length - 1]
    const neededFromVerdict = Number(payloadOf(lastAsk).approvers)
    const neededFromApproval = approvals.length ? Number(payloadOf(approvals[approvals.length - 1]).needed) : NaN
    const needed = Number.isInteger(neededFromVerdict) && neededFromVerdict > 0 ? neededFromVerdict : Number.isInteger(neededFromApproval) && neededFromApproval > 0 ? neededFromApproval : 1
    const have = approvers.length
    const intentRow = list.find((r) => r.kind === 'intent')
    const askRaw = payloadOf(intentRow ?? lastAsk).ask ?? (approvals.length ? payloadOf(approvals[approvals.length - 1]).ask : null)
    const refused = payloadOf(latest).allowed === false
    const last = list[list.length - 1]
    out.push({
      intentId,
      ask: typeof askRaw === 'string' ? askRaw : null,
      usd: lastAsk.valueUsd ?? intentRow?.valueUsd ?? null,
      deskId: lastAsk.deskId ?? intentRow?.deskId ?? null,
      needed,
      have,
      approvers,
      mine: !!me && approvers.includes(me),
      state: refused ? 'refused' : have >= needed ? 'approved' : 'awaiting',
      reason: refused ? String(payloadOf(latest).reason ?? '') || null : null,
      lastSeq: last.seq,
      lastAt: last.createdAt,
    })
  }
  return out.sort((a, b) => (a.state === 'awaiting' ? 0 : 1) - (b.state === 'awaiting' ? 0 : 1) || b.lastSeq - a.lastSeq)
}

/** Who sees what on a pending policy version (the API still decides):
 *  under maker-checker the proposer waits for a second admin; everyone else
 *  (and the proposer on a plan without maker-checker) may approve. */
export function proposalSeat(p: { proposedBy: string }, viewer: string | null, makerChecker: boolean): 'awaiting-second-admin' | 'approve' {
  const mine = !!viewer && p.proposedBy.toLowerCase() === viewer.toLowerCase()
  return makerChecker && mine ? 'awaiting-second-admin' : 'approve'
}
