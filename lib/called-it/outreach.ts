// The outreach kit (squad called-gtm, lane OUTREACH, 2026-11-16). Pure.
//
// Nate messages an account that was scanned, by hand, with ONE link: the
// call it got right (gtm callHref). This file writes what he sends, from a
// BoardEntry and nothing else: the link, the card image's address, and three
// drafts (a reply to the original post, a DM, a standalone post). NOTHING
// HERE SENDS ANYTHING: the desk shows the drafts, a Copy button and X's own
// composer (an intent link), and he presses send himself.
//
// Honesty (README rule 1, carried into words):
//   - every number, date and verdict comes from the entry (the record's own
//     words: the headline's tally, the best call's move line, VERDICT_WORDS);
//   - every text says "hits and misses" and carries the record's tally, or at
//     least links the full record (the link IS the record page);
//   - the word "verified" (any form) appears only when entry.verified;
//   - an entry with no hit gets no kit: a miss is never dressed as a highlight.
//
// X's weight: a link counts 23 whatever its length; an ASCII character 1;
// anything else 2 (CJK and emoji weigh 2 on X; counting every non-ASCII
// character as 2 can only over-count, never run over). Every text fits 280.
import { X_LINK_WEIGHT, X_POST_MAX, maskAddresses } from '@/lib/share-posts'
import { fmtDay } from './spec'
import { CALL_PARAM, callHref, type BoardEntry } from './gtm'

/**
 * The arrival tag on every outreach link. lib/journey lifts utm_source,
 * utm_medium and utm_campaign from the landing address into
 * visitor_events.utm; nothing else is read. No person is named in it.
 */
export const OUTREACH_TAG: Readonly<Record<string, string>> = { utm_source: 'x', utm_medium: 'outreach', utm_campaign: 'called-it' }

export type OutreachKind = 'reply' | 'dm' | 'post'

export interface OutreachText {
  kind: OutreachKind
  /** What the desk calls it. */
  label: string
  text: string
  /** X's weighted length (the link counted as 23). */
  weight: number
}

export interface OutreachKit {
  handle: string
  symbol: string
  /** The post the best call came from: what the reply answers. */
  postId: string
  /** The link Nate sends, absolute, tagged. */
  link: string
  /** The same page on this server, untagged, for opening from the desk. */
  path: string
  /** The card of that one call (lane CALL's param contract), absolute. */
  imageUrl: string
  /** The same image on this server, for the desk's preview. */
  imagePath: string
  reply: OutreachText
  dm: OutreachText
  post: OutreachText
  /** X's composer, a reply to the original post, prefilled with `reply`. */
  replyIntent: string
  /** X's composer, a new post, prefilled with `post`. */
  postIntent: string
}

const URL_RE = /https?:\/\/\S+/g

/** X's weighted length of a text that carries its links inline. */
export function xWeight(text: string): number {
  let n = 0
  const bare = text.replace(URL_RE, () => {
    n += X_LINK_WEIGHT
    return ''
  })
  for (const ch of bare) n += ch.codePointAt(0)! <= 0x7e ? 1 : 2
  return n
}

/** The fullest variant that fits X's 280; the last one whatever it weighs (it is the shortest we write). */
export function fitX(variants: readonly string[]): string {
  return variants.find((t) => xWeight(t) <= X_POST_MAX) ?? variants[variants.length - 1]
}

/** `$BTC` where X draws a cashtag; the plain symbol where it would not. */
function ticker(symbol: string): string {
  const s = symbol.toUpperCase()
  return /^[A-Z]{1,6}$/.test(s) ? `$${s}` : s
}

/** The tally half of the record's headline: "8 calls, 1 called it, 4 missed, 2 no real move." */
export function tallyWords(headline: string): string {
  const cut = headline.indexOf(': ')
  return (cut < 0 ? headline : headline.slice(cut + 2)).trim()
}

/** A quote that can travel: masked, one line, straight quotes swapped, cut on a character budget. */
function quoteOf(text: string, max: number): string {
  const one = maskAddresses(text).replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, ' ').replace(/\s+/g, ' ').replace(/"/g, "'").trim().replace(/\.+$/, '')
  if ([...one].length <= max) return one
  return `${[...one].slice(0, max - 1).join('').trimEnd()}...`
}

/** Append the outreach tag to an absolute link. */
export function taggedLink(url: string): string {
  const q = new URLSearchParams(OUTREACH_TAG as Record<string, string>).toString()
  return `${url}${url.includes('?') ? '&' : '?'}${q}`
}

/** X's composer as a reply to one post. `text` carries its link inline. */
export function replyIntentHref(postId: string, text: string): string {
  return `https://x.com/intent/post?${new URLSearchParams({ in_reply_to: postId, text }).toString()}`
}

/** X's composer, a new post. */
export function postIntentHref(text: string): string {
  return `https://x.com/intent/post?${new URLSearchParams({ text }).toString()}`
}

