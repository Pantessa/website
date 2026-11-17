'use client'

// The dashboard's in-place sign-in (2026-11-17). A wallet that is connected
// but has no session for it (never signed, or the wallet switched accounts)
// used to be sent home from SETTINGS with no word why. The dashboard (creator
// page, keys, billing, account) reads the SIWE session, so it asks for the
// one signature right here, and opens in place when the session lands:
// signIn() with this page as its target refreshes it (lib/app-entry
// sameAppHref), and the layout's gate (dashboardGate) turns 'open'.
//
// The signature fires only from the button: nothing auto-signs on arrival
// (rule 6), and on a phone the wallet app's launch needs this tap. While it
// is out, the global SignatureWaitTakeover shows the wait.

import Link from 'next/link'
import { Loader2, LogIn, Settings } from 'lucide-react'
import { currentAppHref, useSession } from '@/lib/session'
import { shortAddress } from '@/lib/progress'

export default function DashboardSignIn() {
  const { walletAddress, switchedAccount, signingIn, error, signIn } = useSession()
  const who = walletAddress ? shortAddress(walletAddress) : 'Your wallet'

  return (
    <div className="min-h-full grid place-items-center px-4 py-12" data-dashboard-sign-in="">
      <div className="w-full max-w-[420px] rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] p-6">
        <div className="flex items-center gap-2 text-[color:var(--muted)]">
          <Settings className="w-4 h-4" />
          <span className="mono text-[11px] uppercase tracking-wider">Settings</span>
        </div>
        <h1 className="mt-3 text-[22px] leading-tight font-semibold text-[color:var(--fg)]">
          Sign in to open your settings
        </h1>
        <p className="mt-2 text-[14px] leading-relaxed text-[color:var(--muted)]">
          {switchedAccount ? (
            <>
              Your wallet switched to <span className="mono text-[color:var(--fg)]">{who}</span>. Sign in as this
              account to see its settings.
            </>
          ) : (
            <>
              <span className="mono text-[color:var(--fg)]">{who}</span> is connected. Your creator page, keys,
              billing and account need one signature to prove the wallet is yours. It costs no gas and moves no
              money.
            </>
          )}
        </p>
        <button
          type="button"
          // This page, read on press (never at render: lib/app-entry signInLandingFor).
          onClick={() => void signIn(currentAppHref())}
          disabled={signingIn}
          className="mt-5 w-full min-h-[44px] inline-flex items-center justify-center gap-2 rounded-full bg-[var(--accent)] px-5 text-[15px] font-semibold text-black transition-opacity hover:opacity-90 disabled:opacity-60"
        >
          {signingIn ? <Loader2 className="w-4 h-4 animate-spin" /> : <LogIn className="w-4 h-4" />}
          {signingIn ? 'Check your wallet…' : 'Sign in with wallet'}
        </button>
        {error && <p className="mt-3 text-[13px] text-red-400">{error}</p>}
        <Link
          href="/"
          className="mt-4 block text-center text-[13px] text-[color:var(--muted)] hover:text-[color:var(--fg)] transition-colors"
        >
          Not now, back to markets
        </Link>
      </div>
    </div>
  )
}
