'use client'

import { useSyncExternalStore } from 'react'
import { LogIn, Loader2, Sparkles } from 'lucide-react'
import { useSession } from '@/lib/session'
import CreateAccountButton from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { GUEST_TRIAL_LIMIT, guestTurnsUsed, subscribeGuestTrial } from '@/lib/guest-trial'

/**
 * The chat's sign-in surface. It used to be a full-screen scrim that demanded
 * SIWE before a visitor could type ANYTHING — the cohort funnel measured ~93%
 * of arrivals bouncing on it before their first ask. Now:
 *
 *  · Guests get a slim, non-blocking banner and a real guest lane — asking is
 *    free (house model + free MCP calls, the same anonymous lane the embed
 *    has always run on), and anything transactional ends at the in-chat
 *    connect-wallet moment, so a guest turn can never move money.
 *  · Only when the guest trial is exhausted (GUEST_TRIAL_LIMIT turns) does
 *    the blocking scrim return, asking for a wallet to continue.
 *  · A connected-but-unsigned wallet is a FULL participant — connecting is
 *    enough to sign what the chat builds (the tx signature is the ownership
 *    proof that matters). The banner offers SIWE only for what it actually
 *    buys: keeping chats + receipts on the dashboard ("connect to act, sign
 *    in to keep"). Nothing auto-fires a signature request on arrival.
 */
/** Where to land after sign-in: the page the visitor is already on, query
 *  string included — a hardcoded '/chat' used to drop ?mcps=/?prompt= deep
 *  links (the share-page handoff) on the post-sign-in redirect. Client-only
 *  component, so window is available; '/chat' is the SSR-safe fallback. */
function hereWithQuery(): string {
  if (typeof window === 'undefined') return '/chat'
  return window.location.pathname + window.location.search
}

export default function ChatSignInGate() {
  const { status, signingIn, needsSignIn, signIn, connectAndSignIn } = useSession()
  const turnsUsed = useSyncExternalStore(subscribeGuestTrial, guestTurnsUsed, () => 0)

  // Only guests see any of this. During `loading` we stay out of the way to
  // avoid a flash before the session cookie hydrates; `authed` needs no gate.
  if (status !== 'guest') return null

  // A wallet is connected but there's no SIWE session yet — the user just
  // needs to approve the signature request in their wallet.
  const awaitingSignature = needsSignIn
  const turnsLeft = Math.max(0, GUEST_TRIAL_LIMIT - turnsUsed)
  const exhausted = !awaitingSignature && turnsLeft === 0

  const ctaClass =
    'flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--accent)] text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed'

  const signInCta = (label: string) =>
    cdpEnabled ? (
      // Open the full sign-in modal (wallet / Google / email).
      <CreateAccountButton
        className={ctaClass}
        label={
          <>
            <LogIn className="w-4 h-4" strokeWidth={2.5} />
            <span>{label}</span>
          </>
        }
        redirectTo={hereWithQuery()}
      />
    ) : (
      // No embedded-wallet SDK configured — direct wallet SIWE.
      <button
        onClick={() => connectAndSignIn(hereWithQuery())}
        disabled={signingIn}
        type="button"
        title="Connect a wallet and sign in — one step"
        className={ctaClass}
      >
        {signingIn ? <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} /> : <LogIn className="w-4 h-4" strokeWidth={2.5} />}
        <span>{signingIn ? 'Signing in…' : label}</span>
      </button>
    )

  // ── Trial exhausted: the one place the blocking scrim remains ────────────
  if (exhausted) {
    return (
      <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
        <div className="max-w-md text-center">
          <p className="text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--muted-2)]">Guest run complete</p>
          <h2 className="mt-3 text-4xl sm:text-5xl leading-tight text-white" style={{ fontFamily: 'var(--font-serif)' }}>
            Bring a wallet to keep going
          </h2>
          <p className="mt-5 text-sm sm:text-base leading-relaxed text-[color:var(--muted)]">
            That was the guest taste — {GUEST_TRIAL_LIMIT} free asks. Sign in with a wallet to keep your
            chats, see your portfolio, and sign what the chat builds. Asking stays free; money only
            moves when your wallet signs it.
          </p>
          <div className="mt-7 flex justify-center">{signInCta('Sign in to keep going')}</div>
        </div>
      </div>
    )
  }

  // ── Non-blocking banner: guests keep the whole chat interactive ──────────
  return (
    // bottom-28 clears the composer on desktop; below lg the shell adds the
    // 48px bottom tab bar (+ safe area) under the composer, so the banner
    // must ride that much higher or it sits ON the input (375px drill,
    // squad 2026-08-18).
    <div className="pointer-events-none absolute bottom-28 max-lg:bottom-[calc(7.25rem+48px+env(safe-area-inset-bottom))] inset-x-0 z-40 flex justify-center px-4">
      <div className="pointer-events-auto flex flex-wrap items-center justify-center gap-x-4 gap-y-2 max-w-2xl rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] backdrop-blur-md px-4 py-2.5 shadow-[0_8px_32px_rgba(0,0,0,0.35)]">
        <p className="flex items-center gap-2 text-xs text-[color:var(--muted)]">
          <Sparkles className="w-3.5 h-3.5 flex-shrink-0 text-[color:var(--accent)]" />
          {awaitingSignature ? (
            <span>
              <span className="text-white font-medium">Wallet connected — you can sign what it builds.</span>{' '}
              Sign in to keep this chat and your receipts on your dashboard. One signature; nothing
              moves.
            </span>
          ) : (
            <span>
              <span className="text-white font-medium">Ask anything — no wallet needed.</span>{' '}
              {turnsUsed > 0
                ? `${turnsLeft} guest ask${turnsLeft === 1 ? '' : 's'} left. `
                : `${GUEST_TRIAL_LIMIT} free asks to look around. `}
              Connect when you want to sign what it builds.
            </span>
          )}
        </p>
        {awaitingSignature ? (
          <button
            onClick={() => signIn(hereWithQuery())}
            disabled={signingIn}
            type="button"
            title="Sign one message to keep your chats — proves ownership, nothing moves"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-black text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {signingIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2.5} /> : <LogIn className="w-3.5 h-3.5" strokeWidth={2.5} />}
            <span>{signingIn ? 'Waiting…' : 'Sign in to keep'}</span>
          </button>
        ) : cdpEnabled ? (
          <CreateAccountButton
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-black text-xs font-semibold hover:opacity-90 transition-opacity"
            label={
              <>
                <LogIn className="w-3.5 h-3.5" strokeWidth={2.5} />
                <span>Sign in</span>
              </>
            }
            redirectTo={hereWithQuery()}
          />
        ) : (
          <button
            onClick={() => connectAndSignIn(hereWithQuery())}
            disabled={signingIn}
            type="button"
            title="Connect a wallet and sign in — one step"
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-[var(--accent)] text-black text-xs font-semibold hover:opacity-90 transition-opacity disabled:opacity-60"
          >
            {signingIn ? <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2.5} /> : <LogIn className="w-3.5 h-3.5" strokeWidth={2.5} />}
            <span>{signingIn ? 'Signing in…' : 'Sign in'}</span>
          </button>
        )}
      </div>
    </div>
  )
}
