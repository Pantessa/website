// lib/share-posts.ts — the words and the address of every share (pure; no
// React, no node builtins, so the pins and the client both import it).
//
// One rulebook for a pre-written post, wherever it is composed:
//   · never an @mention first (X files a post that opens with one as a
//     reply and shows it to far fewer people); the account is named once,
//     from lib/social, inside the sentence.
//   · a ticker leads as a cashtag, once.
//   · no hashtags; one link, last (the `url` param), so the card draws
//     under the text.
//   · a user's own words are quoted and cut to a budget, never rewritten;
//     anything address-shaped in them is masked before it leaves.
//
// The sharer's `via` id (a one-way hash of their wallet, lib/share-receipts
// viaIdOf) rides on the link so an arrival can be traced back to the share.
// It is analytics today (wallet_arrivals); creator earnings follow an intent
// link (/i/<slug>), which carries its creator in the link itself.

import { X_MENTION } from '@/lib/social'
import { SITE_URL, absoluteUrl } from '@/lib/site-url'
import { MARKETS_HREF } from '@/lib/markets'

/** ?via= values the door accepts (mirrors lib/share-receipts VIA_RE). */
export const SHARE_VIA_RE = /^[a-z0-9]{4,16}$/

/** The salt of the sharer id — the same string lib/share-receipts hashes. */
export const VIA_SALT = 'yeetful-via-1'

/** The sharer id, computed where there is no node:crypto (the browser; also
 *  any runtime with WebCrypto). The twin of lib/share-receipts viaIdOf,
 *  pinned equal in scripts/gtm-share-pins.ts. */
export async function viaIdOfBrowser(wallet: string): Promise<string | null> {
  try {
    const bytes = new TextEncoder().encode(`${VIA_SALT}|${wallet.toLowerCase()}`)
    const hash = await crypto.subtle.digest('SHA-256', bytes)
    return Array.from(new Uint8Array(hash))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('')
      .slice(0, 10)
  } catch {
    return null
  }
}

/** What a post may quote of somebody's sentence. */
export const POST_QUOTE_MAX = 160

/** 0x1234…abcd for anything address-shaped inside free text. */
export function maskAddresses(text: string): string {
  return text.replace(/0x[a-fA-F0-9]{40}\b/g, (a) => `${a.slice(0, 6)}…${a.slice(-4)}`).replace(/0x[a-fA-F0-9]{64}\b/g, (h) => `${h.slice(0, 10)}…`)
}

/** A quoted sentence that fits a post: masked, one line, cut on the budget. */
export function quoteForPost(text: string, max = POST_QUOTE_MAX): string {
  const one = maskAddresses(text).replace(/\s+/g, ' ').trim()
  return one.length > max ? `${one.slice(0, max - 1).trimEnd()}…` : one
}

/** Append the sharer's id to one of OUR links. Leaves anything else alone:
 *  a foreign origin, a malformed id, or a link that already carries one. */
export function withVia(url: string, via: string | null | undefined): string {
  if (!via || !SHARE_VIA_RE.test(via)) return url
  const own = url.startsWith('/') || url.startsWith(`${SITE_URL}/`) || url === SITE_URL
  const local = /^https?:\/\/(localhost|127\.0\.0\.1)(:\d+)?(\/|$)/.test(url)
  if (!own && !local) return url
  if (/[?&]via=/.test(url)) return url
  const [base, hash = ''] = url.split('#')
  return `${base}${base.includes('?') ? '&' : '?'}via=${via}${hash ? `#${hash}` : ''}`
}

/** X's composer, prefilled. `text` never contains the link. */
export function xIntentHref(text: string, url: string): string {
  return `https://twitter.com/intent/tweet?${new URLSearchParams({ text, url }).toString()}`
}

export interface SharePost {
  /** The page being shared (absolute). */
  url: string
  /** The share sheet's title line. */
  title: string
  /** The pre-written post, link excluded. */
  text: string
}

const pct = (n: number) => `${n > 0 ? '+' : ''}${n.toFixed(2)}%`

