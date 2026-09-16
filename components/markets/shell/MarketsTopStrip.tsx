'use client'

// The strip above the watchlist (2026-09-11, Nate: "integrate the account
// connected and ask into the fixed watch list"). With the brochure nav gone
// on the markets surface, its two live controls dock here: the Ask door's
// trigger (⌘K — the same sheet, symbol-aware chips on /t/<sym>) and the
// site's account control (SiteAccount — sign-in door when disconnected, the
// NavAccount pill otherwise). Sign-in and sign-out both keep you on the page,
// query included (?tab=trade survives): the door names no destination, so it
// lands on the page it is pressed on (lib/app-entry signInLandingFor). Sticky
// at the top of the side column on desktop; the page's top bar on phones.

import { AskDoorTrigger } from '@/components/AskDoor'
import SiteAccount from '@/components/SiteAccount'

export default function MarketsTopStrip() {
  return (
    <div className="mkt-frame__top" data-slot="top-strip">
      <AskDoorTrigger variant="rail" />
      <div className="mkt-frame__acct">
        <SiteAccount />
      </div>
    </div>
  )
}
