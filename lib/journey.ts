// lib/journey.ts — the browser half of the journey log.
//
// What a visitor did on the way to (or away from) their first transaction:
// pages, clicks on our own controls, time and scroll on each page, script
// errors, failing endpoints. It exists because every other record we keep is
// keyed by wallet, and the people we most need to understand leave before
// they have one.
//
// Rules this module keeps:
//   · No cookie, no localStorage id, nothing planted on the device. The
//     server derives a daily-rotating visitor id from the request itself
//     (lib/visitor-id.ts).
//   · Never reads an input, a textarea or anything the visitor typed. A click
//     is recorded by the label WE wrote on the control.
//   · Pathnames only. Query strings carry prompts and tokens; they stay home.
//   · Global Privacy Control / Do Not Track turn it off entirely.
//   · /embed is never tracked: those are other sites' visitors.
//   · It can never throw into the app, and never blocks a paint: events
//     queue, and leave in one small batch every few seconds or on page hide.

import { MAX_BATCH, type JourneyBatchIn, type JourneyEventIn, type JourneyKind } from '@/lib/journey-events'

const ENDPOINT = '/api/journey'
const FLUSH_MS = 4_000
const TEAM_KEY = 'pantessa.team'

type Queued = Omit<JourneyEventIn, 'ago'> & { at: number }

let queue: Queued[] = []
let timer: ReturnType<typeof setTimeout> | null = null
let wallet: string | null = null
let arrival: { ref?: string; utm?: string } | null = null
let arrivalSent = false
/** The untouched fetch, captured before observeFetch() wraps window.fetch. */
let rawFetch: typeof fetch | null = null

function off(): boolean {
  if (typeof window === 'undefined') return true
  const nav = navigator as Navigator & { globalPrivacyControl?: boolean }
  if (nav.globalPrivacyControl === true || nav.doNotTrack === '1') return true
  const p = window.location.pathname
  return p === '/embed' || p.startsWith('/embed/')
}

function teamBrowser(): boolean {
  try {
    return window.localStorage.getItem(TEAM_KEY) === '1'
  } catch {
    return false
  }
}

/** Called once an admin wallet signs in here: this browser is ours from now
 *  on, whatever throwaway wallet it connects next. The flag sits on the
 *  admin's own machine and says nothing about anyone else. */
export function markTeamBrowser(): void {
  try {
    window.localStorage.setItem(TEAM_KEY, '1')
  } catch {
    /* private mode — the server still knows by the session */
  }
}

export function setJourneyWallet(address: string | null | undefined): void {
  wallet = address ? address.toLowerCase() : null
}

/** How this page load arrived: the external referrer and the campaign words,
 *  read once. Only utm_* and via are lifted from the query; nothing else. */
function readArrival(): { ref?: string; utm?: string } {
  const out: { ref?: string; utm?: string } = {}
  try {
    const ref = document.referrer
    if (ref && new URL(ref).origin !== window.location.origin) out.ref = ref.slice(0, 200)
  } catch {
    /* an opaque referrer is no referrer */
  }
  try {
    const q = new URLSearchParams(window.location.search)
    const words: string[] = []
    for (const k of ['utm_source', 'utm_medium', 'utm_campaign', 'via']) {
      const v = q.get(k)
      if (v) words.push(`${k}=${v.replace(/[^a-zA-Z0-9._-]/g, '').slice(0, 40)}`)
    }
    if (words.length) out.utm = words.join('&')
  } catch {
    /* no query */
  }
  return out
}

export function trackJourney(kind: JourneyKind, label?: string | null, detail?: Record<string, string | number | boolean>, path?: string): void {
  try {
    if (off()) return
    queue.push({ k: kind, p: path ?? window.location.pathname, ...(label ? { l: label.slice(0, 240) } : {}), ...(detail ? { d: detail } : {}), at: Date.now() })
    if (queue.length >= MAX_BATCH) return flushJourney()
    if (!timer) timer = setTimeout(() => flushJourney(), FLUSH_MS)
  } catch {
    /* the log must never break the page */
  }
}

/** Send what is queued. `final` = the page is going away: use sendBeacon,
 *  which the browser finishes after the tab is gone. */
