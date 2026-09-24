// The Sheet's history coordinator (squad mobile-native, 2026-09-24, SHELL).
//
// Every open sheet on a phone owns ONE history entry marked `{ sheet: key }`,
// so the back gesture closes it and stays on the page. Every overlay in the
// page shares this ONE coordinator (through components/mobile/useBackToClose;
// the Sheet wears the hook), so the cases below are handled once:
//
//   THE HANDOFF (PAGES measured it): one tap closes sheet A and opens sheet B
//   in the same commit. A's entry is not popped at once — it is PENDING, and
//   B takes it over (replaceState; Next's own `__NA` + tree fields are kept,
//   so the entry stays a same-URL restore, never a reload). One entry for
//   the chain, and back closes B.
//
//   CLOSE UNDER (PAGES measured it): A closes ONE RENDER AFTER B opens (an
//   effect "close A when B opens"). B pushed while A was still open, so A's
//   entry sits BELOW B's. A closes while not on top → its entry is DEAD. When
//   the top sheet later dismisses (not by back), the pop takes 1 + the dead
//   entries beneath it; when a user's back lands ON a dead entry, one more
//   pop skips it. No dead press of the back button.
//
//   THE LINK INSIDE A SHEET (QA's trace, 42531a46): a row closes the sheet
//   AND starts a Next navigation (MORE → Docs, the account menu → Dashboard).
//   Next pushes when its RSC payload is in — 4ms later when prefetched, 50–
//   300ms on a phone — and a back() already travelling then pops the NEW
//   entry: /docs, then /docs → /chat 36ms later. Two rules, together:
//     1. a pending pop WAITS while a navigation may be under way (a tap on a
//        link/button/menu item inside a dialog marks SHEET_TAP_NAV_MS; polled
//        every NAV_POLL_MS up to SHEET_NAV_WAIT_MS), and is cancelled when the
//        page is unloading (a hard navigation);
//     2. a push that arrives while the closed sheet's entry is still pending
//        is turned into a REPLACE (`interceptPush`, wired into pushState by the
//        browser host): the sheet's entry BECOMES the target — history reads
//        [.., /markets, /docs], no stale step, nothing to pop under, and it
//        holds for a Link and for a router.push alike.
//   A stale sheet entry left behind by any other path is skipped when a
//   later back lands on it.
//
//   IN FLIGHT: a sheet opening while our own pop is travelling waits for that
//   popstate, then claims an entry of its own. Our own pops are swallowed;
//   any other popstate closes the sheet on top of the stack.
//
// Pure over an injectable host, so the harness pins every case with a fake
// history; the browser host is at the bottom.

export type SheetOwner = { key: string; onBack: () => void }

export type SheetHistoryHost = {
  state(): unknown
  push(state: Record<string, unknown>): void
  replace(state: Record<string, unknown>): void
  /** Traverse `n` entries back (n ≥ 1). */
  go(n: number): void
  /** Registers the popstate listener (called once). */
  onPop(cb: () => void): void
  /** The next macrotask (the tick a takeover must beat). */
  later(cb: () => void): void
  /** `cb` after `ms` (the navigation grace). */
  wait(ms: number, cb: () => void): void
  /** True while a navigation may be under way: a link/button inside a sheet
   *  was tapped moments ago, or the page is unloading. */
  navigating(): boolean
  /** True once the page is leaving (never pop into an unload). */
  unloading(): boolean
  /** The clock (Date.now in the browser; a fake's virtual clock). */
  now(): number
}

/** How long a pending pop keeps waiting while a navigation may be under way. */
export const SHEET_NAV_WAIT_MS = 2000
/** An in-sheet tap counts as "a navigation may follow" for this long. */
export const SHEET_TAP_NAV_MS = 1500
const NAV_POLL_MS = 120

type Entry = { key: string; owner: SheetOwner | null }

