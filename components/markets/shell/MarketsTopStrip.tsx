'use client'

// The strip above the watchlist (2026-09-11, Nate: "integrate the account
// connected and ask into the fixed watch list"). With the brochure nav gone
// on the markets surface, its live controls dock here: the Ask door's
// trigger (⌘K — the same sheet, symbol-aware chips on /t/<sym>), the alerts
// bell (RailAlerts, 2026-10-13 — fired + armed alerts behind one icon, the
// rail no longer spends two bands on them) and the site's account control
// (SiteAccount — sign-in door when disconnected, the NavAccount pill
// otherwise). Sign-in and sign-out both keep you on the page, query included
// (?tab=trade survives): the door names no destination, so it lands on the
// page it is pressed on (lib/app-entry signInLandingFor). Sticky at the top
// of the side column on desktop; the page's top bar on phones. The lens
// between Ask and the bell opens the symbol search (2026-11-17,
// components/markets/search): any chart from any markets page, `/` too.

import { AskDoorTrigger } from '@/components/AskDoor'
import RailAlerts from '@/components/markets/shell/RailAlerts'
import { SymbolSearchTrigger } from '@/components/markets/search/SymbolSearch'
import SiteAccount from '@/components/SiteAccount'
import type { ReactNode } from 'react'

// `lead` (2026-11-19, Nate: "Pantessa — An intent is all you need and the Ask
// buttons should be on the same horizontal level and padding"): whatever the
// page wants at the strip's left edge, on the row the controls ride. Only the
// home hands one (its eyebrow), and components/home/mosaic.css shows it only
// where the strip is a full-width bar over the stranger's hero.
export default function MarketsTopStrip({ lead }: { lead?: ReactNode }) {
  return (
    <div className="mkt-frame__top" data-slot="top-strip">
      {lead ? <div className="mkt-frame__lead">{lead}</div> : null}
      <AskDoorTrigger variant="rail" />
      <SymbolSearchTrigger variant="strip" />
      <RailAlerts />
      <div className="mkt-frame__acct">
        <SiteAccount />
      </div>
    </div>
  )
}
