'use client'

// The strip above the watchlist (2026-09-11, Nate: "integrate the account
// connected and ask into the fixed watch list"). With the brochure nav gone
// on the markets surface, its two live controls dock here: the Ask door's
// trigger (⌘K — the same sheet, symbol-aware chips on /t/<sym>) and the
// site's account control (SiteAccount — sign-in door when disconnected, the
// NavAccount pill otherwise; sign-in and sign-out both keep you on the
// page). Sticky at the top of the side column on desktop; the page's top
// bar on phones.

import { useEffect, useState } from 'react'
import { usePathname } from 'next/navigation'
import { AskDoorTrigger } from '@/components/AskDoor'
import SiteAccount from '@/components/SiteAccount'

export default function MarketsTopStrip() {
  const pathname = usePathname()
  // Where the sign-in door lands afterwards: this page, query included
  // (?tab=trade survives). Read after mount — window only — and the
  // pathname is the SSR-safe fallback.
  const [here, setHere] = useState(pathname)
  useEffect(() => setHere(window.location.pathname + window.location.search), [pathname])
  return (
    <div className="mkt-frame__top" data-slot="top-strip">
      <AskDoorTrigger variant="rail" />
      <div className="mkt-frame__acct">
        <SiteAccount redirectTo={here} />
      </div>
    </div>
  )
}
