'use client'

// Dashboard shell: authed-only. The wallet → SIWE gate lives HERE (once) — a
// signed-out visitor is redirected home rather than shown an in-place gate.
// Authed children render inside the ONE app shell: the spine (shared with
// chat) on the far left, then the dashboard's section rail, then content.

import { usePathname, useRouter } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PanelLeftClose } from 'lucide-react'
import { rememberSignInReturn, signedOutJustNow, useSession } from '@/lib/session'
import { useAppSidebar } from '@/lib/app-sidebar'
import { FRAME_ATTR, SCROLL_ATTR } from '@/lib/phone-shell'
import { dashboardGate } from '@/lib/app-entry'
import AppSpine from '@/components/AppSpine'
import DashboardSignIn from '@/components/DashboardSignIn'
import DashAskBar from '@/components/DashAskBar'
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
  const { address, status, needsSignIn, signedOut: nobodyHere } = useSession()

  // Wallet state is client-only — render nothing until mounted (hydration-safe).
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  // Who may see the dashboard (lib/app-entry dashboardGate, 2026-11-17). The
  // dashboard is authed-only, but a CONNECTED wallet with no session is not a
  // stranger: it gets the sign-in card in place (Nate: "give the user a path
  // to sign then to dashboard") instead of the trip home it used to take.
  // Only nobody-here (no wallet, no session, settled: useSession().signedOut)
  // goes home. A visitor who arrived signed out leaves this page to come back
  // to (lib/session rememberSignInReturn), so a sign-in on the landing lands
  // back here; one who just signed out here leaves nothing (signedOutJustNow).
  const gate = dashboardGate({ mounted, sessionStatus: status, sessionAddress: address, needsSignIn, signedOut: nobodyHere })
  const signedOut = gate === 'home'
  useEffect(() => {
    if (!signedOut) return
    if (!signedOutJustNow()) rememberSignInReturn(pathname + window.location.search)
    router.replace('/')
  }, [signedOut, pathname, router])

  // Nothing of the dashboard renders until the session is known: through the
  // loading phase, and through the brief tick before the redirect above
  // lands. On a phone the FRAME renders at once (an empty one), so the
  // document never has a moment without the frame's rules while the
  // wallet/session settle (QA saw a transient scrolling document on the
  // dashboard once).
  if (gate === 'sign') {
    return (
      <div className="dashshell" {...{ [FRAME_ATTR]: '' }}>
        <AppSpine surface="dashboard" />
        <div className="flex-1 min-w-0 min-h-dvh" {...{ [SCROLL_ATTR]: '' }}>
          <DashboardSignIn />
        </div>
      </div>
    )
  }
  if (!mounted || !address) return <div className="dashshell" {...{ [FRAME_ATTR]: '' }} />

  // Below lg the shell is a PHONE FRAME (squad mobile-native, 2026-09-24;
  // app/native-shell.css): .dashshell is the frame, .dash is its ONE scroller
  // (the sticky section bar and the sticky-bottom ask bar stick to it), and
  // the spine's tab bar is the frame's last row, in flow. The hand reserves
  // (`:root[data-spine] .dash__main` 96px, `.dashask` 60px) are gone: the
  // scroller ends where the bar begins, and .dashask's own `bottom: 20px` is
  // measured from there.
  const frame = { [FRAME_ATTR]: '' }
  const scroll = { [SCROLL_ATTR]: '' }
  return (
    <div className="dashshell" {...frame}>
      {/* The shared spine — same component chat mounts, dashboard flavor:
          tab icons are shortcuts into chat, SETTINGS wears the active state. */}
      <AppSpine surface="dashboard" />
      <div className="dash" {...scroll}>
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
        <main className="dash__main">
          {children}
          <DashAskBar />
        </main>
      </div>
    </div>
  )
}
