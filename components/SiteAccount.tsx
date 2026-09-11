'use client'

// The site's account control, one piece (2026-09-11): disconnected → the
// unified sign-in door (rule 6 — CreateAccountButton when cdpEnabled, the
// AuthButton fallback); connected or signed in → the consolidated NavAccount
// pill (Dashboard / Wallet details / sign in-or-out). The brochure nav's
// desktop cluster, the markets strip above the watchlist and the chat
// toolbar all render THIS, so the doors can never drift. Renders nothing
// before mount — wallet state is client-only, and the SSR markup stays
// hydration-safe.

import { useEffect, useState } from 'react'
import { useAccount } from 'wagmi'
import { LogIn } from 'lucide-react'
import { useSession } from '@/lib/session'
import { cdpEnabled } from '@/lib/cdp-embedded'
import AuthButton from '@/components/AuthButton'
import CreateAccountButton from '@/components/CreateAccountButton'
import NavAccount from '@/components/NavAccount'

export const signInPill =
  'inline-flex items-center gap-1.5 px-3.5 py-1.5 rounded-full bg-white/5 border border-white/15 text-zinc-200 text-xs font-semibold hover:bg-white/10 hover:border-white/25 transition-colors'
export const signInLabel = (
  <>
    <LogIn className="w-3.5 h-3.5" strokeWidth={2.5} /> Sign in
  </>
)

export default function SiteAccount({ redirectTo }: { redirectTo: string }) {
  const { isConnected } = useAccount()
  const { address: sessionAddress } = useSession()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null
  const disconnected = !isConnected && !sessionAddress
  if (!disconnected) return <NavAccount />
  return cdpEnabled ? (
    <CreateAccountButton className={signInPill} label={signInLabel} redirectTo={redirectTo} />
  ) : (
    <AuthButton redirectTo={redirectTo} />
  )
}