/** A symbol page. The move rides along when the caller has a live quote. */
export function symbolPost(symbol: string, opts?: { name?: string; changePct?: number | null }): SharePost {
  const sym = symbol.toUpperCase()
  const move = typeof opts?.changePct === 'number' && Number.isFinite(opts.changePct) ? ` ${pct(opts.changePct)} today.` : ''
  return {
    url: absoluteUrl(`/t/${sym}`),
    title: `${sym}${opts?.name && opts.name.toUpperCase() !== sym ? ` · ${opts.name}` : ''} on Pantessa`,
    text: `$${sym}${move} Live chart, and the chart is the order form. Via ${X_MENTION}:`,
  }
}

/** The markets index. */
export function marketsPost(): SharePost {
  return {
    url: absoluteUrl(MARKETS_HREF),
    title: 'Pantessa Markets',
    text: `Stocks 24/7, crypto and perps on one board, and every row is an order form. Watchlists and alerts are free. Via ${X_MENTION}:`,
  }
}

/** The read (2026-11-09): the home's own sentence about the market (lib/read
 *  readHeadlineText), ready to post — the line leads, as it was composed. */
export function readPost(line: string): SharePost {
  return {
    url: absoluteUrl(MARKETS_HREF),
    title: 'The read on Pantessa',
    text: `${line}\n\nThe market in one sentence, and every word is a button. Via ${X_MENTION}:`,
  }
}

/** A public watchlist. Up to four tickers lead as cashtags. */
export function listPost(list: { slug: string; name: string; symbols: string[] }): SharePost {
  const tags = list.symbols.slice(0, 4).map((s) => `$${s.toUpperCase()}`)
  const more = list.symbols.length - tags.length
  const lead = tags.length ? `${tags.join(' ')}${more > 0 ? ` +${more}` : ''}\n\n` : ''
  return {
    url: absoluteUrl(`/lists/${list.slug}`),
    title: `${list.name} — a Pantessa watchlist`,
    text: `${lead}"${quoteForPost(list.name, 80)}", a watchlist you can follow in one tap. Live quotes, every row trades. Via ${X_MENTION}:`,
  }
}

/** An intent link: the ask is the post. */
export function intentLinkPost(link: { slug: string; ask: string }): SharePost {
  return {
    url: absoluteUrl(`/i/${link.slug}`),
    title: quoteForPost(link.ask, 90),
    text: `"${quoteForPost(link.ask)}"\n\nTap it, connect a wallet, sign. Built and guarded by ${X_MENTION}:`,
  }
}

/** A creator's page of links. */
export function creatorPagePost(handle: string, brandName?: string | null): SharePost {
  return {
    url: absoluteUrl(`/l/${handle}`),
    title: `${brandName ?? `@${handle}`} on Pantessa`,
    text: `Links that move money, from ${brandName ?? handle}. Tap one, connect a wallet, sign. Via ${X_MENTION}:`,
  }
}

/** The front door. */
export function sitePost(): SharePost {
  return {
    url: SITE_URL,
    title: 'Pantessa — the chart that executes',
    text: `The chart that executes: stocks 24/7, crypto and perps, and you trade from the chart with your own wallet. ${X_MENTION}:`,
  }
}

/** The post's X href, with the sharer's id on the link. */
export function postHref(post: SharePost, via?: string | null): string {
  return xIntentHref(post.text, withVia(post.url, via))
}

