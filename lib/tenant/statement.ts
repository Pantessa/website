// lib/tenant/statement.ts — THE MONTHLY STATEMENT (BLOTTER lane, five-million, 2026-11-03).
//
// A tenant's month, read from its own blotter and nothing else:
//
//   notional      every `signed` leg of the month, judged by its `settled` row —
//                 `verified` (the chain proved it) counts; `attested` (an
//                 off-chain leg: Hyperliquid / CoW / Seaport orders, where no EVM
//                 receipt exists) counts, on its own line (STATEMENT_COUNTS_ATTESTED);
//                 `mismatch` (the chain refuted it) never counts; a leg with NO
//                 settlement yet counts on its signature, on its own line — the
//                 statement says which basis each dollar stands on.
//   platform      DESK_PLATFORM_FEE_USD, waived for the part of the month inside
//                 DESIGN_PARTNER_FREE_DAYS of the tenant's creation (prorated by
//                 time: a window that ends on the 15th waives half the month).
//   execution     `tenant.feeBps` flat on the notional when set, else
//                 tieredDeskFeeUsd(notional) (10 / 5 / 2 bps, marginal).
//   credit        the in-calldata fees those counted legs already paid (the sum of
//                 their `fee_usd`), applied against execution, never below zero.
//   amount due    platform due + (execution − credit applied).
//
// A CLOSED month is cut once: one `statement` row per tenant per month (keyed
// `statement:<ym>` inside the blotter's lock), and every later call returns that
// row's numbers. The open month is a live preview and writes nothing. When
// Stripe is configured AND the owner has a Stripe customer, the cut drafts ONE
// invoice with the same three lines — `auto_advance: false`, never finalized,
// never sent; a person reviews and sends it from the Stripe dashboard.

import prisma from '@/lib/db'
import {
  DESIGN_PARTNER_FREE_DAYS,
  DESK_FEE_TIERS,
  DESK_PLATFORM_FEE_USD,
  tieredDeskFeeUsd,
  type BlotterVerification,
} from '@/lib/tenant/spec'
import { recordBlotterOnce, recordTenantTurn, type StoredBlotterRow } from '@/lib/tenant/blotter'
import { settleTenantJobLegs } from '@/lib/job-step-money'
import { chainIdOfTurn, extractTxHash, verifyTurnNow } from '@/lib/link-receipt-verify'
import { getEffectivePlan } from '@/lib/billing'
import { getStripe } from '@/lib/stripe'

export { verifyChain } from '@/lib/tenant/blotter'

/** Off-chain legs (no receipt exists) bill on the signer's attested report. */
export const STATEMENT_COUNTS_ATTESTED = true
export const YM_RE = /^(\d{4})-(0[1-9]|1[0-2])$/
const DAY_MS = 86_400_000

const round2 = (n: number) => Math.round(n * 100) / 100

// ── Pure: the month ─────────────────────────────────────────────────────────

export function monthRange(ym: string): { from: Date; to: Date } | null {
  const m = YM_RE.exec(ym)
  if (!m) return null
  const y = Number(m[1])
  const mo = Number(m[2]) - 1
  return { from: new Date(Date.UTC(y, mo, 1)), to: new Date(Date.UTC(y, mo + 1, 1)) }
}

