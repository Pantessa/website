'use client'

import { LogIn, LogOut, Loader2, ShieldCheck } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useSession } from '@/lib/session'

/**
 * Combined sign-in affordance (one button, connect → sign):
 * - signed in → a "Signed in" chip whose click signs out
 * - otherwise → "Sign in" that connects the wallet (if needed) and runs SIWE in
 *   one flow. `redirectTo` defaults to /dashboard (the generic nav entry); pass
 *   a path for in-page gates that should return the user where they were.
 */
export default function AuthButton({ redirectTo = '/dashboard' }: { redirectTo?: string }) {
  const router = useRouter()
  const { address, signingIn, connectAndSignIn, signOut } = useSession()

  if (address) {
    return (
      <button
        onClick={() => signOut().then(() => router.push('/'))}
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
      onClick={() => connectAndSignIn(redirectTo)}
      disabled={signingIn}
      type="button"
      title="Sign in with your wallet — connect and sign in one step"
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
