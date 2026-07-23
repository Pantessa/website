'use client'

// The dashboard's left rail (Vercel-style): section links with active state.
// Pathname comes in as a prop, which keeps the markup static-render testable
// despite the wallet gate (effects don't run under renderToStaticMarkup).

import Link from 'next/link'
import { useEffect, useRef } from 'react'
import { LayoutDashboard, KeyRound, Bot, ToggleRight, Activity, ReceiptText, Building2, LineChart, Server, MessageSquare, BookOpen, Sparkles, AlertTriangle, CreditCard, Globe, ShieldAlert, ShieldCheck, Users, Landmark, Link2 } from 'lucide-react'
import { isAdminAddress } from '@/lib/admin'

// Links-first order (Nate, 2026-07-22): App rides right under Overview,
// Intent links at the top of the product sections — the link rail is the
// product's front door. Guardian rides right below it (Nate, 2026-07-23).
export const DASH_SECTIONS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/chat', label: 'App', icon: MessageSquare, exact: false },
  { href: '/dashboard/links', label: 'Intent links', icon: Link2, exact: false },
  { href: '/dashboard/guardian', label: 'Guardian', icon: ShieldCheck, exact: false },
  { href: '/dashboard/embeds', label: 'Embeds', icon: Globe, exact: false },
  { href: '/dashboard/servers', label: 'Servers', icon: Server, exact: false },
  { href: '/dashboard/agents', label: 'Agents', icon: Bot, exact: false },
  { href: '/dashboard/guardian', label: 'Guardian', icon: ShieldCheck, exact: false },
  { href: '/dashboard/keys', label: 'API Keys', icon: KeyRound, exact: false },
  { href: '/dashboard/approvals', label: 'Approvals', icon: ToggleRight, exact: false },
  { href: '/dashboard/plan', label: 'Usage', icon: CreditCard, exact: false },
  { href: '/dashboard/activity', label: 'Activity', icon: Activity, exact: false },
  { href: '/dashboard/routing', label: 'Routing', icon: Sparkles, exact: false },
  { href: '/dashboard/receipts', label: 'Earnings', icon: ReceiptText, exact: false },
  { href: '/dashboard/org', label: 'Organization', icon: Building2, exact: false },
  { href: '/docs', label: 'Docs', icon: BookOpen, exact: false },
] as const

// Admin-only sections, appended when the connected wallet is on the allowlist
// (server-enforced by each page; this is just nav visibility). Incidents =
// /incidents (the self-heal logs); admins only, page 404s for everyone else.
const ADMIN_SECTIONS = [
  // Users merged INTO Adoption (2026-07-22) — /dashboard/users redirects.
  { href: '/dashboard/admin', label: 'Adoption', icon: LineChart, exact: false },
  { href: '/dashboard/treasury', label: 'Treasury', icon: Landmark, exact: false },
  { href: '/dashboard/failures', label: 'Failures', icon: ShieldAlert, exact: false },
  { href: '/incidents', label: 'Incidents', icon: AlertTriangle, exact: false },
] as const

export function isSectionActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href)
}

/** All sections visible to this wallet (admin rows appended on the allowlist). */
export function sectionsFor(address?: string | null) {
  return isAdminAddress(address) ? [...DASH_SECTIONS, ...ADMIN_SECTIONS] : DASH_SECTIONS
}

/**
 * The label of the section the current path sits under — used by the mobile
 * bar so "you are here" is always legible (the old horizontal-scroll row
 * buried it). Picks the most specific match (longest matching href).
 */
export function currentSectionLabel(pathname: string, address?: string | null): string {
  const match = sectionsFor(address)
    .filter((s) => isSectionActive(pathname, s.href, s.exact))
    .sort((a, b) => b.href.length - a.href.length)[0]
  return match?.label ?? 'Dashboard'
}

export default function DashboardSidebar({
  pathname,
  address,
  onNavigate,
}: {
  pathname: string
  address?: string | null
  /** Fired when a section link is tapped — the mobile drawer uses it to close. */
  onNavigate?: () => void
}) {
  const nav = useRef<HTMLElement>(null)
  // Keep the active section in view (harmless on the vertical rail; matters
  // when this list renders inside a scrollable mobile drawer).
  useEffect(() => {
    nav.current
      ?.querySelector('.is-on')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest', behavior: 'instant' as ScrollBehavior })
  }, [pathname])

  return (
    <nav className="dash__side" aria-label="Dashboard sections" ref={nav}>
      {sectionsFor(address).map(({ href, label, icon: Icon, exact }) => (
        <Link
          key={href}
          href={href}
          onClick={onNavigate}
          className={`dash__link mono ${isSectionActive(pathname, href, exact) ? 'is-on' : ''}`}
        >
          <Icon width={15} height={15} />
          {label}
        </Link>
      ))}
    </nav>
  )
}
