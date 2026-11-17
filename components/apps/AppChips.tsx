'use client'

// YOUR APPS: the row that decides the page (squad apps-page). Every app that
// is on is a pressed chip with its mark; a tap removes it. A few apps that
// are off sit beside them, one tap from on. "Browse all" opens the tray
// under the row: the whole free fleet, the paid catalog, and "Add your own
// MCP" — the same list the drawer used to carry (components/AppsRailTab),
// so nothing the drawer could do is lost.

import { useMemo, useState } from 'react'
import BrandIcon from '@/components/BrandIcon'
import AppsRailTab from '@/components/AppsRailTab'
import { fleetRank } from '@/lib/free-fleet'
import { cleanServerName, cn } from '@/lib/utils'
import { useAppSet } from '@/components/apps/useAppSet'

/** How many off apps the row offers before "Browse all" takes over. */
const OFFERED = 5

export default function AppChips({ right }: { right?: React.ReactNode }) {
  const { servers, active, toggle } = useAppSet()
  const [trayOpen, setTrayOpen] = useState(false)

  const offered = useMemo(() => {
    const on = new Set(active.map((s) => s.id))
    return servers
      .filter((s) => !on.has(s.id) && s.gated === false && !/^yeetful-tool-/.test(s.slug))
      .sort((a, b) => fleetRank(a.slug) - fleetRank(b.slug))
      .slice(0, OFFERED)
  }, [servers, active])

  return (
    <div className="apg-chips" data-apps-chips="">
      <div className="apg-chips__row">
        <span className="apg-eyebrow apg-chips__label">Your apps</span>
        <div className="apg-chips__list" role="group" aria-label="Apps on this page">
          {active.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed="true"
              onClick={() => toggle(s)}
              title={`${cleanServerName(s.name)} is on this page. Click to remove it.`}
              className="apg-chip apg-chip--on"
              data-apps-chip={s.slug}
            >
              <BrandIcon server={s} size={16} />
              <span>{cleanServerName(s.name)}</span>
              <span aria-hidden className="apg-chip__x">
                ×
              </span>
            </button>
          ))}
          {offered.map((s) => (
            <button
              key={s.id}
              type="button"
              aria-pressed="false"
              onClick={() => toggle(s)}
              title={`Add ${cleanServerName(s.name)} to this page`}
              className="apg-chip"
              data-apps-chip={s.slug}
            >
              <BrandIcon server={s} size={16} />
              <span>{cleanServerName(s.name)}</span>
              <span aria-hidden className="apg-chip__x">
                +
              </span>
            </button>
          ))}
          <button
            type="button"
            aria-expanded={trayOpen}
            aria-controls="apg-tray"
            onClick={() => setTrayOpen((v) => !v)}
            className={cn('apg-chip apg-chip--browse', trayOpen && 'apg-chip--open')}
            data-apps-browse=""
          >
            {trayOpen ? 'Close' : 'Browse all'}
          </button>
        </div>
        {right && <div className="apg-chips__right">{right}</div>}
      </div>
      {trayOpen && (
        <div id="apg-tray" className="apg-tray" data-apps-tray="">
          <AppsRailTab flat />
        </div>
      )}
    </div>
  )
}
