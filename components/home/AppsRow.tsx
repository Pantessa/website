'use client'

// THE APPS ROW's seat on the splash (2026-10-13): the fleet's marks in a
// row, each a door into the chat's APPS drawer with that app on (lib/home-apps
// — the chat's own `?mcps=` deep link). It stands where the guide card stood
// ("the space where it says see the live tape" — the deck is that lesson
// now), so it also keeps the guide's record of a splash visit
// (`visited:home`, which the claim block reads to go compact on a return).
// A SpineLink either way: the chat surface is public to look at today
// (lib/app-entry isPublicAppPath), and if that rule ever closes again the
// door comes back here on its own.

import { useEffect } from 'react'
import SpineLink from '@/components/SpineLink'
import { getProtocolMark } from '@/components/protocol-marks'
import { noteGuideEvent } from '@/lib/guide'
import { HOME_APPS, HOME_APPS_ALL_HREF, HOME_APPS_EYEBROW, HOME_APPS_WHY, homeAppHref } from '@/lib/home-apps'
import './apps-row.css'

export default function AppsRow() {
  useEffect(() => {
    noteGuideEvent('visited:home')
  }, [])
  return (
    <section className="apps-row" aria-label="Your apps" data-apps-row>
      <header className="apps-row__head">
        <span className="apps-row__eyebrow mono">{HOME_APPS_EYEBROW}</span>
        <span className="apps-row__why">{HOME_APPS_WHY}</span>
      </header>
      <ul className="apps-row__list">
        {HOME_APPS.map((a) => {
          const Mark = getProtocolMark(a.slug, a.name)
          return (
            <li key={a.slug}>
              <SpineLink href={homeAppHref(a.slug)} className="apps-row__app" prefetch={false} title={a.does} data-journey={`App ${a.name}`} data-app={a.slug}>
                <span className="apps-row__mark" aria-hidden>
                  {Mark ? <Mark size={18} /> : a.name.slice(0, 1)}
                </span>
                <span className="apps-row__name">{a.name}</span>
              </SpineLink>
            </li>
          )
        })}
        <li>
          <SpineLink href={HOME_APPS_ALL_HREF} className="apps-row__app apps-row__app--all" prefetch={false} data-journey="All apps">
            All apps <span className="apps-row__arrow" aria-hidden>→</span>
          </SpineLink>
        </li>
      </ul>
    </section>
  )
}
