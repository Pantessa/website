'use client'

// The dashboard's phone chrome: ONE top bar (squad mobile-native, 2026-09-24).
//
// On a phone the dashboard used to stack three bars: this one (a crumb + a
// Menu burger), the spine's tab bar, and the Ask bar (DashAskBar) riding just
// above it: 171px of chrome on a 667px screen, 496px left for the page. And
// this bar never stuck: it was `sticky; top: 64px` inside a wrapper exactly
// its own height, so 600px down the page it sat at top −600 with the section
// switcher gone.
//
// Now the bar is the whole chrome besides the tab bar:
//   • left, the section you're in, which is also the button that switches
//     sections: the ONE Sheet (the org, every section, your account), closed
//     by a tap outside, a swipe, Escape, the back gesture, or picking a
//     section;
//   • right, Ask: the site-wide ask door, the same one every other page
//     opens (DashAskBar steps aside while this bar shows).
// The bar sticks at the top of whatever scrolls the screen (CSS: `.dashnav`).

import { useEffect, useState } from 'react'
import { ChevronDown } from 'lucide-react'
import DashboardSidebar, { currentSectionLabel } from '@/components/DashboardSidebar'
import DashboardAccount from '@/components/DashboardAccount'
import OrgSwitcher from '@/components/OrgSwitcher'
import Sheet from '@/components/mobile/Sheet'
import { PantessaMark } from '@/components/Logo'
import { useAskDoor } from '@/lib/ask-door'

export default function DashboardMobileNav({ pathname, address }: { pathname: string; address: string }) {
  const [open, setOpen] = useState(false)
  const openDoor = useAskDoor((s) => s.openDoor)
  const label = currentSectionLabel(pathname, address)

  // A new section closes the sheet (the links also close it on tap).
  useEffect(() => setOpen(false), [pathname])

  return (
    <div className="dashnav">
      <div className="dashnav__bar" data-dash-bar>
        <button
          type="button"
          className="dashnav__switch"
          aria-haspopup="dialog"
          aria-expanded={open}
          aria-label={`Dashboard sections, now on ${label}`}
          onClick={() => setOpen(true)}
          data-dash-sections
        >
          <span className="dashnav__eyebrow mono">Dashboard</span>
          <span className="dashnav__crumb">
            <span className="dashnav__label">{label}</span>
            <ChevronDown className="dashnav__chev" width={16} height={16} aria-hidden />
          </span>
        </button>
        <button type="button" className="dashnav__ask" onClick={() => openDoor()} aria-label="Ask Pantessa" data-dash-ask>
          <PantessaMark size={18} />
          Ask
        </button>
      </div>

      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Dashboard"
        id="dash-sections"
        className="dashsheet"
        footer={<DashboardAccount address={address} />}
      >
        <div className="dashsheet__body">
          <OrgSwitcher />
          <DashboardSidebar pathname={pathname} address={address} onNavigate={() => setOpen(false)} />
        </div>
      </Sheet>
    </div>
  )
}