/** The last month that has ended at `now` (the default statement). */
export function lastClosedMonth(now = new Date()): string {
  const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() - 1, 1))
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`
}

// ── Pure: the legs ──────────────────────────────────────────────────────────

export interface StatementLeg {
  signedSeq: number
  valueUsd: number | null
  feeUsd: number | null
  /** The latest settlement's verdict, or null when none was written yet. */
  settled: BlotterVerification | null
}

const onceOf = (payload: unknown): string | null => {
  const o = (payload as { once?: unknown } | null)?.once
  return typeof o === 'string' ? o : null
}

/** Pair each `signed` row with its latest receipt `settled` row (by
 *  `payload.signedSeq`, else by the once-key twin `…:signed` ↔ `…:settled`).
 *  Wait-step settlements (`payload.source = 'wait'`) prove a venue's fill, not a
 *  leg's money, and are not paired. Pure. */
export function statementLegs(signed: StoredBlotterRow[], settled: StoredBlotterRow[]): StatementLeg[] {
  const bySeq = new Map<number, StoredBlotterRow>()
  const byOnce = new Map<string, StoredBlotterRow>()
  for (const s of [...settled].sort((a, b) => a.seq - b.seq)) {
    const p = (s.payload ?? {}) as { signedSeq?: unknown; source?: unknown }
    if (p.source === 'wait') continue
    if (typeof p.signedSeq === 'number') bySeq.set(p.signedSeq, s)
    const once = onceOf(s.payload)
    if (once?.endsWith(':settled')) byOnce.set(once.slice(0, -':settled'.length), s)
  }
  return signed
    .filter((r) => r.kind === 'signed')
    .map((r) => {
      const once = onceOf(r.payload)
      const twin = bySeq.get(r.seq) ?? (once?.endsWith(':signed') ? byOnce.get(once.slice(0, -':signed'.length)) : undefined)
      const v = twin?.verification
      return {
        signedSeq: r.seq,
        valueUsd: typeof r.valueUsd === 'number' && Number.isFinite(r.valueUsd) ? r.valueUsd : null,
        feeUsd: typeof r.feeUsd === 'number' && Number.isFinite(r.feeUsd) ? r.feeUsd : null,
        settled: v === 'verified' || v === 'attested' || v === 'mismatch' || v === 'unverified' ? v : null,
      }
    })
}

// ── Pure: the math ──────────────────────────────────────────────────────────

export interface StatementBucket {
  count: number
  usd: number
}

export interface StatementNumbers {
  ym: string
  period: { from: string; to: string }
  legs: {
    total: number
    verified: StatementBucket
    attested: StatementBucket & { counted: boolean }
    /** Signed with no settlement (or an `unverified` one) yet — counted on the signature. */
    signedOnly: StatementBucket
    mismatch: StatementBucket
    /** Legs with no price on the signed row (count only; they add $0). */
    unpriced: number
  }
  /** 'verified' when every counted dollar is receipt-verified; else which mix. */
  basis: 'none' | 'verified' | 'verified+attested' | 'verified+signed' | 'verified+attested+signed' | 'attested' | 'signed' | 'attested+signed'
  basisNote: string
  notionalUsd: number
  platform: { listUsd: number; waivedUsd: number; dueUsd: number; freeUntil: string; note: string }
  execution: { mode: 'flat' | 'tiered'; bps: number | null; tiers: { uptoUsd: number | null; bps: number; spanUsd: number; feeUsd: number }[] | null; feeUsd: number }
  calldataCreditUsd: number
  creditAppliedUsd: number
  /** In-calldata fees above this month's execution fee (not refunded in wave 1). */
  creditUnusedUsd: number
  executionDueUsd: number
  amountDueUsd: number
  lines: { id: 'platform' | 'execution' | 'credit'; description: string; amountUsd: number }[]
}

const fmtUsd = (n: number) => `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
const monthWords = (ym: string) => {
  const r = monthRange(ym)!
  return r.from.toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' })
}

