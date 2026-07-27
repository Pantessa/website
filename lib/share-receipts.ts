// Receipt permalinks (/r/<id>) — the shareable proof layer. Everything a
// share card shows is derived HERE, at share time, from the artifact the
// owner clicked share on: a settled tx turn, a done job, a DCA schedule, a
// guardian protection. The builders are pure (harness-testable, no DB) and
// PUBLIC-SAFE by construction: truncated wallet only, the owner's own ask
// only (sharing IS choosing to show it), never a raw address or a prompt
// the owner didn't sign/arm.
//
// `via` is the viral-loop tracer: a stable short id derived from the
// sharer's wallet (one-way hash — the id can't be walked back to the
// wallet). It rides every outbound link (?via=), gets cookied on landing,
// and is stamped into wallet_arrivals on the visitor's first sign-in — so
// /dashboard/users can show which wallets a share actually brought in.

import { createHash } from 'node:crypto'
import { chainById } from '@/lib/chains'
import { cadenceLabel, type DcaCadence } from '@/lib/dca'
import { signedTxsOf } from '@/components/SignedTxLines'

export interface ShareFact {
  label: string
  value: string
}

export interface ShareTxLine {
  hash: string
  chainId: number
  title?: string
}

/** What a share card is made of — the snapshot persisted to share_receipts. */
export interface ShareContent {
  headline: string
  ask: string | null
  standing: boolean
  valueUsd: number | null
  facts: ShareFact[]
  txs: ShareTxLine[]
}

export type ShareKind = 'tx' | 'job' | 'dca' | 'guardian'

export const SHARE_KINDS: ReadonlySet<string> = new Set(['tx', 'job', 'dca', 'guardian'])

/** ?via= values we accept back at the door (cookie + arrival stamp). */
export const VIA_RE = /^[a-z0-9]{4,16}$/

/**
 * The sharer's stable short id. One-way (sha-256, truncated), salted with a
 * fixed app string so the mapping is deterministic across envs but never a
 * raw wallet fragment someone could eyeball-match to an address.
 */
export function viaIdOf(wallet: string): string {
  return createHash('sha256').update(`yeetful-via-1|${wallet.toLowerCase()}`).digest('hex').slice(0, 10)
}

/** 0x1234…abcd — the only form a wallet ever takes on a public share surface. */
export function shortWallet(address: string): string {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address
}

/** Hex runs long enough to be an address/hash/calldata fragment. */
const ADDRESS_TOKEN_RE = /0x[a-fA-F0-9]{8,}/g

/**
 * Truncate every address-shaped token in free text to the 0x1234…abcd
 * idiom. The tx-kind receipt is the ONLY share path that republishes
 * verbatim user text (the other kinds synthesize canonical asks), and
 * prompts sometimes carry pasted recipient addresses — the #490 review
 * finding: "no prompts or full addresses on public share surfaces", and
 * the address-bearing ask is the leak that bites. Applied at write time
 * (the persisted snapshot is clean at rest) AND at the /r read doors
 * (covers rows minted before this existed).
 */
export function maskAddressTokens(text: string): string {
  return text.replace(ADDRESS_TOKEN_RE, (t) => `${t.slice(0, 6)}…${t.slice(-4)}`)
}

const usd = (n: number) => `$${n.toFixed(2)}`

// ── Per-kind content builders (pure) ────────────────────────────────────────

/** "every week" — the cadence as the share card says it. */
function cadencePhrase(cadence: DcaCadence): string {
  return cadence === 'day' ? 'every day' : cadence === 'week' ? 'every week' : 'every month'
}

