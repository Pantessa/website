'use client'

import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { useConnect } from 'wagmi'
import { CDP_CONNECTOR_ID } from '@coinbase/cdp-wagmi'
import {
  useSignInWithEmail,
  useVerifyEmailOTP,
  useSignInWithOAuth,
  useIsInitialized,
} from '@coinbase/cdp-hooks'
import { Loader2, ArrowLeft, ArrowRight, X, Wallet } from 'lucide-react'
import { CDP_INIT_PATIENCE_MS, emailLaneHint, walletLaneChips } from '@/lib/wallet-lineup'
import { analytics } from '@/lib/analytics'
import { WALLET_MARKS } from '@/components/wallet-marks'
import { oauthAllowedIn, oauthRefusedCopy } from '@/lib/mobile-wallet'
import { armMetaMaskLaunch } from '@/lib/wallet-arm'
import { PantessaMark } from '@/components/Logo'
import { cn } from '@/lib/utils'
import { currentAppHref, signInLandingHere, useSession } from '@/lib/session'
import { OAUTH_INTENT_KEY, type OAuthIntent } from '@/components/CdpOAuthReturn'
import { sameAppHref } from '@/lib/app-entry'
import { inAppBrowserOf, inAppEscapeCopy, type InAppBrowser } from '@/lib/inapp-browser'

// Social providers via CDP Embedded Wallets. Enable each + set its OAuth client
// id/secret and redirect URIs in the CDP Portal; the app needs only the project
// id (NEXT_PUBLIC_CDP_PROJECT_ID). X/Twitter is parked for now — re-add
// { id: 'x', label: 'Continue with X' } once it's configured in the portal.
const OAUTH_PROVIDERS = [
  { id: 'google', label: 'Continue with Google' },
] as const

/**
 * "Create an account" — the dead-simple, no-extension onboarding path.
 *
 * A newcomer enters an email, gets a 6-digit code, and ends up with a
 * Coinbase CDP Embedded (non-custodial) wallet connected to wagmi — at which
 * point the rest of the app (SIWE sign-in, x402 signing, the dashboard) treats
 * them exactly like a MetaMask user. After the OTP verifies we connect the CDP
 * wagmi connector explicitly (it reuses the just-authenticated CDP session, so
 * there's no second prompt), then sign them in: this is the account door (sign
 * in to keep, rule 6), the dashboard's gate needs a SIWE session, and the
 * embedded wallet signs the message without a prompt. Then they land on the
 * door's `redirectTo`, or, without one, stay on the page they're on (Markets
 * from the landing page). The Google lane does the same after its redirect
 * (CdpOAuthReturn). A connect-only door (`walletConnectOnly`) stops at the
 * connect on every lane.
 *
 * Only mount this when `cdpEnabled` (the CDP hooks require CDPHooksProvider,
 * which Providers.tsx only renders when NEXT_PUBLIC_CDP_PROJECT_ID is set).
 *
 * The trigger styling is caller-supplied (`className` + `label`) so the same
 * flow drops into the nav pill row and the hero CTA row unchanged.
 */
export default function CreateAccountButton({
  className,
  style,
  label = 'Create an account',
  redirectTo,
  walletConnectOnly = false,
  onOpenChange,
}: {
  className?: string
  /** Inline trigger styling — branded /i splashes repaint the CTA in the
   *  creator's accent (brandCtaStyle). */
  style?: CSSProperties
  label?: ReactNode
  /** Where to land after a successful sign-in, when the door has a flow of
   *  its own (a SpineLink's target, a plan checkout). Leave it off and the
   *  sign-in keeps the visitor on the page they're on, or goes to Markets
   *  from the landing page (lib/app-entry signInLandingFor), read when they
   *  act. */
  redirectTo?: string
  /** Connect-to-act surfaces (/i, /chat's connect gate): every lane only
   *  CONNECTS — no SIWE request fires (the run is the guest lane; SIWE is
   *  offered post-receipt). The wallet lane skips connectAndSignIn, and the
   *  email and Google lanes skip the sign-in that otherwise follows their
   *  connect. */
  walletConnectOnly?: boolean
  /** Fires when the door opens/closes — a caller that armed something on
   *  the click (the chat's connect gate) needs to know the door went away
   *  WITHOUT a connection, or its "Connecting…" state never releases. */
  onOpenChange?: (open: boolean) => void
}) {
  const [open, setOpenState] = useState(false)
  const setOpen = (next: boolean) => {
    setOpenState(next)
    onOpenChange?.(next)
  }
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setOpen(true)} data-sheet-open="door">
        {label}
      </button>
      {open && (
        <CreateAccountModal onClose={() => setOpen(false)} redirectTo={redirectTo} walletConnectOnly={walletConnectOnly} />
      )}
    </>
  )
}

