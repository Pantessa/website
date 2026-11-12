'use client'

// The plot on a symbol page, in the browser (squad called-it, lane CHART).
//
// ONE plot per page: a handle, a side and (when the viewer chose their own)
// the pins. It lives in the address (`/t/BTC?x=handle&side=bear&pins=…`), so a
// plot is a link; this store is the page's copy of it, shared by the door on
// the chart's bar, the Calls strip under the chart and the chart itself.
//
//   the address  → parsePlotParams      read after mount and on back / forward
//   the plot     → plotUrl              mirrored with replaceState, the way
//                                       `?tf=` and `?vs=` are (lib/markets)
//   the record   ← GET /api/x/record    one read per handle + side; a pin
//                                       toggle is applied here and costs no read
//
// Pure helpers first (scripts/called-chart-pins holds them); the store and the
// hooks after. Nothing here judges a call or words a verdict: that is
// lib/called-it/spec, and the server's record is the only source of both.

import { useEffect, useRef, useState } from 'react'
import { create } from 'zustand'
import { readTokens } from '@/components/markets/chart/chart-tokens'
import { VERDICT_GLYPH, createCalledPins, type CalledInks, type CalledPinsController } from '@/lib/tv/called-pins'
import { PIN_URL_MAX, POST_ID_RE, VERDICT_WORDS, normalizeHandle, normalizeSide, postRefFromUrl, type CalledRecord, type CalledSide, type RecordResponse } from './spec'

// ── The plot and its address (pure) ─────────────────────────────────────

export interface Plot {
  /** Lowercase, no @. */
  handle: string
  side: CalledSide
  /** The viewer's own pins (post ids). Empty = the rule picks. */
  pins: string[]
}

/** Post ids from a list or a comma-separated string: well-formed, no repeats, at most what a URL may carry. */
export function cleanPins(raw: unknown): string[] {
  const list = Array.isArray(raw) ? raw : typeof raw === 'string' ? raw.split(',') : []
  const out: string[] = []
  for (const id of list) if (typeof id === 'string' && POST_ID_RE.test(id) && !out.includes(id)) out.push(id)
  return out.slice(0, PIN_URL_MAX)
}

/** `?x=handle&side=bear&pins=1,2` → the plot, or null when the address plots nothing (or names no real handle). */
export function parsePlotParams(search: string): Plot | null {
  const q = new URLSearchParams(search)
  const handle = normalizeHandle(q.get('x'))
  if (!handle) return null
  return { handle, side: normalizeSide(q.get('side')), pins: cleanPins(q.get('pins')) }
}

/** The address with the plot set (or cleared), every other param kept in place. `All` and "the rule's pins" are left out. */
export function plotUrl(plot: Plot | null, pathname: string, search: string): string {
  const q = new URLSearchParams(search)
  q.delete('x')
  q.delete('side')
  q.delete('pins')
  if (plot) {
    q.set('x', plot.handle)
    if (plot.side !== 'all') q.set('side', plot.side)
    if (plot.pins.length) q.set('pins', cleanPins(plot.pins).join(','))
  }
  // A comma between ids reads as a list; the encoded form says the same and reads worse.
  const s = q.toString().replace(/%2C/gi, ',')
  return s ? `${pathname}?${s}` : pathname
}

export function samePlot(a: Plot | null, b: Plot | null): boolean {
  if (!a || !b) return a === b
  return a.handle === b.handle && a.side === b.side && a.pins.join(',') === b.pins.join(',')
}

/** The read for a plot. The pins are not sent: they are applied here (`applyPins`), so toggling one costs no read. */
export function recordApiUrl(plot: Pick<Plot, 'handle' | 'side'>, symbol: string): string {
  const q = new URLSearchParams({ handle: plot.handle, sym: symbol })
  if (plot.side !== 'all') q.set('side', plot.side)
  return `/api/x/record?${q.toString()}`
}

const STATUSES = new Set(['ready', 'unscanned', 'scanning', 'refused'])

