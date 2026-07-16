'use client'

// Global "you switched accounts" prompt.
//
// MetaMask fires accountsChanged the moment a user picks a different account;
// wagmi's useAccount() is reactive to it, so lib/session.tsx already notices the
// connected wallet no longer matches the SIWE session cookie (switchedAccount)
// and drops the effective address to null. Without a nudge the user is quietly
// signed out of their data with no obvious way back except the old
// disconnect/reconnect dance.
//
// This bar makes the fix a single click: signIn() runs a fresh SIWE round-trip
// and re-mints the cookie for the NEW address — the wallet stays connected the
// whole time, no disconnect needed. Suppressed on /embed, where the wallet is
// the host page's (address changes come through the postMessage relay, not from
// a MetaMask account switch the visitor made here).

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { RefreshCw, Loader2, X } from 'lucide-react'
import { useSession } from '@/lib/session'

function shortAddr(a: string): string {
  return `${a.slice(0, 6)}…${a.slice(-4)}`
}

export default function AccountSwitchBanner() {
  const { switchedAccount, walletAddress, signIn, signingIn, error } = useSession()
  const pathname = usePathname()
  // Remember which wallet the user dismissed so the bar doesn't nag — but it
  // returns the instant they switch to yet another account.
  const [dismissedFor, setDismissedFor] = useState<string | null>(null)

  // A brand-new switch un-dismisses (the dismissed address no longer matches).
  useEffect(() => {
    if (walletAddress && dismissedFor && walletAddress !== dismissedFor) {
      setDismissedFor(null)
    }
  }, [walletAddress, dismissedFor])

  // The embeddable chat drives the wallet from the host page — not our surface.
  if (pathname?.startsWith('/embed')) return null
  if (!switchedAccount || !walletAddress) return null
  if (dismissedFor === walletAddress) return null

  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-[90] w-[calc(100vw-2rem)] max-w-md px-1">
      <div className="toast-in flex items-center gap-3 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3 shadow-lg shadow-black/40">
        <RefreshCw className="w-4 h-4 flex-shrink-0 text-[var(--accent)]" strokeWidth={2.5} />
        <div className="flex-1 min-w-0">
          <p className="text-xs sm:text-sm leading-snug text-[color:var(--fg)]">
            Switched to{' '}
            <span className="font-mono font-medium">{shortAddr(walletAddress)}</span>
          </p>
          <p className="text-[11px] leading-snug text-[color:var(--muted)]">
            {error ?? 'Sign in with this account to keep using it.'}
          </p>
        </div>
        <button
          onClick={() => void signIn()}
          disabled={signingIn}
          type="button"
          className="flex-shrink-0 flex items-center gap-1.5 rounded-full bg-[var(--accent)] px-3.5 py-1.5 text-xs font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60 disabled:cursor-not-allowed"
        >
          {signingIn ? (
            <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2.5} />
          ) : null}
          <span>{signingIn ? 'Signing in…' : 'Sign in'}</span>
        </button>
        <button
          onClick={() => setDismissedFor(walletAddress)}
          aria-label="Dismiss"
          type="button"
          className="flex-shrink-0 -mr-1 p-1 rounded-md text-[color:var(--muted-2)] transition-colors hover:text-[color:var(--fg)]"
        >
          <X className="w-3.5 h-3.5" />
        </button>
      </div>
    </div>
  )
}
