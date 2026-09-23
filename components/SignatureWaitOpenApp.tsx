'use client'

// The inline "Open MetaMask" button every sign surface shows while a wallet
// request is open in the phone's wallet APP (mobile-onboarding squad
// 2026-09-23, SIGN lane, on CONNECT's handoff API).
//
// While the MetaMask SDK has a request queued, lib/wallet-handoff remembers
// the link it asked to open (walletAppLastLink). A "Confirm in your wallet…"
// button that is DISABLED at that moment is the #822 shape: the request is
// waiting in an app the browser may never have switched to. So the wait
// state of a card carries this button instead — a tap carries its own
// activation, and the app comes up with the request already in it. The
// global handoff card (WalletAppHandoff) is the belt; this is the braces,
// inside the card the visitor is looking at.
//
// Renders nothing when no request is open (a desktop, a non-SDK lane, a
// settled request), so every surface can mount it unconditionally.

import { Smartphone } from 'lucide-react'
import { useWalletAppLastLink } from '@/lib/use-sign-round-trip'
import { openWalletApp } from '@/lib/wallet-handoff'

export default function SignatureWaitOpenApp({
  waiting,
  className = '',
}: {
  /** The surface's own "the wallet has the request" state. */
  waiting: boolean
  className?: string
}) {
  const last = useWalletAppLastLink()
  if (!waiting || !last) return null
  return (
    <button
      type="button"
      onClick={() => openWalletApp()}
      data-sign-open-app={last.app}
      className={`inline-flex items-center gap-1.5 rounded-full border border-[var(--line-2)] px-3 py-1 text-[12px] font-medium text-[color:var(--fg)] [@media(hover:none)]:min-h-10 [@media(hover:none)]:px-4 ${className}`}
      title={`${last.app} has this request — tap to open it`}
    >
      <Smartphone className="w-3.5 h-3.5" /> Open {last.app}
    </button>
  )
}
