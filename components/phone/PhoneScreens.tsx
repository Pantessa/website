'use client'

// THE PHONE SCREENS (squad mobile-native, 2026-09-24, D2 "a tab is a
// place"): what /chat's main area shows below lg for each destination the
// bottom bar names. Every body is the SAME component the desktop drawer
// renders in its column (AppsRailTab, JobsRailTab, LinksRailTab,
// TeamRailTab, ChatsRailTab), laid flat inside the screen's one scroller.
//
// LINKS is the studio (name your page, mint, earnings, the funnel table;
// LinksWorkspace — the public board for a visitor with no session). The
// rail's quick list (Mint a link, the first-payout checklist, your links
// with opens/signed to copy, your page) is ONE LABELED TAP away — "Your
// list" in the header opens it as a Sheet with a scrim, closed by default,
// closed by a tap outside — instead of the 248px drawer that used to pop
// over half the studio with no way to dismiss it. Its Mint / Name-your-page
// actions land on the studio itself (the sheet closes, the screen scrolls
// to the mint stage or the page panel): the studio already holds both.

import { useState } from 'react'
import { ListChecks } from 'lucide-react'
import { useYeetfulStore, type PhoneScreen as PhoneScreenName } from '@/lib/store'
import PhoneScreen from '@/components/phone/PhoneScreen'
import Sheet from '@/components/mobile/Sheet'
import AppsRailTab from '@/components/AppsRailTab'
import ChatsRailTab from '@/components/ChatsRailTab'
import JobsRailTab from '@/components/JobsRailTab'
import LinksRailTab from '@/components/LinksRailTab'
import TeamRailTab from '@/components/TeamRailTab'
import LinksWorkspace from '@/components/LinksWorkspace'

/** The screen headings, the same words the desktop drawer uses. */
export const PHONE_SCREEN_TITLES: Record<Exclude<PhoneScreenName, 'chat'>, string> = {
  apps: 'Your apps',
  jobs: 'Running work',
  links: 'Intent links',
  team: 'Your team',
  history: 'Chats',
}

/** Scroll the LINKS screen to one of the studio's own stages. */
function scrollStudioTo(selector: string) {
  const el = document.querySelector<HTMLElement>(`[data-phone-screen="links"] ${selector}`)
  el?.scrollIntoView({ block: 'start', behavior: 'smooth' })
}

function LinksScreen() {
  const [listOpen, setListOpen] = useState(false)
  // Close the sheet, then land on the studio's stage after the sheet's DOM
  // has gone (the next frame) so nothing scrolls under a scrim.
  const landOn = (selector: string) => {
    setListOpen(false)
    requestAnimationFrame(() => scrollStudioTo(selector))
  }
  return (
    <PhoneScreen
      name="links"
      title={PHONE_SCREEN_TITLES.links}
      action={
        <button
          type="button"
          onClick={() => setListOpen(true)}
          aria-label="Your list"
          aria-haspopup="dialog"
          aria-expanded={listOpen}
          title="Your links at a glance — mint, the first-payout checklist, copy a link, your page"
          className="flex-shrink-0 flex items-center gap-1.5 min-h-[44px] px-3 rounded-xl text-[12px] font-medium text-[color:var(--accent)] active:bg-[var(--surf-1)] transition-colors select-none"
        >
          <ListChecks className="w-4 h-4" aria-hidden />
          Your list
        </button>
      }
    >
      <LinksWorkspace />
      <Sheet id="links-list" open={listOpen} onClose={() => setListOpen(false)} title="Your links" size="auto">
        <div className="flex flex-col pb-2">
          <LinksRailTab flat onMint={() => landOn('.linkstudio__mint')} onPage={() => landOn('.linkstudio__page')} onStudio={() => landOn('.linkstudio')} />
        </div>
      </Sheet>
    </PhoneScreen>
  )
}

export default function PhoneScreens({ screen }: { screen: Exclude<PhoneScreenName, 'chat'> }) {
  const { setPhoneScreen } = useYeetfulStore()
  const toChat = () => setPhoneScreen('chat')
  switch (screen) {
    case 'apps':
      return (
        <PhoneScreen name="apps" title={PHONE_SCREEN_TITLES.apps}>
          <AppsRailTab flat />
        </PhoneScreen>
      )
    case 'jobs':
      return (
        <PhoneScreen name="jobs" title={PHONE_SCREEN_TITLES.jobs}>
          <JobsRailTab flat onNavigate={toChat} />
        </PhoneScreen>
      )
    case 'links':
      return <LinksScreen />
    case 'team':
      return (
        <PhoneScreen name="team" title={PHONE_SCREEN_TITLES.team}>
          <TeamRailTab flat />
        </PhoneScreen>
      )
    case 'history':
      return (
        <PhoneScreen name="history" title={PHONE_SCREEN_TITLES.history}>
          <ChatsRailTab flat onNavigate={toChat} />
        </PhoneScreen>
      )
  }
}
