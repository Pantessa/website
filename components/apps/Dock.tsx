'use client'

// The chat dock's own pieces (squad apps-page): the header that says which
// apps the chat is scoped to (one line, the names cut with an ellipsis), the
// controls (a new chat once there is a thread, expand to the full-width
// conversation, close to the pinned ask bar), the empty state, and the "/"
// shortcut that brings the composer from anywhere on the page. The thread,
// the composer and every card are ChatInterface's, unchanged: the dock is
// the SAME chat in a column, not a second runtime.

import { useEffect } from 'react'
import { usePathname, useRouter } from 'next/navigation'
import { Maximize2, SquarePen, X } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { useAppsUi } from '@/lib/apps-page-ui'
import { chatScopeLabel } from '@/lib/apps-page'
import { DOCK_SHORTCUT_HINT, isChatShortcut } from '@/lib/apps-dock'
import { cleanServerName } from '@/lib/utils'
import './apps.css'
import './dock.css'

const rank = (order: string[], id: string) => {
  const i = order.indexOf(id)
  return i < 0 ? order.length : i
}

/** Most marks the header shows; the words say the rest ("5 apps"). */
const MARKS = 4

/** "CHAT WITH [marks] Uniswap and Snapshot": the toolbar's left side. */
export function DockScope({ servers: given }: { servers: McpServer[] }) {
  // In the order the row shows them (the order they were added), not the
  // directory's.
  const order = useYeetfulStore((s) => s.activeServerIds)
  const servers = [...given].sort((a, b) => rank(order, a.id) - rank(order, b.id))
  const names = servers.map((s) => cleanServerName(s.name))
  return (
    <div className="apg-dock__scope apgd-scope" data-dock-scope={servers.length} title={names.length ? `This chat uses ${names.join(', ')}` : undefined}>
      <span className="apg-eyebrow apgd-scope__eyebrow">Chat with</span>
      {servers.length > 0 && (
        <span className="apg-dock__marks apgd-scope__marks" aria-hidden>
          {servers.slice(0, MARKS).map((s) => (
            <BrandIcon key={s.id} server={s} size={16} />
          ))}
        </span>
      )}
      <span className="apg-dock__name apgd-scope__name">{chatScopeLabel(names)}</span>
    </div>
  )
}

/** New chat (only once there is a thread to leave), expand (the
 *  conversation takes the whole main area; the APPS tab brings the page
 *  back) and close (the page keeps one pinned ask bar). */
export function DockControls() {
  const setMcpRailOpen = useYeetfulStore((s) => s.setMcpRailOpen)
  const setCurrentChatId = useYeetfulStore((s) => s.setCurrentChatId)
  const hasThread = useYeetfulStore((s) => (s.chats.find((c) => c.id === s.currentChatId)?.messages.length ?? 0) > 0)
  const setChatOpen = useAppsUi((s) => s.setChatOpen)
  const router = useRouter()
  const pathname = usePathname()
  // Same as the CHATS drawer's New Chat (components/ChatsRailTab): clear the
  // current thread by hand, and leave an open thread's address for the bare
  // /chat. The apps page stays: it follows the store, not the address.
  const newChat = () => {
    setCurrentChatId(null)
    if (pathname !== '/chat') router.push('/chat')
  }
  return (
    <>
      {hasThread && (
        <button type="button" className="apg-dock__btn" onClick={newChat} aria-label="Start a new chat" title="New chat" data-dock-new="">
          <SquarePen width={15} height={15} aria-hidden />
        </button>
      )}
      <button type="button" className="apg-dock__btn" onClick={() => setMcpRailOpen(false)} aria-label="Open the chat full width" title="Full width. The Apps tab brings the page back." data-dock-expand="">
        <Maximize2 width={15} height={15} aria-hidden />
      </button>
      <button type="button" className="apg-dock__btn" onClick={() => setChatOpen(false)} aria-label="Close the chat" title="Close the chat" data-dock-close="">
        <X width={16} height={16} aria-hidden />
      </button>
    </>
  )
}

/** "/" from anywhere on the apps page: open the dock if it is closed and put
 *  the cursor in its composer. Mounted only beside the apps page. */
export function DockShortcut() {
  const setChatOpen = useAppsUi((s) => s.setChatOpen)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.defaultPrevented) return
      const t = e.target instanceof HTMLElement ? e.target : null
      if (!isChatShortcut({ key: e.key, metaKey: e.metaKey, ctrlKey: e.ctrlKey, altKey: e.altKey, isComposing: e.isComposing, target: t ? { tagName: t.tagName, isContentEditable: t.isContentEditable, type: (t as HTMLInputElement).type } : null })) return
      // A dialog (the add-MCP form, a sheet) owns the keyboard while open.
      if (document.querySelector('[role="dialog"][aria-modal="true"]')) return
      e.preventDefault()
      setChatOpen(true)
      // The dock un-hides on the next commit; wait for its composer.
      let tries = 0
      const focus = () => {
        const el = document.querySelector<HTMLTextAreaElement>('[data-chat-dock="open"] [data-composer-input]')
        if (el) {
          el.focus()
          return
        }
        if (++tries < 20) requestAnimationFrame(focus)
      }
      requestAnimationFrame(focus)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setChatOpen])
  return null
}

/** The dock before the first message: what it is for, and a few asks the
 *  open apps suggest (the page publishes them: lib/apps-page-ui), each a
 *  full-width row that reads as something to say. */
export function DockEmpty({ count, onPick, phone }: { count: number; onPick: (prompt: string) => void; /** The phone's conversation screen: there is no page beside it. */ phone?: boolean }) {
  const suggestions = useAppsUi((s) => s.suggestions)
  return (
    <div className="apg-dockempty apgd-empty" data-dock-empty="">
      <p className="apg-dockempty__lead apgd-empty__lead">
        {count === 0
          ? 'Add an app to the page and it joins this chat.'
          : `${phone ? 'Ask about your apps' : 'Ask about anything on the page'}, or say what should happen. Anything that moves money comes back here as a card your wallet signs.`}
      </p>
      {count > 0 && suggestions.length > 0 && (
        <div className="apgd-empty__list" role="list" aria-label="Things to ask">
          <span className="apg-eyebrow">Try</span>
          {suggestions.map((s) => (
            <button key={s.prompt} type="button" role="listitem" className="apgd-say" onClick={() => onPick(s.prompt)} title={s.prompt} data-dock-suggestion="">
              <span className="apgd-say__text">{s.label}</span>
            </button>
          ))}
        </div>
      )}
      <p className="apgd-empty__hint" data-dock-hint="">
        {DOCK_SHORTCUT_HINT.split('/')[0]}
        <kbd className="apgd-kbd">/</kbd>
        {DOCK_SHORTCUT_HINT.split('/').slice(1).join('/')}
      </p>
    </div>
  )
}
