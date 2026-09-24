'use client'

// The conversation's top bar on a phone (squad mobile-native, 2026-09-24, CHAT
// lane). Nate: "it needs to feel like a native mobile app when accessed from
// mobile." A conversation in Messages has one compact row: the way back to
// the list on the left, who you're talking to in the middle (tap it for the
// details), and the few controls that matter on the right. Here:
//
//   ‹ Chats   │  <title>            │  chain  share  account
//             │  4 apps ›           │
//
// - "‹ Chats" opens the chat list (setPhoneScreen('history')), labeled.
// - The middle is ONE 44px target: the chat's title over the apps count; a tap
//   opens the apps screen (setPhoneScreen('apps')), the way tapping a group
//   chat's header opens its members. Never an overlay drawer (README D2).
// - The chain picker and Share keep their seats; the account door is the site's
//   own (SiteAccount), compacted to a 44px avatar by chat-phone.css.
//
// Rendered only below lg; the desktop toolbar is unchanged at lg+.

import { ChevronLeft, LayoutGrid } from 'lucide-react'
import ChainPicker from '@/components/ChainPicker'
import ShareButton from '@/components/ShareButton'
import SiteAccount from '@/components/SiteAccount'
import { useYeetfulStore } from '@/lib/store'
import { appsDoorLabel, phoneChatTitle } from '@/lib/chat-phone'
import './chat-phone.css'

export default function ChatPhoneBar({ title, appCount, showAccount }: { title: string | null | undefined; appCount: number; showAccount: boolean }) {
  const setPhoneScreen = useYeetfulStore((s) => s.setPhoneScreen)
  const name = phoneChatTitle(title)
  const apps = appsDoorLabel(appCount)
  return (
    <div data-chat-topbar="" className="chat-phonebar lg:hidden">
      <button
        type="button"
        data-phone-to-history=""
        onClick={() => setPhoneScreen('history')}
        aria-label="Chats: your conversations"
        className="chat-phonebar__back"
      >
        <ChevronLeft className="w-5 h-5 -ml-1" strokeWidth={2.25} aria-hidden />
        <span>Chats</span>
      </button>
      <button
        type="button"
        data-phone-to-apps=""
        onClick={() => setPhoneScreen('apps')}
        aria-label={`${name}. ${apps} in this chat: open your apps`}
        className="chat-phonebar__head"
      >
        <span data-chat-title="" className="chat-phonebar__title">
          {name}
        </span>
        <span className="chat-phonebar__apps">
          <LayoutGrid className="w-3 h-3" aria-hidden />
          {apps}
          <span aria-hidden>›</span>
        </span>
      </button>
      <div className="chat-phonebar__chain">
        <ChainPicker />
      </div>
      <div className="chat-phonebar__share">
        <ShareButton />
      </div>
      {showAccount && (
        <div className="chat-phonebar__acct">
          <SiteAccount />
        </div>
      )}
    </div>
  )
}