export function flushJourney(final = false): void {
  try {
    if (timer) {
      clearTimeout(timer)
      timer = null
    }
    if (queue.length === 0 || off()) {
      queue = []
      return
    }
    const now = Date.now()
    const events = queue.splice(0, MAX_BATCH).map(({ at, ...e }) => ({ ...e, ago: now - at }))
    if (!arrival) arrival = readArrival()
    const body: JourneyBatchIn = { events, ...(wallet ? { w: wallet } : {}), ...(teamBrowser() ? { team: true } : {}) }
    if (!arrivalSent && events.some((e) => e.k === 'view')) {
      if (arrival.ref) body.ref = arrival.ref
      if (arrival.utm) body.utm = arrival.utm
      arrivalSent = true
    }
    const json = JSON.stringify(body)
    const beacon = final && typeof navigator.sendBeacon === 'function'
    if (beacon && navigator.sendBeacon(ENDPOINT, new Blob([json], { type: 'application/json' }))) {
      /* handed to the browser */
    } else {
      const send = rawFetch ?? window.fetch.bind(window)
      void send(ENDPOINT, { method: 'POST', headers: { 'content-type': 'application/json' }, body: json, keepalive: true }).catch(() => {})
    }
    if (queue.length) timer = setTimeout(() => flushJourney(final), final ? 0 : FLUSH_MS)
  } catch {
    queue = []
  }
}

// ── what a click was on ───────────────────────────────────────────────────

const CLICKABLE = 'a[href],button,[role="button"],[role="tab"],[role="menuitem"],summary,label[for],[data-journey]'

/** The label WE put on a control — never a value someone typed. */
export function labelOfClick(target: EventTarget | null): { label: string; detail: Record<string, string> } | null {
  if (!(target instanceof Element)) return null
  if (target.closest('input,textarea,select,[contenteditable="true"],[data-journey-skip]')) return null
  const el = target.closest(CLICKABLE)
  if (!el) return null
  const named = el.getAttribute('data-journey') || el.getAttribute('aria-label') || el.getAttribute('title')
  const text = (named || el.textContent || '').replace(/\s+/g, ' ').trim()
  if (!text) return null
  const detail: Record<string, string> = { tag: el.tagName.toLowerCase() }
  const href = el instanceof HTMLAnchorElement ? el.getAttribute('href') : null
  if (href) {
    try {
      const u = new URL(href, window.location.origin)
      // Our own pages by pathname; anyone else's by hostname alone.
      detail.to = u.origin === window.location.origin ? u.pathname.slice(0, 120) : u.hostname.slice(0, 80)
    } catch {
      /* a javascript: or malformed href names nothing */
    }
  }
  return { label: text.slice(0, 80), detail }
}

// ── failing endpoints, as the visitor's browser saw them ──────────────────

/** Polls a signed-out page makes on purpose; their 401 is not a wall. */
const QUIET_401 = /^\/api\/(jobs|dca|guardian\/policies|watchlists|alerts|chats|inbox|auth\/me|roster|working-set)\b/

export function shouldLogApiFailure(method: string, pathname: string, status: number): boolean {
  if (!pathname.startsWith('/api/') || pathname.startsWith(ENDPOINT)) return false
  if (status < 400) return false
  if (status === 401 && (method === 'GET' || QUIET_401.test(pathname))) return false
  return true
}

/** Wrap window.fetch to NOTICE a failing same-origin API call. It reads the
 *  status and nothing else: the response goes back untouched and unread. */
export function observeFetch(): () => void {
  if (typeof window === 'undefined' || rawFetch) return () => {}
  const original = window.fetch
  rawFetch = original.bind(window)
  const wrapped: typeof fetch = async (input, init) => {
    let method = 'GET'
    let pathname = ''
    try {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const u = new URL(url, window.location.origin)
      if (u.origin === window.location.origin) pathname = u.pathname
      method = (init?.method ?? (typeof input === 'object' && 'method' in input ? input.method : 'GET')).toUpperCase()
    } catch {
      /* not ours to describe */
    }
    try {
      const res = await original.call(window, input, init)
      if (pathname && shouldLogApiFailure(method, pathname, res.status)) {
        trackJourney('api-error', `${method} ${pathname.slice(0, 120)}`, { status: res.status })
      }
      return res
    } catch (err) {
      // A request cut short by leaving the page is not a failure of ours.
      const aborted = err instanceof DOMException && err.name === 'AbortError'
      if (pathname && !aborted && document.visibilityState === 'visible' && shouldLogApiFailure(method, pathname, 599)) {
        trackJourney('api-error', `${method} ${pathname.slice(0, 120)}`, { status: 0, failed: 'network' })
      }
      throw err
    }
  }
  window.fetch = wrapped
  return () => {
    if (window.fetch === wrapped) window.fetch = original
    rawFetch = null
  }
}

// ── script errors ─────────────────────────────────────────────────────────

/** Noise that is not ours: browser extensions, cross-origin "Script error.",
 *  the benign ResizeObserver warning, a wallet the visitor rejected. */
const NOT_OURS = /^Script error\.?$|ResizeObserver loop|chrome-extension:|moz-extension:|safari-web-extension:|User rejected|User denied|user rejected|Non-Error promise rejection captured/

export function shouldLogScriptError(message: string, source?: string | null): boolean {
  if (!message) return false
  return !NOT_OURS.test(message) && !NOT_OURS.test(source ?? '')
}
