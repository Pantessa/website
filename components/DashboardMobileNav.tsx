'use client'

// Mobile dashboard navigation. Replaces the old horizontal-scroll section row
// (13+ links you had to swipe through, with the current one easily lost) with a
// compact bar — current section name + a hamburger — that opens a full vertical
// drawer of every section, the org switcher, and the account/sign-out control.
//
// The drawer is portaled to <body>: the sticky bar's backdrop-filter makes it
// the containing block for fixed descendants, which would otherwise trap the
// drawer inside the bar (same fix as the brochure nav drawer).

import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import { Menu, X } from 'lucide-react'
import DashboardSidebar, { currentSectionLabel } from '@/components/DashboardSidebar'
import DashboardAccount from '@/components/DashboardAccount'
import OrgSwitcher from '@/components/OrgSwitcher'

export default function DashboardMobileNav({ pathname, address }: { pathname: string; address: string }) {
  const [open, setOpen] = useState(false)

  // Close on route change; lock body scroll + wire Escape while open.
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    document.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = ''
    }
  }, [open])

  return (
    <div className="dashnav">
      <div className="dashnav__bar">
        <span className="dashnav__crumb mono">{currentSectionLabel(pathname, address)}</span>
        <button
          type="button"
          className="dashnav__burger"
          aria-label={open ? 'Close menu' : 'Open menu'}
          aria-expanded={open}
          onClick={() => setOpen((o) => !o)}
        >
          {open ? <X width={18} height={18} /> : <Menu width={18} height={18} />}
          Menu
        </button>
      </div>

      {open &&
        createPortal(
          <div className="dashnav__drawer">
            <button className="dashnav__backdrop" aria-label="Close menu" onClick={() => setOpen(false)} />
            <div className="dashnav__panel" role="dialog" aria-label="Dashboard navigation">
              <OrgSwitcher />
              <DashboardSidebar pathname={pathname} address={address} onNavigate={() => setOpen(false)} />
              <DashboardAccount address={address} />
            </div>
          </div>,
          document.body,
        )}
    </div>
  )
}