/** A body that has the contract's shape, or null. Nothing else is ever drawn. */
export function asRecordResponse(body: unknown): RecordResponse | null {
  if (typeof body !== 'object' || body === null) return null
  const b = body as Record<string, unknown>
  if (typeof b.status !== 'string' || !STATUSES.has(b.status)) return null
  if (b.status === 'ready') {
    const r = b.record as Partial<CalledRecord> | undefined
    if (!r || typeof r.handle !== 'string' || typeof r.symbol !== 'string' || !Array.isArray(r.calls) || typeof r.words?.headline !== 'string' || typeof r.words?.standing !== 'string' || !r.tally || !r.bySide || !r.profile) return null
    // Whether a scan stands behind the count is not guessed: a record that does not say is not drawn.
    if (typeof r.scanned !== 'boolean') return null
    // Posts a large scan kept but has not labeled yet (lane JUDGE): the strip offers to finish them.
    const unlabeled = typeof b.unlabeled === 'number' && Number.isInteger(b.unlabeled) && b.unlabeled > 0 ? b.unlabeled : 0
    return unlabeled ? { status: 'ready', record: r as CalledRecord, unlabeled } : { status: 'ready', record: r as CalledRecord }
  }
  if (b.status === 'refused') {
    if (typeof b.reason !== 'string') return null
    const next = Array.isArray(b.next) ? (b.next as unknown[]).flatMap((n) => (n && typeof (n as { label?: unknown }).label === 'string' && typeof (n as { href?: unknown }).href === 'string' ? [{ label: (n as { label: string }).label, href: (n as { href: string }).href }] : [])) : []
    return { status: 'refused', reason: b.reason, next }
  }
  if (typeof b.handle !== 'string' || typeof b.symbol !== 'string') return null
  if (b.status === 'scanning') return { status: 'scanning', handle: b.handle, symbol: b.symbol, scanId: typeof b.scanId === 'string' ? b.scanId : '', progress: typeof b.progress === 'string' ? b.progress : '' }
  return { status: 'unscanned', handle: b.handle, symbol: b.symbol, canScan: b.canScan === true, ...(typeof b.reason === 'string' ? { reason: b.reason } : {}) }
}

/**
 * The counts beside All · Bull · Bear: what the SCAN found on each side. A
 * record with no finished scan has no tally, so it has no counts (its pasted
 * posts are shown and marked, never counted).
 */
export function sideCounts(record: Pick<CalledRecord, 'scanned' | 'bySide'> | null): Record<CalledSide, number> | null {
  if (!record || !record.scanned) return null
  return { all: record.bySide.bull.total + record.bySide.bear.total, bull: record.bySide.bull.total, bear: record.bySide.bear.total }
}

/** A link a refusal offers is followed only when it is a path on this site. */
export function safeNextHref(href: string): string | null {
  return /^\/(?![/\\])[^\s]*$/.test(href) && href.length <= 300 ? href : null
}

/** The record with the viewer's own pins on it. No valid pin = the rule's picks stand (the server's rule, lib/called-it/spec buildRecord). The tally is never touched. */
export function applyPins(record: CalledRecord, pins: readonly string[]): CalledRecord {
  const own = cleanPins(pins).filter((id) => record.calls.some((c) => c.postId === id))
  if (!own.length) return record
  const set = new Set(own)
  if (record.calls.every((c) => c.picked === set.has(c.postId))) return record
  return { ...record, calls: record.calls.map((c) => (c.picked === set.has(c.postId) ? c : { ...c, picked: set.has(c.postId) })) }
}

/** Pin or unpin one call. A plot keeps at least one pin and at most what a URL carries; a refusal says which. */
export function togglePin(record: CalledRecord, postId: string): { pins: string[] } | { refused: string } {
  const picked = record.calls.filter((c) => c.picked).map((c) => c.postId)
  if (!record.calls.some((c) => c.postId === postId)) return { refused: 'That call is not on this plot.' }
  if (picked.includes(postId)) {
    if (picked.length === 1) return { refused: 'A plot keeps at least one pin. Pin another call first.' }
    return { pins: picked.filter((id) => id !== postId) }
  }
  if (picked.length >= PIN_URL_MAX) return { refused: `A plot holds ${PIN_URL_MAX} pins. Unpin one first.` }
  return { pins: [...picked, postId] }
}

