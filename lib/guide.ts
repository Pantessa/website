// THE GUIDE — how the app teaches itself as a visitor moves (squad
// front-door, 2026-10-06, Nate: "educate the user about links, the AI
// driven bits as they move through the app … pull the user to see jobs,
// links, wallet as they go"). GUIDE lane owns this file: the hints, where
// each may show, what has to have happened first, the storage record and
// the journey events. Pure: no DOM at import time, so the harness pins it.
//
// The shape of it: ONE card, ONE rule module, five seats (`/`, `/t`, `/live`,
// `/chat`, `/wallet`). A seat asks `pickHintForLoad(surface, ctx)` once when
// it mounts and shows what comes back, or nothing. The rules:
//   · one hint per surface per page load (a remount shows the same one and
//     counts it once);
//   · a hint shows at most twice, ever; a dismissed hint never returns;
//     "Don't show tips" ends the guide;
//   · a dismiss quiets THAT surface for GUIDE_QUIET_MS, so a reload right
//     after never swaps a fresh card into the hole the old one left;
//   · a hint's `requires` reads what this browser has done — tapped a chip,
//     connected a wallet, asked something, been here before.
// Honesty (README §5): a hint says only what CAN happen, never that
// something did; every fee figure is derived from lib/fees, never typed;
// nothing a hint says may be false on this machine or in prod.
//
// The spine's JOBS · LINKS · WALLET seats wear a small dot until each place
// has been visited once (`dotFor`). The record lives in localStorage under
// GUIDE_STORAGE_KEY and tolerates garbage: a corrupt record reads as fresh.

import { CREATOR_FEE_SPLIT, LINK_FEE_PCT } from '@/lib/fees'
import { LINKS_STUDIO_HREF } from '@/lib/links-href'
import { WALLET_PAGE_HREF } from '@/lib/wallet-page'

/** The surfaces a hint can sit on. */
export type GuideSurface = 'home' | 'symbol' | 'live' | 'chat' | 'wallet'

/** Per-browser memory of what the guide has shown (localStorage). */
export const GUIDE_STORAGE_KEY = 'pantessa.guide.v1'

/** Places the record remembers a visit to: the five seats, plus the two
 *  drawer destinations the spine dots point at (JOBS and LINKS are tabs of
 *  /chat, not pages; WALLET is the wallet surface itself). */
export type GuideVisit = GuideSurface | 'jobs' | 'links'

/** The spine seats that wear the unseen-dot. */
export type GuideDotTab = 'jobs' | 'links' | 'wallet'

export const GUIDE_SURFACES: readonly GuideSurface[] = ['home', 'symbol', 'live', 'chat', 'wallet']
export const GUIDE_VISITS: readonly GuideVisit[] = [...GUIDE_SURFACES, 'jobs', 'links']

/** After a dismiss, the surface it happened on stays quiet this long. */
export const GUIDE_QUIET_MS = 10 * 60_000

/** How often one hint may be shown before it retires on its own. */
export const GUIDE_MAX_SHOWS = 2

export type GuideHintId = 'pulse' | 'chart' | 'triggers' | 'links' | 'jobs' | 'wallet' | 'alerts'

/** What the seat knows that the record does not: where it is, which symbol
 *  (the chart hint names it), the example ask the page's own grammar
 *  composes, and whether a wallet is connected right now. */
export interface GuideCtx {
  surface?: GuideSurface
  symbol?: string | null
  /** The symbol page's own "buy" sentence for this pair (lib/trade-asks
   *  composeAsk) — the chart hint quotes it, so the example is always a
   *  sentence the ladder builds. */
  ask?: string | null
  connected?: boolean
}

/** What the card's one action does. `href` is a plain link (a public page);
 *  `spine` is a link INTO the signed-in app (rendered through SpineLink, so a
 *  stranger meets the door); `door` opens the ask door with a DRAFT (on /t
 *  that is Ask the chart's composer — nothing fires); `ask` SENDS a sentence
 *  through the connect-to-act door (the chip-send contract; the wallet
 *  signature is the gate); `scroll` brings a selector into view. */
