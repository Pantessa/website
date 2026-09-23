'use client'

// The waiting-for-signature takeover, born on /i (IntentRuntime): a wallet
// with an open (or missed) SIWE signature request reads the page as STALLED
// unless something on the page says so — the sign-in UX contract is "prompt
// visibly, a silent stall reads as broken".
//
// Three exports:
//  · SignatureWaitModal — the presentational card (spinner while the request
//    is in flight, re-open CTA when it was missed or rejected). IntentRuntime
//    renders it inside its own shell with its own hold-the-ask semantics.
//  · useSignatureWait — when the card shows, and in which voice (below).
//  · default SignatureWaitTakeover — the GLOBAL mount (Providers.tsx): shows
//    the card anywhere on the site while a SIWE round-trip is actually in
//    flight (`signingIn`). It deliberately does NOT gate on the persistent
//    needsSignIn state — walling every connected-but-unsigned guest is the
//    scrim that bounced ~93% of arrivals (ChatSignInGate's banner exists for
//    that); this only appears after the user ASKED to sign in and the wallet
//    is waiting on them.
//
// The embedded wallet (email and Google accounts) signs SILENTLY, over CDP's
// API, with no request for the visitor to find. "Waiting for your signature,
// the request is open in your wallet" would send them looking for one that
// doesn't exist and read as a stall. So for that wallet the card says it's
// signing them in, has no open-the-request button, and shows only once the
// signature has run SILENT_SIGN_GRACE_MS: the door's email and Google lanes
// sign right after they connect, and a fast one shouldn't flash a card.

import { useEffect, useState, useSyncExternalStore } from 'react'
import { usePathname } from 'next/navigation'
import { useAccount } from 'wagmi'
import { CDP_CONNECTOR_ID } from '@coinbase/cdp-wagmi'
import { Loader2, PenLine, Smartphone, X } from 'lucide-react'
import { useSession } from '@/lib/session'
import {
  openWalletApp,
  subscribeWalletAppOpen,
  walletAppLastLink,
  walletAppOpenServerSnapshot,
  walletAppOpenSnapshot,
  walletAppRequestSettled,
} from '@/lib/wallet-handoff'

const noLink = () => null

/** How long a silent signature runs before its card shows. The embedded
 *  wallet's sign-in is three quick round-trips (nonce, CDP's signature,
 *  verify); one still going after a second is slow enough that "Signing you
 *  in…" beats a page that just sits there. */
export const SILENT_SIGN_GRACE_MS = 1000

/** Whether the signature card shows, and whether it speaks for a silent
 *  signer. A prompting wallet's card shows at once: its request is waiting
 *  on the visitor. */
export function useSignatureWait(signingIn: boolean): { shown: boolean; silent: boolean } {
  const { connector } = useAccount()
  const silent = connector?.id === CDP_CONNECTOR_ID
  const [late, setLate] = useState(false)
  useEffect(() => {
    setLate(false)
    if (!signingIn || !silent) return
    const t = setTimeout(() => setLate(true), SILENT_SIGN_GRACE_MS)
    return () => clearTimeout(t)
  }, [signingIn, silent])
  return { shown: signingIn && (!silent || late), silent }
}

export function SignatureWaitModal({
  signingIn,
  silent = false,
  openApp,
  onOpenRequest,
  onDismiss,
  dismissLabel = 'Dismiss',
  overlayClassName = 'fixed inset-0 z-[80]',
}: {
  signingIn: boolean
  /** The embedded wallet is the signer (useSignatureWait): nothing to open,
   *  nothing to approve. */
  silent?: boolean
  /** On a phone the request is queued in the wallet APP (lib/wallet-handoff
   *  walletAppLastLink): the waiting button becomes "Open {app}" — a tap
   *  carries its own activation. The global mount reads the holder; /i's
   *  own instance passes what it reads. */
  openApp?: { app: string; onOpen: () => void } | null
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
          {silent ? 'Signing you in…' : signingIn ? 'Waiting for your signature…' : 'One signature to continue'}
        </h2>
        <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted)]">
          {silent
            ? 'Your Pantessa wallet is signing a one-time message that proves it’s yours. There’s nothing to approve — nothing moves, nothing spends.'
            : signingIn && openApp
              ? `The request is waiting in ${openApp.app} — open it and approve there. It just proves you own this address. Nothing moves, nothing spends.`
              : signingIn
                ? 'The request is open in your wallet — approving it just proves you own this address. Nothing moves, nothing spends.'
                : 'Your wallet needs to sign one message to finish signing in. It proves ownership — nothing moves, nothing spends.'}
        </p>
        {!silent && signingIn && openApp ? (
          // The phone case: a disabled "Waiting…" here IS the #822 stall. The
          // request is in the app; the tap that opens it is the whole fix.
          <button
            type="button"
            onClick={openApp.onOpen}
            data-sign-open-app={openApp.app}
            className="btn btn--solid mt-5 inline-flex items-center justify-center gap-2 text-[13px]"
          >
            <Smartphone className="w-4 h-4" /> Open {openApp.app}
          </button>
        ) : !silent ? (
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
        ) : null}
      </div>
    </div>
  )
}

export default function SignatureWaitTakeover() {
  const { signingIn, signIn } = useSession()
  const pathname = usePathname()
  const wait = useSignatureWait(signingIn)
  // On a phone the wallet is another app, and the browser can refuse the jump
  // to it (lib/wallet-handoff). While that is true this card's words are wrong
  // — the request is NOT "open in your wallet", it is queued in an app nobody
  // switched to — and its button is disabled exactly when it is needed. The
  // handoff card takes over: it says so, and its button opens the app.
  const handoff = useSyncExternalStore(
    subscribeWalletAppOpen,
    walletAppOpenSnapshot,
    walletAppOpenServerSnapshot,
  )
  // The link the SDK last asked to open, while its request may still be
  // waiting in the wallet app: the card's button opens it (a dismissed
  // handoff card must never strand the queued SIWE).
  const last = useSyncExternalStore(subscribeWalletAppOpen, walletAppLastLink, noLink)
  // Dismiss hides the card for THIS flight only; the next explicit sign-in
  // click brings it back (signingIn drops when the round-trip settles).
  const [dismissed, setDismissed] = useState(false)
  useEffect(() => {
    if (!signingIn) {
      setDismissed(false)
      // The sign-in ended — signed, rejected, failed. Nothing is waiting in
      // the wallet any more: the handoff card AND the remembered link go.
      walletAppRequestSettled()
    }
  }, [signingIn])

  // /embed signs through the host page's wallet relay — not our surface to
  // cover. /i mounts its own instance inside its full-viewport shell (same
  // signingIn-only semantics — the run itself is the guest lane, and SIWE is
  // only ever a click the visitor made on the post-receipt save bar).
  if (pathname?.startsWith('/embed')) return null
  if (pathname === '/i' || pathname?.startsWith('/i/')) return null
  if (!wait.shown || dismissed || handoff) return null

  return (
    <SignatureWaitModal
      signingIn
      silent={wait.silent}
      openApp={last ? { app: last.app, onOpen: () => openWalletApp() } : null}
      onOpenRequest={() => void signIn()}
      onDismiss={() => setDismissed(true)}
    />
  )
}
