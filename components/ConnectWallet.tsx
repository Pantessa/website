'use client'

import { ConnectButton } from '@rainbow-me/rainbowkit'
import { Wallet, ChevronDown } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * Top-right connect button that matches Pantessa's zinc/dark aesthetic.
 * - Disconnected: solid white "Connect Wallet" pill with wallet icon
 * - Wrong network: red "Wrong network" pill
 * - Connected: compact address pill (truncated 0x1234…abcd) + tiny chain chip,
 *   both clickable (chain switcher + account menu)
 */
export default function ConnectWallet() {
  return (
    <ConnectButton.Custom>
      {({
        account,
        chain,
        openAccountModal,
        openChainModal,
        openConnectModal,
        authenticationStatus,
        mounted,
      }) => {
        const ready = mounted && authenticationStatus !== 'loading'
        const connected =
          ready &&
          account &&
          chain &&
          (!authenticationStatus || authenticationStatus === 'authenticated')

        return (
          <div
            {...(!ready && {
              'aria-hidden': true,
              style: {
                opacity: 0,
                pointerEvents: 'none',
                userSelect: 'none',
              },
            })}
            className="flex items-center gap-1.5"
          >
            {(() => {
              if (!connected) {
                return (
                  <button
                    onClick={openConnectModal}
                    type="button"
                    className={cn(
                      'flex items-center gap-2 px-3.5 py-1.5 rounded-full',
                      'bg-white text-zinc-950 text-xs font-semibold',
                      'hover:bg-zinc-200 active:scale-[0.98] transition-all duration-150',
                      'shadow-sm shadow-black/40'
                    )}
                  >
                    <Wallet className="w-3.5 h-3.5" strokeWidth={2.5} />
                    <span>Connect Wallet</span>
                  </button>
                )
              }

              if (chain.unsupported) {
                return (
                  <button
                    onClick={openChainModal}
                    type="button"
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-full',
                      'bg-red-500/10 text-red-400 border border-red-500/30',
                      'text-xs font-medium hover:bg-red-500/20 transition-colors'
                    )}
                  >
                    <span className="w-1.5 h-1.5 rounded-full bg-red-400 animate-pulse" />
                    Wrong network
                  </button>
                )
              }

              return (
                <>
                  {/* Chain chip */}
                  <button
                    onClick={openChainModal}
                    type="button"
                    title={chain.name}
                    className={cn(
                      'hidden sm:flex items-center gap-1.5 px-2 py-1.5 rounded-full',
                      'bg-white/5 border border-white/10 text-xs font-medium text-zinc-300',
                      'hover:bg-white/10 hover:border-white/20 transition-colors'
                    )}
                  >
                    {chain.hasIcon && chain.iconUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={chain.iconUrl}
                        alt={chain.name}
                        className="w-3.5 h-3.5 rounded-full"
                        style={{ background: chain.iconBackground }}
                      />
                    ) : (
                      <span
                        className="w-2 h-2 rounded-full bg-emerald-400"
                        aria-hidden
                      />
                    )}
                  </button>

                  {/* Account pill */}
                  <button
                    onClick={openAccountModal}
                    type="button"
                    className={cn(
                      'flex items-center gap-2 px-3 py-1.5 rounded-full',
                      'bg-white/5 border border-white/10',
                      'hover:bg-white/10 hover:border-white/20 transition-colors',
                      'text-xs font-mono text-zinc-200'
                    )}
                  >
                    <span
                      className="w-1.5 h-1.5 rounded-full bg-emerald-400"
                      aria-hidden
                    />
                    <span className="tracking-tight">
                      {account.displayName}
                    </span>
                    {account.displayBalance && (
                      <span className="hidden md:inline text-zinc-500">
                        · {account.displayBalance}
                      </span>
                    )}
                    <ChevronDown
                      className="w-3 h-3 text-zinc-500"
                      strokeWidth={2.5}
                    />
                  </button>
                </>
              )
            })()}
          </div>
        )
      }}
    </ConnectButton.Custom>
  )
}
