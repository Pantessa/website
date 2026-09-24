'use client'

// ONE phone screen (squad mobile-native, 2026-09-24): a destination given the
// whole /chat main area below lg — a header naming the place, then the
// screen's ONE scroller. It lies OVER the conversation (absolute, opaque)
// rather than replacing it, so the conversation keeps its state, its
// in-flight turn and its scroll position while you visit APPS or JOBS; the
// conversation underneath is made inert by ChatWorkspace.
//
// The scroller carries `data-app-scroll` (lib/phone-shell SCROLL_ATTR): the
// frame's CSS makes it the thing that scrolls, and lib/app-scroller finds it
// — the screens mount BEFORE ChatInterface in DOM order, so while one shows
// it is the first scroller on the page and "tap the lit seat → top" lands
// here. In the conversation the thread carries the attribute instead.
//
// z-index: above the guest banner (40) and below the tab bar (50), the
// modals (70) and the sheets (90).

import type { ReactNode } from 'react'
import type { PhoneScreen as PhoneScreenName } from '@/lib/store'

export default function PhoneScreen({
  name,
  title,
  action,
  children,
}: {
  name: Exclude<PhoneScreenName, 'chat'>
  title: string
  /** A labeled control on the header's right (the LINKS screen's list door). */
  action?: ReactNode
  children: ReactNode
}) {
  return (
    <section data-phone-screen={name} aria-label={title} className="absolute inset-0 z-[45] flex flex-col bg-[var(--bg)]">
      <header className="flex-shrink-0 flex items-center gap-2 pl-4 pr-2 min-h-12 border-b border-[var(--line)]">
        <h1 className="flex-1 min-w-0 mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] truncate">{title}</h1>
        {action}
      </header>
      <div data-app-scroll="" className="flex-1 min-h-0 overflow-y-auto overscroll-y-contain flex flex-col [-webkit-overflow-scrolling:touch]">
        {children}
      </div>
    </section>
  )
}