/** The statement's numbers from the month's legs. Pure. */
export function statementMath(input: { ym: string; tenantCreatedAt: Date; feeBps: number | null; legs: StatementLeg[] }): StatementNumbers {
  const range = monthRange(input.ym)
  if (!range) throw new Error(`bad month ${input.ym}`)
  const b = (): StatementBucket => ({ count: 0, usd: 0 })
  const verified = b()
  const attested = b()
  const signedOnly = b()
  const mismatch = b()
  let unpriced = 0
  let credit = 0
  for (const l of input.legs) {
    const usd = l.valueUsd ?? 0
    if (l.valueUsd === null) unpriced++
    const bucket = l.settled === 'verified' ? verified : l.settled === 'attested' ? attested : l.settled === 'mismatch' ? mismatch : signedOnly
    bucket.count++
    bucket.usd += usd
    const counted = bucket === verified || bucket === signedOnly || (bucket === attested && STATEMENT_COUNTS_ATTESTED)
    if (counted) credit += l.feeUsd ?? 0
  }
  for (const x of [verified, attested, signedOnly, mismatch]) x.usd = round2(x.usd)
  const notional = round2(verified.usd + (STATEMENT_COUNTS_ATTESTED ? attested.usd : 0) + signedOnly.usd)

  const parts = [verified.count ? 'verified' : '', STATEMENT_COUNTS_ATTESTED && attested.count ? 'attested' : '', signedOnly.count ? 'signed' : ''].filter(Boolean)
  const basis = (parts.length ? parts.join('+') : 'none') as StatementNumbers['basis']
  const noteBits = [
    verified.count ? `${fmtUsd(verified.usd)} receipt-verified on chain (${verified.count} leg${verified.count === 1 ? '' : 's'})` : '',
    attested.count
      ? STATEMENT_COUNTS_ATTESTED
        ? `${fmtUsd(attested.usd)} venue-attested off-chain legs, no EVM receipt exists (${attested.count})`
        : `${fmtUsd(attested.usd)} venue-attested off-chain legs NOT counted (${attested.count})`
      : '',
    signedOnly.count ? `${fmtUsd(signedOnly.usd)} signed with no settlement yet, counted on the signature (${signedOnly.count})` : '',
    mismatch.count ? `${fmtUsd(mismatch.usd)} the chain refuted, never counted (${mismatch.count})` : '',
    unpriced ? `${unpriced} leg${unpriced === 1 ? '' : 's'} carried no price and add $0` : '',
  ].filter(Boolean)
  const basisNote = noteBits.length ? `${noteBits.join('; ')}.` : 'No signed legs this month.'

  // Platform: waived for the part of the month inside the free window.
  const freeUntil = new Date(input.tenantCreatedAt.getTime() + DESIGN_PARTNER_FREE_DAYS * DAY_MS)
  const monthMs = range.to.getTime() - range.from.getTime()
  const existed = range.to > input.tenantCreatedAt
  const chargedFrom = Math.max(range.from.getTime(), freeUntil.getTime())
  const fraction = existed ? Math.max(0, range.to.getTime() - chargedFrom) / monthMs : 0
  const platformDue = round2(DESK_PLATFORM_FEE_USD * fraction)
  const platformNote = !existed
    ? 'The tenant did not exist yet this month.'
    : fraction === 0
      ? `Waived: the design-partner window (${DESIGN_PARTNER_FREE_DAYS} days from ${input.tenantCreatedAt.toISOString().slice(0, 10)}) covers the whole month.`
      : fraction < 1
        ? `Waived until ${freeUntil.toISOString().slice(0, 10)} (the ${DESIGN_PARTNER_FREE_DAYS}-day design-partner window); the rest of the month is charged.`
        : 'Charged in full.'

  // Execution.
  const flat = typeof input.feeBps === 'number' && Number.isFinite(input.feeBps) && input.feeBps >= 0
  let tiers: StatementNumbers['execution']['tiers'] = null
  let executionFee: number
  if (flat) {
    executionFee = round2((notional * (input.feeBps as number)) / 10_000)
  } else {
    executionFee = tieredDeskFeeUsd(notional)
    tiers = []
    let left = notional
    let prev = 0
    for (const t of DESK_FEE_TIERS) {
      const span = Math.max(0, Math.min(left, t.uptoUsd - prev))
      tiers.push({ uptoUsd: Number.isFinite(t.uptoUsd) ? t.uptoUsd : null, bps: t.bps, spanUsd: round2(span), feeUsd: round2((span * t.bps) / 10_000) })
      left -= span
      prev = t.uptoUsd
    }
  }
  const calldataCredit = round2(credit)
  const applied = round2(Math.min(calldataCredit, executionFee))
  const executionDue = round2(executionFee - applied)
  const amountDue = round2(platformDue + executionDue)
  const month = monthWords(input.ym)
  const execWords = flat ? `${input.feeBps} bps flat` : 'tiered 10 / 5 / 2 bps'
  return {
    ym: input.ym,
    period: { from: range.from.toISOString(), to: range.to.toISOString() },
    legs: { total: input.legs.length, verified, attested: { ...attested, counted: STATEMENT_COUNTS_ATTESTED }, signedOnly, mismatch, unpriced },
    basis,
    basisNote,
    notionalUsd: notional,
    platform: { listUsd: DESK_PLATFORM_FEE_USD, waivedUsd: round2(DESK_PLATFORM_FEE_USD - platformDue), dueUsd: platformDue, freeUntil: freeUntil.toISOString(), note: platformNote },
    execution: { mode: flat ? 'flat' : 'tiered', bps: flat ? (input.feeBps as number) : null, tiers, feeUsd: executionFee },
    calldataCreditUsd: calldataCredit,
    creditAppliedUsd: applied,
    creditUnusedUsd: round2(calldataCredit - applied),
    executionDueUsd: executionDue,
    amountDueUsd: amountDue,
    lines: [
      { id: 'platform', description: `Desk platform fee, ${month}${platformDue < DESK_PLATFORM_FEE_USD ? ` (${fmtUsd(round2(DESK_PLATFORM_FEE_USD - platformDue))} waived, design-partner window)` : ''}`, amountUsd: platformDue },
      { id: 'execution', description: `Execution, ${execWords} on ${fmtUsd(notional)} notional, ${month}`, amountUsd: executionFee },
      { id: 'credit', description: `Credit: fees already collected in calldata on those trades, ${month}`, amountUsd: applied ? -applied : 0 },
    ],
  }
}

