'use client'

// The logged-in "app shell" chrome. When a signed-in user is on an app surface
// (dashboard / chat / docs) the brochure top-nav is hidden (see Navigation) and
// the app takes over the viewport. This module supplies the shared pieces:
//
//  • AppShellMount — mounted once globally. Sets html[data-app-shell] (full-
//    height layout, no top-nav gap) and html[data-rail-collapsed], and renders
//    the floating reopen toggle when the rail is collapsed.
//  • AppRailHeader — the ChatGPT-style header pinned to the TOP of a collapsible
//    rail (dashboard/docs): a collapse toggle + the yeetful mark linking home to
//    the dashboard.
//
// Collapse applies to dashboard + docs (their rails share useAppSidebar). Chat
// manages its own conversation sidebar, so it only gets the top-nav removal and
// a home affordance in its toolbar — not the shared collapse.

import Link from 'next/link'
import { usePathname } from 'next/navigation'
import { useEffect, useState } from 'react'
import { PanelLeft, PanelLeftClose } from 'lucide-react'
import { useSession } from '@/lib/session'
import { useAppSidebar } from '@/lib/app-sidebar'
import { YeetfulMark } from '@/components/Logo'

/** Which app-shell behaviours apply on the current route for a signed-in user. */
export function useAppShellMode() {
  const pathname = usePathname()
  const { address } = useSession()
  const [mounted, setMounted] = useState(false)
  useEffect(() => setMounted(true), [])

  const authed = mounted && !!address
  const onDashboard = pathname.startsWith('/dashboard')
  const onDocs = pathname.startsWith('/docs')
  const onChat = pathname.startsWith('/chat')
  return {
    // Top brochure nav is hidden and the app owns the viewport.
    chrome: authed && (onDashboard || onDocs || onChat),
    // The rail is collapsible via the shared toggle (dashboard + docs only).
    collapsible: authed && (onDashboard || onDocs),
  }
}

/** Header at the top of a collapsible rail: collapse toggle + home. */
export function AppRailHeader() {
  const { collapsible } = useAppShellMode()
  const toggle = useAppSidebar((s) => s.toggle)
  if (!collapsible) return null
  return (
    <div className="apprail__head">
      <button className="apprail__toggle" onClick={toggle} aria-label="Collapse sidebar" title="Collapse sidebar">
        <PanelLeftClose width={17} height={17} />
      </button>
      <Link href="/dashboard" className="apprail__home" aria-label="Dashboard home">
        <YeetfulMark size={30} />
        <span className="apprail__word">pantessa</span>
      </Link>
    </div>
  )
}

/** Floating control shown top-left when the rail is collapsed. */
function AppRailReopen() {
  const toggle = useAppSidebar((s) => s.toggle)
  return (
    <div className="apprail__reopen">
      <button className="apprail__toggle" onClick={toggle} aria-label="Open sidebar" title="Open sidebar">
        <PanelLeft width={17} height={17} />
      </button>
      <Link href="/dashboard" className="apprail__homeicon" aria-label="Dashboard home">
        <YeetfulMark size={30} />
      </Link>
    </div>
  )
}

/**
 * Mounted once in the root layout. Reflects app-shell state onto the document
 * element (so CSS can restyle each surface's rail) and renders the floating
 * reopen toggle when collapsed.
 */
export function AppShellMount() {
  const { chrome, collapsible } = useAppShellMode()
  const collapsed = useAppSidebar((s) => s.collapsed)
  const railTucked = collapsible && collapsed

  useEffect(() => {
    const el = document.documentElement
    if (chrome) el.setAttribute('data-app-shell', '1')
    else el.removeAttribute('data-app-shell')
    if (railTucked) el.setAttribute('data-rail-collapsed', '1')
    else el.removeAttribute('data-rail-collapsed')
    return () => {
      el.removeAttribute('data-app-shell')
      el.removeAttribute('data-rail-collapsed')
    }
  }, [chrome, railTucked])

  return railTucked ? <AppRailReopen /> : null
}
