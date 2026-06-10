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
  /** Per-turn metadata persisted to the DB — e.g. { receipts: [...] } (x402 payments). */
  meta?: unknown
  createdAt: string
}

export interface Chat {
  id: string
  title: string
  activeServerIds: string[]
  messages: Message[]
  createdAt: string
  updatedAt?: string
  // Sharing (DB-backed; undefined for ephemeral guest chats).
  isPublic?: boolean
  publicSlug?: string | null
  // True once this chat's messages have been fetched from the DB.
  messagesLoaded?: boolean
}

// Shape returned by the chat API routes.
interface ApiChat {
  id: string
  title: string
  activeServerIds?: string[]
  isPublic?: boolean
  publicSlug?: string | null
  createdAt?: string
  updatedAt?: string
  messages?: { id: string; role: string; content: string; meta?: unknown; createdAt: string }[]
}

function fromApiChat(c: ApiChat, existing?: Chat): Chat {
  return {
    id: c.id,
    title: c.title,
    activeServerIds: c.activeServerIds ?? existing?.activeServerIds ?? [],
    messages: c.messages
      ? c.messages.map((m) => ({
          id: m.id,
          role: m.role as Message['role'],
          content: m.content,
          meta: m.meta ?? undefined,
          createdAt: m.createdAt,
        }))
      : existing?.messages ?? [],
    createdAt: c.createdAt ?? existing?.createdAt ?? new Date().toISOString(),
    updatedAt: c.updatedAt,
    isPublic: c.isPublic ?? existing?.isPublic,
    publicSlug: c.publicSlug ?? existing?.publicSlug ?? null,
    messagesLoaded: c.messages ? true : existing?.messagesLoaded ?? false,
  }
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
  setActiveServerIds: (ids: string[]) => void
  clearActiveServers: () => void

  // Session — set by SessionProvider so store actions know whether to hit the DB.
  authedAddress: string | null
  setAuthedAddress: (address: string | null) => void

  // Chats
  chats: Chat[]
  currentChatId: string | null
  chatsLoading: boolean
  setCurrentChatId: (id: string | null) => void
  createChat: (title?: string) => Promise<string>
  addMessage: (chatId: string, message: Omit<Message, 'id' | 'createdAt'>) => void
  updateChatServers: (chatId: string, serverIds: string[]) => void
  deleteChat: (id: string) => void
  // DB sync
  loadChats: () => Promise<void>
  loadChat: (id: string) => Promise<Chat | null>
  resetChats: () => void
  setChatPublic: (chatId: string, isPublic: boolean) => Promise<Chat | null>

  // UI state
  sidebarOpen: boolean
  setSidebarOpen: (open: boolean) => void
}

const localId = () => Math.random().toString(36).slice(2)

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
      setActiveServerIds: (ids) => set({ activeServerIds: ids }),
      clearActiveServers: () => set({ activeServerIds: [] }),

      authedAddress: null,
      setAuthedAddress: (address) => set({ authedAddress: address }),

      chats: [],
      currentChatId: null,
      chatsLoading: false,
      setCurrentChatId: (id) => set({ currentChatId: id }),

      createChat: async (title = 'New chat') => {
        const activeServerIds = get().activeServerIds
        // Signed in → create in the DB and use the real cuid.
        if (get().authedAddress) {
          try {
            const res = await fetch('/api/chats', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ title, activeServerIds }),
            })
            if (res.ok) {
              const chat = fromApiChat(await res.json())
              chat.messagesLoaded = true // brand-new chat has no messages to load
              set((s) => ({ chats: [chat, ...s.chats], currentChatId: chat.id }))
              return chat.id
            }
          } catch {
            // fall through to a local chat if the network hiccups
          }
        }
        // Guest (or DB write failed) → ephemeral local chat.
        const id = localId()
        const chat: Chat = {
          id,
          title,
          activeServerIds,
          messages: [],
          createdAt: new Date().toISOString(),
          messagesLoaded: true,
        }
        set((s) => ({ chats: [chat, ...s.chats], currentChatId: id }))
        return id
      },

      addMessage: (chatId, message) => {
        const msg: Message = {
          ...message,
          id: localId(),
          createdAt: new Date().toISOString(),
        }
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? { ...c, messages: [...c.messages, msg], updatedAt: msg.createdAt }
              : c
          ),
        }))
        // Persist to the DB in the background (owner-only; system msgs aren't stored).
        if (get().authedAddress && (message.role === 'user' || message.role === 'assistant')) {
          void fetch(`/api/chats/${chatId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: message.role,
              content: message.content,
              meta: message.meta,
            }),
          }).catch(() => {})
        }
      },

      updateChatServers: (chatId, serverIds) => {
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId ? { ...c, activeServerIds: serverIds } : c
          ),
        }))
        if (get().authedAddress) {
          void fetch(`/api/chats/${chatId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ activeServerIds: serverIds }),
          }).catch(() => {})
        }
      },

      deleteChat: (id) => {
        set((s) => ({
          chats: s.chats.filter((c) => c.id !== id),
          currentChatId: s.currentChatId === id ? null : s.currentChatId,
        }))
        if (get().authedAddress) {
          void fetch(`/api/chats/${id}`, { method: 'DELETE' }).catch(() => {})
        }
      },

      loadChats: async () => {
        if (!get().authedAddress) return
        set({ chatsLoading: true })
        try {
          const res = await fetch('/api/chats', { cache: 'no-store' })
          if (!res.ok) throw new Error('failed')
          const rows: ApiChat[] = await res.json()
          set((s) => {
            const byId = new Map(s.chats.map((c) => [c.id, c]))
            return {
              chats: rows.map((r) => fromApiChat(r, byId.get(r.id))),
              chatsLoading: false,
            }
          })
        } catch {
          set({ chatsLoading: false })
        }
      },

      loadChat: async (id) => {
        // Local (guest) chats are already complete in memory.
        const existing = get().chats.find((c) => c.id === id)
        if (!get().authedAddress) return existing ?? null
        try {
          const res = await fetch(`/api/chats/${id}`, { cache: 'no-store' })
          if (!res.ok) return existing ?? null
          const chat = fromApiChat(await res.json(), existing)
          set((s) => ({
            chats: s.chats.some((c) => c.id === id)
              ? s.chats.map((c) => (c.id === id ? chat : c))
              : [chat, ...s.chats],
          }))
          return chat
        } catch {
          return existing ?? null
        }
      },

      resetChats: () => set({ chats: [], currentChatId: null }),

      setChatPublic: async (chatId, isPublic) => {
        if (!get().authedAddress) return null
        try {
          const res = await fetch(`/api/chats/${chatId}`, {
            method: 'PATCH',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ isPublic }),
          })
          if (!res.ok) return null
          const updated = fromApiChat(await res.json(), get().chats.find((c) => c.id === chatId))
          set((s) => ({ chats: s.chats.map((c) => (c.id === chatId ? updated : c)) }))
          return updated
        } catch {
          return null
        }
      },

      sidebarOpen: true,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
    }),
    {
      name: 'yeetful-store',
      // Persist only UI prefs. Chats are DB-backed (signed in) or ephemeral
      // (guest) — never written to localStorage, so one wallet's chats can't
      // leak into another account or survive a sign-out.
      partialize: (state) => ({
        activeServerIds: state.activeServerIds,
        sidebarOpen: state.sidebarOpen,
      }),
    }
  )
)
