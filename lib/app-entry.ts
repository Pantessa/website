// Who stands in the app shell, and where a sign-in lands (2026-09-11, Nate:
// "if the user is inside markets, or App or anytime the left side bar is
// there and they are not logged in, let's take them to the root home page.
// Also on a fresh login let's take users to the markets page, not the
// setting / dashboard"). A fresh login means one from the landing page:
// anywhere else a sign-in keeps the visitor where they are (2026-09-16,
// signInLandingFor).
//
// The spine surfaces /chat, /wallet and the dashboard are the signed-in app.
// AppSpine sends a signed-out visitor home; the dashboard keeps its own
// stricter gate (a SIWE session, app/dashboard/layout.tsx). The markets
// surface (/markets, /t/<symbol>) mounts the spine too, but it is public
// (isPublicAppPath, 2026-09-14): looking needs no wallet, and an action there
// asks for one (lib/use-connect-to-act). Links INTO the signed-in app from
// outside it open the sign-in door instead of bouncing (components/SpineLink).
//
// "Signed out" is what the account slot means when it shows "Sign in": no
// wallet connected AND no session. A connected wallet without SIWE is in —
// connecting is enough to act (rule 6: connect to act, sign in to keep), and
// a connect-only door (/i, /chat's connect gate) connects the embedded
// wallet without a SIWE round-trip, so a SIWE-only gate would bounce the
// account holders it just made.
//
// Pure: the harness pins the decision table.

import { isMarketsPath } from '@/lib/markets'

/** Where a fresh login from the landing page goes (signInLandingFor). */
export const SIGN_IN_LANDING = '/markets'

// ── Where a sign-in lands ────────────────────────────────────────────────
// 2026-09-16, Nate: "If the user is in a chat or anywhere else doing
// something, please do not redirect them to the markets page, keep them
// running on their task, only redirect if they are on the landing and not
// signed in or where it makes sense to not ruin their task process."

/** Base for resolving in-app hrefs; any href that resolves off it left the site. */
const APP_ORIGIN = 'https://pantessa.invalid'

/** Path and query of an in-app href. Null for anything that leaves the site. */
function appHrefParts(href: string): { path: string; search: string } | null {
  if (!href.startsWith('/') || href.startsWith('//') || href.includes('\\')) return null
  let u: URL
  try {
    u = new URL(href, APP_ORIGIN)
  } catch {
    return null
  }
  if (u.origin !== APP_ORIGIN) return null
  return { path: u.pathname, search: u.search }
}

/** The signed-in app pages that send a signed-out visitor home (AppSpine on
 *  /chat and /wallet, the dashboard's layout). Only these are come back to. */
const HOME_RETURN_PATH = /^\/(?:chat|wallet|dashboard)(?:\/|$)/
const HOME_RETURN_MAX_CHARS = 2048

/**
 * The page a signed-out visitor was sent home from, when it is worth coming
 * back to: one of the signed-in app pages above, on this site. Anything else
 * (another site, an API route, an over-long URL) is null.
 */
export function homeReturnHref(raw: string | null | undefined): string | null {
  if (!raw || raw.length > HOME_RETURN_MAX_CHARS) return null
  const parts = appHrefParts(raw)
  if (!parts || !HOME_RETURN_PATH.test(parts.path)) return null
  return parts.path + parts.search
}

// ── The way back from home ───────────────────────────────────────────────
// The signed-in app sends a visitor who arrives signed out home (AppSpine,
// the dashboard's layout). The page they opened was their task, so the gate
// leaves this record in sessionStorage (this tab only) and a sign-in on the
// landing lands back on it instead of on Markets. It isn't a `?next=` on the
// landing URL: Next 16.2's client router caches a route under its pathname
// with the URL it was first fetched at, so every later soft navigation to /
// in that tab (the logo, a sign-out) came back wearing the stale ?next=.

export const SIGN_IN_RETURN_KEY = 'pantessa.signInReturn'
export const SIGN_IN_RETURN_TTL_MS = 30 * 60_000

/** The record a signed-out gate leaves for `here`, or null when `here` isn't
 *  a page to come back to. */
export function signInReturnRecord(here: string, now: number): string | null {
  const href = homeReturnHref(here)
  return href ? JSON.stringify({ href, at: now }) : null
}

/** The page a stored record names: fresh (under SIGN_IN_RETURN_TTL_MS) and
 *  still a page to come back to. Null for anything else. */
export function readSignInReturn(raw: string | null, now: number): string | null {
  if (!raw) return null
  let rec: unknown
  try {
    rec = JSON.parse(raw)
  } catch {
    return null
  }
  const { href, at } = (rec ?? {}) as { href?: unknown; at?: unknown }
  if (typeof href !== 'string' || typeof at !== 'number' || !Number.isFinite(at)) return null
  if (at > now || now - at > SIGN_IN_RETURN_TTL_MS) return null
  return homeReturnHref(href)
}

/**
 * Where a sign-in lands when its door names no destination of its own: the
 * brochure nav, the account menu, AuthButton, the unified door's default,
 * and every door on a page the visitor is working in (a chat, an intent
 * link, a symbol page).
 *
 *  · On the landing page there is no task to come back to. A fresh login
 *    goes to Markets, or to the app page the visitor was sent home from
 *    (`homeReturn`, the record above): they were already on their way there.
 *  · Anywhere else the sign-in stays: `here` comes back, and lib/session
 *    refreshes that page in place (sameAppHref), with no navigation.
 *
 * `here` is the path and query at the moment the visitor acts. Never read it
 * while rendering: an in-app navigation renders the new page before the
 * router writes the URL, so `window.location` at render can still name the
 * previous page. An /i sign-up landed back on that page that way (#758).
 *
 * A door with a flow of its own (a SpineLink's target, a plan checkout, the
 * mint handoff) passes that target and never asks.
 */