/** An intent link named by its path ("/i/abc"), its URL, or its slug. */
export function intentLinkPostAt(ask: string, pathOrSlug: string): SharePost {
  const slug = pathOrSlug.replace(/^https?:\/\/[^/]+/, '').replace(/^\/?i\//, '').replace(/[?#].*$/, '')
  return intentLinkPost({ slug, ask })
}

/** The X post for an intent link. */
export function intentLinkXHref(ask: string, pathOrSlug: string, via?: string | null): string {
  return postHref(intentLinkPostAt(ask, pathOrSlug), via)
}

/** The X post for a creator page. */
export function creatorPageXHref(handle: string, brandName?: string | null): string {
  return postHref(creatorPagePost(handle, brandName))
}

/** How many of a list's rows its social card draws (the board holds nine
 *  43px rows), and how many it says follow. */
export const LIST_CARD_ROWS = 9
export function listCardRows(symbols: string[]): { rows: string[]; more: number } {
  const rows = symbols.slice(0, LIST_CARD_ROWS)
  return { rows, more: Math.max(0, symbols.length - rows.length) }
}

// ── Called it (squad called-it, 2026-11-11, lane RECORD) ──────────────────
// The post for one record: an X handle's calls on one market, pinned to the
// days they were posted (lib/called-it). The house rules above hold: the
// ticker leads as a cashtag, the handle is tagged INSIDE the sentence (a post
// that opens with an @mention is filed as a reply), no hashtags, one link,
// last. Three more, from the squad's honesty rules:
//   · the tally is the record's own words (the headline's second half: every
//     call found, in numbers, never a pick of them);
//   · the standing line is the record's own ("Not verified…" for a plot of
//     somebody else, "Verified…" only for the account itself);
//   · everything is ASCII, one line, and fits X's 280 with the link counted
//     as X counts it (23). A long symbol or a five-digit tally drops the
//     closing sentence, then the standing line's second half, before it would
//     ever run over.

/** What a called-it post is written from: a CalledRecord (lib/called-it/spec) has all four. */
export interface CalledPostInput {
  handle: string
  symbol: string
  side: 'all' | 'bull' | 'bear'
  words: { headline: string; standing: string }
}

/** X's limit, and what X charges a link whatever its length. */
export const X_POST_MAX = 280
export const X_LINK_WEIGHT = 23

/** What a prefilled post weighs on X: the text, one space, the link. (ASCII text: one per character.) */
export function xPostWeight(text: string): number {
  return text.length + 1 + X_LINK_WEIGHT
}

/** Printable ASCII, one line: what a share intent may receive. */
export const SHARE_ASCII_RE = /^[\x20-\x7e]*$/

/** `$BTC` where X draws a cashtag (one to six letters); the plain symbol where it would not. */
function calledTicker(symbol: string): string {
  return /^[A-Z]{1,6}$/.test(symbol) ? `$${symbol}` : symbol
}

/** The tally half of the record's headline: "10 calls, 5 called it, 3 missed." */
function calledTally(record: CalledPostInput): string {
  const cut = record.words.headline.indexOf(': ')
  return cut < 0 ? record.words.headline : record.words.headline.slice(cut + 2)
}

/** The fullest of `variants` that fits a post; the last one whatever it weighs (it is the shortest we write). */
function fitPost(variants: string[]): string {
  return variants.find((t) => xPostWeight(t) <= X_POST_MAX) ?? variants[variants.length - 1]
}

function calledUrl(record: CalledPostInput): string {
  return absoluteUrl(`/x/${record.handle}/${encodeURIComponent(record.symbol.toUpperCase())}${record.side === 'all' ? '' : `?side=${record.side}`}`)
}

/** Somebody else's handle: their calls on a market, the tally in numbers, "Not verified", the link. */
export function calledPost(record: CalledPostInput): SharePost {
  const lean = record.side === 'bull' ? 'Bullish ' : record.side === 'bear' ? 'Bearish ' : ''
  const lead = `${lean}${calledTicker(record.symbol.toUpperCase())} calls by @${record.handle}, each pinned to the day it was posted: ${calledTally(record)}`
  const standing = record.words.standing
  const short = `${standing.split('. ')[0].replace(/\.$/, '')}.`
  const close = `Plot any handle with ${X_MENTION}:`
  return {
    url: calledUrl(record),
    title: record.words.headline,
    text: fitPost([`${lead} ${standing} ${close}`, `${lead} ${short} ${close}`, `${lead} ${short}`, lead]),
  }
}

/** The account's own record, signed in with X: first person, the same tally, "Verified", the link. */
export function myCalledPost(record: CalledPostInput): SharePost {
  const lean = record.side === 'bull' ? 'bullish ' : record.side === 'bear' ? 'bearish ' : ''
  const lead = `My ${lean}${calledTicker(record.symbol.toUpperCase())} calls, each pinned to the day I posted it: ${calledTally(record)}`
  const standing = record.words.standing
  const close = `Plot yours with ${X_MENTION}:`
  return {
    url: calledUrl(record),
    title: record.words.headline,
    text: fitPost([`${lead} ${standing} ${close}`, `${lead} ${standing}`, lead]),
  }
}
