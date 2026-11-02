// lib/broker-origin.ts — PROVENANCE on the desk: where an intent was born.
//
// An agent that read something before it asked (a Dune query, a feed row,
// a chart) can say so when it opens the intent: `origin: { feed, ref?,
// market?, surface? }`. The desk stores it on the intent, echoes it from
// every desk answer (open · choose · handoff · send · status), and the sign
// link and the public track record show it as one line — "Born from Dune ·
// query 5551234 · USDC/WETH on Base". It is the first brick of the joint
// number with a data partner: trades born from THEIR read, signed through
// OUR guarded path.
//
// Two rules carry this, and this module is the only place they are written:
//   1. CLIENT-CLAIMED evidence. The desk cannot verify that the agent read
//      the query it names. The origin is displayed and counted, and nothing
//      else: it never routes, prices, funds, or authorizes a build, and no
//      reader may act on another person's rows because of it.
//   2. Printable text only, bounded. Every string loses its control and
//      format characters, collapses its whitespace, and is cut at
//      ORIGIN_TEXT_MAX. A `ref` carrying transaction material (a 64+ hex
//      run — a hash, calldata, a signature) is refused by name at the door,
//      because the desk's outbound leak check (lib/broker assertNoTxMaterial)
//      would refuse to answer with it anyway, and "your origin looked like
//      calldata" is the honest reason.
//
// Pure: no I/O, no Prisma. The MCP layer validates the SAME shape with zod
// first (max lengths refuse there); this module is the defense a REST caller
// or a DB row read back still passes through.

export const ORIGIN_FEEDS = ['dune', 'hyperliquid', 'other'] as const
export type OriginFeed = (typeof ORIGIN_FEEDS)[number]

export interface BrokerOrigin {
  /** Who the agent read. `other` names the source in `surface`. */
  feed: OriginFeed
  /** What it read: a Dune query id, an execution id (ULID), a dashboard URL, a feed row. */
  ref?: string
  /** The market the read was about ("USDC/WETH on Base", "HYPE perp"). */
  market?: string
  /** Where the agent saw it (a client, a page, a dashboard name). */
  surface?: string
}

/** Each origin string is cut here. Mirrors the zod `.max(120)` on the desk MCP. */
export const ORIGIN_TEXT_MAX = 120

/** The words a surface prints for a feed. Lettered — no partner mark exists on file. */
export const ORIGIN_FEED_LABEL: Record<OriginFeed, string> = {
  dune: 'Dune',
  hyperliquid: 'Hyperliquid',
  other: 'a feed',
}

/** 64+ hex = a hash, calldata or a signature — the same line lib/broker draws. */
const TX_MATERIAL_RE = /0x[0-9a-fA-F]{64,}/

export function isOriginFeed(v: unknown): v is OriginFeed {
  return typeof v === 'string' && (ORIGIN_FEEDS as readonly string[]).includes(v)
}

/** Printable text, bounded: control/format/surrogate/private-use characters
 *  dropped, whitespace collapsed, trimmed, cut at ORIGIN_TEXT_MAX. Empty → null. */
export function cleanOriginText(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const s = raw
    .replace(/\p{C}/gu, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, ORIGIN_TEXT_MAX)
    .trim()
  return s || null
}

function fieldLooksLikeTxMaterial(s: string | null): boolean {
  return !!s && TX_MATERIAL_RE.test(s)
}

/**
 * The door: turn an agent's `origin` argument into a stored BrokerOrigin.
 * Absent/empty → null (no origin). A non-object, an unknown feed, or a field
 * carrying transaction material → a named Error (the MCP answer the agent
 * reads). Strings are cleaned, never trusted.
 */
export function cleanOrigin(raw: unknown): BrokerOrigin | null {
  if (raw == null || raw === '') return null
  if (typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('origin must be an object: { feed: "dune" | "hyperliquid" | "other", ref?, market?, surface? }.')
  }
  const o = raw as Record<string, unknown>
  if (!isOriginFeed(o.feed)) {
    throw new Error(`origin.feed must be one of ${ORIGIN_FEEDS.join(', ')}.`)
  }
  const ref = cleanOriginText(o.ref)
  const market = cleanOriginText(o.market)
  const surface = cleanOriginText(o.surface)
  for (const [k, v] of [['ref', ref], ['market', market], ['surface', surface]] as const) {
    if (fieldLooksLikeTxMaterial(v)) {
      throw new Error(`origin.${k} looks like transaction material (a 64+ hex run). Name the query, execution, or page you read — never a hash, calldata, or a signature.`)
    }
  }
  return {
    feed: o.feed,
    ...(ref ? { ref } : {}),
    ...(market ? { market } : {}),
    ...(surface ? { surface } : {}),
  }
}

/** A stored row read back for DISPLAY: the same cleaning, but a malformed
 *  value is simply no origin — a reader never throws over provenance. */
export function readOrigin(raw: unknown): BrokerOrigin | null {
  try {
    return cleanOrigin(raw)
  } catch {
    return null
  }
}

const DIGITS_RE = /^\d{1,16}$/
const ULID_RE = /^[0-9A-HJKMNP-TV-Z]{26}$/
const REF_SHOWN_MAX = 48

/** The ref, worded: a bare number is a Dune query id, a ULID is an execution. */
export function originRefWords(origin: Pick<BrokerOrigin, 'feed' | 'ref'>): string | null {
  const ref = origin.ref
  if (!ref) return null
  if (origin.feed === 'dune' && DIGITS_RE.test(ref)) return `query ${ref}`
  if (origin.feed === 'dune' && ULID_RE.test(ref)) return `execution ${ref}`
  return ref.length > REF_SHOWN_MAX ? `${ref.slice(0, REF_SHOWN_MAX - 1)}…` : ref
}

/** One line for a page: "Born from Dune · query 5551234 · USDC/WETH on Base". */
export function originLine(origin: BrokerOrigin): string {
  const who = origin.feed === 'other' && origin.surface ? origin.surface : ORIGIN_FEED_LABEL[origin.feed]
  return [`Born from ${who}`, originRefWords(origin), origin.market].filter((p): p is string => !!p).join(' · ')
}
