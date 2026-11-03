// components/desk-page/sample.ts — the /desk page's SAMPLE objects, pure
// (squad five-million, DESKPAGE lane, 2026-11-03).
//
// Everything the page shows an institution is derived from lib/tenant/spec:
// the policy sample is typed as the spec's TenantPolicyDoc (tsc refuses a
// venue, op or side the gate would not know), the vocabulary rows are the
// spec constants (never retyped), the blotter sample's hashes are the spec's
// own blotterHash replayed from BLOTTER_GENESIS (so `verify` on this sample
// is a real replay, not a drawing), and the pricing example is the spec's
// tieredDeskFeeUsd over the plan's example month. The pins script imports
// these and checks them against the spec on every run.

import {
  BLOTTER_GENESIS,
  BLOTTER_KINDS,
  DESIGN_PARTNER_FREE_DAYS,
  DESK_FEE_TIERS,
  DESK_PLATFORM_FEE_USD,
  TENANT_OPS,
  TENANT_SIDES,
  TENANT_VENUES,
  VENUE_CHAINS,
  blotterHash,
  tieredDeskFeeUsd,
  type BlotterKind,
  type BlotterVerification,
  type TenantPolicyDoc,
  type TenantVenue,
} from '@/lib/tenant/spec'
import { PLAN_BY_ID, type Plan } from '@/lib/plans'
import { baseSepoliaAppChain, chainById } from '@/lib/chains'

// ── The policy document: the SHAPE, with sample values ─────────────────────
// "The shape; your compliance writes the values." CoW + Uniswap v3 on
// Ethereum and Base, Aave v4 supply/withdraw, three tokens, $5M an order, one
// desk `macro` with two approvers over $1M, New York hours, a pre-trade hook.
// Tokens are spelled the way the gate compares them: symbols UPPER.

export const SAMPLE_TOKENS = ['USDC', 'WETH', 'WSTETH'] as const
export const SAMPLE_MAX_ORDER_USD = 5_000_000
export const SAMPLE_APPROVAL_OVER_USD = 1_000_000
export const SAMPLE_APPROVERS = 2

export const SAMPLE_POLICY: TenantPolicyDoc = {
  version: 1,
  default: 'deny',
  venues: [
    {
      venue: 'cow',
      chains: [1, 8453],
      ops: ['swap', 'limit'],
      tokens: [...SAMPLE_TOKENS],
      sides: ['buy', 'sell'],
      maxOrderUsd: SAMPLE_MAX_ORDER_USD,
      maxPriceImpactBps: 50,
    },
    {
      venue: 'uniswap-v3',
      chains: [1, 8453],
      ops: ['swap'],
      tokens: [...SAMPLE_TOKENS],
      sides: ['buy', 'sell'],
      maxOrderUsd: SAMPLE_MAX_ORDER_USD,
      maxPriceImpactBps: 50,
    },
    {
      venue: 'aave-v4',
      chains: [1, 8453],
      ops: ['supply', 'withdraw'],
      tokens: [...SAMPLE_TOKENS],
      maxOrderUsd: SAMPLE_MAX_ORDER_USD,
    },
  ],
  desks: [
    {
      id: 'macro',
      perOrderUsd: SAMPLE_MAX_ORDER_USD,
      perDayUsd: 25_000_000,
      approvals: { overUsd: SAMPLE_APPROVAL_OVER_USD, approvers: SAMPLE_APPROVERS },
      hours: { tz: 'America/New_York', from: '07:00', to: '18:00', days: [1, 2, 3, 4, 5] },
    },
  ],
  hooks: { preTrade: 'https://compliance.example.com/pantessa/pre-trade' },
  signing: { lane: 'walletconnect', wallets: ['0x0000000000000000000000000000000000000000'] },
}

/** The sample as the page prints it: two-space JSON with arrays of scalars
 *  kept on one line (`"chains": [1, 8453]`), so the block reads like a policy
 *  and not like a column. The object is the spec-typed one above, verbatim. */