export type GuideCtaKind = 'href' | 'spine' | 'door' | 'ask' | 'scroll'

export interface GuideCta {
  label: string
  kind: GuideCtaKind
  value: string
}

export interface GuideHint {
  id: GuideHintId
  surfaces: readonly GuideSurface[]
  /** `{SYM}` and `{ASK}` are filled from the ctx at render (renderGuideText). */
  title: string
  body: string
  cta?: GuideCta | ((ctx: GuideCtx) => GuideCta | null)
  /** What must have happened first. Absent = nothing. */
  requires?: (state: GuideState, ctx: GuideCtx & { surface: GuideSurface }) => boolean
}

export interface GuideState {
  v: 1
  /** Times shown + the last time, per hint. */
  seen: Partial<Record<GuideHintId, { n: number; at: number }>>
  /** When each hint was dismissed (Got it, or its CTA used). */
  dismissed: Partial<Record<GuideHintId, number>>
  /** "Don't show tips." */
  off: boolean
  /** First visit to each place. */
  visited: Partial<Record<GuideVisit, number>>
  /** What this browser has done. */
  acted: { chip?: number; connected?: number; asked?: number }
  /** The last dismiss on each surface (the quiet rule). */
  quiet: Partial<Record<GuideSurface, number>>
}

export type GuideEvent = 'chip' | 'connected' | 'asked' | `visited:${GuideVisit}`

export type GuideOutcome = 'shown' | 'cta' | 'dismissed' | 'off'

// ── The words ─────────────────────────────────────────────────────────────

/** The creator's share of the fee, said in words when it is a clean
 *  fraction; a percent otherwise. Derived, never typed (lib/fees). */
export const CREATOR_SPLIT_WORD: string =
  CREATOR_FEE_SPLIT === 0.5 ? 'half' : CREATOR_FEE_SPLIT === 0.25 ? 'a quarter' : `${Math.round(CREATOR_FEE_SPLIT * 100)}%`

/** The ordered hints. Order IS priority: on a surface that could show two,
 *  the first wins. Copy rules: only what CAN happen; a sentence offered as
 *  an ask must be one the ladder builds (scripts/guide-pins.ts replays
 *  `{ASK}` for a stock, a coin and a perp); fee numbers come from lib/fees. */
export const GUIDE_HINTS: readonly GuideHint[] = [
  {
    id: 'pulse',
    surfaces: ['home'],
    title: 'Every print is a button.',
    body: 'The live tape is Hyperliquid’s own fills, keyless. Each print carries the sentence that does the same thing — and only your wallet signs it.',
    cta: { label: 'Open the live tape →', kind: 'href', value: '/live' },
  },
  {
    id: 'chart',
    surfaces: ['symbol'],
    title: 'Ask the chart.',
    body: 'Type “{ASK}” or “why is it moving?” — the answer builds the order right here, in a ticket beside the chart.',
    cta: { label: 'Why is {SYM} moving?', kind: 'door', value: 'Why is {SYM} moving?' },
  },
  {
    id: 'triggers',
    surfaces: ['live'],
    title: 'A trigger arms the ask.',
    body: 'Rules on the stream — a big print, one taker, a one-sided minute. A fired event carries the chip; nothing on this page fires on its own.',
    cta: { label: 'See the triggers →', kind: 'scroll', value: '[data-slot="triggers"]' },
  },
  {
    id: 'links',
    surfaces: ['symbol', 'home', 'chat', 'wallet'],
    title: 'Any ask is a link that pays you.',
    body: `Share it. A reader signs it, and you earn ${CREATOR_SPLIT_WORD} of the ${LINK_FEE_PCT} fee on every swap it produces.`,
    // A stranger reads the public board; a connected wallet goes to the
    // studio (through the door — SpineLink — when there is no session).
    cta: (ctx) =>
      ctx.connected ? { label: 'Mint one →', kind: 'spine', value: LINKS_STUDIO_HREF } : { label: 'See how links pay →', kind: 'href', value: '/links' },
    // On the chart and the splash, only after a chip was tapped (or a chart
    // was visited before): the lesson lands once an ask has a face. In the
    // chat and the wallet, any time.
    requires: (s, ctx) => (ctx.surface === 'symbol' || ctx.surface === 'home' ? !!s.acted.chip || (ctx.surface === 'symbol' && !!s.visited.symbol) : true),
  },
  {
    id: 'jobs',
    surfaces: ['chat', 'home', 'symbol', 'wallet'],
    title: 'An ask with “then” is a job.',
    body: 'Fund, wait, buy, protect — one signature per step, and it waits out the bridge for you.',
    cta: { label: 'See your jobs →', kind: 'spine', value: '/chat?tab=jobs' },
    // The chat's seat is the empty state, so "after the first turn" means
    // a browser that has asked before; on the splash and the chart, after a
    // chip; on the wallet page (a connected wallet by definition), any time.
    requires: (s, ctx) => (ctx.surface === 'chat' ? !!s.acted.asked : ctx.surface === 'wallet' ? true : !!s.acted.chip),
  },
  {
    id: 'wallet',
    surfaces: ['home', 'symbol', 'live', 'chat'],
    title: 'One window for every chain.',
    body: 'Balances, gas and what’s stuck, on every chain you hold — each flag with its fix beside it.',
    cta: { label: 'Open your wallet →', kind: 'spine', value: WALLET_PAGE_HREF },
    requires: (s) => !!s.acted.connected,
  },
  {
    id: 'alerts',
    surfaces: ['home', 'symbol'],
    title: 'An alert here can act.',
    body: 'Set a level. When it hits, the alert hands you the chip that does the trade — you sign it, nothing else does.',
    cta: { label: 'Open the watchlist →', kind: 'scroll', value: '.mkt-frame__rail' },
    // The second visit: the seat reads the record BEFORE it writes its own
    // visit, so a visit on file means an earlier page load.
    requires: (s, ctx) => !!s.visited[ctx.surface],
  },
]