/** A pasted post link, checked before it is sent: it must be a post, and when the link names an account, this plot's. */
export function checkPostLink(raw: string, handle: string): { ok: true; url: string } | { ok: false; reason: string } {
  const ref = postRefFromUrl(raw)
  if (!ref) return { ok: false, reason: 'Paste the link to one post on X (x.com/name/status/…).' }
  if (ref.handle && ref.handle !== handle) return { ok: false, reason: `That post is by @${ref.handle}. This plot is @${handle}.` }
  return { ok: true, url: raw.trim() }
}

/** The plotted handles a door suggests, whatever envelope the list arrives in. Handles are re-checked; nothing else is trusted. */
export function plottedFrom(body: unknown, limit = 6): { handle: string; symbol: string | null; name: string | null }[] {
  const b = body as { handles?: unknown; plotted?: unknown; rows?: unknown } | unknown[] | null
  const list = Array.isArray(b) ? b : Array.isArray(b?.handles) ? b.handles : Array.isArray(b?.plotted) ? b.plotted : Array.isArray(b?.rows) ? b.rows : []
  const out: { handle: string; symbol: string | null; name: string | null }[] = []
  for (const row of list as unknown[]) {
    const r = (typeof row === 'string' ? { handle: row } : row) as { handle?: unknown; symbol?: unknown; name?: unknown } | null
    const handle = normalizeHandle(r?.handle)
    if (!handle || out.some((o) => o.handle === handle)) continue
    out.push({ handle, symbol: typeof r?.symbol === 'string' && /^[A-Za-z0-9.:^-]{1,24}$/.test(r.symbol) ? r.symbol.toUpperCase() : null, name: typeof r?.name === 'string' ? r.name.slice(0, 60) : null })
    if (out.length >= limit) break
  }
  return out
}

/** The X account this browser proved (GET /api/x/me, lane AUTH), reduced to what this lane reads. */
export interface XViewer {
  xUserId: string
  /** Lowercase, no @. What the cookie says: good for a shortcut, never for "this is the owner". */
  handle: string
}

/** The identity in an `/api/x/me` body (or in the sign-in / sign-out event's detail), or null. */
export function viewerFrom(body: unknown): XViewer | null {
  const id = (body as { identity?: { xUserId?: unknown; handle?: unknown } | null } | null)?.identity
  const handle = normalizeHandle(id?.handle)
  return id && typeof id.xUserId === 'string' && id.xUserId.length > 0 && handle ? { xUserId: id.xUserId, handle } : null
}

/**
 * Is the viewer the account this record is about? Only when the record itself
 * is verified (the account signed in with X and still holds the handle) AND
 * the viewer's proven user id is that account's. Never from the cookie's
 * handle: a handle can change hands, a user id cannot (squad review).
 */
export function viewerOwns(record: Pick<CalledRecord, 'verified' | 'profile'> | null, viewer: XViewer | null): boolean {
  return !!record?.verified && !!viewer && !!record.profile.xUserId && viewer.xUserId === record.profile.xUserId
}

/** The plot as dots for the built-in chart (its markers take a time and a short label): the glyph and the verdict's own word. */
export function classicMarkers(record: CalledRecord | null): { t: number; label: string }[] {
  if (!record) return []
  return record.calls.map((c) => ({ t: c.barTime, label: `${VERDICT_GLYPH[c.verdict]} ${VERDICT_WORDS[c.verdict]}` }))
}

// ── The store ───────────────────────────────────────────────────────────

export type CalledPhase = 'idle' | 'loading' | 'settled' | 'failed'

// ── "The visitor just pressed Plot" (pure; pinned) ──────────────────────
// The door on the share landing navigates to the record's page. When that
// page finds the handle unscanned, the press that brought the visitor there
// already was the ask, so the page scans by itself. The press leaves a mark
// in THIS tab's session for two minutes; a page opened from a link has none,
// so a link never spends on load.

export const PLOT_INTENT_KEY = 'pantessa.called.plot'
export const PLOT_INTENT_MS = 2 * 60 * 1000