// ── The Stripe draft (injectable for the pins) ──────────────────────────────

export interface StripeLike {
  invoices: { create(params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ id: string; status?: string | null }> }
  invoiceItems: { create(params: Record<string, unknown>, opts?: { idempotencyKey?: string }): Promise<{ id: string }> }
}

export interface StatementInvoice {
  id: string
  status: string | null
  customer: string
  items: string[]
}

/** Draft (never finalize, never send) one invoice with the statement's three
 *  lines. Idempotency keys per tenant-month, so two racing cuts get one invoice. */
export async function draftStatementInvoice(stripe: StripeLike, customer: string, tenant: { id: string; slug: string }, n: StatementNumbers): Promise<StatementInvoice> {
  const key = `pantessa-statement:${tenant.id}:${n.ym}`
  const invoice = await stripe.invoices.create(
    {
      customer,
      auto_advance: false,
      collection_method: 'send_invoice',
      days_until_due: 30,
      pending_invoice_items_behavior: 'exclude',
      description: `Pantessa desk statement, ${monthWords(n.ym)} (${tenant.slug})`,
      metadata: { tenantId: tenant.id, tenantSlug: tenant.slug, ym: n.ym, notionalUsd: String(n.notionalUsd), basis: n.basis },
    },
    { idempotencyKey: `${key}:invoice` },
  )
  const items: string[] = []
  for (const line of n.lines) {
    const item = await stripe.invoiceItems.create(
      { customer, invoice: invoice.id, currency: 'usd', amount: Math.round(line.amountUsd * 100), description: line.description, metadata: { tenantId: tenant.id, ym: n.ym, line: line.id } },
      { idempotencyKey: `${key}:${line.id}` },
    )
    items.push(item.id)
  }
  return { id: invoice.id, status: invoice.status ?? 'draft', customer, items }
}

// ── I/O: the settlement sweep for link turns ────────────────────────────────

/**
 * Browser-signed turns through a tenant's desk-minted links whose receipt was not
 * verified when the beacon landed: verify them now (bounded) and book the verified
 * ones (lib/tenant/blotter recordTenantTurn). The join is server truth only —
 * broker_intents.tenant_id → link_slug → embed_turns.intent_link_slug. Never throws.
 */
