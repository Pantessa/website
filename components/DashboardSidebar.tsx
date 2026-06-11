// The dashboard's left rail (Vercel-style): section links with active state.
// Presentational — pathname comes in as a prop, which keeps it static-render
// testable despite the wallet gate around the real dashboard.

import Link from 'next/link'
import { LayoutDashboard, KeyRound, ToggleRight, Activity } from 'lucide-react'

export const DASH_SECTIONS = [
  { href: '/dashboard', label: 'Overview', icon: LayoutDashboard, exact: true },
  { href: '/dashboard/keys', label: 'API Keys', icon: KeyRound, exact: false },
  { href: '/dashboard/approvals', label: 'Approvals', icon: ToggleRight, exact: false },
  { href: '/dashboard/activity', label: 'Activity', icon: Activity, exact: false },
] as const

export function isSectionActive(pathname: string, href: string, exact: boolean): boolean {
  return exact ? pathname === href : pathname.startsWith(href)
}

export default function DashboardSidebar({ pathname }: { pathname: string }) {
  return (
    <nav className="dash__side" aria-label="Dashboard sections">
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