export function plotIntentValue(handle: string, symbol: string, nowMs: number): string {
  return JSON.stringify({ k: `${handle.toLowerCase()}|${symbol.toUpperCase()}`, at: nowMs })
}

/** The stored mark is for this handle and market and is fresh. Anything else (absent, malformed, another handle, old, from the future) is no mark. */
export function plotIntentMatches(raw: string | null | undefined, handle: string, symbol: string, nowMs: number): boolean {
  if (!raw || raw.length > 200) return false
  try {
    const v = JSON.parse(raw) as { k?: unknown; at?: unknown }
    return v.k === `${handle.toLowerCase()}|${symbol.toUpperCase()}` && typeof v.at === 'number' && nowMs - v.at >= 0 && nowMs - v.at <= PLOT_INTENT_MS
  } catch {
    return false
  }
}

// ── What the door says about the plot (pure; pinned) ────────────────────
// A plot with nothing to pin used to look like nothing had happened: the
// handle sat on the door's pill and every word about it was in the strip
// under the chart, below the fold (Nate, 2026-11-12: "I put @nategeier in
// and nothing popped up"). The pill now names the state and, when the chart
// has no pins to speak for it, a note under the pill says why.

export type PlotStatusKind = 'idle' | 'loading' | 'scanning' | 'unscanned' | 'refused' | 'failed' | 'empty' | 'pasted' | 'ready'

export interface PlotStatus {
  kind: PlotStatusKind
  /** After the handle on the door's pill ("8 calls", "reading posts"). Empty while idle. */
  pill: string
  /** One or two sentences for the note under the pill. Empty when the pins on the chart speak for themselves. */
  line: string
  /** The note offers the Scan button (a plot opened from an address is never scanned without a press). */
  canScan: boolean
  /** Somewhere to go, from a refusal. */
  next: { label: string; href: string }[]
}

const countOf = (n: number, one: string) => `${n} ${one}${n === 1 ? '' : 's'}`

export function plotStatus(s: { plot: Pick<Plot, 'handle'> | null; symbol: string | null; phase: CalledPhase; response: RecordResponse | null; record: CalledRecord | null; scanning: boolean; progress: string }): PlotStatus {
  const none: PlotStatus = { kind: 'idle', pill: '', line: '', canScan: false, next: [] }
  if (!s.plot || !s.symbol) return none
  const who = `@${s.plot.handle}`
  const r = s.response
  if ((s.scanning && !s.record) || r?.status === 'scanning') {
    // The scan's own note joins the sentence only when it adds something ("Read 42 posts", "Labeling 42 posts"): its first note says the same thing as this line.
    const raw = (r?.status === 'scanning' ? r.progress : s.progress).trim().replace(/[.\s]+$/, '')
    const note = raw && !/^(reading|starting)\b/i.test(raw) ? `${raw}. ` : ''
    return { ...none, kind: 'scanning', pill: 'reading posts', line: `Reading ${who}'s posts about ${s.symbol}. ${note}It takes up to a minute.` }
  }
  if (s.record) {
    const rec = s.record
    if (!rec.scanned) return { ...none, kind: 'pasted', pill: `${rec.added} added` }
    if (rec.calls.length === 0) return { ...none, kind: 'empty', pill: 'no calls', line: `No calls by ${who} on ${rec.symbol}. ${rec.words.coverage ?? ''} A call is a post that says where the price goes or tells people what to do.`.replace(/\s+/g, ' ') }
    return { ...none, kind: 'ready', pill: countOf(rec.tally.total, 'call') }
  }
  if (s.phase === 'loading' || s.phase === 'idle') return { ...none, kind: 'loading', pill: 'loading' }
  if (s.phase === 'failed' || !r) return { ...none, kind: 'failed', pill: 'no answer', line: `The record for ${who} did not load.` }
  if (r.status === 'unscanned') return { ...none, kind: 'unscanned', pill: 'not scanned', canScan: r.canScan, line: r.canScan ? `Nobody has scanned ${who} on ${s.symbol} yet. A scan reads their posts about it from the last year.` : (r.reason ?? `Nobody has scanned ${who} on ${s.symbol} yet, and scans are not available here.`) }
  if (r.status === 'refused') return { ...none, kind: 'refused', pill: 'not plotted', line: r.reason, next: r.next.map((n) => ({ label: n.label, href: safeNextHref(n.href) ?? '' })).filter((n) => n.href) }
  return { ...none, kind: 'loading', pill: 'loading' }
}