export async function sweepTenantLinkTurns(tenantId: string, limit = 10): Promise<number> {
  try {
    const intents = await prisma.brokerIntent.findMany({ where: { tenantId, linkSlug: { not: null } }, select: { id: true, linkSlug: true, deskKeyId: true }, orderBy: { createdAt: 'desc' }, take: 200 })
    if (!intents.length) return 0
    const bySlug = new Map(intents.map((i) => [i.linkSlug as string, i]))
    const turns = await prisma.embedTurn.findMany({
      where: { intentLinkSlug: { in: [...bySlug.keys()] }, outcome: 'signed', createdAt: { gt: new Date(Date.now() - 35 * DAY_MS) } },
      select: { id: true, intentLinkSlug: true, walletAddress: true, valueUsd: true, buildPath: true, feeBps: true, chain: true, txUrl: true, artifact: true, verification: true },
      orderBy: { createdAt: 'desc' },
      take: 100,
    })
    if (!turns.length) return 0
    const keys = turns.map((t) => `turn:${t.id}:signed`)
    const booked = await prisma.$queryRaw<{ once: string }[]>`SELECT payload->>'once' AS once FROM blotter_rows WHERE tenant_id = ${tenantId} AND kind = 'signed' AND payload->>'once' = ANY(${keys})`
    const done = new Set(booked.map((b) => b.once))
    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { signers: true } })
    let n = 0
    for (const t of turns) {
      if (n >= limit) break
      if (done.has(`turn:${t.id}:signed`)) continue
      if (t.verification === 'mismatch' || t.verification === 'attested' || t.verification === 'dev') continue
      const v =
        t.verification === 'verified'
          ? 'verified'
          : await Promise.race([verifyTurnNow(t.id), new Promise<'unverified'>((r) => setTimeout(() => r('unverified'), 4000))]).catch(() => 'unverified')
      if (v !== 'verified') continue
      const intent = bySlug.get(t.intentLinkSlug as string)!
      await recordTenantTurn({
        tenantId,
        deskKeyId: intent.deskKeyId,
        intentId: intent.id,
        turnId: t.id,
        wallet: t.walletAddress,
        valueUsd: t.valueUsd,
        buildPath: t.buildPath,
        stampedFeeBps: t.feeBps,
        chainId: chainIdOfTurn(t),
        txHash: extractTxHash(t.txUrl),
        artifact: t.artifact,
        signers: tenant?.signers ?? null,
      })
      n++
    }
    return n
  } catch (err) {
    console.error('[blotter] tenant link-turn sweep failed', tenantId, (err as Error)?.message ?? err)
    return 0
  }
}

// ── I/O: the statement ──────────────────────────────────────────────────────

export interface StatementResult extends StatementNumbers {
  tenant: { id: string; slug: string; name: string }
  /** The month has ended. */
  closed: boolean
  /** A `statement` row holds these numbers (they will not change). */
  final: boolean
  /** The row this call returned already existed. */
  existing: boolean
  seq: number | null
  hash: string | null
  invoice: StatementInvoice | null
  invoiceNote: string
}

export interface StatementOptions {
  now?: Date
  /** false = numbers only: no row, no invoice (the route's preview without the entitlement). */
  cut?: boolean
  /** Inject a Stripe client (the pins); null = none; omitted = getStripe(). */
  stripe?: StripeLike | null
  /** Run the settlement sweeps first (default true). */
  sweep?: boolean
}

type StatementPayload = { ym: string; statement: StatementNumbers; invoice: StatementInvoice | null; invoiceNote: string }

const SELECT_ROW = { seq: true, prevHash: true, hash: true, kind: true, createdAt: true, payload: true, valueUsd: true, feeUsd: true, verification: true } as const

async function cutRow(tenantId: string, ym: string) {
  const rows = await prisma.$queryRaw<{ seq: number; hash: string; payload: unknown }[]>`SELECT seq, hash, payload FROM blotter_rows WHERE tenant_id = ${tenantId} AND kind = 'statement' AND payload->>'once' = ${`statement:${ym}`} ORDER BY seq ASC LIMIT 1`
  return rows[0] ?? null
}

function fromRow(tenant: StatementResult['tenant'], row: { seq: number; hash: string; payload: unknown }): StatementResult {
  const p = row.payload as StatementPayload
  return { ...p.statement, tenant, closed: true, final: true, existing: true, seq: Number(row.seq), hash: row.hash, invoice: p.invoice ?? null, invoiceNote: p.invoiceNote ?? '' }
}