/** Why an entry gets no kit, in words. Null when it gets one. */
export function noKitReason(entry: Pick<BoardEntry, 'best' | 'tally'>): string | null {
  if (entry.best) return null
  if (entry.tally.total === 0) return 'The scan found no calls, so there is nothing to send.'
  if (entry.tally.right === 0) return `No call in this record reads "called it" yet (${entry.tally.wrong} missed, ${entry.tally.flat} no real move, ${entry.tally.open} too early to say). Lead with nothing; the record stands as it is.`
  return 'No scanned call reads "called it". A post a viewer added is never a highlight.'
}

/**
 * The kit for one board entry, or null when the record has no hit. `origin`
 * is the public origin the link and the image are written on (SITE_URL on
 * the desk), no trailing slash.
 */
export function outreachKit(entry: BoardEntry, origin: string): OutreachKit | null {
  const best = entry.best
  if (!best) return null
  const base = origin.replace(/\/+$/, '')
  const sym = entry.symbol.toUpperCase()
  const handle = entry.handle
  const path = callHref(handle, sym, best.postId)
  const link = taggedLink(`${base}${path}`)
  const imagePath = `/api/og/called?${new URLSearchParams({ handle, sym, [CALL_PARAM]: best.postId }).toString()}`
  const t = ticker(sym)
  const day = fmtDay(best.postedAt)
  const tally = tallyWords(entry.headline).replace(/\.$/, '')
  const verdict = best.verdictWords
  const move = best.move
  const mine = entry.verified ? ' The record shows as verified.' : ' If the account is yours, sign in with X on that page to mark the record as yours.'
  const v = `"${verdict}"`

  // The reply: under their own post, so the post itself is the quote.
  const reply = fitX([
    `This one aged well. ${t}, ${day}: ${v}, ${move}. Your full record on the chart, hits and misses (${tally}): ${link}`,
    `This one aged well. ${t}, ${day}: ${v}, ${move}. Your full record on the chart, hits and misses: ${link}`,
    `${t}, ${day}: ${v}. Your full record, hits and misses: ${link}`,
  ])

  // The DM: who is writing, the one call, the whole record.
  const dm = fitX([
    `Hi @${handle}, Nate from Pantessa here. We judged your public ${t} calls on the chart. Your call of ${day} reads ${v}: ${move}. The full record, hits and misses (${tally}): ${link}${mine}`,
    `Hi @${handle}, Nate from Pantessa here. Your ${t} call of ${day} reads ${v}: ${move}. The full record, hits and misses (${tally}): ${link}${mine}`,
    `Hi @${handle}, Nate from Pantessa here. Your ${t} call of ${day} reads ${v}: ${move}. The full record, hits and misses (${tally}): ${link}`,
    `Hi @${handle}, your ${t} call of ${day} reads ${v}. The full record, hits and misses: ${link}`,
  ])

  // The standalone post: the ticker first (never an @mention first: X files that as a reply).
  const q = (n: number) => quoteOf(best.quote || best.text, n)
  const post = fitX([
    `${t}, ${day}: @${handle} posted "${q(100)}". It reads ${v}: ${move}. The full record, hits and misses (${tally}): ${link}`,
    `${t}, ${day}: @${handle} posted "${q(50)}". It reads ${v}: ${move}. The full record, hits and misses (${tally}): ${link}`,
    `${t}, ${day}: @${handle}'s call reads ${v}, ${move}. The full record, hits and misses (${tally}): ${link}`,
    `${t}, ${day}: @${handle}'s call reads ${v}. The full record, hits and misses: ${link}`,
  ])

  const text = (kind: OutreachKind, label: string, s: string): OutreachText => ({ kind, label, text: s, weight: xWeight(s) })
  return {
    handle,
    symbol: sym,
    postId: best.postId,
    link,
    path,
    imageUrl: `${base}${imagePath}`,
    imagePath,
    reply: text('reply', 'Reply to their post', reply),
    dm: text('dm', 'Direct message', dm),
    post: text('post', 'Post that mentions them', post),
    replyIntent: replyIntentHref(best.postId, reply),
    postIntent: postIntentHref(post),
  }
}

/** Contact status on the desk. Kept in the viewer's own browser only. */
export const OUTREACH_STATUSES = ['not contacted', 'sent', 'replied', 'verified'] as const
export type OutreachStatus = (typeof OUTREACH_STATUSES)[number]
export const OUTREACH_STATUS_KEY = 'pantessa.outreach.status.v1'

/** One row of the desk: an entry, its kit, or why it has none (GET /api/admin/outreach). */
export interface OutreachRow {
  entry: BoardEntry
  kit: OutreachKit | null
  /** Why there is no kit, in words. Null when there is one. */
  reason: string | null
}

export interface OutreachResponse {
  rows: OutreachRow[]
  failed: boolean
  /** Distinct handles on the board, and how many of them have at least one hit / are verified. */
  counts: { accounts: number; records: number; withHit: number; verified: number }
  origin: string
}