export const GUIDE_TOTAL = GUIDE_HINTS.length

export function guideHintById(id: string): GuideHint | null {
  return GUIDE_HINTS.find((h) => h.id === id) ?? null
}

/** 1-based position for the eyebrow (`GUIDE · 3/7`). */
export function guideIndexOf(id: GuideHintId): number {
  return GUIDE_HINTS.findIndex((h) => h.id === id) + 1
}

/** Fill `{SYM}` / `{ASK}`. With no symbol the chart words still read. */
export function renderGuideText(text: string, ctx: GuideCtx = {}): string {
  const sym = ctx.symbol || 'it'
  const ask = ctx.ask || `Buy $25 of ${ctx.symbol || 'ETH'}`
  return text.replace(/\{SYM\}/g, sym).replace(/\{ASK\}/g, ask)
}

/** The hint's action for this ctx, text filled. */
export function guideCta(hint: GuideHint, ctx: GuideCtx = {}): GuideCta | null {
  const raw = typeof hint.cta === 'function' ? hint.cta(ctx) : hint.cta
  if (!raw) return null
  return { ...raw, label: renderGuideText(raw.label, ctx), value: raw.kind === 'door' || raw.kind === 'ask' ? renderGuideText(raw.value, ctx) : raw.value }
}

// ── The record ────────────────────────────────────────────────────────────

export const GUIDE_FRESH: GuideState = Object.freeze({
  v: 1,
  seen: {},
  dismissed: {},
  off: false,
  visited: {},
  acted: {},
  quiet: {},
}) as GuideState

export function freshGuideState(): GuideState {
  return { v: 1, seen: {}, dismissed: {}, off: false, visited: {}, acted: {}, quiet: {} }
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v)
const isStamp = (v: unknown): v is number => typeof v === 'number' && Number.isFinite(v) && v > 0

const HINT_IDS = new Set<string>(GUIDE_HINTS.map((h) => h.id))

/** Parse what localStorage holds. ANY defect — not JSON, wrong version, a
 *  field of the wrong shape — reads as a fresh record rather than a
 *  half-trusted one: a guide that misremembers is worse than one that
 *  forgets. Unknown hint ids and places are dropped, not fatal (a retired
 *  hint must not reset everyone). */
