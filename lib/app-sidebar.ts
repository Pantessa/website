'use client'

// Shared collapse state for the logged-in app shell's left rail (dashboard +
// docs). ChatGPT-style: one persisted boolean drives whether the rail is shown
// or tucked away behind a floating reopen toggle. Chat keeps its own sidebar
// state (its rail is the conversation list, toggled from the chat toolbar).

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

interface AppSidebarState {
  collapsed: boolean
  setCollapsed: (collapsed: boolean) => void
  toggle: () => void
}

export const useAppSidebar = create<AppSidebarState>()(
  persist(
    (set) => ({
      collapsed: false,
      setCollapsed: (collapsed) => set({ collapsed }),
      toggle: () => set((s) => ({ collapsed: !s.collapsed })),
    }),
    { name: 'yf-app-sidebar' },
  ),
)