type Step = 'email' | 'otp' | 'connecting'

/** The door without its trigger button — for a caller whose trigger is
 *  something else (SpineLink opens it from a plain link). cdpEnabled only:
 *  it runs on the CDP hooks. */
export function CreateAccountModal({
  onClose,
  redirectTo,
  walletConnectOnly,
  resumeAsk,
}: {
  onClose: () => void
  /** A flow target of the caller's own; see CreateAccountButton. */
  redirectTo?: string
  walletConnectOnly?: boolean
  /** An action held on a public page (lib/use-connect-to-act). The Google
   *  lane leaves the page, so the ask rides the OAuth intent and the page
   *  runs it once the wallet is back. */
  resumeAsk?: string
}) {
  const router = useRouter()
  const { connectAndSignIn, signInOnceConnected } = useSession()
  const { openConnectModal } = useConnectModal()
  const { isInitialized } = useIsInitialized()
  const { signInWithEmail } = useSignInWithEmail()
  const { verifyEmailOTP } = useVerifyEmailOTP()
  const { signInWithOAuth } = useSignInWithOAuth()
  const { connectAsync, connectors } = useConnect()

  // Where this door's sign-in lands, read when the visitor acts: the caller's
  // flow target, else the page they're on (Markets from the landing page).
  const landing = () => redirectTo ?? signInLandingHere()

  // Social sign-in is a full-page redirect to the provider. Persist the intent
  // so CdpOAuthReturn can connect wagmi, sign in (unless this door is
  // connect-only), hand a held action back to its page, and route once the
  // browser comes back. The provider returns to this very page.
  function startOAuth(provider: 'google') {
    // Inside an app's embedded WebView (X, LinkedIn, a bare WKWebView) Google
    // refuses OAuth outright (`disallowed_useragent`); the lane would leave
    // and come back to Google's error page. Say so here, on the door, and
    // point at the lane that works there (lib/mobile-wallet oauthAllowedIn;
    // the reading is LINKS's lib/inapp-browser).
    const browser = inAppBrowserOf(navigator.userAgent)
    if (!oauthAllowedIn(browser)) {
      setError(oauthRefusedCopy(inAppEscapeCopy(browser)))
      return
    }
    analytics.signInDoor('lane', { lane: provider })
    const intent: OAuthIntent = { redirectTo: landing(), signIn: !walletConnectOnly }
    if (resumeAsk) intent.resumeAsk = resumeAsk
    try {
      sessionStorage.setItem(OAUTH_INTENT_KEY, JSON.stringify(intent))
    } catch {
      /* storage blocked — the return handler falls back to the sign-in landing */
    }
    void signInWithOAuth(provider)
  }

  const [mounted, setMounted] = useState(false)
  // The browser this door is being read in, resolved ONCE after mount. Never
  // at render: the server has no UA, and a value that differs between the two
  // passes is a hydration mismatch (CONNECT's contract, squad
  // mobile-onboarding 2026-09-23).
  const [browser, setBrowser] = useState<InAppBrowser | null>(null)
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [flowId, setFlowId] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    setMounted(true)
    setBrowser(inAppBrowserOf(navigator.userAgent))
  }, [])

  // The door's own story, for the journey log (lib/journey.ts): it opened,
  // and anything it told the visitor went wrong. A stranger who backs out
  // here is otherwise indistinguishable from one who never tried.
  useEffect(() => {
    analytics.signInDoor('open', { connectOnly: walletConnectOnly === true })
  }, [walletConnectOnly])
  // On a phone the MetaMask lane is the MetaMask SDK, whose app launch waits
  // on a relay socket ack (+0.8s after the tap) — a continuation WebKit never
  // treats as user-initiated. Arm it the moment the door opens: the SDK's
  // connection starts now with the launch held, and the MetaMask tap then
  // navigates synchronously to the link it built (lib/wallet-arm).
  useEffect(() => {
    void armMetaMaskLaunch(connectors)
  }, [connectors])
  useEffect(() => {
    if (error) analytics.signInDoor('error', { message: error.slice(0, 120), step })
    // eslint-disable-next-line react-hooks/exhaustive-deps -- one row per message, not per step change
  }, [error])

  // The CDP SDK (Google + email lanes) inits with a cross-origin config
  // fetch; when a blocker or a filter kills it, the lanes would spin
  // forever. After CDP_INIT_PATIENCE_MS the door says so and points at the
  // wallet lane, which works on its own (lib/wallet-lineup emailLaneHint).
  const [cdpTimedOut, setCdpTimedOut] = useState(false)
  useEffect(() => {
    if (isInitialized) return
    const t = setTimeout(() => {
      setCdpTimedOut(true)
      analytics.signInDoor('cdp_timeout')
    }, CDP_INIT_PATIENCE_MS)
    return () => clearTimeout(t)
  }, [isInitialized])

  // Close on Escape; lock body scroll while open.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [onClose])

  // Focus the active input as steps change.
  useEffect(() => {
    inputRef.current?.focus()
  }, [step])

  async function sendCode(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const addr = email.trim()
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(addr)) {
      setError('Enter a valid email address.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const { flowId } = await signInWithEmail({ email: addr })
      analytics.signInDoor('code_sent')
      setFlowId(flowId)
      setOtp('')
      setStep('otp')
    } catch (err) {
      setError(messageFrom(err, 'Could not send the code. Try again.'))
    } finally {
      setBusy(false)
    }
  }

  async function verify(e: React.FormEvent) {
    e.preventDefault()
    if (busy) return
    const code = otp.trim()
    if (code.length < 6) {
      setError('Enter the 6-digit code from your email.')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await verifyEmailOTP({ flowId, otp: code })
      // Authenticated with CDP — now hand the embedded wallet to wagmi so the
      // whole app sees a normal connected account (no second prompt).
      setStep('connecting')
      const connector = connectors.find((c) => c.id === CDP_CONNECTOR_ID)
      if (!connector) throw new Error('Embedded wallet connector unavailable.')
      await connectAsync({ connector })
      if (walletConnectOnly) {
        // Connect to act: the connection is the whole step on this door. It
        // writes no session, so staying on this page needs no refresh.
        const to = landing()
        onClose()
        if (!sameAppHref(to, currentAppHref())) router.push(to)
      } else {
        // Sign in to keep: mint the SIWE session the account surfaces gate
        // on (the dashboard sent every account made here home without one).
        // The embedded wallet signs without a prompt, in the session rather
        // than this door: the connect can swap the door's host for the
        // account pill (the nav's does) and take the door with it, and the
        // sign-in still lands where it was headed. A slow one shows the silent
        // "Signing you in…" card.
        await signInOnceConnected(landing())
        onClose()
      }
    } catch (err) {
      setError(messageFrom(err, 'That code did not verify. Try again.'))
      setStep('otp')
    } finally {
      setBusy(false)
    }
  }

  if (!mounted) return null

  // Inside an app's own browser (X, LinkedIn, a bare WebView) two of the
  // three lanes cannot work and the door used to say nothing: Google refuses
  // OAuth there outright (`disallowed_useragent`, its documented policy) and
  // no `metamask://` launch can bring a wallet app forward. So the door
  // re-reads itself: email leads, the other two carry a caption saying what
  // is in the way and how to get out. Nothing is disabled here — CONNECT owns
  // whether a lane fires; this is the layout and the words (squad
  // mobile-onboarding, 2026-09-23).
  // A wallet's OWN browser is the good case (`canLaunchApps`): the wallet is
  // injected, signing happens in-page, and the wallet lane is exactly right
  // there. `walled` is the other kind.
  const walled = !!browser && browser.inApp && !browser.canLaunchApps
  const escape = inAppEscapeCopy(browser ?? { inApp: false, vendor: null, canLaunchApps: true, walletInjected: false, platform: 'other' })
  // One reading for the Google lane, shared with the connect behaviour that
  // refuses the redirect (lib/mobile-wallet oauthAllowedIn).
  const oauthOk = !browser || oauthAllowedIn(browser)

  return createPortal(
    <div className="ca" data-sheet="door">
      <button className="ca__backdrop" aria-label="Close" onClick={onClose} />
      {/* The stone's light — behind the panel, unclipped, so the door reads as
          lit from within rather than pasted onto black. */}
      <div className="ca__glow" aria-hidden="true" />
      <div className="ca__panel" role="dialog" aria-modal="true" aria-label="Sign in or create an account">
        <button className="ca__close" aria-label="Dismiss" onClick={onClose}>
          <X width={16} height={16} />
        </button>

        {step === 'email' && (
          <form onSubmit={sendCode} className={`ca__form${walled ? ' ca__form--walled' : ''}`}>
            {/* The stone leads. An emerald cut is nested step facets around an
                open table — the flat plane where a signature lands — which is
                what this door is, so the mark carries the header instead of a
                stock envelope glyph. */}
            <div className="ca__crest">
              <PantessaMark size={68} className="ca__gem" />
            </div>
            {/* Connect-to-act surfaces (/i) never say "sign in": connecting IS
                the whole step there (rule 6). */}
            <h2 className="ca__title">{walletConnectOnly ? 'Connect a wallet' : 'Sign in to Pantessa'}</h2>
            {/* The security model, stated on the door itself. A first-time
                visitor's real question is "is this safe?", and answering it
                before anything is clicked is the whole point of this line. */}
            <p className="ca__promise">
              <strong>Your wallet is the only signer.</strong> We never hold your funds or your keys.
            </p>
            {walled && (
              <p className="ca__inapp" role="status">
                You&rsquo;re in {escape.app}&rsquo;s built-in browser, which can&rsquo;t open a wallet app or
                Google sign-in. Email works here &mdash; or {escape.where} to use the rest.
              </p>
            )}

            {/* Lane 1 — connect an existing wallet. It wears the accent fill
                because it IS the product's front door (rule 6: wallet lead).
                Closes this modal and opens the wagmi connect modal. Default:
                connectAndSignIn fires SIWE once connected. walletConnectOnly
                (connect-to-act surfaces): connect IS the whole step — no
                signature request. */}
            <button
              type="button"
              className="ca__wallet ca__wallet--lead"
              onClick={() => {
                analytics.signInDoor('lane', { lane: 'wallet' })
                if (walletConnectOnly) openConnectModal?.()
                else connectAndSignIn(landing())
                onClose()
              }}
            >
              <Wallet width={17} height={17} /> Connect a wallet
              <ArrowRight className="ca__walletarrow" width={15} height={15} />
            </button>
            {/* Which wallets actually sign here — as their own logos, which
                are read at a glance where a row of names has to be parsed.
                Lanes come from walletLineup() via walletLaneChips, so the
                lineup keeps its ONE source: with a WC project id the QR lanes
                join and their logos appear for free. Decorative to the eye,
                named to a screen reader. */}
            <ul className="ca__lanes" aria-label="Wallets you can sign in with">
              {walletLaneChips(process.env.NEXT_PUBLIC_WC_PROJECT_ID).map(({ id, name }) => {
                const Mark = WALLET_MARKS[id]
                return (
                  <li key={id} className="ca__lane" title={name}>
                    <Mark size={26} />
                    <span className="sr-only">{name}</span>
                  </li>
                )
              })}
            </ul>
            {walled && (
              <p className="ca__lanenote">Opening a wallet app from here is blocked by {escape.app}.</p>
            )}

            {/* ONE divider, and it names which half is yours — the wallet lane
                assumes you have one; everything below MAKES you one. Two bare
                "OR"s read as three competing choices. */}
            <div className="ca__or"><span />{walled ? 'have a wallet app?' : 'new here?'}<span /></div>

            {/* Lane 2 — social sign-in (CDP). Redirects to the provider. */}
            <div className="ca__providers">
              {OAUTH_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="ca__oauth"
                  onClick={() => startOAuth(p.id)}
                  disabled={!isInitialized}
                  aria-disabled={!oauthOk || undefined}
                  aria-label={p.label}
                  title={!oauthOk ? oauthRefusedCopy(escape) : cdpTimedOut && !isInitialized ? 'Unavailable right now — the sign-in provider is unreachable. Connect a wallet instead.' : p.label}
                >
                  {/* Visible label, not glyph-only: with a single provider the
                      icon-row design read as a wide empty button with a "G"
                      in it (375px stranger drill, squad 2026-08-18). */}
                  <GoogleGlyph /> {p.label}
                </button>
              ))}
              {/* The shared refusal line (lib/mobile-wallet oauthRefusedCopy)
                  names the email code without a direction — in this layout the
                  email row LEADS — so the caption states the fact and the full
                  line stays on the button's title. */}
              {!oauthOk && <p className="ca__lanenote">Google won&rsquo;t sign you in inside {escape.app}&rsquo;s browser.</p>}
            </div>

            {/* Lane 3 — email OTP, as ONE row (field + accent submit) rather
                than label/field/full-width-button stacked. Same reach, ~120px
                less door. The submit still carries the SDK-boot loading state:
                a spinner + "preparing" copy below, never a disabled button
                stuck on "Starting…" (that read as broken). */}
            <div className="ca__emailrow">
              <label className="sr-only" htmlFor="ca-email">Email</label>
              <input
                ref={inputRef}
                id="ca-email"
                type="email"
                autoComplete="email"
                inputMode="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="ca__input"
                aria-describedby="ca-email-hint"
              />
              <button
                type="submit"
                className="ca__go"
                disabled={busy || !isInitialized}
                aria-busy={busy || !isInitialized}
                aria-label="Continue with email"
                title="Continue with email"
              >
                {busy || (!isInitialized && !cdpTimedOut)
                  ? <Loader2 className="ca__spin" width={17} height={17} />
                  : <ArrowRight width={18} height={18} />}
              </button>
            </div>
            {error && <p className="ca__error" role="alert">{error}</p>}
            <p id="ca-email-hint" className="ca__fine" role={cdpTimedOut && !isInitialized ? 'status' : undefined}>
              {emailLaneHint({ initialized: isInitialized, busy, timedOut: cdpTimedOut })}
            </p>

            <p className="ca__consent">
              By continuing you agree to our{' '}
              <a href="/docs/terms" target="_blank" rel="noopener noreferrer">Terms</a> and{' '}
              <a href="/docs/privacy" target="_blank" rel="noopener noreferrer">Privacy Policy</a>.
            </p>
          </form>
        )}

        {step === 'otp' && (
          <form onSubmit={verify}>
            <button type="button" className="ca__back" onClick={() => { setStep('email'); setError(null) }}>
              <ArrowLeft width={14} height={14} /> Back
            </button>
            <div className="ca__crest">
              <PantessaMark size={40} className="ca__gem" />
            </div>
            <h2 className="ca__title">Check your email</h2>
            <p className="ca__promise">
              We sent a 6-digit code to <strong>{email}</strong>.
            </p>
            <label className="sr-only" htmlFor="ca-otp">Verification code</label>
            <input
              ref={inputRef}
              id="ca-otp"
              type="text"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={6}
              placeholder="123456"
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, ''))}
              className="ca__input ca__input--otp ca__input--spaced"
              aria-describedby="ca-otp-hint"
            />
            <p id="ca-otp-hint" className="ca__fine">Enter it here to finish — the code expires shortly.</p>
            {error && <p className="ca__error" role="alert">{error}</p>}
            <button type="submit" className="ca__submit" disabled={busy}>
              {busy ? <Loader2 className="ca__spin" width={16} height={16} /> : null}
              {busy ? 'Verifying…' : 'Verify & continue'}
            </button>
            <button type="button" className="ca__resend" onClick={sendCode} disabled={busy}>
              Resend code
            </button>
          </form>
        )}

        {step === 'connecting' && (
          <div className="ca__connecting">
            <PantessaMark size={44} className="ca__gem ca__gem--pulse" />
            <p className="ca__sub">Setting up your wallet…</p>
            <Loader2 className="ca__spin" width={18} height={18} />
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

/** The official multi-color Google "G" mark — the OAuth button is now icon-only. */
function GoogleGlyph() {
  return (
    <svg width={18} height={18} viewBox="0 0 18 18" aria-hidden="true" focusable="false">
      <path
        fill="#4285F4"
        d="M17.64 9.2c0-.637-.057-1.251-.164-1.84H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
      />
      <path
        fill="#34A853"
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
      />
      <path
        fill="#FBBC05"
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
      />
      <path
        fill="#EA4335"
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
      />
    </svg>
  )
}

function messageFrom(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string' && m.length > 0 && m.length < 200) return m
  }
  return fallback
}
