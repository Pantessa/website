'use client'

import { useEffect, useRef, useState, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { useRouter } from 'next/navigation'
import { useConnect } from 'wagmi'
import { CDP_CONNECTOR_ID } from '@coinbase/cdp-wagmi'
import {
  useSignInWithEmail,
  useVerifyEmailOTP,
  useSignInWithOAuth,
  useIsInitialized,
} from '@coinbase/cdp-hooks'
import { Loader2, Mail, ArrowLeft, X, Wallet } from 'lucide-react'
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
  label = 'Create an account',
  redirectTo = '/dashboard',
}: {
  className?: string
  label?: ReactNode
  /** Where to land after a successful sign-in (email or wallet). */
  redirectTo?: string
}) {
  const [open, setOpen] = useState(false)
  return (
    <>
      <button type="button" className={className} onClick={() => setOpen(true)}>
        {label}
      </button>
      {open && <CreateAccountModal onClose={() => setOpen(false)} redirectTo={redirectTo} />}
    </>
  )
}

type Step = 'email' | 'otp' | 'connecting'

function CreateAccountModal({ onClose, redirectTo }: { onClose: () => void; redirectTo: string }) {
  const router = useRouter()
  const { connectAndSignIn } = useSession()
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
      <div className="ca__panel" role="dialog" aria-modal="true" aria-label="Sign in or create an account">
        <button className="ca__close" aria-label="Dismiss" onClick={onClose}>
          <X width={16} height={16} />
        </button>

        {step === 'email' && (
          <form onSubmit={sendCode}>
            <div className="ca__icon"><Mail width={20} height={20} /></div>
            <h2 className="ca__title">Sign in to Yeetful</h2>
            <p className="ca__sub">
              Continue with Google — or use email. New here, we create your secure
              non-custodial wallet; returning, we sign you back in. Already have a wallet? Connect it
              below.
            </p>

            {/* Social sign-in (CDP) — each redirects to the provider. */}
            <div className="ca__providers">
              {OAUTH_PROVIDERS.map((p) => (
                <button
                  key={p.id}
                  type="button"
                  className="ca__oauth"
                  onClick={() => startOAuth(p.id)}
                  disabled={!isInitialized}
                >
                  {p.label}
                </button>
              ))}
            </div>

            <div className="ca__or" aria-hidden="true">
              <span />or<span />
            </div>

            <label className="ca__label" htmlFor="ca-email">Email</label>
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
            />
            {error && <p className="ca__error" role="alert">{error}</p>}
            <button type="submit" className="ca__submit" disabled={busy || !isInitialized}>
              {busy ? <Loader2 className="ca__spin" width={16} height={16} /> : null}
              {!isInitialized ? 'Starting…' : busy ? 'Sending…' : 'Continue with email'}
            </button>

            {/* Or hand off to the wallet flow: close this modal, open the wagmi
                connect modal, and (via connectAndSignIn) sign once connected. */}
            <div className="ca__or" aria-hidden="true">
              <span />or<span />
            </div>
            <button
              type="button"
              className="ca__wallet"
              onClick={() => {
                connectAndSignIn(redirectTo)
                onClose()
              }}
            >
              <Wallet width={16} height={16} /> Connect a wallet
            </button>

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
            <h2 className="ca__title">Enter your code</h2>
            <p className="ca__sub">
              We sent a 6-digit code to <strong>{email}</strong>. Enter it to continue.
            </p>
            <label className="ca__label" htmlFor="ca-otp">Verification code</label>
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
              className="ca__input ca__input--otp"
              aria-describedby="ca-otp-hint"
            />
            <p id="ca-otp-hint" className="ca__fine">Enter the 6-digit code we emailed you.</p>
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
            <Loader2 className="ca__spin ca__spin--lg" width={28} height={28} />
            <p className="ca__sub">Setting up your wallet…</p>
          </div>
        )}
      </div>
    </div>,
    document.body,
  )
}

function messageFrom(err: unknown, fallback: string): string {
  if (err && typeof err === 'object' && 'message' in err) {
    const m = (err as { message?: unknown }).message
    if (typeof m === 'string' && m.length > 0 && m.length < 200) return m
  }
  return fallback
}
