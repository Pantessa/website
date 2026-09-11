'use client'

// The /wallet page body: the window "Wallet details" opens (WalletDetails,
// layout "page") under the page's own header, which says which wallet this
// is and carries the one account action that belongs here, switch or
// disconnect (RainbowKit's modal). Dashboard is the spine's SETTINGS seat.
//
// Connect-to-act (rule 6): a connection is all it takes to look (reads are
// by address, no SIWE), so the disconnected state is the unified door's
// connect-only lane, landing back here.
//
// The boot hold is ChatInterface's (lib/wallet-reconnect + useHydrated): the
// server and the hydration render paint the skeleton; after that a visitor
// with a connection on file keeps the skeleton while wagmi restores it (up
// to 4s), and one with nothing on file gets the door on the first frame. A
// returning wallet never flashes "connect a wallet" before its balances.

import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { useAccountModal } from '@rainbow-me/rainbowkit'
import { ArrowRight, Settings2, Wallet } from 'lucide-react'
import { WalletDetails, walletKind } from '@/components/WalletPanel'
import CreateAccountButton from '@/components/CreateAccountButton'
import AuthButton from '@/components/AuthButton'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { useHydrated } from '@/lib/use-hydrated'
import { bootHoldingFor, initialHoldElapsed } from '@/lib/wallet-reconnect'
import { APP_CHAINS } from '@/lib/chains'
import { WALLET_PAGE_HREF } from '@/lib/wallet-page'

/** "Base, Ethereum, Arbitrum, Optimism and Robinhood Chain" — the chains
 *  /api/wallet reads, in registry order. */
const CHAIN_WORDS = (() => {
  const names = APP_CHAINS.map((c) => c.name)
  return names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : (names[0] ?? '')
})()

const PAGE_GRID = 'grid items-start gap-x-10 gap-y-6 lg:grid-cols-[minmax(0,1fr)_minmax(320px,380px)]'

/** The page's own shape while wagmi decides, so nothing jumps when the
 *  balances land. */
function Skeleton() {
  return (
    <div aria-hidden className={PAGE_GRID}>
      <div className="space-y-5">
        <div className="h-8 w-80 max-w-full rounded-lg bg-[var(--surf-1)] animate-pulse" />
        <div className="space-y-2">
          <div className="h-3 w-32 rounded bg-[var(--surf-1)] animate-pulse" />
          <div className="h-12 w-60 max-w-full rounded-lg bg-[var(--surf-1)] animate-pulse" />
        </div>
        <div className="space-y-1.5">
          {[0, 1, 2].map((i) => (
            <div key={i} className="h-[52px] rounded-xl border border-[var(--line)] bg-[var(--surf-1)] animate-pulse" />
          ))}
        </div>
      </div>
      <div className="space-y-2">
        {[0, 1, 2].map((i) => (
          <div key={i} className="h-[58px] rounded-xl border border-[var(--line)] bg-[var(--surf-1)] animate-pulse" />
        ))}
      </div>
    </div>
  )
}

/** Nothing connected: the unified door's connect-only lane (rule 6). */
function ConnectDoor() {
  const cta = 'btn btn--solid inline-flex items-center justify-center gap-2 h-[46px] px-6 rounded-full text-[14px]'
  return (
    <div data-wallet-door className="mx-auto mt-4 sm:mt-10 max-w-[560px] rounded-2xl border border-[var(--line-2)] bg-[var(--surf-1)] px-6 py-9 text-center">
      <span className="mx-auto w-12 h-12 grid place-items-center rounded-xl bg-black/40 border border-[var(--line)] text-[color:var(--accent)]">
        <Wallet className="w-6 h-6" strokeWidth={2.25} />
      </span>
      <h2 className="mt-4 text-[22px] font-semibold tracking-tight text-[color:var(--fg)]">Your wallet, on every chain</h2>
      <p className="mt-2 text-[13.5px] leading-relaxed text-[color:var(--muted)]">
        Connect a wallet, or create one with Google or email. This page shows what it holds on {CHAIN_WORDS}: priced, with the gas on each chain, recent transfers, and the ways to add, send and receive.
      </p>
      <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">Looking takes no signature. Moving money takes yours.</p>
      <div className="mt-6 flex justify-center">
        {cdpEnabled ? (
          <CreateAccountButton
            walletConnectOnly
            redirectTo={WALLET_PAGE_HREF}
            className={cta}
            label={
              <>
                Connect a wallet <ArrowRight className="w-4 h-4" />
              </>
            }
          />
        ) : (
          <AuthButton redirectTo={WALLET_PAGE_HREF} />
        )}
      </div>
    </div>
  )
}

export default function WalletPage() {
  const { address, connector, status: walletStatus } = useAccount()
  const { openAccountModal } = useAccountModal()

  const hydrated = useHydrated()
  const [holdElapsed, setHoldElapsed] = useState(() => initialHoldElapsed(typeof window === 'undefined' ? null : window.localStorage))
  useEffect(() => {
    if (holdElapsed) return
    const t = setTimeout(() => setHoldElapsed(true), 4000)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])
  const holding = bootHoldingFor({ hydrated, walletStatus, holdElapsed })

  const kind = walletKind(connector?.id, connector?.name)
  const showDetails = hydrated && !!address
  const showDoor = hydrated && !address && !holding

  return (
    <main className="flex-1 min-w-0 px-4 sm:px-8 lg:px-12 pt-5 sm:pt-8 pb-28">
      <div className="mx-auto w-full max-w-[1180px]">
        <header className="flex items-center justify-between gap-4 pb-5 mb-6 border-b border-[var(--line)]">
          <div className="flex items-center gap-3 min-w-0">
            <span className="w-10 h-10 grid place-items-center rounded-xl bg-black/40 border border-[var(--line)] text-[color:var(--accent)] flex-shrink-0">
              <Wallet className="w-5 h-5" strokeWidth={2.5} />
            </span>
            <div className="min-w-0">
              <div className="mono text-[10.5px] uppercase tracking-[0.16em] text-[color:var(--muted-2)]">Wallet</div>
              <h1 className="text-[19px] font-semibold leading-tight text-[color:var(--fg)] truncate">{showDetails ? kind.label : 'Your wallet'}</h1>
              {showDetails && <div className="mono text-[11px] text-[color:var(--muted-2)] truncate">{kind.sub}</div>}
            </div>
          </div>
          {/* Switch or disconnect: RainbowKit's account modal, the right
              place for that (the panel's "Wallet settings", promoted to the
              page's header). */}
          {showDetails && openAccountModal && (
            <button
              type="button"
              onClick={openAccountModal}
              title="Switch wallet or disconnect"
              aria-label="Switch wallet or disconnect"
              data-wallet-switch
              className="flex-shrink-0 inline-flex items-center gap-1.5 rounded-full border border-[var(--line)] bg-[var(--surf-1)] px-3 py-1.5 text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:border-[var(--line-2)] transition-colors"
            >
              <Settings2 className="w-3.5 h-3.5" />
              <span className="max-sm:hidden">Switch or disconnect</span>
            </button>
          )}
        </header>

        {showDetails && address ? (
          // Keyed by address: an account switch is a fresh look.
          <WalletDetails key={address} address={address} layout="page" />
        ) : showDoor ? (
          <ConnectDoor />
        ) : (
          <Skeleton />
        )}
      </div>
    </main>
  )
}