interface CalledState {
  /** The symbol page the plot is on. A plot never follows to another symbol. */
  symbol: string | null
  plot: Plot | null
  phase: CalledPhase
  /** The server's last answer for this handle and side. */
  response: RecordResponse | null
  /** The record on screen: the answer with the viewer's pins applied. Kept while the other side loads. */
  record: CalledRecord | null
  /** A scan this browser started is running. */
  scanning: boolean
  /** The running scan's own note ("Read 212 posts"), as the server words it. */
  progress: string
  /** Posts a scan kept but has not labeled yet (the strip offers to finish them). */
  unlabeled: number
  /** The call the chart and the strip are both pointing at, and who pointed. */
  focusId: string | null
  focusBy: 'chart' | 'strip' | null
  /** Bumped to ask the chart for "fit all calls". */
  fitNonce: number
  /** Cards the chart is showing (0 = marks only, or the built-in chart). */
  cards: number
  /** The Advanced chart is up and drawing the plot (the built-in chart draws dots and cannot be asked to fit). */
  advanced: boolean
  /** One line the strip shows once (a pin limit). */
  note: string | null
  /** The address has been read on this page (nothing is mirrored before that). */
  opened: boolean
  open(symbol: string, plot: Plot | null, opts?: { fit?: boolean }): void
  plotHandle(handle: string, side: CalledSide): void
  setSide(side: CalledSide): void
  togglePin(postId: string): void
  rulePins(): void
  clear(): void
  focus(postId: string | null, by: 'chart' | 'strip'): void
  fit(): void
  retry(): void
  scan(): Promise<void>
  addPost(url: string): Promise<{ ok: true } | { ok: false; reason: string }>
  setCards(n: number): void
  setAdvanced(on: boolean): void
}

const SCAN_POLL_MS = 2500
const SCAN_POLL_MAX = 48
const FETCH_TIMEOUT_MS = 15_000
let seq = 0
let pollTimer: ReturnType<typeof setTimeout> | null = null
const cache = new Map<string, { at: number; body: RecordResponse }>()
const CACHE_MS = 60_000
const cacheKey = (symbol: string, plot: Pick<Plot, 'handle' | 'side'>) => `${symbol}|${plot.handle}|${plot.side}`

async function getJson(url: string, init?: RequestInit): Promise<{ status: number; body: unknown }> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), init?.method === 'POST' ? 70_000 : FETCH_TIMEOUT_MS)
  try {
    const res = await fetch(url, { cache: 'no-store', credentials: 'same-origin', ...init, signal: ctl.signal })
    let body: unknown = null
    try {
      body = await res.json()
    } catch {
      /* not JSON: the status speaks */
    }
    return { status: res.status, body }
  } finally {
    clearTimeout(timer)
  }
}

