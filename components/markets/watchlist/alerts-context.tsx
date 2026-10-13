'use client'

// ONE alerts read for the markets side column (2026-10-13, Nate: "remove the
// alerts bar, maybe just put the alert icon that pops up if clicked near the
// ASK button"). The bell in the top strip (shell/RailAlerts) and the
// watchlist rail's "Set an alert" form (WatchlistRail → AlertForm) both act
// on the owner's alerts, so they read and write the SAME useAlerts instance:
// a rule set from a row shows on the bell at once, a dismissal on the bell is
// the rail's too, and the 30s poll runs once. MarketsSide owns the instance
// and provides it; a rail mounted outside the side column keeps its own.

import { createContext, useContext } from 'react'
import type { AlertsApi } from './useWatchlists'

export const AlertsContext = createContext<AlertsApi | null>(null)

export function useSharedAlerts(): AlertsApi | null {
  return useContext(AlertsContext)
}