/** The tenant's statement for `ym` (YYYY-MM). null = no such tenant. */
export async function monthlyStatement(tenantId: string, ym: string, opts: StatementOptions = {}): Promise<StatementResult | null> {
  const range = monthRange(ym)
  if (!range) throw new Error(`month must be YYYY-MM, got ${ym}`)
  const tenant = await prisma.tenant.findUnique({ where: { id: tenantId }, select: { id: true, slug: true, name: true, ownerAddress: true, feeBps: true, createdAt: true } })
  if (!tenant) return null
  const who = { id: tenant.id, slug: tenant.slug, name: tenant.name }
  const now = opts.now ?? new Date()
  const closed = range.to.getTime() <= now.getTime()
  if (closed) {
    const prior = await cutRow(tenantId, ym)
    if (prior) return fromRow(who, prior)
  }
  if (opts.sweep !== false) {
    await settleTenantJobLegs(tenantId, 25)
    await sweepTenantLinkTurns(tenantId, 25)
  }
  const [signed, settled] = await Promise.all([
    prisma.blotterRow.findMany({ where: { tenantId, kind: 'signed', createdAt: { gte: range.from, lt: range.to } }, orderBy: { seq: 'asc' }, select: SELECT_ROW }),
    prisma.blotterRow.findMany({ where: { tenantId, kind: 'settled', createdAt: { gte: range.from } }, orderBy: { seq: 'asc' }, select: SELECT_ROW }),
  ])
  const numbers = statementMath({ ym, tenantCreatedAt: tenant.createdAt, feeBps: tenant.feeBps, legs: statementLegs(signed, settled) })
  const open = (invoiceNote: string): StatementResult => ({ ...numbers, tenant: who, closed, final: false, existing: false, seq: null, hash: null, invoice: null, invoiceNote })
  if (!closed) return open('The month is still open: these are live numbers; the statement is cut once the month ends.')
  if (opts.cut === false) return open('Preview: nothing was cut and no invoice was drafted.')

  // The Stripe draft, when there is a Stripe and a customer to bill.
  let invoice: StatementInvoice | null = null
  let invoiceNote: string
  const stripe = opts.stripe !== undefined ? opts.stripe : (getStripe() as unknown as StripeLike | null)
  const customer = (await getEffectivePlan(tenant.ownerAddress)).row?.stripeCustomerId ?? null
  if (!stripe) invoiceNote = 'No invoice drafted: Stripe is not configured here.'
  else if (!customer) invoiceNote = "No invoice drafted: the tenant owner has no Stripe customer yet."
  else if (numbers.amountDueUsd <= 0) invoiceNote = 'No invoice drafted: nothing is due.'
  else {
    try {
      invoice = await draftStatementInvoice(stripe, customer, who, numbers)
      invoiceNote = 'A DRAFT invoice was created in Stripe (never finalized, never sent): review and send it from the dashboard.'
    } catch (err) {
      // Not cut: the next call retries the draft (the idempotency keys keep it one invoice).
      return open(`Stripe refused the draft (${String((err as Error)?.message ?? err).slice(0, 200)}); nothing was cut, ask again to retry.`)
    }
  }
  const payload: StatementPayload = { ym, statement: numbers, invoice, invoiceNote }
  const w = await recordBlotterOnce(`statement:${ym}`, {
    tenantId,
    kind: 'statement',
    valueUsd: numbers.notionalUsd,
    feeUsd: numbers.amountDueUsd,
    payload: payload as unknown as Record<string, unknown>,
  })
  if (!w) return open('The blotter could not be written; nothing was cut. Ask again.')
  if (!w.written) {
    const prior = await cutRow(tenantId, ym)
    if (prior) return fromRow(who, prior)
  }
  return { ...numbers, tenant: who, closed: true, final: true, existing: false, seq: w.seq, hash: w.hash ?? null, invoice, invoiceNote }
}