export const useCalled = create<CalledState>((set, get) => {
  const stopPoll = () => {
    if (pollTimer) clearTimeout(pollTimer)
    pollTimer = null
  }
  /** Take an answer for the current plot. */
  const settle = (my: number, body: RecordResponse, opts: { fit?: boolean } = {}) => {
    const { plot, symbol } = get()
    if (my !== seq || !plot || !symbol) return
    const record = body.status === 'ready' ? applyPins(body.record, plot.pins) : null
    if (body.status === 'ready') cache.set(cacheKey(symbol, plot), { at: Date.now(), body })
    set((s) => ({
      phase: 'settled',
      response: body,
      record,
      unlabeled: body.status === 'ready' ? (body.unlabeled ?? 0) : 0,
      progress: body.status === 'scanning' ? body.progress : '',
      fitNonce: record && opts.fit ? s.fitNonce + 1 : s.fitNonce,
      focusId: record && s.focusId && record.calls.some((c) => c.postId === s.focusId) ? s.focusId : null,
    }))
    stopPoll()
    // Somebody else's scan is running: the answer arrives by asking again.
    if (body.status === 'scanning') {
      let polls = 0
      const again = () => {
        pollTimer = setTimeout(() => {
          if (my !== seq || ++polls > SCAN_POLL_MAX) return
          void read(my, { quiet: true, fit: true }).then((still) => {
            if (still) again()
          })
        }, SCAN_POLL_MS)
      }
      again()
    }
  }
  /** One read of the record. Returns true while the answer is still "scanning". */
  const read = async (my: number, opts: { quiet?: boolean; fit?: boolean; fresh?: boolean } = {}): Promise<boolean> => {
    const { plot, symbol } = get()
    if (!plot || !symbol) return false
    const hit = opts.fresh || opts.quiet ? null : cache.get(cacheKey(symbol, plot))
    if (hit && Date.now() - hit.at < CACHE_MS) {
      settle(my, hit.body, opts)
      return false
    }
    if (!opts.quiet) set({ phase: 'loading' })
    try {
      const { body } = await getJson(recordApiUrl(plot, symbol))
      if (my !== seq) return false
      const answer = asRecordResponse(body)
      if (!answer) {
        if (!opts.quiet) set({ phase: 'failed', response: null })
        return false
      }
      if (opts.quiet) {
        // A poll while a scan runs only carries its progress note; the scan's own request brings the answer.
        if (answer.status === 'scanning') {
          set(get().record ? { progress: answer.progress } : { progress: answer.progress, response: answer })
          return true
        }
        if (get().scanning) return false
      }
      settle(my, answer, opts)
      return false
    } catch {
      if (my === seq && !opts.quiet) set({ phase: 'failed', response: null })
      return false
    }
  }
  const load = (plot: Plot, opts: { fit?: boolean; keep?: boolean; byHand?: boolean } = {}) => {
    const my = ++seq
    stopPoll()
    set((s) => ({ plot, phase: 'loading', scanning: false, progress: '', note: null, focusId: null, focusBy: null, ...(opts.keep && s.record && s.record.handle === plot.handle ? {} : { record: null, response: null, unlabeled: 0 }) }))
    void read(my, { fit: opts.fit }).then(() => {
      // The door's press IS the ask: a handle nobody has scanned is scanned now, not after a second button under the
      // chart. A plot opened from an address (a shared link, a reload) never scans without a press: `open` passes no byHand.
      if (!opts.byHand || my !== seq) return
      const r = get().response
      if (r?.status === 'unscanned' && r.canScan) void get().scan()
    })
  }

  return {
    symbol: null,
    plot: null,
    phase: 'idle',
    response: null,
    record: null,
    scanning: false,
    progress: '',
    unlabeled: 0,
    focusId: null,
    focusBy: null,
    fitNonce: 0,
    cards: 0,
    advanced: false,
    note: null,
    opened: false,

    open(symbol, plot, opts) {
      const s = get()
      if (s.symbol === symbol && s.opened && samePlot(s.plot, plot)) return
      const sameHandle = s.symbol === symbol && !!plot && !!s.plot && s.plot.handle === plot.handle && s.plot.side === plot.side
      if (s.symbol !== symbol) {
        seq++
        stopPoll()
        set({ symbol, plot: null, phase: 'idle', response: null, record: null, scanning: false, progress: '', unlabeled: 0, focusId: null, focusBy: null, fitNonce: 0, cards: 0, note: null, opened: true })
      } else set({ opened: true })
      if (!plot) {
        if (get().plot) get().clear()
        return
      }
      // Back / forward to the same handle with other pins: no read, the pins are applied here.
      if (sameHandle && s.response?.status === 'ready') set({ plot, record: applyPins(s.response.record, plot.pins) })
      else load(plot, { fit: opts?.fit ?? true })
    },
    plotHandle(handle, side) {
      if (!get().symbol) return
      load({ handle, side, pins: [] }, { fit: true, byHand: true })
    },
    setSide(side) {
      const { plot } = get()
      if (!plot || plot.side === side) return
      // A side is its own plot: the rule picks again, and the other side's cards stay up until this one answers.
      load({ handle: plot.handle, side, pins: [] }, { fit: true, keep: true })
    },
    togglePin(postId) {
      const { plot, record } = get()
      if (!plot || !record) return
      const next = togglePin(record, postId)
      if ('refused' in next) {
        set({ note: next.refused })
        return
      }
      const pins = cleanPins(next.pins)
      set({ plot: { ...plot, pins }, record: applyPins(record, pins), note: null })
    },
    rulePins() {
      const { plot, response } = get()
      if (!plot || !plot.pins.length || response?.status !== 'ready') return
      set({ plot: { ...plot, pins: [] }, record: response.record, note: null })
    },
    clear() {
      seq++
      stopPoll()
      set({ plot: null, phase: 'idle', response: null, record: null, scanning: false, progress: '', unlabeled: 0, focusId: null, focusBy: null, note: null, cards: 0 })
    },
    focus(postId, by) {
      set({ focusId: postId, focusBy: postId ? by : null })
    },
    fit() {
      set((s) => ({ fitNonce: s.fitNonce + 1 }))
    },
    retry() {
      const { plot } = get()
      if (plot) load(plot, { fit: true })
    },
    async scan() {
      const { plot, symbol, scanning } = get()
      if (!plot || !symbol || scanning) return
      const my = ++seq
      stopPoll()
      // A first scan shows its progress in place of the record; "Finish" (a record is already up) keeps the record on screen.
      if (get().record) set({ scanning: true })
      else set({ scanning: true, phase: 'settled', response: { status: 'scanning', handle: plot.handle, symbol, scanId: '', progress: '' } })
      // The scan runs inside this request; its own progress note is read beside it.
      let polls = 0
      const tick = () => {
        pollTimer = setTimeout(() => {
          if (my !== seq || !get().scanning || ++polls > SCAN_POLL_MAX) return
          void read(my, { quiet: true }).then(() => {
            if (get().scanning) tick()
          })
        }, SCAN_POLL_MS)
      }
      tick()
      try {
        const { status, body } = await getJson('/api/x/scan', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: plot.handle, sym: symbol, side: plot.side }) })
        if (my !== seq) return
        stopPoll()
        const answer = asRecordResponse(body)
        cache.delete(cacheKey(symbol, plot))
        set({ scanning: false })
        const had = get().record
        if (answer && !(answer.status === 'scanning' && !answer.scanId) && !(had && answer.status !== 'ready')) settle(my, answer, { fit: !had })
        else if (had) set({ note: answer?.status === 'refused' ? answer.reason : 'The rest could not be labeled just now. The record on screen stands.' })
        else settle(my, { status: 'refused', reason: status === 404 ? 'Scans are not on this server yet. One post can still be added by its link.' : 'The scan did not finish. Nothing was plotted. Try again in a moment.', next: [] })
      } catch {
        if (my !== seq) return
        stopPoll()
        set({ scanning: false })
        if (get().record) set({ note: 'The rest could not be labeled just now. The record on screen stands.' })
        else settle(my, { status: 'refused', reason: 'The scan did not answer in time. If it is still running, the plot will be here when you come back.', next: [] })
      }
    },
    async addPost(url) {
      const { plot, symbol } = get()
      if (!plot || !symbol) return { ok: false, reason: 'Plot a handle first.' }
      const checked = checkPostLink(url, plot.handle)
      if (!checked.ok) return checked
      const my = seq
      try {
        const { status, body } = await getJson('/api/x/add', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ handle: plot.handle, sym: symbol, url: checked.url }) })
        if (my !== seq) return { ok: false, reason: 'The plot changed before the post was added.' }
        const answer = asRecordResponse(body)
        if (answer?.status === 'refused') return { ok: false, reason: answer.reason }
        cache.delete(cacheKey(symbol, plot))
        if (answer?.status === 'ready') {
          // The side on screen may not be the side the answer was built for: read this plot's own.
          if (answer.record.side === plot.side) settle(my, answer)
          else await read(my, { quiet: true, fresh: true })
          return { ok: true }
        }
        if (status === 404) return { ok: false, reason: 'Adding a post is not on this server yet.' }
        if (status >= 200 && status < 300) {
          await read(my, { quiet: true, fresh: true })
          return { ok: true }
        }
        return { ok: false, reason: 'That post could not be added. Try again in a moment.' }
      } catch {
        return { ok: false, reason: 'That post could not be added. Try again in a moment.' }
      }
    },
    setCards(n) {
      if (get().cards !== n) set({ cards: n })
    },
    setAdvanced(on) {
      if (get().advanced !== on) set({ advanced: on })
    },
  }
})