export function dcaShareContent(s: {
  buyUsd: number
  buyToken: string
  sellToken: string
  cadence: string
  chainId: number
  status: string
}): ShareContent {
  const when = cadencePhrase(s.cadence as DcaCadence)
  const chain = chainById(s.chainId)?.name ?? `chain ${s.chainId}`
  return {
    headline: `${usd(s.buyUsd)} → ${s.buyToken} · ${when}`,
    ask: `buy $${s.buyUsd} of ${s.buyToken} ${cadenceLabel(s.cadence as DcaCadence)}`,
    standing: true,
    valueUsd: s.buyUsd,
    facts: [
      { label: 'Cadence', value: when },
      { label: 'Spends', value: s.sellToken },
      { label: 'Chain', value: chain },
      { label: 'Signs', value: 'owner wallet — one signature per buy' },
    ],
    txs: [],
  }
}

export function guardianShareContent(
  p: {
    coin: string
    side: string
    kind: string
    triggerMode: string
    triggerValue: number
    status: string
  },
  lastRun?: { action: string; valueUsd: number | null } | null,
): ShareContent {
  const kindLabel = p.kind === 'stop_loss' ? 'Stop-loss' : 'Take-profit'
  const trigger =
    p.triggerMode === 'price'
      ? `at $${p.triggerValue}`
      : `${p.kind === 'stop_loss' ? '−' : '+'}${Math.abs(p.triggerValue)}% from entry`
  const fired = lastRun?.action === 'closed'
  const headline = fired
    ? `${kindLabel} fired on ${p.coin}${lastRun?.valueUsd ? ` · ${usd(lastRun.valueUsd)} closed` : ''}`
    : `${kindLabel} standing on ${p.coin} · ${trigger}`
  return {
    headline,
    ask: `set a ${p.kind === 'stop_loss' ? 'stop loss' : 'take profit'} on my ${p.coin} position ${
      p.triggerMode === 'price' ? `at $${p.triggerValue}` : `at ${Math.abs(p.triggerValue)}%`
    }`,
    standing: true,
    valueUsd: fired ? (lastRun?.valueUsd ?? null) : null,
    facts: [
      { label: 'Watching', value: `${p.coin} ${p.side}` },
      { label: 'Trigger', value: trigger },
      { label: 'Checks', value: 'every minute, keys stay yours' },
      { label: 'Status', value: fired ? 'fired — position protected' : p.status },
    ],
    txs: [],
  }
}

/** Narrow a job step result to the tx hashes it settled with. */
function stepTxsOf(result: unknown): ShareTxLine[] {
  if (!result || typeof result !== 'object') return []
  const r = result as { txs?: unknown; txHash?: unknown }
  if (Array.isArray(r.txs)) {
    return r.txs.filter(
      (t): t is ShareTxLine =>
        !!t && typeof t === 'object' && typeof (t as ShareTxLine).hash === 'string' && typeof (t as ShareTxLine).chainId === 'number',
    )
  }
  return []
}

export function jobShareContent(
  job: { title: string; status: string; valueUsd: number | null },
  steps: Array<{ title: string; kind: string; status: string; valueUsd?: number | null; result?: unknown }>,
): ShareContent {
  const txs = steps.flatMap((s) => stepTxsOf(s.result)).slice(0, 8)
  const done = steps.filter((s) => s.status === 'done')
  return {
    headline: job.valueUsd && job.valueUsd > 0 ? `${usd(job.valueUsd)} moved · ${done.length} guarded steps` : job.title,
    ask: job.title,
    standing: true,
    valueUsd: job.valueUsd ?? null,
    facts: done.slice(0, 6).map((s) => ({
      label: s.kind === 'wait' ? 'Settled' : s.kind === 'auto' ? 'Auto' : 'Signed',
      value: s.valueUsd ? `${s.title} · ${usd(s.valueUsd)}` : s.title,
    })),
    txs,
  }
}

/**
 * A plain in-chat signed turn (no job): the message's durable meta.signed
 * log + the ask that produced it. `messages` is the chat's ordered list —
 * the ask is the nearest user turn BEFORE the shared message.
 */
