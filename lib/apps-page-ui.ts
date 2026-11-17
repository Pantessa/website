'use client'

// The apps page's own UI memory (squad apps-page, 2026-11-17): whether the
// chat dock is open, and the ask a page button hands to the chat. Kept out
// of lib/store on purpose — that store's persisted shape is versioned and
// pinned, and nothing outside the apps page reads these.

import { create } from 'zustand'
import { persist } from 'zustand/middleware'
import type { SuggestedPrompt } from '@/lib/splash/types'

export interface AppsAsk {
  text: string
  /** true runs it (a button on the page); false only fills the composer. */
  send: boolean
  at: number
  /** App slugs the ask needs on (they ride the send, like a chip's). */
  mcps?: string[]
}

interface AppsUi {
  /** The dock beside the page. Closed = one pinned ask bar under the page. */
  chatOpen: boolean
  setChatOpen: (open: boolean) => void
  /** The latest ask handed to the chat (ChatWorkspace feeds it to
   *  ChatInterface's injectedPrompt). Session-only. */
  ask: AppsAsk | null
  /** Hand an ask to the chat. Opens the dock: the answer lands there. */
  sendAsk: (text: string, opts?: { send?: boolean; mcps?: string[] }) => void
  /** Asks the open apps suggest, for the dock's empty state. The page
   *  publishes them from its tiles; the dock only reads. Session-only. */
  suggestions: SuggestedPrompt[]
  setSuggestions: (next: SuggestedPrompt[]) => void
}

export const useAppsUi = create<AppsUi>()(
  persist(
    (set) => ({
      chatOpen: true,
      setChatOpen: (open) => set({ chatOpen: open }),
      ask: null,
      sendAsk: (text, opts) => {
        const t = text.trim()
        if (!t) return
        set({ chatOpen: true, ask: { text: t, send: opts?.send !== false, at: Date.now(), mcps: opts?.mcps } })
      },
      suggestions: [],
      setSuggestions: (next) =>
        set((s) => (s.suggestions.length === next.length && s.suggestions.every((p, i) => p.prompt === next[i].prompt) ? s : { suggestions: next })),
    }),
    { name: 'pantessa.apps.ui.v1', partialize: (s) => ({ chatOpen: s.chatOpen }) },
  ),
)