// ── The hooks ───────────────────────────────────────────────────────────

/**
 * The page's side of the plot: read the address after mount and on back /
 * forward, and mirror every change back into it. Mounted ONCE per symbol page
 * (the Calls strip mounts it).
 */
export function useCalledAddress(symbol: string): void {
  const plot = useCalled((s) => (s.symbol === symbol ? s.plot : null))
  const opened = useCalled((s) => s.symbol === symbol && s.opened)
  useEffect(() => {
    const read = () => {
      const q = new URLSearchParams(window.location.search)
      const tf = q.get('tf')
      // A plot opens on daily bars with every call in view, unless the address asks for another frame.
      useCalled.getState().open(symbol, parsePlotParams(window.location.search), { fit: !tf || tf.toLowerCase() === '1d' })
    }
    read()
    window.addEventListener('popstate', read)
    return () => window.removeEventListener('popstate', read)
  }, [symbol])
  const mirrored = useRef(false)
  useEffect(() => {
    if (!opened) return
    // First run: the address is already the truth (it was just read).
    if (!mirrored.current) {
      mirrored.current = true
      return
    }
    const { pathname, search } = window.location
    const next = plotUrl(plot, pathname, search)
    if (next !== `${pathname}${search}`) window.history.replaceState(null, '', next)
  }, [plot, opened])
}

