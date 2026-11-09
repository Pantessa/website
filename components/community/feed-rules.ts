// The feed's pure rules (squad community, lane FEED, 2026-11-09): the words a
// card prints, the trade a reader can copy, and where a share goes. No React,
// no fetch, no DOM: the card, the composer, the share sheet and the pins
// (scripts/community-feed-pins.ts) all read this one file.
//
// Honesty rules that live here:
//   · a trade's FACT line is built from the proof alone (the server re-derived
//     it from a receipt the chain confirmed); the title a poster typed is
//     never part of it, and the word "verified" is printed only behind
//     `isVerified`.
//   · a share's text is plain ASCII, fits X's weighted count with the link,
//     and never opens with an @mention.

import { chartPairFor } from '@/lib/charts'
import { composeExecAsk } from '@/lib/trade-asks'
import { X_MENTION } from '@/lib/social'
import { absoluteUrl } from '@/lib/site-url'
import { explorerTxFor, fmtProofDollars, proofFactLine, proofTagLine, tradeHeadline } from '@/lib/community/proof-words'
import { callPath } from '@/lib/chart-calls'
import { COMMUNITY_SLUG_RE, INVITE_CODE_RE, invitePath, type FeedKind, type FeedPost, type FeedSort, type FeedWindow, type TradeProof, type VideoHost } from '@/lib/community/spec'

// ── the composer's kinds ───────────────────────────────────────────────────

export const COMPOSER_KINDS = [
  { kind: 'idea', label: 'Chart idea' },
  { kind: 'link', label: 'Link' },
  { kind: 'video', label: 'Video' },
  { kind: 'trade', label: 'Trade with proof' },
] as const satisfies readonly { kind: FeedKind; label: string }[]

export const COMPOSER_FOLDED_LINE = 'Share a chart idea, a link, a video or a trade'

export const VIDEO_HOST_NAME: Record<VideoHost, string> = { youtube: 'YouTube', vimeo: 'Vimeo', loom: 'Loom', x: 'X' }
/** The hosts a pasted video URL may come from, in the words the composer prints. */
export const VIDEO_HOSTS_LINE = 'YouTube, Vimeo, Loom and X links work here.'

/** The sandbox a video iframe wears, and the only moment it may mount (after a tap). */
export const VIDEO_IFRAME_SANDBOX = 'allow-scripts allow-same-origin allow-presentation'

// ── the feed's address ─────────────────────────────────────────────────────

export const FEED_SORT_LABEL: Record<FeedSort, string> = { hot: 'Hot', new: 'New', top: 'Top' }
export const FEED_WINDOWS: readonly FeedWindow[] = ['day', 'week', 'all']
export const FEED_WINDOW_LABEL: Record<FeedWindow, string> = { day: 'Today', week: 'This week', all: 'All time' }

export interface FeedQueryInput {
  community?: string
  symbol?: string
  sort: FeedSort
  window?: FeedWindow
  cursor?: string | null
  limit?: number
}

/** GET /api/feed's address for a list. `window` rides only on `top`. */
export function feedHref(q: FeedQueryInput): string {
  const p = new URLSearchParams()
  if (q.community) p.set('community', q.community)
  if (q.symbol) p.set('symbol', q.symbol)
  p.set('sort', q.sort)
  if (q.sort === 'top') p.set('window', q.window ?? 'week')
  if (q.cursor) p.set('cursor', q.cursor)
  if (q.limit) p.set('limit', String(q.limit))
  return `/api/feed?${p.toString()}`
}

/** Every post has one page: the call page (/c/<id>) carries all four kinds. */
export const postPath = (id: string) => callPath(id)

// ── votes ──────────────────────────────────────────────────────────────────

export type Vote = 1 | 0 | -1

/** What a tap does to the caller's vote: the same arrow again clears it. */
export function nextVote(current: Vote, tapped: 1 | -1): Vote {
  return current === tapped ? 0 : tapped
}

/** The score a card shows the instant a vote is tapped (the server's answer replaces it). */
export function optimisticScore(score: number, from: Vote, to: Vote): number {
  return score - from + to
}