export function readGuideState(raw: string | null | undefined): GuideState {
  if (!raw) return freshGuideState()
  let parsed: unknown
  try {
    parsed = JSON.parse(raw)
  } catch {
    return freshGuideState()
  }
  if (!isObj(parsed) || parsed.v !== 1) return freshGuideState()
  const { seen, dismissed, off, visited, acted, quiet } = parsed
  if (!isObj(seen) || !isObj(dismissed) || typeof off !== 'boolean' || !isObj(visited) || !isObj(acted) || (quiet !== undefined && !isObj(quiet))) return freshGuideState()
  const out = freshGuideState()
  out.off = off
  for (const [k, v] of Object.entries(seen)) {
    if (!HINT_IDS.has(k)) continue
    if (!isObj(v) || typeof v.n !== 'number' || !Number.isInteger(v.n) || v.n < 0 || !isStamp(v.at)) return freshGuideState()
    out.seen[k as GuideHintId] = { n: v.n, at: v.at }
  }
  for (const [k, v] of Object.entries(dismissed)) {
    if (!HINT_IDS.has(k)) continue
    if (!isStamp(v)) return freshGuideState()
    out.dismissed[k as GuideHintId] = v
  }
  for (const [k, v] of Object.entries(visited)) {
    if (!(GUIDE_VISITS as readonly string[]).includes(k)) continue
    if (!isStamp(v)) return freshGuideState()
    out.visited[k as GuideVisit] = v
  }
  for (const k of ['chip', 'connected', 'asked'] as const) {
    const v = acted[k]
    if (v === undefined) continue
    if (!isStamp(v)) return freshGuideState()
    out.acted[k] = v
  }
  if (isObj(quiet)) {
    for (const [k, v] of Object.entries(quiet)) {
      if (!(GUIDE_SURFACES as readonly string[]).includes(k)) continue
      if (!isStamp(v)) return freshGuideState()
      out.quiet[k as GuideSurface] = v
    }
  }
  return out
}

export function serializeGuideState(state: GuideState): string {
  return JSON.stringify(state)
}

// ── Reducers (pure) ───────────────────────────────────────────────────────

export function markShown(state: GuideState, id: GuideHintId, now = Date.now()): GuideState {
  const prev = state.seen[id]
  return { ...state, seen: { ...state.seen, [id]: { n: (prev?.n ?? 0) + 1, at: now } } }
}

export function markDismissed(state: GuideState, id: GuideHintId, surface: GuideSurface | null, now = Date.now()): GuideState {
  return {
    ...state,
    dismissed: { ...state.dismissed, [id]: now },
    quiet: surface ? { ...state.quiet, [surface]: now } : state.quiet,
  }
}

export function markOff(state: GuideState): GuideState {
  return { ...state, off: true }
}

/** A visit or an action, recorded ONCE (the first time is what the rules
 *  read; a later repeat changes nothing, so a poll never rewrites storage). */
export function noteEvent(state: GuideState, event: GuideEvent, now = Date.now()): GuideState {
  if (event.startsWith('visited:')) {
    const place = event.slice('visited:'.length) as GuideVisit
    if (!(GUIDE_VISITS as readonly string[]).includes(place) || state.visited[place]) return state
    return { ...state, visited: { ...state.visited, [place]: now } }
  }
  const kind = event as 'chip' | 'connected' | 'asked'
  if (state.acted[kind]) return state
  return { ...state, acted: { ...state.acted, [kind]: now } }
}

// ── The rules ─────────────────────────────────────────────────────────────

/** The first hint for this surface that may show: not dismissed, shown fewer
 *  than GUIDE_MAX_SHOWS times, its `requires` met, the guide not off, the
 *  surface not quiet after a recent dismiss. */
export function nextHint(surface: GuideSurface, state: GuideState, ctx: GuideCtx = {}, now = Date.now()): GuideHint | null {
  if (state.off) return null
  const quietAt = state.quiet[surface]
  if (quietAt && now - quietAt < GUIDE_QUIET_MS && now >= quietAt) return null
  const full = { ...ctx, surface }
  for (const hint of GUIDE_HINTS) {
    if (!hint.surfaces.includes(surface)) continue
    if (state.dismissed[hint.id]) continue
    if ((state.seen[hint.id]?.n ?? 0) >= GUIDE_MAX_SHOWS) continue
    if (hint.requires && !hint.requires(state, full)) continue
    return hint
  }
  return null
}

