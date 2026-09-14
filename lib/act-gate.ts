// Looking is free; acting asks for a wallet (2026-09-14, Nate: "I don't think
// the user should have to connect wallet to view the charts and market, but
// only on an action item 'buy $10 of APPLE'").
//
// The markets pages are open to everyone (lib/app-entry isPublicAppPath). An
// action on them — a Buy chip, the Trade panel's Send, a chart level's ask, a
// watchlist chip — goes through lib/use-connect-to-act, which asks this module
// what to do with it, and how an action held across the Google lane's
// full-page redirect comes back.
//
// Pure: the harness pins the decision table.

/**
 * What an action does on this render.
 *
 *  · 'run': a wallet is connected. Connect to act (rule 6): no session is
 *    needed, and the transaction signature is the ownership proof.
 *  · 'door': nobody is here (lib/app-entry isSignedOut). Hold the ask and
 *    open the unified door on its connect-only lanes.
 *  · 'wait': a wallet this browser connected before may still come back
 *    (wagmi's page-load probe). Hold the ask with no door yet: it runs when
 *    the wallet lands, and the door opens if nothing does.
 */
export type ActStep = 'run' | 'door' | 'wait'

export function actStep(s: { walletAddress: string | null; signedOut: boolean }): ActStep {
  if (s.walletAddress) return 'run'
  return s.signedOut ? 'door' : 'wait'
}

// ── The Google lane's way back ──────────────────────────────────────────
// Google sign-in leaves the page for the provider and returns on a fresh
// load, so an action held in memory is gone. The door carries the ask in its
// OAuth intent. Once the embedded wallet is connected, CdpOAuthReturn leaves
// this record for the page it routes to (and fires ACT_RESUME_EVENT for a
// page that is already up); that page takes the record and runs the ask.
// Nothing is written unless the connect succeeded, the record lives in
// sessionStorage (this tab only), and it goes stale in a minute, so a later
// visit never fires an old ask.

export const ACT_RESUME_KEY = 'pantessa.actResume'
export const ACT_RESUME_EVENT = 'pantessa:act-resume'
export const ACT_RESUME_TTL_MS = 60_000

/** The record CdpOAuthReturn stores: the ask, and the path it routes to. */
export function actResumeRecord(redirectTo: string, ask: string, now: number): string {
  return JSON.stringify({ path: redirectTo.split(/[?#]/)[0], ask, at: now })
}

/**
 * Reads the stored record on `pathname`. `ask` is the action to run: the
 * record belongs to this page and is fresh. `clear` says to remove it: it
 * was taken, or it is stale or unreadable. A fresh record for another page
 * stays for that page.
 */
export function takeActResume(raw: string | null, pathname: string, now: number): { ask: string | null; clear: boolean } {
  if (raw === null) return { ask: null, clear: false }
  let rec: unknown
  try {
    rec = JSON.parse(raw)
  } catch {
    return { ask: null, clear: true }
  }
  const { path, ask, at } = (rec ?? {}) as { path?: unknown; ask?: unknown; at?: unknown }
  if (typeof path !== 'string' || typeof ask !== 'string' || !ask.trim() || typeof at !== 'number' || !Number.isFinite(at)) {
    return { ask: null, clear: true }
  }
  if (at > now || now - at > ACT_RESUME_TTL_MS) return { ask: null, clear: true }
  if (path !== pathname) return { ask: null, clear: false }
  return { ask, clear: true }
}
