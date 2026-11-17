'use client'

// The chat dock's own pieces (squad apps-page): the header that says which
// apps the chat is scoped to, the two controls (expand to the full-width
// conversation, close to the pinned ask bar), and the empty state. The
// thread, the composer and every card are ChatInterface's, unchanged — the
// dock is the SAME chat in a column, not a second runtime.

import { Maximize2, X } from 'lucide-react'
import BrandIcon from '@/components/BrandIcon'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { useAppsUi } from '@/lib/apps-page-ui'
import { chatScopeLabel } from '@/lib/apps-page'
import { cleanServerName } from '@/lib/utils'

/** "CHAT WITH [marks] Uniswap and Snapshot" — the toolbar's left side. */
export function DockScope({ servers }: { servers: McpServer[] }) {
  const names = servers.map((s) => cleanServerName(s.name))
  return (
    <div className="apg-dock__scope" data-dock-scope={servers.length}>
      <span className="apg-eyebrow">Chat with</span>
      <span className="apg-dock__marks" aria-hidden>
        {servers.slice(0, 4).map((s) => (
          <BrandIcon key={s.id} server={s} size={16} />
        ))}
      </span>
      <span className="apg-dock__name" title={names.join(', ')}>
        {chatScopeLabel(names)}
      </span>
    </div>
  )
}

/** Expand (the conversation takes the whole main area; the APPS tab brings
 *  the page back) and close (the page keeps one pinned ask bar). */
export function DockControls() {
  const setMcpRailOpen = useYeetfulStore((s) => s.setMcpRailOpen)
  const setChatOpen = useAppsUi((s) => s.setChatOpen)
  return (
    <>
      <button type="button" className="apg-dock__btn" onClick={() => setMcpRailOpen(false)} aria-label="Open the chat full width" title="Full width. The Apps tab brings the page back." data-dock-expand="">
        <Maximize2 width={15} height={15} aria-hidden />
      </button>
      <button type="button" className="apg-dock__btn" onClick={() => setChatOpen(false)} aria-label="Close the chat" title="Close the chat" data-dock-close="">
        <X width={16} height={16} aria-hidden />
      </button>
    </>
  )
}

/** The dock before the first message: what it is for, and a few asks the
 *  open apps suggest (the page publishes them: lib/apps-page-ui). */
export function DockEmpty({ count, onPick }: { count: number; onPick: (prompt: string) => void }) {
  const suggestions = useAppsUi((s) => s.suggestions)
  return (
    <div className="apg-dockempty" data-dock-empty="">
      <p className="apg-dockempty__lead">
        {count === 0
          ? 'Add an app to the page and it joins this chat.'
          : 'Ask about anything on the page, or say what should happen. Anything that moves money comes back here as a card your wallet signs.'}
      </p>
      {suggestions.length > 0 && (
        <div className="apg-dockempty__chips">
          {suggestions.map((s) => (
            <button key={s.prompt} type="button" className="apg-btn" onClick={() => onPick(s.prompt)} title={s.prompt}>
              {s.label}
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