export function samplePolicyJson(): string {
  const SCALARS = /\[\s*((?:(?:"[^"]*"|-?\d+(?:\.\d+)?|true|false|null)\s*,?\s*)+)\]/g
  return JSON.stringify(SAMPLE_POLICY, null, 2).replace(SCALARS, (_m, inner: string) => `[${inner.trim().split(/\s*,\s*/).join(', ')}]`)
}

// ── The vocabulary, from the spec (the page lists these, never retypes) ────

export interface VocabRow {
  k: string
  items: readonly string[]
}

function chainLabel(id: number): string {
  if (id === baseSepoliaAppChain.id) return baseSepoliaAppChain.name
  return chainById(id)?.name ?? `chain ${id}`
}

/** Every chain any venue runs on, named from the chain registry. */
export function policyChainLabels(): string[] {
  const ids = new Set<number>()
  for (const v of TENANT_VENUES) for (const id of VENUE_CHAINS[v] ?? []) ids.add(id)
  return [...ids].sort((a, b) => a - b).map((id) => `${chainLabel(id)} · ${id}`)
}

export function policyVocabulary(): VocabRow[] {
  return [
    { k: 'venues', items: TENANT_VENUES },
    { k: 'ops', items: TENANT_OPS },
    { k: 'sides', items: TENANT_SIDES },
    { k: 'chains', items: policyChainLabels() },
  ]
}

/** Which chains a venue runs on, for the per-venue line under the vocabulary. */
export function venueChainLine(v: TenantVenue): string {
  const ids = VENUE_CHAINS[v]
  if (ids === null) return 'off-chain (the venue signs its own L1 actions)'
  return ids.map(chainLabel).join(' · ')
}

// ── The blotter: kinds + a six-row SAMPLE export whose chain verifies ──────

/** One line per kind, in the spec's order; the words are the spec's own
 *  comments, kept short. */
export const BLOTTER_KIND_WORDS: Record<BlotterKind, string> = {
  intent: 'an order reached the desk: the ask, the venue, the dollars',
  policy_verdict: "the gate's answer: allowed, or refused with the reason's name",
  build: 'a leg was built: the quotes considered, the route chosen',
  offered: 'the unsigned leg was offered to the signer',
  signed: 'the signer reported a signature or a hash',
  settled: 'the chain or the venue proved it (the verification state)',
  refused: 'a relay refused a signed leg',
  approval: 'an admin approved an over-threshold intent',
  policy_proposed: 'a policy version was proposed',
  policy_activated: 'a different admin activated it',
  policy_rejected: 'a proposal was rejected',
  key_minted: 'a desk key was minted',
  key_paused: 'a desk key was paused',
  key_resumed: 'a desk key was resumed',
  key_revoked: 'a desk key was revoked',
  statement: 'a monthly statement was cut',
}

export const BLOTTER_KIND_ROWS = BLOTTER_KINDS.map((kind) => ({ kind, words: BLOTTER_KIND_WORDS[kind] }))

export interface SampleBlotterRow {
  seq: number
  kind: BlotterKind
  createdAtIso: string
  deskId: string
  venue: string
  chainId: number
  valueUsd: number | null
  feeUsd: number | null
  txHash: string | null
  verification: BlotterVerification | null
  payload: Record<string, unknown>
  prevHash: string
  hash: string
}

/** Clearly a sample: the tenant is named `sample`, the hashes below are
 *  sha256 over these very rows, and the tx hash is the nil hash. */
export const SAMPLE_TENANT = 'sample'
export const SAMPLE_TX_HASH = `0x${'0'.repeat(64)}`
const SAMPLE_ORDER_USD = 250_000
const SAMPLE_FEE_USD = (SAMPLE_ORDER_USD * DESK_FEE_TIERS[0].bps) / 10_000

const SAMPLE_EVENTS: Omit<SampleBlotterRow, 'seq' | 'prevHash' | 'hash'>[] = [
  {
    kind: 'intent',
    createdAtIso: '2026-11-03T14:02:11.000Z',
    deskId: 'macro',
    venue: 'cow',
    chainId: 1,
    valueUsd: SAMPLE_ORDER_USD,
    feeUsd: null,
    txHash: null,
    verification: null,
    payload: { ask: 'Buy $250,000 of WETH with USDC on Ethereum', desk: 'macro', key: 'dk_sample…' },
  },
  {
    kind: 'policy_verdict',
    createdAtIso: '2026-11-03T14:02:11.040Z',
    deskId: 'macro',
    venue: 'cow',
    chainId: 1,
    valueUsd: SAMPLE_ORDER_USD,
    feeUsd: null,
    txHash: null,
    verification: null,
    payload: { allowed: true, rule: 'cow', needsApproval: false, policyVersion: 3 },
  },
  {
    kind: 'build',
    createdAtIso: '2026-11-03T14:02:12.310Z',
    deskId: 'macro',
    venue: 'cow',
    chainId: 1,
    valueUsd: SAMPLE_ORDER_USD,
    feeUsd: SAMPLE_FEE_USD,
    txHash: null,
    verification: null,
    payload: { route: 'cow batch auction', quotes: [{ venue: 'cow', outWeth: '73.4121' }, { venue: 'uniswap-v3', outWeth: '73.3870' }], chosen: 'cow' },
  },
  {
    kind: 'offered',
    createdAtIso: '2026-11-03T14:02:12.350Z',
    deskId: 'macro',
    venue: 'cow',
    chainId: 1,
    valueUsd: SAMPLE_ORDER_USD,
    feeUsd: SAMPLE_FEE_USD,
    txHash: null,
    verification: null,
    payload: { lane: 'walletconnect', shape: 'order', validTo: '2026-11-03T14:32:12.000Z' },
  },
  {
    kind: 'signed',
    createdAtIso: '2026-11-03T14:03:40.902Z',
    deskId: 'macro',
    venue: 'cow',
    chainId: 1,
    valueUsd: SAMPLE_ORDER_USD,
    feeUsd: SAMPLE_FEE_USD,
    txHash: null,
    verification: 'attested',
    payload: { orderUid: '0xsample…', signer: '0x0000…0000' },
  },
  {
    kind: 'settled',
    createdAtIso: '2026-11-03T14:05:02.118Z',
    deskId: 'macro',
    venue: 'cow',
    chainId: 1,
    valueUsd: SAMPLE_ORDER_USD,
    feeUsd: SAMPLE_FEE_USD,
    txHash: SAMPLE_TX_HASH,
    verification: 'verified',
    payload: { filledWeth: '73.4121', block: 0, receipt: 'verified against the chain' },
  },
]

/** The six rows with the hash chain computed the way the blotter computes it. */
export function sampleBlotterRows(): SampleBlotterRow[] {
  let prevHash = BLOTTER_GENESIS
  return SAMPLE_EVENTS.map((e, i) => {
    const seq = i + 1
    const hash = blotterHash({ prevHash, seq, kind: e.kind, createdAtIso: e.createdAtIso, payload: e.payload })
    const row: SampleBlotterRow = { ...e, seq, prevHash, hash }
    prevHash = hash
    return row
  })
}

/** Replays the chain exactly as GET …/blotter/verify does: `{ ok, rows, brokenAt? }`. */
export function verifySampleChain(rows: SampleBlotterRow[]): { ok: boolean; rows: number; brokenAt?: number } {
  let prev = BLOTTER_GENESIS
  for (const r of rows) {
    if (r.prevHash !== prev) return { ok: false, rows: rows.length, brokenAt: r.seq }
    const h = blotterHash({ prevHash: r.prevHash, seq: r.seq, kind: r.kind, createdAtIso: r.createdAtIso, payload: r.payload })
    if (h !== r.hash) return { ok: false, rows: rows.length, brokenAt: r.seq }
    prev = r.hash
  }
  return { ok: true, rows: rows.length }
}

/** CSV of the sample, the export's column order. */
export function sampleBlotterCsv(): string {
  const head = ['seq', 'kind', 'created_at', 'desk', 'venue', 'chain', 'value_usd', 'fee_usd', 'tx_hash', 'verification', 'prev_hash', 'hash']
  const lines = sampleBlotterRows().map((r) =>
    [r.seq, r.kind, r.createdAtIso, r.deskId, r.venue, r.chainId, r.valueUsd ?? '', r.feeUsd ?? '', r.txHash ?? '', r.verification ?? '', r.prevHash, r.hash].join(','),
  )
  return [head.join(','), ...lines].join('\n')
}

// ── Pricing, from the spec (+ lib/plans once the PLANS lane lands) ─────────

export const PRICING_EXAMPLE_NOTIONAL_USD = 25_000_000

/** Platform fee + the marginal tiers over a month's verified notional. */
export function monthlyDeskCostUsd(notionalUsd: number): number {
  return DESK_PLATFORM_FEE_USD + tieredDeskFeeUsd(notionalUsd)
}

export const usd0 = (n: number): string => `$${Math.round(n).toLocaleString('en-US')}`
export const usdShort = (n: number): string => (n >= 1_000_000 ? `$${n / 1_000_000}M` : n >= 1_000 ? `$${n / 1_000}K` : `$${n}`)

/** The tiers as the page prints them: "10 bps to $10M", "5 bps to $100M", "2 bps above". */
export function tierLines(): string[] {
  return DESK_FEE_TIERS.map((t) => (Number.isFinite(t.uptoUsd) ? `${t.bps} bps to ${usdShort(t.uptoUsd)} a month` : `${t.bps} bps above`))
}

export const FREE_DAYS = DESIGN_PARTNER_FREE_DAYS

/** The self-serve seats, read from lib/plans when the PLANS lane has added
 *  them (`agent`, `desk`); absent until then, and the page says where they
 *  are priced instead of inventing a number. */
export function deskSeatPlans(): { agent: Plan | null; desk: Plan | null } {
  const byId = PLAN_BY_ID as Record<string, Plan | undefined>
  const pick = (id: string): Plan | null => {
    const p = byId[id]
    return p && !p.legacy && typeof p.priceUsd === 'number' ? p : null
  }
  return { agent: pick('agent'), desk: pick('desk') }
}