/** The X identity this browser proved, kept in step with a sign-in or sign-out on the same page. Null until known, and when there is none. */
export function useXViewer(): XViewer | null {
  const [viewer, setViewer] = useState<XViewer | null>(null)
  useEffect(() => {
    let alive = true
    fetch('/api/x/me', { credentials: 'same-origin', cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((body) => alive && setViewer(viewerFrom(body)))
      .catch(() => undefined)
    const onChange = (e: Event) => alive && setViewer(viewerFrom((e as CustomEvent<unknown>).detail))
    window.addEventListener('pantessa:x-identity', onChange)
    return () => {
      alive = false
      window.removeEventListener('pantessa:x-identity', onChange)
    }
  }, [])
  return viewer
}

function inksNow(): CalledInks {
  const t = readTokens()
  return { up: t.up, down: t.down, fg: t.fg, bg: t.bg, surf: t.surf, muted: t.muted, line: t.line }
}

/** The Advanced chart's pins, tied to the page's plot. One controller per chart (the chart is keyed by its symbol). */
export function useCalledPins(symbol: string): CalledPinsController {
  const ref = useRef<CalledPinsController | null>(null)
  if (!ref.current) {
    ref.current = createCalledPins({
      symbol,
      inks: inksNow,
      onPick: (postId) => useCalled.getState().focus(postId, 'chart'),
      onCards: (n) => useCalled.getState().setCards(n),
      onAttach: (on) => useCalled.getState().setAdvanced(on),
    })
  }
  const record = useCalled((s) => (s.symbol && s.symbol.toUpperCase() === symbol.toUpperCase() ? s.record : null))
  const focusId = useCalled((s) => s.focusId)
  const fitNonce = useCalled((s) => s.fitNonce)
  useEffect(() => {
    ref.current?.set({ record, focusId, fitNonce })
  }, [record, focusId, fitNonce])
  return ref.current
}

/** The plot as dots on the built-in chart (the strip under it carries the words). */
export function useClassicCalledMarkers(symbol: string): { t: number; label: string }[] {
  const record = useCalled((s) => (s.symbol && s.symbol.toUpperCase() === symbol.toUpperCase() ? s.record : null))
  const ref = useRef<{ record: CalledRecord | null; markers: { t: number; label: string }[] }>({ record: null, markers: [] })
  if (ref.current.record !== record) ref.current = { record, markers: classicMarkers(record) }
  return ref.current.markers
}
