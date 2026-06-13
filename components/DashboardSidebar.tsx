'use client'

// The dashboard's left rail (Vercel-style): section links with active state.
// Pathname comes in as a prop, which keeps the markup static-render testable
// despite the wallet gate (effects don't run under renderToStaticMarkup).

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { LayoutDashboard, KeyRound, Bot, ToggleRight, Activity, Building2 } from 'lucide-react'

export const DASH_SECTIONS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/agents', label: 'Agents', icon: Bot, exact: false },
  { href: '/dashboard/keys', label: 'API Keys', icon: KeyRound, exact: false },
  { href: '/dashboard/approvals', label: 'Approvals', icon: ToggleRight, exact: false },
  { href: '/dashboard/activity', label: 'Activity', icon: Activity, exact: false },
  { href: '/dashboard/org', label: 'Organization', icon: Building2, exact: false },
] as const

export function isSectionActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href)
}

export default function DashboardSidebar({ pathname }: { pathname: string }) {
  const nav = useRef<HTMLElement>(null)
  // On the mobile horizontal bar, keep the active section in view.
  useEffect(() => {
    nav.current
      ?.querySelector('.is-on')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  return (
    <nav className="dash__side" aria-label="Dashboard sections" ref={nav}>
      {DASH_SECTIONS.map(({ href, label, icon: Icon, exact }) => (
        <Link
          key={href}
          href={href}
          className={`dash__link mono ${isSectionActive(pathname, href, exact) ? 'is-on' : ''}`}
        >
          <Icon width={15} height={15} />
          {label}
        </Link>
      ))}
    </nav>
  )
}