/** 1.2k, 14.3k, 1.1m: a score reads at a glance and never widens the column. */
export function fmtScore(n: number): string {
  const a = Math.abs(n)
  if (a < 1000) return String(Math.trunc(n))
  if (a < 1_000_000) return `${(n / 1000).toFixed(a < 10_000 ? 1 : 0).replace(/\.0$/, '')}k`
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, '')}m`
}

/** A vote held for a stranger while the sign-in door is open (sessionStorage, so
 *  the Google lane's full-page return still finds it). Fresh for ten minutes. */
export const HELD_VOTE_KEY = 'pantessa.community.heldVote'
export const HELD_VOTE_TTL_MS = 10 * 60_000
export function heldVoteRecord(postId: string, value: Vote, now: number): string {
  return JSON.stringify({ id: postId, value, at: now })
}
export function takeHeldVote(raw: string | null, postId: string, now: number): Vote | null {
  if (!raw) return null
  try {
    const r = JSON.parse(raw) as { id?: unknown; value?: unknown; at?: unknown }
    if (r.id !== postId || typeof r.at !== 'number' || now - r.at > HELD_VOTE_TTL_MS || now < r.at) return null
    return r.value === 1 || r.value === -1 || r.value === 0 ? r.value : null
  } catch {
    return null
  }
}

// ── a trade, as a fact ─────────────────────────────────────────────────────

/** The ONE gate for the word "verified" on a card. */
export function isVerified(post: Pick<FeedPost, 'proof'>): boolean {
  return post.proof?.verification === 'verified'
}

/** A dollar size a trader reads at a glance: $25, $1,250, $12.5K, $1.2M. */
export function fmtProofUsd(n: number): string {
  const a = Math.abs(n)
  if (a >= 1_000_000) return `$${(n / 1_000_000).toFixed(a >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`
  if (a >= 10_000) return `$${(n / 1000).toFixed(a >= 100_000 ? 0 : 1).replace(/\.0$/, '')}K`
  if (a >= 100) return `$${Math.round(n).toLocaleString('en-US')}`
  return `$${n.toFixed(n % 1 === 0 ? 0 : 2)}`
}

/** The market a proof names: the post's own symbol, else the first side-tagged
 *  symbol on the receipt ("buy:ETH" → ETH). */
export function proofMarket(proof: TradeProof, symbol: string): string {
  if (symbol) return symbol
  const tagged = proof.symbols.find((s) => /^[a-z]+:[A-Za-z0-9.:]{1,16}$/.test(s))
  return tagged ? tagged.split(':').slice(1).join(':') : (proof.symbols[0] ?? '')
}

/**
 * A trade post's two lines (QA-SECURITY S1/S9):
 *   fact  what the chain confirmed — "Verified on-chain: this wallet moved
 *         $25.00 on Base" (or "moved funds on Base" when the size is hidden);
 *   tag   the author's own tag, worded as theirs — "Tagged by the author:
 *         bought ETH" (null when there is none). Never under the verified mark.
 * Nothing the poster typed is in either.
 */
export function tradeFact(proof: TradeProof, _symbol?: string): { fact: string; tag: string | null; size: string | null; chain: string; line: string } {
  const size = typeof proof.sizeUsd === 'number' && Number.isFinite(proof.sizeUsd) && proof.sizeUsd > 0 ? fmtProofDollars(proof.sizeUsd) : null
  const fact = proofFactLine(proof)
  return { fact, tag: proofTagLine(proof), size, chain: proof.chain, line: fact }
}

/** What a reader's copy of the trade costs by default (lib/tape FOLLOW_USD). */
export const SAME_TRADE_USD = 25

/**
 * The sentence that does the same trade, in the composer grammar the chips
 * everywhere else use (lib/trade-asks). null = this market takes no order
 * here, so the card offers no chip. The caller still asks canTradeAsk (and
 * canSellAsk for a sell) before drawing it.
 */
export function sameTradeAsk(proof: TradeProof, symbol: string, usd = SAME_TRADE_USD): { ask: string; label: string } | null {
  if (!proof.side) return null
  const pair = chartPairFor(proofMarket(proof, symbol))
  if (!pair) return null
  const ask = composeExecAsk(pair, proof.side, { usd })
  if (!ask) return null
  return { ask, label: ask }
}

// ── sharing ────────────────────────────────────────────────────────────────

/** Plain ASCII for a share line: typographic punctuation becomes its ASCII
 *  twin, everything else outside printable ASCII is dropped, one line. */
export function asciiLine(text: string): string {
  return text
    .replace(/[‘’‚′]/g, "'")
    .replace(/[“”„″]/g, '"')
    .replace(/[–—−]/g, '-')
    .replace(/…/g, '...')
    .replace(/ /g, ' ')
    .replace(/[^\x20-\x7E]/g, '')
    .replace(/\s+/g, ' ')
    .trim()
}

/** X counts a link as 23 whatever its length, and joins it to the text with one space. */
export const X_LIMIT = 280
export const X_URL_WEIGHT = 23
export const X_TEXT_BUDGET = X_LIMIT - X_URL_WEIGHT - 1

/** X's weighted length of a text (no link in it): the Latin ranges weigh 1, everything else 2. */
export function xWeight(text: string): number {
  let n = 0
  for (const ch of text) {
    const c = ch.codePointAt(0) ?? 0
    n += c <= 0x10ff || (c >= 0x2000 && c <= 0x200d) || (c >= 0x2010 && c <= 0x201f) || (c >= 0x2032 && c <= 0x2037) ? 1 : 2
  }
  return n
}

/** Cut a line so text + link fit one X post. */
export function fitForX(text: string, budget = X_TEXT_BUDGET): string {
  const line = asciiLine(text)
  return line.length <= budget ? line : `${line.slice(0, budget - 3).trimEnd()}...`
}

const X_TAIL = ` Via ${X_MENTION}:`

/** X's composer, prefilled: the line, our name once inside the sentence when
 *  it fits (never first), the link last so the card draws under the text. */
export function xShareHref(text: string, url: string): string {
  const line = fitForX(text, X_TEXT_BUDGET - X_TAIL.length)
  return `https://twitter.com/intent/tweet?${new URLSearchParams({ text: `${line}${X_TAIL}`, url }).toString()}`
}

/** Telegram's share sheet: the link first (Telegram draws its card), the line under it. */
export function telegramShareHref(text: string, url: string): string {
  return `https://t.me/share/url?${new URLSearchParams({ url, text: asciiLine(text) }).toString()}`
}

/** An in-app path or one of our URLs, made absolute on the canonical host. A
 *  foreign URL is left as given (the sheet only ever shares our own pages). */
export function shareUrl(url: string): string {
  return url.startsWith('/') ? absoluteUrl(url) : url
}

/** The room a shared URL names (`/g/<slug>`), when it is one of ours and carries no invite yet. */
export function roomSlugOfUrl(url: string): string | null {
  let path = url
  let search = ''
  try {
    const u = new URL(url, 'https://x.invalid')
    path = u.pathname
    search = u.search
  } catch {
    return null
  }
  const m = path.match(/^\/g\/([^/]+)\/?$/)
  if (!m || !COMMUNITY_SLUG_RE.test(m[1])) return null
  if (new URLSearchParams(search).has('via')) return null
  return m[1]
}

/** The room's link carrying the member's own invite code (unknown or malformed code → the plain room). */
export function roomInviteUrl(slug: string, code: string | null | undefined): string {
  return absoluteUrl(invitePath(slug, code && INVITE_CODE_RE.test(code) ? code : null))
}

/** One line that reads on its own in a chat, for a post. Ticker first as a
 *  cashtag (once), the author's own title, then what stands behind it. */
export function postShareText(post: Pick<FeedPost, 'kind' | 'symbol' | 'title' | 'proof'>): string {
  if (post.kind === 'trade') {
    // T4: a trade leads with what the chain confirmed; the typed title is the author's words.
    const h = tradeHeadline({ title: asciiLine(post.title), proof: post.proof })
    return `${h.headline}.${h.authorWords ? ` ${h.authorWords}` : ''}`
  }
  const title = asciiLine(post.title)
  const sym = post.symbol ? `$${post.symbol}` : ''
  const opens = !!post.symbol && new RegExp(`^\\$?${post.symbol.replace(/[^A-Za-z0-9]/g, '')}\\b`, 'i').test(title)
  const fallback = post.kind === 'video' ? 'A video' : post.kind === 'link' ? 'A link' : 'A chart idea'
  const said = title.length >= 3 ? title : fallback
  const lead = !sym ? said : opens ? `$${said.replace(/^\$/, '')}` : `${sym}: ${said}`
  const stands = post.kind === 'idea' ? ' Time and price stamped.' : ''
  return `${lead}${/[.!?]$/.test(lead) ? '' : '.'}${stands}`
}

// ── a composer you can link to (lane SHARE) ────────────────────────────────
//
// `/community?compose=trade` (also idea, link, video; `&symbol=ETH` pre-picks
// the market) opens the composer on that tab. The same query on a room page
// or a symbol page opens the composer there. The query is read once and then
// stripped from the address bar, so a reload or a copied URL never re-opens it.

export const COMPOSE_PARAM = 'compose'
export const COMPOSE_SYMBOL_PARAM = 'symbol'
const COMPOSE_SYMBOL_RE = /^[A-Za-z0-9.:]{1,24}$/

export interface ComposeQuery {
  kind: FeedKind
  /** '' when the link names no market (or names something that is not one). */
  symbol: string
}

/** The composer a URL asks for, or null. Only the four kinds open it. */
export function readComposeQuery(search: string): ComposeQuery | null {
  const p = new URLSearchParams(search)
  const want = (p.get(COMPOSE_PARAM) ?? '').toLowerCase()
  const k = COMPOSER_KINDS.find((x) => x.kind === want)
  if (!k) return null
  const sym = p.get(COMPOSE_SYMBOL_PARAM) ?? ''
  return { kind: k.kind, symbol: COMPOSE_SYMBOL_RE.test(sym) ? sym : '' }
}

/** The same address without the composer's query (everything else is kept, in order). */
export function stripComposeQuery(pathname: string, search: string, hash = ''): string {
  const p = new URLSearchParams(search)
  p.delete(COMPOSE_PARAM)
  p.delete(COMPOSE_SYMBOL_PARAM)
  const q = p.toString()
  return `${pathname}${q ? `?${q}` : ''}${hash}`
}

/** A link that opens the composer on a tab: the feed's own page, or a room's. */
export function composeHref(kind: FeedKind, opts: { symbol?: string; room?: string } = {}): string {
  const base = opts.room && COMMUNITY_SLUG_RE.test(opts.room) ? `/g/${opts.room}` : '/community'
  const p = new URLSearchParams({ [COMPOSE_PARAM]: kind })
  if (opts.symbol && COMPOSE_SYMBOL_RE.test(opts.symbol)) p.set(COMPOSE_SYMBOL_PARAM, opts.symbol)
  return `${base}?${p.toString()}`
}

/** The trade tab's pre-pick: the ONE fill that is new since the last look
 *  (`seenAt` = the newest fill time listed then; null = never looked). Zero or
 *  several new fills pre-pick nothing: the list reads as it always did. */
export function preselectFill(fills: readonly { turnId: string; signedAt: number }[], seenAt: number | null): string | null {
  const fresh = fills.filter((f) => seenAt == null || f.signedAt > seenAt)
  return fresh.length === 1 ? fresh[0].turnId : null
}

/** The mark the next look compares against: the newest fill time ever listed. */
export function fillsSeenMark(fills: readonly { signedAt: number }[], prev: number | null): number | null {
  let m = prev
  for (const f of fills) if (Number.isFinite(f.signedAt) && (m == null || f.signedAt > m)) m = f.signedAt
  return m
}

export const FILLS_SEEN_KEY = 'pantessa.community.fillsSeenAt'

// ── the receipt's door into the feed (lane SHARE) ──────────────────────────
//
// Right after a signed transaction settles, the receipt row offers "Post it
// with proof". It is offered ONLY when the receipt holds a confirmed
// transaction hash on a chain the proof reader can read (the registry has an
// explorer for it): never for a Hyperliquid order, a CoW order that has not
// settled, or a job step with no transaction. The words promise what the
// proof gives and no more: the post says what the chain confirmed.

export const PROOF_DOOR_LABEL = 'Post it with proof'
export const PROOF_DOOR_TITLE = 'Opens the community composer on your confirmed trades. The post shows what the chain confirmed.'

/** true = at least one of these is a mined transaction the proof reader can locate. */
export function hasProvableTx(txs: readonly { hash?: unknown; chainId?: unknown }[] | null | undefined): boolean {
  return !!txs?.some((t) => typeof t?.hash === 'string' && typeof t?.chainId === 'number' && !!explorerTxFor(t.chainId, t.hash))
}

/** The door's address, or null when the receipt has nothing the chain can prove. */
export function proofDoorHref(txs: readonly { hash?: unknown; chainId?: unknown }[] | null | undefined): string | null {
  return hasProvableTx(txs) ? composeHref('trade') : null
}

/** A done job's confirmed transactions, from its steps' own results. */
export function jobStepTxs(steps: readonly { status?: string; result?: Record<string, unknown> | null }[]): { hash: string; chainId: number }[] {
  const out: { hash: string; chainId: number }[] = []
  for (const s of steps) {
    if (s.status !== 'done' || !s.result) continue
    const txs = (s.result as { txs?: unknown }).txs
    if (!Array.isArray(txs)) continue
    for (const t of txs) {
      const hash = (t as { hash?: unknown } | null)?.hash
      const chainId = (t as { chainId?: unknown } | null)?.chainId
      if (typeof hash === 'string' && typeof chainId === 'number') out.push({ hash, chainId })
    }
  }
  return out
}

// ── the feed by address, and the chart's next step (lane SHARE) ────────────

/** The sort a `/community?sort=` address asks for (null = none named: Hot). */
export function readFeedSort(search: string): FeedSort | null {
  const s = new URLSearchParams(search).get('sort')
  return s === 'hot' || s === 'new' || s === 'top' ? s : null
}

/** Where a just-published call is on top: the feed, newest first. */
export const COMMUNITY_NEW_HREF = '/community?sort=new'
export const CALL_NEXT_LABEL = 'See it in the community'

// ── rooms on the symbol page (lane SHARE) ──────────────────────────────────

export const SYMBOL_ROOMS_LIMIT = 3
/** The strip's one read: the rooms that follow a market, most members first. */
export function symbolRoomsHref(symbol: string, limit = SYMBOL_ROOMS_LIMIT): string {
  return `/api/communities?${new URLSearchParams({ symbol, limit: String(limit) }).toString()}`
}
/** The strip's quiet line when no room follows the market. */
export function noRoomLine(symbol: string): string {
  return `No room follows ${symbol} yet.`
}