export function signInLandingFor(here: string, homeReturn: string | null = null): string {
  const parts = appHrefParts(here)
  if (!parts) return SIGN_IN_LANDING
  if (parts.path !== '/') return parts.path + parts.search
  return homeReturnHref(homeReturn) ?? SIGN_IN_LANDING
}

/**
 * True when two in-app hrefs name the same page: path (a trailing slash
 * doesn't count) and query, exactly. A sign-in that lands on the page the
 * visitor is already on refreshes it instead of navigating: no history
 * entry, no scroll jump, and the server parts that read the session render
 * again.
 */
export function sameAppHref(a: string, b: string): boolean {
  const pa = appHrefParts(a)
  const pb = appHrefParts(b)
  if (!pa || !pb) return false
  const norm = (p: string) => p.replace(/\/+$/, '') || '/'
  return norm(pa.path) === norm(pb.path) && pa.search === pb.search
}

/**
 * The app surfaces open to a signed-out visitor (2026-09-14, Nate: "I don't
 * think the user should have to connect wallet to view the charts and market,
 * but only on an action item 'buy $10 of APPLE'"): the markets index and every
 * symbol page. AppSpine leaves a visitor there, SpineLink links there plainly,
 * and signing out there stays put. Takes a path or an in-app href; the query
 * and hash don't count.
 */
export function isPublicAppPath(href: string): boolean {
  return isMarketsPath(href.split(/[?#]/)[0])
}

export type SessionStatus = 'loading' | 'authed' | 'guest'
/** wagmi's account status. */
export type WalletStatus = 'connected' | 'connecting' | 'reconnecting' | 'disconnected'

/**
 * True once nobody is here: the session cookie (/api/auth/me) answered with
 * no one, no wallet address is on hand, and no wallet is about to come back.
 *
 * "About to come back" is the hard part. At page load wagmi resets its
 * persisted connection (createConfig sets the initial state before it
 * rehydrates), then probes every connector for whoever still authorizes the
 * site: 'connecting' the whole time, with no address, for a returning wallet
 * and a stranger alike. The probe loads each connector's provider first (the
 * embedded wallet's waits on the CDP SDK's network init), and a full pass
 * measured ~9s in headless Chrome. Waiting it out for everyone left a
 * stranger looking at the app that long before the bounce, and let their
 * clicks into the shell through. So the probe is waited for only when this
 * browser connected a wallet before and hasn't disconnected it since
 * (walletRemembered) — a returning account, email and Google ones included:
 * the embedded wallet restores only once the CDP SDK loads, and those
 * accounts may have no SIWE session to go on. A wallet that still
 * authorizes the site with nothing remembered (storage cleared) lands home
 * and is connected there.
 *
 * The session covers the first beat: wagmi reads 'disconnected' until its
 * mount effect starts the probe, and the session fetch — a network
 * round-trip — can't answer before that.
 */
export function isSignedOut(s: {
  sessionStatus: SessionStatus
  sessionAddress: string | null
  walletStatus: WalletStatus
  walletAddress: string | null
  walletRemembered: boolean
}): boolean {
  if (s.sessionStatus === 'loading') return false
  if (s.sessionAddress || s.walletAddress) return false
  if (s.walletStatus === 'disconnected') return true
  return !s.walletRemembered
}

/**
 * wagmi's own storage says a wallet was connected in this browser and not
 * disconnected since. wagmi writes `recentConnectorId` on every explicit
 * connect (the door, RainbowKit, the embedded wallet's connectAsync) and
 * never clears it; a disconnect sets the injected connectors'
 * `<id>.disconnected` shim. Keys carry wagmi's 'wagmi.' prefix and values
 * are JSON; `read` is localStorage.getItem.
 */
export function walletRemembered(read: (key: string) => string | null): boolean {
  let id: unknown
  try {
    id = JSON.parse(read('wagmi.recentConnectorId') ?? 'null')
  } catch {
    return false
  }
  if (typeof id !== 'string' || !id) return false
  return read(`wagmi.${id}.disconnected`) !== 'true'
}

/**
 * What a pending sign-in does on this render: lib/session.tsx's post-connect
 * effect asks for both kinds.
 *
 *  · connectAndSignIn leaves one while RainbowKit's modal connects a wallet.
 *  · signInOnceConnected leaves one right after the embedded wallet's connect
 *    (the door's email and Google lanes), and its caller waits for the
 *    attempt to settle (`callerWaits`).
 *
 * 'wait' keeps it: the session hasn't hydrated, no wallet is connected yet,
 * or a sign-in is already running and the caller is waiting (that sign-in's
 * answer is the caller's). 'land': a session for THIS wallet exists, so
 * there's nothing to sign. One for another address doesn't count; it's stale
 * (the wallet switched), and session.tsx drops it to 'guest' a render later.
 * 'drop': connectAndSignIn's while a sign-in is already running, which never
 * starts a second one. 'sign': run SIWE for the connected wallet.
 */
export type PendingSignInStep = 'wait' | 'land' | 'sign' | 'drop'

export function pendingSignInStep(s: {
  sessionStatus: SessionStatus
  sessionAddress: string | null
  /** The connected wallet's address; null while none is connected. */
  walletAddress: string | null
  signingIn: boolean
  callerWaits: boolean
}): PendingSignInStep {
  if (s.sessionStatus === 'loading' || !s.walletAddress) return 'wait'
  if (s.sessionStatus === 'authed' && s.sessionAddress?.toLowerCase() === s.walletAddress.toLowerCase()) return 'land'
  if (s.signingIn) return s.callerWaits ? 'wait' : 'drop'
  return 'sign'
}
