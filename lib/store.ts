'use client'

import { create } from 'zustand'
import { persist } from 'zustand/middleware'

export interface McpServer {
  id: string
  name: string
  slug: string
  description: string
  category: string
  websiteUrl: string | null
  color: string | null

  // x402 fields
  kind?: 'inference' | 'data'
  protocol?: 'mcp' | 'http' | null
  endpoint?: string | null
  tool?: string | null
  queryParam?: string | null
  priceUsd?: string | null
  networks?: string[]
  callable?: boolean

  // presentation / provenance (DB-backed directory)
  iconSlug?: string | null
  source?: string
  featured?: boolean

  // legacy/static-only fields (optional — DB rows don't carry these)
  iconUrl?: string | null
  isDefault?: boolean
  isCustom?: boolean
  configSchema?: Record<string, { type: string; label: string; required: boolean }> | null
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  createdAt: string
}

export interface Chat {
  id: string
  title: string
  activeServerIds: string[]
  messages: Message[]
  createdAt: string
}

interface YeetfulStore {
  // MCP Servers
  servers: McpServer[]
  setServers: (servers: McpServer[]) => void
  addServer: (server: McpServer) => void
  removeServer: (id: string) => void

  // Active servers for current chat session
  activeServerIds: string[]
  toggleServer: (id: string) => void
  clearActiveServers: () => void

  // Chats
  chats: Chat[]
  currentChatId: string | null
  setCurrentChatId: (id: string | null) => void
  createChat: (title?: string) => string
  addMessage: (chatId: string, message: Omit<Message, 'id' | 'createdAt'>) => void
  updateChatServers: (chatId: string, serverIds: string[]) => void
  deleteChat: (id: string) => void

  // UI state
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

export const useYeetfulStore = create<YeetfulStore>()(
  persist(
    (set, get) => ({
      servers: [],
      setServers: (servers) => set({ servers }),
      addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
      removeServer: (id) => set((s) => ({ servers: s.servers.filter((sv) => sv.id !== id) })),

      activeServerIds: [],
      toggleServer: (id) =>
        set((s) => ({
          activeServerIds: s.activeServerIds.includes(id)
            ? s.activeServerIds.filter((sid) => sid !== id)
            : [...s.activeServerIds, id],
        })),
      clearActiveServers: () => set({ activeServerIds: [] }),

      chats: [],
      currentChatId: null,
      setCurrentChatId: (id) => set({ currentChatId: id }),
      createChat: (title = 'New Chat') => {
        const id = Math.random().toString(36).slice(2)
        const chat: Chat = {
          id,
          title,
          activeServerIds: get().activeServerIds,
          messages: [],
          createdAt: new Date().toISOString(),
        }
        set((s) => ({ chats: [chat, ...s.chats], currentChatId: id }))
        return id
      },
      addMessage: (chatId, message) => {
        const msg: Message = {
          ...message,
          id: Math.random().toString(36).slice(2),
          createdAt: new Date().toISOString(),
        }
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId ? { ...c, messages: [...c.messages, msg] } : c
          ),
        }))
      },
      updateChatServers: (chatId, serverIds) =>
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId ? { ...c, activeServerIds: serverIds } : c
          ),
        })),
      deleteChat: (id) =>
        set((s) => ({
          chats: s.chats.filter((c) => c.id !== id),
          currentChatId: s.currentChatId === id ? null : s.currentChatId,
        })),

      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'yeetful-store',
      partialize: (state) => ({
        activeServerIds: state.activeServerIds,
        chats: state.chats,
        currentChatId: state.currentChatId,
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
)