export function txShareContent(
  messages: Array<{ id: string; role: string; content: string; meta: unknown }>,
  messageId: string,
): ShareContent | null {
  const idx = messages.findIndex((m) => m.id === messageId)
  if (idx < 0) return null
  const msg = messages[idx]
  const txs = signedTxsOf(msg.meta)
  if (txs.length === 0) return null
  const rawAsk = [...messages.slice(0, idx)].reverse().find((m) => m.role === 'user')?.content.trim() ?? null
  // The one verbatim-user-text path — pasted 0x addresses go public here.
  const ask = rawAsk ? maskAddressTokens(rawAsk) : null
  const guard = (msg.meta as { guardrails?: { valueUsd?: unknown } } | null)?.guardrails
  const valueUsd = typeof guard?.valueUsd === 'number' && guard.valueUsd > 0 ? guard.valueUsd : null
  return {
    headline: valueUsd ? `${usd(valueUsd)} moved on-chain` : (txs[0].title ?? 'Signed on-chain'),
    ask: ask && ask.length <= 400 ? ask : null,
    standing: false,
    valueUsd,
    facts: txs.slice(0, 6).map((t) => ({
      label: 'Signed',
      value: `${t.title ?? 'transaction'} · ${chainById(t.chainId)?.name ?? `chain ${t.chainId}`}`,
    })),
    txs: txs.slice(0, 8),
  }
}

// ── Read-side narrowing (share_receipts.facts / .txs are JSON columns) ─────

export function factsOf(json: unknown): ShareFact[] {
  if (!Array.isArray(json)) return []
  return json.filter(
    (f): f is ShareFact => !!f && typeof f === 'object' && typeof (f as ShareFact).label === 'string' && typeof (f as ShareFact).value === 'string',
  )
}

export function txLinesOf(json: unknown): ShareTxLine[] {
  if (!Array.isArray(json)) return []
  return json.filter(
    (t): t is ShareTxLine => !!t && typeof t === 'object' && typeof (t as ShareTxLine).hash === 'string' && typeof (t as ShareTxLine).chainId === 'number',
  )
}

// ── Outbound links ───────────────────────────────────────────────────────────

const site = () => process.env.NEXT_PUBLIC_SITE_URL ?? 'https://www.yeetful.com'

/** The public permalink, via param included — the link IS the tracer. */
export function shareReceiptUrl(id: string, via: string): string {
  return `${site()}/r/${id}?via=${via}`
}

/** "Do this yourself" — the handoff that eases a visitor in: same ask,
 *  prefilled, never auto-sent; the via tag rides along for attribution. */
export function receiptTryHref(receipt: { ask: string | null; via: string }): string {
  const parts = [
    ...(receipt.ask ? [`prompt=${encodeURIComponent(receipt.ask)}`] : []),
    `via=${receipt.via}`,
  ]
  return `/chat?${parts.join('&')}`
}

/** How much of the ask fits in the tweet (same budget as the /p tweet). */
const TWEET_ASK_MAX = 160

/**
 * Pre-written share post. Standing receipts lead with the machine running
 * unattended — that's the screenshot the product is FOR; attended receipts
 * lead with the ask that became a guarded, signed transaction.
 */
export function receiptTweetHref(receipt: {
  id: string
  headline: string
  ask: string | null
  standing: boolean
  via: string
}): string {
  const ask =
    receipt.ask && receipt.ask.length > TWEET_ASK_MAX
      ? `${receipt.ask.slice(0, TWEET_ASK_MAX - 1).trimEnd()}…`
      : receipt.ask
  const text = receipt.standing
    ? `${receipt.headline} — set up in one sentence on @yeetful_ai. It runs whether I'm at the keyboard or not. Receipt:`
    : ask
      ? `"${ask}" → built, guarded, signed on @yeetful_ai. Receipt:`
      : `${receipt.headline} — built, guarded, signed on @yeetful_ai. Receipt:`
  const params = new URLSearchParams({ text, url: shareReceiptUrl(receipt.id, receipt.via) })
  return `https://twitter.com/intent/tweet?${params.toString()}`
}
