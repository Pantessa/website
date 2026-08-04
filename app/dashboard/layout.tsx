'use client'

// Dashboard shell: authed-only. The wallet → SIWE gate lives HERE (once) — a
// signed-out visitor is redirected home rather than shown an in-place gate.
// Authed children render inside the ONE app shell: the spine (shared with
// chat) on the far left, then the dashboard's section rail, then content.

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PanelLeftClose } from 'lucide-react'
import { useSession } from '@/lib/session'
import { useAppSidebar } from '@/lib/app-sidebar'
import AppSpine from '@/components/AppSpine'
import DashboardSidebar from '@/components/DashboardSidebar'
import DashboardMobileNav from '@/components/DashboardMobileNav'
import DashboardAccount from '@/components/DashboardAccount'
import OrgSwitcher from '@/components/OrgSwitcher'

// The rail header speaks the chat drawer's language now — a quiet label +
// the one collapse control. The brand seat lives on the spine, so the old
// AppRailHeader wordmark would be a double brand.
function DashRailHeader() {
  const toggle = useAppSidebar((s) => s.toggle)
  return (
    <div className="flex items-center gap-1 px-1">
      <span className="flex-1 mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
        Dashboard
      </span>
      <button
        className="apprail__toggle flex-shrink-0"
        onClick={toggle}
        aria-label="Collapse sidebar"
        title="Collapse sidebar"
      >
        <PanelLeftClose width={17} height={17} />
      </button>
    </div>
  )
}

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  const pathname = usePathname()
  const router = useRouter()
  const { address, status } = useSession()

  // Wallet state is client-only — render nothing until mounted (hydration-safe).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Signed out → home. The dashboard is authed-only; there's no in-place gate.
  // Wait for the session to SETTLE before deciding: `address` is null while
  // status === 'loading' (before /api/auth/me resolves), so redirecting on that
  // would bounce a signed-in user mid-hydration. Only 'guest' means truly out.
  const signedOut = mounted && status === 'guest' && !address
  useEffect(() => {
    if (signedOut) router.replace('/')
  }, [signedOut, router])

  // Nothing to render until we know the user is authed: null through the
  // loading phase, and through the brief tick before the redirect above lands.
  if (!mounted || !address) return null

  return (
    <div className="dashshell">
      {/* The shared spine — same component chat mounts, dashboard flavor:
          tab icons are shortcuts into chat, DASH wears the active state. */}
      <AppSpine surface="dashboard" />
      <div className="dash">
        {/* Desktop: persistent left rail — sections up top, account pinned to
            the bottom (wallet + sign out). Hidden below 900px. */}
        <aside className="dash__rail">
          <DashRailHeader />
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
    </div>
  )
}
