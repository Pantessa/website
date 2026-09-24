// The Sheet's history coordinator (squad mobile-native, 2026-09-24, SHELL).
//
// Every open sheet on a phone owns ONE history entry marked `{ sheet: key }`,
// so the back gesture closes it and stays on the page. The hard part is the
// HANDOFF: one tap closes sheet A and opens sheet B in the same commit (the
// account menu → "Wallet details", MORE → a sheet, the ask row → the ask
// door). If A's close called history.back() at once, that queued traversal
// would pop the entry B had just pushed and B would close a frame after it
// opened (PAGES measured it on the merged tree). So:
//
//   - a closing sheet never pops synchronously: it marks its entry PENDING and
//     pops it on the next tick — unless a sheet opens in between, which TAKES
//     OVER the entry with replaceState (Next's own `__NA` + tree fields are
//     kept, so the entry stays a same-URL restore, never a reload);
//   - a sheet that opens while a pop is already in flight waits for that
//     popstate, then claims an entry of its own;
//   - a popstate that is our own in-flight pop is swallowed; any other one
//     closes the sheet on top of the stack.
//
// Net: a chain of handoffs is one history entry, and back closes whatever is
// open. The module is a pure state machine over an injectable host, so the
// harness pins the race with a fake history; the browser host is below.

export type SheetOwner = { key: string; onBack: () => void }

export type SheetHistoryHost = {
  state(): unknown
  push(state: Record<string, unknown>): void
  replace(state: Record<string, unknown>): void
  back(): void
  /** Registers the popstate listener (called once). */
  onPop(cb: () => void): void
  /** The next macrotask (the tick a takeover must beat). */
  later(cb: () => void): void
}

export type SheetHistory = {
  opened(owner: SheetOwner): void
  closed(key: string, reason: 'back' | 'other'): void
  debug(): { stack: string[]; pendingBack: string | null; backInFlight: string | null; deferred: string | null }
}

function sheetOf(state: unknown): string | null {
  return state && typeof state === 'object' && typeof (state as { sheet?: unknown }).sheet === 'string' ? (state as { sheet: string }).sheet : null
}

export function createSheetHistory(host: SheetHistoryHost): SheetHistory {
  const stack: SheetOwner[] = []
  let pendingBack: string | null = null
  let backInFlight: string | null = null
  let deferred: SheetOwner | null = null
  let listening = false

  const claim = (o: SheetOwner) => {
    const st = host.state()
    if (pendingBack && sheetOf(st) === pendingBack) {
      // The tap that closed the last sheet opened this one: same entry.
      pendingBack = null
      host.replace({ ...(st as Record<string, unknown>), sheet: o.key })
    } else {
      host.push({ sheet: o.key })
    }
    stack.push(o)
  }

  const listen = () => {
    if (listening) return
    listening = true
    host.onPop(() => {
      if (backInFlight) {
        backInFlight = null
        if (deferred) {
          const d = deferred
          deferred = null
          claim(d)
        }
        return
      }
      const top = stack.pop()
      if (top) top.onBack()
    })
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
    closed(key, reason) {
      if (deferred?.key === key) {
        deferred = null
        return
      }
      const i = stack.findIndex((o) => o.key === key)
      if (i < 0) return
      const wasTop = i === stack.length - 1
      stack.splice(i, 1)
      if (reason === 'back' || !wasTop) return
      pendingBack = key
      host.later(() => {
        if (pendingBack !== key) return
        pendingBack = null
        // Only while our entry is still the current one: if the page moved on
        // (a link inside the sheet pushed a new URL), the entry stays behind
        // as a harmless same-URL step rather than undoing the navigation.
        if (sheetOf(host.state()) === key) {
          backInFlight = key
          host.back()
        }
      })
    },
    debug() {
      return { stack: stack.map((o) => o.key), pendingBack, backInFlight, deferred: deferred?.key ?? null }
    },
  }
}

const browserHost: SheetHistoryHost = {
  state: () => window.history.state,
  push: (s) => window.history.pushState(s, '', window.location.href),
  replace: (s) => window.history.replaceState(s, '', window.location.href),
  back: () => window.history.back(),
  onPop: (cb) => window.addEventListener('popstate', cb),
  later: (cb) => {
    window.setTimeout(cb, 0)
  },
}

let browserInstance: SheetHistory | null = null
/** The one coordinator every Sheet in the page shares. */
export function sheetHistory(): SheetHistory {
  return (browserInstance ??= createSheetHistory(browserHost))
}