export type SheetHistory = {
  opened(owner: SheetOwner): void
  closed(key: string, reason: 'back' | 'other'): void
  /** Asked by the host before EVERY pushState: true = perform it as a
   *  replaceState instead (a navigation landing on a closed sheet's pending
   *  entry takes that entry over). Our own sheet pushes (`data.sheet`) and
   *  same-URL pushes are never converted. */
  interceptPush(data: unknown, url: string | URL | null | undefined, currentHref: string): boolean
  debug(): { stack: string[]; dead: string[]; pendingBack: string | null; backInFlight: number; deferred: string | null }
}

function sheetOf(state: unknown): string | null {
  return state && typeof state === 'object' && typeof (state as { sheet?: unknown }).sheet === 'string' ? (state as { sheet: string }).sheet : null
}

export function createSheetHistory(host: SheetHistoryHost): SheetHistory {
  // The sheet entries above the page's own entry, bottom → top. An entry
  // whose owner is null is DEAD (its sheet closed under another).
  const entries: Entry[] = []
  let pendingBack: string | null = null
  let backInFlight = 0 // entries a traversal of ours is removing
  let deferred: SheetOwner | null = null
  let listening = false

  const top = () => entries[entries.length - 1]
  const deadBelowTop = () => {
    let n = 0
    for (let i = entries.length - 2; i >= 0 && entries[i].owner === null; i--) n++
    return n
  }
  const trailingDead = () => {
    let n = 0
    for (let i = entries.length - 1; i >= 0 && entries[i].owner === null; i--) n++
    return n
  }

  const claim = (o: SheetOwner) => {
    const st = host.state()
    const t = top()
    if (pendingBack && t && t.key === pendingBack && sheetOf(st) === pendingBack) {
      // The tap that closed the last sheet opened this one: same entry.
      pendingBack = null
      host.replace({ ...(st as Record<string, unknown>), sheet: o.key })
      entries[entries.length - 1] = { key: o.key, owner: o }
    } else {
      host.push({ sheet: o.key })
      entries.push({ key: o.key, owner: o })
    }
  }

  const travel = (n: number) => {
    backInFlight = n
    host.go(n)
  }

  const listen = () => {
    if (listening) return
    listening = true
    host.onPop(() => {
      if (backInFlight) {
        // Our own traversal landed: drop what it removed.
        entries.splice(Math.max(0, entries.length - backInFlight))
        backInFlight = 0
        if (deferred) {
          const d = deferred
          deferred = null
          claim(d)
        }
        return
      }
      const t = entries.pop()
      if (!t) {
        // Nothing of ours is open, yet the entry we landed on wears a sheet
        // marker: a STALE sheet entry (one a navigation left behind — the
        // link-inside-a-sheet case). A sheet entry never deserves a visible
        // stop: skip it with one more traversal.
        if (sheetOf(host.state())) travel(1)
        return
      }
      // The user's back popped the top entry: its sheet closes …
      if (t.owner) t.owner.onBack()
      // … and if that leaves us ON dead entries, skip them with one more traversal.
      const dead = trailingDead()
      if (dead > 0) travel(dead)
    })
  }

  const schedulePop = (key: string) => {
    const started = host.now()
    const attempt = () => {
      if (pendingBack !== key) return // taken over, or superseded
      if (host.unloading()) {
        pendingBack = null
        return
      }
      // Only while our entry is still the current one: if the page moved on
      // (a link inside the sheet pushed a new URL), the entry stays behind as
      // a harmless same-URL step rather than undoing the navigation.
      if (sheetOf(host.state()) !== key) {
        pendingBack = null
        const i = entries.findIndex((e) => e.key === key)
        if (i >= 0) entries.splice(i)
        return
      }
      if (host.navigating() && host.now() - started < SHEET_NAV_WAIT_MS) {
        host.wait(NAV_POLL_MS, attempt)
        return
      }
      pendingBack = null
      const t = top()
      if (!t || t.key !== key) return
      travel(1 + deadBelowTop())
    }
    host.later(attempt)
  }

  return {
    opened(o) {
      listen()
      if (backInFlight) {
        deferred = o
        return
      }
      claim(o)
    },
    interceptPush(data, url, currentHref) {
      if (!pendingBack) return false
      if (data && typeof data === 'object' && typeof (data as { sheet?: unknown }).sheet === 'string') return false
      if (sheetOf(host.state()) !== pendingBack) return false
      if (url == null || url === '') return false
      let target: URL
      try {
        target = new URL(String(url), currentHref)
      } catch {
        return false
      }
      const here = new URL(currentHref)
      if (target.pathname === here.pathname && target.search === here.search) return false
      // The navigation takes the entry over: it is the page's own from here.
      const key = pendingBack
      pendingBack = null
      const i = entries.findIndex((e) => e.key === key)
      if (i >= 0) entries.splice(i)
      return true
    },
    closed(key, reason) {
      if (deferred?.key === key) {
        deferred = null
        return
      }
      const i = entries.findIndex((e) => e.key === key)
      if (i < 0) return
      if (reason === 'back') return // the browser already popped it (onPop)
      if (i < entries.length - 1) {
        // Closed UNDER another sheet: its entry stays, dead, until the top
        // sheet's pop takes it along (or a back lands on it).
        entries[i] = { key, owner: null }
        return
      }
      pendingBack = key
      schedulePop(key)
    },
    debug() {
      return {
        stack: entries.filter((e) => e.owner).map((e) => e.key),
        dead: entries.filter((e) => !e.owner).map((e) => e.key),
        pendingBack,
        backInFlight,
        deferred: deferred?.key ?? null,
      }
    },
  }
}

