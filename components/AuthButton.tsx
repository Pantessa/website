'use client'

import { LogIn, LogOut, Loader2, ShieldCheck } from 'lucide-react'
import { useAccount } from 'wagmi'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/session'

/**
 * SIWE sign-in affordance, shown to the left of the wallet pill.
 * - wallet not connected → nothing (ConnectWallet shows "Connect Wallet")
 * - connected, no session → "Sign in" button (triggers the SIWE flow)
 * - signed in            → a "Signed in" chip whose click signs out
 */
export default function AuthButton() {
  const { isConnected } = useAccount()
  const { address, signingIn, signIn, signOut } = useSession()

  if (!isConnected) return null

  if (address) {
    return (
      <button
        onClick={() => signOut()}
        type="button"
        title="Signed in with Ethereum — click to sign out"
        className={cn(
          'group flex items-center gap-1.5 px-2.5 py-1.5 rounded-full',
          'bg-emerald-500/10 border border-emerald-500/25 text-emerald-300',
          'text-xs font-medium hover:bg-emerald-500/15 transition-colors'
        )}
      >
        <ShieldCheck className="w-3.5 h-3.5 group-hover:hidden" strokeWidth={2.5} />
        <LogOut className="w-3.5 h-3.5 hidden group-hover:block" strokeWidth={2.5} />
        <span className="hidden sm:inline group-hover:hidden">Signed in</span>
        <span className="hidden sm:group-hover:inline">Sign out</span>
      </button>
    )
  }

  return (
    <button
      onClick={() => signIn()}
      disabled={signingIn}
      type="button"
      title="Sign in with your wallet to save chats"
      className={cn(
        'flex items-center gap-1.5 px-3 py-1.5 rounded-full',
        'bg-white/5 border border-white/15 text-zinc-200',
        'text-xs font-semibold hover:bg-white/10 hover:border-white/25 transition-colors',
        'disabled:opacity-60 disabled:cursor-not-allowed'
      )}
    >
      {signingIn ? (
        <Loader2 className="w-3.5 h-3.5 animate-spin" strokeWidth={2.5} />
      ) : (
        <LogIn className="w-3.5 h-3.5" strokeWidth={2.5} />
      )}
      <span>{signingIn ? 'Sign in…' : 'Sign in'}</span>
    </button>
  )
}
