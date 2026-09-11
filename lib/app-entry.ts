// Who stands in the app shell, and where a fresh sign-in lands (2026-09-11,
// Nate: "if the user is inside markets, or App or anytime the left side bar
// is there and they are not logged in, let's take them to the root home
// page. Also on a fresh login let's take users to the markets page, not the
// setting / dashboard").
//
// The spine surfaces — /markets, /t/<symbol>, /chat, the dashboard — are the
// signed-in app. AppSpine sends a signed-out visitor home; the dashboard
// keeps its own stricter gate (a SIWE session, app/dashboard/layout.tsx).
// Links INTO the shell from outside it open the sign-in door instead of
// bouncing (components/SpineLink).
//
// "Signed out" is what the account slot means when it shows "Sign in": no
// wallet connected AND no session. A connected wallet without SIWE is in —
// connecting is enough to act (rule 6: connect to act, sign in to keep), and
// a connect-only door (/i, /chat's connect gate) connects the embedded
// wallet without a SIWE round-trip, so a SIWE-only gate would bounce the
// account holders it just made.
//
// Pure: the harness pins the decision table.

/** Where a sign-in with no flow of its own lands — the brochure nav's door,
 *  the account menu, the landing's CTAs, the Google return. Flow doors (a
 *  chat deep link, a plan checkout, a markets page) keep their own target. */
export const SIGN_IN_LANDING = '/markets'

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
