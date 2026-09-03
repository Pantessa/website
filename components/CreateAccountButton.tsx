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
import { walletLaneChips } from '@/lib/wallet-lineup'
import { WALLET_MARKS } from '@/components/wallet-marks'
import { PantessaMark } from '@/components/Logo'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/session'
import { OAUTH_INTENT_KEY } from '@/components/CdpOAuthReturn'

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
 * there's no second prompt); Navigation's useAccountEffect then routes them in.
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
  redirectTo = '/dashboard',
  walletConnectOnly = false,
}: {
  className?: string
  /** Inline trigger styling — branded /i splashes repaint the CTA in the
   *  creator's accent (brandCtaStyle). */
  style?: CSSProperties
  label?: ReactNode
  /** Where to land after a successful sign-in (email or wallet). */
  redirectTo?: string
  /** Connect-to-act surfaces (/i): the wallet lane only CONNECTS — no SIWE
   *  request fires (the run is the guest lane; SIWE is offered post-receipt).
   *  Email/Google lanes are unaffected: their CDP auth IS their wallet, and
   *  any signature they later make is silent (no extension popup). */
  walletConnectOnly?: boolean
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} style={style} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && (
        <CreateAccountModal onClose={() => setOpen(false)} redirectTo={redirectTo} walletConnectOnly={walletConnectOnly} />
      )}
    </>
  )
}

type Step = 'email' | 'otp' | 'connecting'

function CreateAccountModal({
  onClose,
  redirectTo,
  walletConnectOnly,
}: {
  onClose: () => void
  redirectTo: string
  walletConnectOnly?: boolean
}) {
  const router = useRouter()
  const { connectAndSignIn } = useSession()
  const { openConnectModal } = useConnectModal()
  const { isInitialized } = useIsInitialized()
  const { signInWithEmail } = useSignInWithEmail()
  const { verifyEmailOTP } = useVerifyEmailOTP()
  const { signInWithOAuth } = useSignInWithOAuth()
  const { connectAsync, connectors } = useConnect()

  // Social sign-in is a full-page redirect to the provider. Persist the intent
  // so CdpOAuthReturn can connect wagmi + route once the browser comes back.
  function startOAuth(provider: 'google') {
    try {
      sessionStorage.setItem(OAUTH_INTENT_KEY, JSON.stringify({ redirectTo }))
    } catch {
      /* storage blocked — the return handler just falls back to /dashboard */
    }
    void signInWithOAuth(provider)
  }

  const [mounted, setMounted] = useState(false)
  const [step, setStep] = useState<Step>('email')
  const [email, setEmail] = useState('')
  const [flowId, setFlowId] = useState('')
  const [otp, setOtp] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => setMounted(true), [])

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
      // Enter the app. (The old Navigation.useAccountEffect that did this on any
      // connect was removed — post-auth routing now lives with each entry point.)
      onClose()
      router.push(redirectTo)
    } catch (err) {
      setError(messageFrom(err, 'That code did not verify. Try again.'))
      setStep('otp')
    } finally {
      setBusy(false)
    }
  }

  if (!mounted) return null

  return createPortal(
    <div className="ca">
      <button className="ca__backdrop" aria-label="Close" onClick={onClose} />
      {/* The stone's light — behind the panel, unclipped, so the door reads as
          lit from within rather than pasted onto black. */}
      <div className="ca__glow" aria-hidden="true" />
      <div className="ca__panel" role="dialog" aria-modal="true" aria-label="Sign in or create an account">
        <button className="ca__close" aria-label="Dismiss" onClick={onClose}>
          <X width={16} height={16} />
        </button>

        {step === 'email' && (
          <form onSubmit={sendCode}>
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
                if (walletConnectOnly) openConnectModal?.()
                else connectAndSignIn(redirectTo)
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

            {/* ONE divider, and it names which half is yours — the wallet lane
                assumes you have one; everything below MAKES you one. Two bare
                "OR"s read as three competing choices. */}
            <div className="ca__or"><span />new here?<span /></div>

            {/* Lane 2 — social sign-in (CDP). Redirects to the provider. */}
            <div className="ca__providers">
              {OAUTH_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="ca__oauth"
                  onClick={() => startOAuth(p.id)}
                  disabled={!isInitialized}
                  aria-label={p.label}
                  title={p.label}
                >
                  {/* Visible label, not glyph-only: with a single provider the
                      icon-row design read as a wide empty button with a "G"
                      in it (375px stranger drill, squad 2026-08-18). */}
                  <GoogleGlyph /> {p.label}
                </button>
              ))}
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
                {busy || !isInitialized
                  ? <Loader2 className="ca__spin" width={17} height={17} />
                  : <ArrowRight width={18} height={18} />}
              </button>
            </div>
            {error && <p className="ca__error" role="alert">{error}</p>}
            <p id="ca-email-hint" className="ca__fine">
              {!isInitialized
                ? 'Preparing the email lane…'
                : busy
                  ? 'Sending your code…'
                  : "We'll email you a 6-digit code — no password, no extension."}
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
