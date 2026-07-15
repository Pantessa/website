'use client'

import { LogIn, Loader2 } from 'lucide-react'
import { useSession } from '@/lib/session'
import CreateAccountButton from '@/components/CreateAccountButton'
import { cdpEnabled } from '@/lib/cdp-embedded'

/**
 * Sign-in gate for the chat surface. While a visitor is a guest (wallet not
 * signed in via SIWE) we overlay the whole workspace with a near-opaque scrim —
 * the chat stays faintly visible behind it, but is non-interactive — explaining
 * what the chat is and prompting sign-in. Once authed (or while the session is
 * still hydrating) we render nothing so the chat is fully usable.
 */
export default function ChatSignInGate() {
  const { status, signingIn, needsSignIn, signIn, connectAndSignIn } = useSession()

  // Only block confirmed guests. During `loading` we stay out of the way to
  // avoid a flash before the session cookie hydrates; `authed` needs no gate.
  if (status !== 'guest') return null

  // A wallet is connected but there's no SIWE session yet — the user just needs
  // to approve the signature request in their wallet. Swap the copy + CTA to
  // point them at that pending prompt instead of the initial sign-in pitch.
  const awaitingSignature = needsSignIn

  const ctaClass =
    'flex items-center gap-2 px-5 py-2.5 rounded-full bg-[var(--accent)] text-black text-sm font-semibold hover:opacity-90 transition-opacity disabled:opacity-60 disabled:cursor-not-allowed'

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
      <div className="max-w-md text-center">
        <p className="text-xs font-medium uppercase tracking-[0.2em] text-[color:var(--muted-2)]">
          {awaitingSignature ? 'Almost there' : 'Sandbox'}
        </p>
        <h2
          className="mt-3 text-4xl sm:text-5xl leading-tight text-white"
          style={{ fontFamily: 'var(--font-serif)' }}
        >
          {awaitingSignature ? 'Waiting for Signature' : 'Beta Mode'}
        </h2>
        <p className="mt-5 text-sm sm:text-base leading-relaxed text-[color:var(--muted)]">
          {awaitingSignature
            ? 'Check your wallet and approve the signature request to finish signing in — it just proves you own this wallet, no funds are moved.'
            : 'Yeetful is just getting started. This chat spends real funds — it pays per call from the USDC and ETH in your connected wallet. Check every transaction carefully before you sign.'}
        </p>
        <div className="mt-7 flex justify-center">
          {awaitingSignature ? (
            // Wallet already connected — re-fire the SIWE signature directly
            // (re-opens the wallet prompt if the user dismissed it).
            <button
              onClick={() => signIn('/chat')}
              disabled={signingIn}
              type="button"
              title="Approve the signature request in your wallet"
              className={ctaClass}
            >
              {signingIn ? (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />
              ) : (
                <LogIn className="w-4 h-4" strokeWidth={2.5} />
              )}
              <span>{signingIn ? 'Waiting for signature…' : 'Sign in with your wallet'}</span>
            </button>
          ) : cdpEnabled ? (
            // Open the full sign-in modal (wallet / Google / email).
            <CreateAccountButton
              className={ctaClass}
              label={
                <>
                  <LogIn className="w-4 h-4" strokeWidth={2.5} />
                  <span>Sign in to use the chat</span>
                </>
              }
              redirectTo="/chat"
            />
          ) : (
            // No embedded-wallet SDK configured — fall back to direct wallet SIWE.
            <button
              onClick={() => connectAndSignIn('/chat')}
              disabled={signingIn}
              type="button"
              title="Sign in with your wallet — connect and sign in one step"
              className={ctaClass}
            >
              {signingIn ? (
                <Loader2 className="w-4 h-4 animate-spin" strokeWidth={2.5} />
              ) : (
                <LogIn className="w-4 h-4" strokeWidth={2.5} />
              )}
              <span>{signingIn ? 'Signing in…' : 'Sign in to use the chat'}</span>
            </button>
          )}
        </div>
      </div>
    </div>
  )
}
