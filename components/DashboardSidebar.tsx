'use client'

// The dashboard's left rail (Vercel-style): section links with active state.
// Pathname comes in as a prop, which keeps the markup static-render testable
// despite the wallet gate (effects don't run under renderToStaticMarkup).

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { LayoutDashboard, KeyRound, Bot, ToggleRight, Activity, ReceiptText, Building2, LineChart, Server, MessageSquare, BookOpen, Sparkles } from 'lucide-react'
import { isAdminAddress } from '@/lib/admin'

export const DASH_SECTIONS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/servers', label: 'Servers', icon: Server, exact: false },
  { href: '/chat', label: 'Chat', icon: MessageSquare, exact: false },
  { href: '/dashboard/agents', label: 'Agents', icon: Bot, exact: false },
  { href: '/dashboard/keys', label: 'API Keys', icon: KeyRound, exact: false },
  { href: '/dashboard/approvals', label: 'Approvals', icon: ToggleRight, exact: false },
  { href: '/dashboard/activity', label: 'Activity', icon: Activity, exact: false },
  { href: '/dashboard/routing', label: 'Routing', icon: Sparkles, exact: false },
  { href: '/dashboard/receipts', label: 'Earnings', icon: ReceiptText, exact: false },
  { href: '/dashboard/org', label: 'Organization', icon: Building2, exact: false },
  { href: '/docs', label: 'Docs', icon: BookOpen, exact: false },
] as const

// Admin-only section, appended when the connected wallet is on the allowlist
// (server-enforced by /api/admin/overview; this is just nav visibility).
const ADMIN_SECTION = { href: '/dashboard/admin', label: 'Adoption', icon: LineChart, exact: false } as const

export function isSectionActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href)
}

export default function DashboardSidebar({ pathname, address }: { pathname: string; address?: string | null }) {
  const nav = useRef<HTMLElement>(null)
  // On the mobile horizontal bar, keep the active section in view.
  useEffect(() => {
    nav.current
      ?.querySelector('.is-on')
      ?.scrollIntoView({ block: 'nearest', inline: 'center', behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  const sections = isAdminAddress(address) ? [...DASH_SECTIONS, ADMIN_SECTION] : DASH_SECTIONS

  return (
    <nav className="dash__side" aria-label="Dashboard sections" ref={nav}>
      {sections.map(({ href, label, icon: Icon, exact }) => (
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