// ── The browser host ───────────────────────────────────────────────────────
/** Dispatched on window when a pushState was performed as a replaceState
 *  (rule 2 above), so the scroll memory still reads it as a PUSH (a new
 *  screen lands at its top). detail: { url }. */
export const SHEET_PUSH_AS_REPLACE_EVENT = 'pantessa:history-push-as-replace'

let lastTap = 0
let leaving = false
let armed = false
function armBrowserSignals() {
  if (armed || typeof window === 'undefined') return
  armed = true
  // A tap on a link, button or menu item INSIDE any open dialog (a Sheet's
  // panel, the sign-in door) may start a navigation; the scrim and the close
  // button never do.
  document.addEventListener(
    'click',
    (e) => {
      const t = e.target
      if (!(t instanceof Element)) return
      if (!t.closest('[role="dialog"]')) return
      if (t.closest('.sheet__close')) return
      if (t.closest('a[href], button, [role="menuitem"], [role="button"]')) lastTap = Date.now()
    },
    true,
  )
  // Rule 2: a push landing on a closed sheet's pending entry is a replace.
  // Wrapped by METHOD on whichever side of Next's own patch we land (Next
  // passes its __NA state straight through either way).
  const h = window.history
  const origPush = h.pushState
  h.pushState = function pushState(this: History, data: unknown, unused: string, url?: string | URL | null) {
    if (browserInstance && browserInstance.interceptPush(data, url, window.location.href)) {
      window.dispatchEvent(new CustomEvent(SHEET_PUSH_AS_REPLACE_EVENT, { detail: { url: url == null ? null : String(url) } }))
      return h.replaceState.call(this, data as never, unused, url)
    }
    return origPush.call(this, data as never, unused, url)
  }
  window.addEventListener('beforeunload', () => {
    leaving = true
  })
  window.addEventListener('pagehide', () => {
    leaving = true
  })
  window.addEventListener('pageshow', () => {
    leaving = false
  })
}

const browserHost: SheetHistoryHost = {
  state: () => window.history.state,
  push: (s) => window.history.pushState(s, '', window.location.href),
  replace: (s) => window.history.replaceState(s, '', window.location.href),
  go: (n) => window.history.go(-n),
  onPop: (cb) => window.addEventListener('popstate', cb),
  later: (cb) => {
    window.setTimeout(cb, 0)
  },
  wait: (ms, cb) => {
    window.setTimeout(cb, ms)
  },
  navigating: () => Date.now() - lastTap < SHEET_TAP_NAV_MS,
  unloading: () => leaving,
  now: () => Date.now(),
}

let browserInstance: SheetHistory | null = null
/** The one coordinator every Sheet in the page shares. */
export function sheetHistory(): SheetHistory {
  armBrowserSignals()
  return (browserInstance ??= createSheetHistory(browserHost))
}
