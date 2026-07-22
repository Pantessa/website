'use client'

// The waiting-for-signature takeover, born on /i (IntentRuntime): a wallet
// with an open (or missed) SIWE signature request reads the page as STALLED
// unless something on the page says so — the sign-in UX contract is "prompt
// visibly, a silent stall reads as broken".
//
// Two exports:
//  · SignatureWaitModal — the presentational card (spinner while the request
//    is in flight, re-open CTA when it was missed or rejected). IntentRuntime
//    renders it inside its own shell with its own hold-the-ask semantics.
//  · default SignatureWaitTakeover — the GLOBAL mount (Providers.tsx): shows
//    the card anywhere on the site while a SIWE round-trip is actually in
//    flight (`signingIn`). It deliberately does NOT gate on the persistent
//    needsSignIn state — walling every connected-but-unsigned guest is the
//    scrim that bounced ~93% of arrivals (ChatSignInGate's banner exists for
//    that); this only appears after the user ASKED to sign in and the wallet
//    is waiting on them.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { Loader2, PenLine, X } from 'lucide-react'
import { useSession } from '@/lib/session'

export function SignatureWaitModal({
  signingIn,
  onOpenRequest,
  onDismiss,
  dismissLabel = 'Dismiss',
  overlayClassName = 'fixed inset-0 z-[80]',
}: {
  signingIn: boolean
  onOpenRequest: () => void
  onDismiss?: () => void
  dismissLabel?: string
  /** Positioning + stacking of the scrim — /i uses `absolute` inside its own
   *  full-viewport shell; the global mount uses `fixed`. */
  overlayClassName?: string
}) {
  return (
    <div className={`${overlayClassName} flex items-center justify-center bg-black/60 backdrop-blur-sm px-6`}>
      <div className="relative max-w-sm w-full rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] px-6 py-7 text-center">
        {onDismiss && (
          <button
            type="button"
            onClick={onDismiss}
            aria-label={dismissLabel}
            className="absolute top-3 right-3 p-1 rounded-md text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
          >
            <X className="w-4 h-4" />
          </button>
        )}
        <div className="mx-auto w-10 h-10 grid place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] mb-4">
          {signingIn ? (
            <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
          ) : (
            <PenLine className="w-5 h-5" style={{ color: 'var(--accent)' }} />
          )}
        </div>
        <h2 className="text-[17px] font-semibold text-[color:var(--fg)]">
          {signingIn ? 'Waiting for your signature…' : 'One signature to continue'}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted)]">
          {signingIn
            ? 'The request is open in your wallet — approving it just proves you own this address. Nothing moves, nothing spends.'
            : 'Your wallet needs to sign one message to finish signing in. It proves ownership — nothing moves, nothing spends.'}
        </p>
        <button
          type="button"
          onClick={onOpenRequest}
          disabled={signingIn}
          className="btn btn--solid mt-5 inline-flex items-center justify-center gap-2 text-[13px] disabled:opacity-60"
        >
          {signingIn ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" /> Waiting…
            </>
          ) : (
            <>
              <PenLine className="w-4 h-4" /> Open the signature request
            </>
          )}
        </button>
      </div>
    </div>
  )
}

export default function SignatureWaitTakeover() {
  const { signingIn, signIn } = useSession()
  const pathname = usePathname()
  // Dismiss hides the card for THIS flight only; the next explicit sign-in
  // click brings it back (signingIn drops when the round-trip settles).
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (!signingIn) setDismissed(false)
  }, [signingIn])

  // /embed signs through the host page's wallet relay — not our surface to
  // cover. /i mounts its own instance (it also holds the takeover on the
  // persistent needsSignIn state, and dismissing routes to the guest lane).
  if (pathname?.startsWith('/embed')) return null
  if (pathname === '/i' || pathname?.startsWith('/i/')) return null
  if (!signingIn || dismissed) return null

  return (
    <SignatureWaitModal
      signingIn
      onOpenRequest={() => void signIn()}
      onDismiss={() => setDismissed(true)}
    />
  )
}
