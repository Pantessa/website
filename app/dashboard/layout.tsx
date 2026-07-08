'use client'

// Dashboard shell: the wallet → SIWE gate lives HERE (once), and authed
// children render inside a Vercel-style layout — persistent left sidebar with
// sections, content on the right. Pages below this layout can assume a
// signed-in session and just fetch.

import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { ShieldCheck } from 'lucide-react'
import { useSession } from '@/lib/session'
import DashboardSidebar from '@/components/DashboardSidebar'
import DashboardMobileNav from '@/components/DashboardMobileNav'
import DashboardAccount from '@/components/DashboardAccount'
import OrgSwitcher from '@/components/OrgSwitcher'
import { AppRailHeader } from '@/components/AppShell'

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const { address, connectAndSignIn, signingIn, status } = useSession()

  // Wallet state is client-only — render nothing until mounted (hydration-safe).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])
  if (!mounted) return null

  // One combined gate: connect (if needed) + sign in one step. No redirect —
  // the user is already on /dashboard, so a successful sign just re-renders
  // this layout with the authed content.
  if (!address) {
    return (
      <Gate
        icon={<ShieldCheck className="w-7 h-7" />}
        title="Sign in to your expense account"
        body="Connect your wallet and a quick signature proves ownership — then your spend data and approvals load."
        cta={signingIn ? 'Signing in…' : 'Sign in with Ethereum'}
        onClick={() => connectAndSignIn()}
        busy={signingIn || status === 'loading'}
      />
    )
  }

  return (
    <div className="dash">
      {/* Desktop: persistent left rail — sections up top, account pinned to the
          bottom (wallet + sign out). Hidden below 900px. */}
      <aside className="dash__rail">
        <AppRailHeader />
        <OrgSwitcher />
        <DashboardSidebar pathname={pathname} address={address} />
        <div className="dash__acct">
          <DashboardAccount address={address} />
        </div>
      </aside>
      {/* Mobile: compact bar + hamburger drawer (replaces the horizontal row). */}
      <DashboardMobileNav pathname={pathname} address={address} />
      <main className="dash__main">{children}</main>
    </div>
  )
}

function Gate({
  icon,
  title,
  body,
  cta,
  onClick,
  busy,
}: {
  icon: React.ReactNode
  title: string
  body: string
  cta: string
  onClick: () => void
  busy?: boolean
}) {
  return (
    <div className="max-w-md mx-auto px-6 py-24 text-center">
      <div className="w-14 h-14 mx-auto rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] grid place-items-center text-[color:var(--muted)] mb-5">
        {icon}
      </div>
      <h1 className="text-xl font-semibold text-white mb-2">{title}</h1>
      <p className="text-sm text-[color:var(--muted)] mb-6">{body}</p>
      <button className="btn btn--solid" onClick={onClick} disabled={busy}>
        {busy ? 'One sec…' : cta}
      </button>
    </div>
  )
}