/** The spine's unseen-dot: on until the place has been visited once; never
 *  once the guide is off. */
export function dotFor(tab: GuideDotTab, state: GuideState): boolean {
  if (state.off) return false
  return !state.visited[tab]
}

// ── The live record (client) ──────────────────────────────────────────────
// Nothing below touches the DOM at import time. On the server every read is
// the fresh record and every write is a no-op.

let cache: GuideState | null = null
const listeners = new Set<() => void>()
let storageBound = false

function storageRead(): string | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage.getItem(GUIDE_STORAGE_KEY)
  } catch {
    return null
  }
}

function storageWrite(state: GuideState): void {
  try {
    if (typeof window !== 'undefined') window.localStorage.setItem(GUIDE_STORAGE_KEY, serializeGuideState(state))
  } catch {
    /* private mode / blocked storage: the guide forgets on reload, and that is all */
  }
}

/** The current record (cached after the first read). Stable reference
 *  between writes, so useSyncExternalStore can hold it. */
export function getGuideState(): GuideState {
  if (typeof window === 'undefined') return GUIDE_FRESH
  if (!cache) cache = readGuideState(storageRead())
  return cache
}

function notify(): void {
  for (const fn of listeners) {
    try {
      fn()
    } catch {
      /* a listener must never break the others */
    }
  }
}

function commit(next: GuideState): void {
  if (next === cache) return
  cache = next
  storageWrite(next)
  notify()
}

/** Re-render on change: the seats and the spine dots subscribe. Another
 *  tab's write (the `storage` event) is picked up too. */
export function subscribeGuide(fn: () => void): () => void {
  listeners.add(fn)
  if (!storageBound && typeof window !== 'undefined') {
    storageBound = true
    window.addEventListener('storage', (e) => {
      if (e.key !== null && e.key !== GUIDE_STORAGE_KEY) return
      cache = readGuideState(storageRead())
      notify()
    })
  }
  return () => {
    listeners.delete(fn)
  }
}

/** Something happened: a chip tapped (lib/use-connect-to-act `act`), a
 *  wallet connected (a seat saw an address), an ask sent (lib/analytics
 *  chatMessage), a place visited (its seat or spine dot). */
export function noteGuideEvent(event: GuideEvent, now = Date.now()): void {
  if (typeof window === 'undefined') return
  commit(noteEvent(getGuideState(), event, now))
}

export function dismissGuideHint(id: GuideHintId, surface: GuideSurface | null, now = Date.now()): void {
  if (typeof window === 'undefined') return
  commit(markDismissed(getGuideState(), id, surface, now))
}

export function turnGuideOff(): void {
  if (typeof window === 'undefined') return
  commit(markOff(getGuideState()))
}

// One hint per surface per page load. A seat that remounts (the chat's
// empty state comes and goes; a soft navigation returns to the splash) gets
// the same answer and counts nothing twice.
const pickedThisLoad = new Map<GuideSurface, GuideHintId | null>()

/** The seat's one question. `fresh` = this load's first pick for the surface
 *  (the seat reports `shown` on exactly those). */
export function pickHintForLoad(surface: GuideSurface, ctx: GuideCtx = {}, now = Date.now()): { hint: GuideHint | null; fresh: boolean } {
  if (typeof window === 'undefined') return { hint: null, fresh: false }
  if (pickedThisLoad.has(surface)) {
    const id = pickedThisLoad.get(surface)
    return { hint: id ? guideHintById(id) : null, fresh: false }
  }
  const hint = nextHint(surface, getGuideState(), ctx, now)
  pickedThisLoad.set(surface, hint?.id ?? null)
  if (hint) commit(markShown(getGuideState(), hint.id, now))
  return { hint, fresh: !!hint }
}

/** Harness only: forget this load's picks and the cached record. */
export function resetGuideForTests(): void {
  pickedThisLoad.clear()
  cache = null
}
