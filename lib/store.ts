'use client'

import { analytics } from '@/lib/analytics'
import { create } from 'zustand'
import { persist } from 'zustand/middleware'
// Type-only the other way (free-fleet imports `type McpServer` from here), so
// this runtime import is not circular.
import { DEFAULT_CHAT_FLEET_SLUGS } from '@/lib/free-fleet'

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
  toolArgs?: Record<string, unknown> | null // structured args for an MCP data tool
  priceUsd?: string | null
  networks?: string[]
  callable?: boolean
  /** false = FREE (non-x402) MCP — no payment gate, rate-limited. Default true (x402-gated). */
  gated?: boolean
  /** Auto-callable via the endpoint planner (has ≥1 plannable endpoint), even
   *  without being hand-wired. Derived in /api/servers. */
  autoCallable?: boolean
  /** Has ≥1 featured ("ping first") endpoint, so the generic connect-time
   *  quick view can paint for it even without a hand-coded splash source.
   *  Derived in lib/catalog; splashCapable() reads it. */
  splashReady?: boolean
  /** Usage-driven reputation from the spend ledger (B18) — settle rate +
   *  settled count. Attached in /api/servers; absent when there's no history. */
  reputation?: { settled: number; failed: number; settleRate: number }

  // presentation / provenance (DB-backed directory)
  iconSlug?: string | null
  /** Real image logo (https:// URL or data: URI). Wins over iconSlug/lettermark
   *  in BrandIcon. Auto-pulled from the MCP's serverInfo.icons or site favicon
   *  at add time; owner-overridable. Falls back to legacy `iconUrl` below. */
  logoUrl?: string | null
  source?: string
  featured?: boolean
  /** Example user asks (seeded per MCP) — the action window's fallback chips. */
  exampleQueries?: string[]

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
  /** DB row id once persisted — equals `id` for messages loaded from the DB;
   *  optimistic messages gain it when the background save resolves. Needed to
   *  write back post-persist facts (signed tx hashes) onto the right row. */
  dbId?: string
}

/** One wallet-signed, chain-confirmed transaction recorded onto the message
 *  that offered it — the durable signing log the /p share page renders. */
export interface SignedTxRecord {
  hash: string
  chainId: number
  title?: string
  at?: string
}

/** One step of the Auto-Router's live reasoning trace (the engine window's
 *  content). Mirrors the SSE wire contract from /api/chat (see lib/router
 *  TraceStep + the streamed pay/receipt events). */
export type RouterTraceEvent =
  | { type: 'status'; label: string }
  | { type: 'analyze'; intent: string; needs: string[] }
  | { type: 'shortlist'; candidates: { service: string; endpoint?: string; priceUsd?: string }[] }
  | { type: 'candidate'; service: string; endpoint?: string; priceUsd?: string; score: number; reason: string; proven?: number; successRate?: number }
  | { type: 'select'; service: string; endpoint?: string; priceUsd?: string; reason: string }
  | { type: 'pay'; service: string; host: string; priceUsd: string }
  | { type: 'receipt'; receipt: { name: string; endpoint?: string; priceUsd?: string; txHash?: string; ok: boolean; note?: string } }
  | { type: 'tool'; name: string; status: 'run' | 'ok' | 'error'; detail?: string }
  | { type: 'eip712'; scheme: string; signer: string; summary: string }
  | { type: 'note'; level: 'info' | 'warn'; label: string }
  | { type: 'error'; message: string }

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
          dbId: m.id,
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

  // The chain picker's selection — null = all supported chains (default).
  // Scopes the splash cards and makes the chain first-class for tx builds.
  selectedChainId: number | null
  setSelectedChainId: (id: number | null) => void

  // Chat ↔ App: 'app' renders the working set as a structured workspace
  // (portfolio / swap / governance / earn panels) with chat docked as the
  // command bar; 'chat' is the classic transcript. Persisted — the mode is a
  // workspace preference, not per-conversation state.
  workspaceMode: 'chat' | 'app'
  setWorkspaceMode: (mode: 'chat' | 'app') => void

  // Slugs the user EXPLICITLY toggled on (rail click / add-MCP modal) — as
  // opposed to the seeded default fleet. The splash shows these MCPs' cards
  // even when the wallet has no activity on them (a hand-picked MCP earns its
  // card by being picked; the affinity gate applies only to the auto scan).
  // Persisted, so the choice survives reloads alongside the working set.
  manualSlugs: string[]
  /** Record a deliberate working-set choice: `on` adds the slug, off removes. */
  markManualMcp: (slug: string, on: boolean) => void

  // Per-wallet working-set cache: last active set for each connected address,
  // so reconnecting restores the previous session's MCPs (ChatWorkspace
  // restores on connect, writes through on change). Persisted locally; for
  // signed-in users saveWalletSet ALSO mirrors it to the DB (/api/working-set)
  // so the set follows the wallet across devices. Guests stay local-only.
  walletSets: Record<string, string[]>
  saveWalletSet: (address: string, ids: string[]) => void
  /** Authed address whose DB working-set copy has been read this session.
   *  Gates the DB write-through: never write before reading, or a stale
   *  local cache would clobber the copy another device just saved. Session
   *  state — deliberately not persisted. */
  walletSetDbFor: string | null
  /** Pull the signed-in wallet's working set from the DB. Resolves to the ids
   *  to apply (non-empty), or null (guest / fetch failed / empty row — nothing
   *  to apply). On success it unlocks the DB write-through; an empty DB row is
   *  seeded from the local cache so existing same-browser sets start syncing. */
  loadWalletSet: () => Promise<string[] | null>

  // Saved MCP shortlist — the wallet's curated 1–3 services (the "pick your
  // tools" default). Persisted per-wallet in the DB (signed in) and locally
  // (guest). Seeds a new chat's active set. See lib/shortlist.ts + /api/shortlist.
  shortlistIds: string[]
  /** Add/remove one service from the shortlist (capped at MAX_SHORTLIST);
   *  no-op past the cap. Persists. Returns true if the set changed. */
  toggleShortlist: (id: string) => boolean
  setShortlist: (ids: string[]) => void
  loadShortlist: () => Promise<void>

  // Auto-Router — when on, the engine picks services per message (no manual
  // selection) and streams its reasoning. Persisted; trace buffer is ephemeral.
  autoRouter: boolean
  setAutoRouter: (on: boolean) => void
  routerTrace: RouterTraceEvent[]
  pushRouterTrace: (event: RouterTraceEvent) => void
  /** Replace the whole trace (manual-mode polling re-reads the turn). */
  setRouterTrace: (events: RouterTraceEvent[]) => void
  clearRouterTrace: () => void
  /** Engine-window visibility (the live routing terminal). Persisted. */
  engineWindowOpen: boolean
  setEngineWindowOpen: (open: boolean) => void

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
  /** Record wallet-signed, chain-confirmed txs onto the message that offered
   *  them — locally for the live UI, and onto the DB row (meta.signed) so the
   *  /p share page can show the signing log with explorer links. */
  recordSignedTxs: (chatId: string, messageId: string, txs: SignedTxRecord[]) => void
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
  /** Phone-overlay visibility — intentionally NOT persisted, so a phone
   *  visit can never collapse the desktop sidebar preference. */
  mobileSidebarOpen: boolean
  setMobileSidebarOpen: (open: boolean) => void
  /** The vertical MCP rail (chat's left tool column) — desktop preference. */
  mcpRailOpen: boolean
  setMcpRailOpen: (open: boolean) => void
  /** Phone-overlay visibility for the MCP rail — transient, not persisted. */
  mobileMcpRailOpen: boolean
  setMobileMcpRailOpen: (open: boolean) => void
}

const localId = () => Math.random().toString(36).slice(2)

// Kept in sync with lib/shortlist.ts MAX_SHORTLIST (can't import it here — that
// module pulls in Prisma and would bundle into the client).
const MAX_SHORTLIST = 3

// Write the shortlist through to the DB when signed in (fire-and-forget; guest
// shortlists live only in the persisted local store).
function persistShortlist(get: () => YeetfulStore, ids: string[]) {
  if (!get().authedAddress) return
  void fetch('/api/shortlist', {
    method: 'PUT',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ serviceIds: ids }),
  }).catch(() => {})
}

export const useYeetfulStore = create<YeetfulStore>()(
  persist(
    (set, get) => ({
      servers: [],
      setServers: (servers) => set({ servers }),
      addServer: (server) => set((s) => ({ servers: [...s.servers, server] })),
      removeServer: (id) => set((s) => ({ servers: s.servers.filter((sv) => sv.id !== id) })),

      activeServerIds: [],
      toggleServer: (id) => {
        const st = get()
        const nowActive = !st.activeServerIds.includes(id)
        const slug = st.servers.find((sv) => sv.id === id)?.slug ?? id
        analytics.agentToggled(slug, nowActive)
        // Mirror the toggle into the DB for the admin adoption view (fire-and-
        // forget; a telemetry failure must never block the toggle).
        void fetch('/api/agents/toggle', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ slug, active: nowActive }),
        }).catch(() => {})
        set((s) => ({
          activeServerIds: s.activeServerIds.includes(id)
            ? s.activeServerIds.filter((sid) => sid !== id)
            : [...s.activeServerIds, id],
        }))
      },
      setActiveServerIds: (ids) => set({ activeServerIds: ids }),
      clearActiveServers: () => set({ activeServerIds: [] }),

      selectedChainId: null,
      setSelectedChainId: (id) => set({ selectedChainId: id }),

      workspaceMode: 'chat',
      setWorkspaceMode: (mode) => set({ workspaceMode: mode }),

      manualSlugs: [],
      markManualMcp: (slug, on) =>
        set((s) => ({
          manualSlugs: on
            ? s.manualSlugs.includes(slug)
              ? s.manualSlugs
              : [...s.manualSlugs, slug]
            : s.manualSlugs.filter((x) => x !== slug),
        })),

      walletSets: {},
      saveWalletSet: (address, ids) => {
        const key = address.toLowerCase()
        const cur = get().walletSets[key]
        if (cur && cur.length === ids.length && cur.every((id, i) => id === ids[i])) return
        // Keep the map bounded — drop the oldest entries past 8 wallets.
        const entries = Object.entries(get().walletSets).filter(([k]) => k !== key)
        while (entries.length >= 8) entries.shift()
        set({ walletSets: Object.fromEntries([...entries, [key, ids]]) })
        // Signed in as this wallet AND the DB copy has been read this session
        // → write through (fire-and-forget) so the set follows the wallet
        // across devices. The walletSetDbFor gate is the store-level twin of
        // ChatWorkspace's restoredFor ref: a save that ran before the DB
        // restore would clobber the copy another device just wrote.
        const st = get()
        if (st.authedAddress?.toLowerCase() === key && st.walletSetDbFor === key) {
          void fetch('/api/working-set', {
            method: 'PUT',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ serviceIds: ids }),
          }).catch(() => {})
        }
      },
      walletSetDbFor: null,
      loadWalletSet: async () => {
        const authed = get().authedAddress?.toLowerCase()
        if (!authed) return null
        try {
          const res = await fetch('/api/working-set', { cache: 'no-store' })
          // Failed read → keep the write-through locked; never risk clobbering
          // the DB copy on the strength of a fetch we couldn't complete.
          if (!res.ok) return null
          const data = await res.json()
          const ids: string[] = Array.isArray(data.serviceIds)
            ? data.serviceIds.filter((x: unknown): x is string => typeof x === 'string')
            : []
          if (ids.length) {
            // Mirror the DB copy into the local cache BEFORE unlocking the
            // write-through, so the no-change check above swallows the echo.
            get().saveWalletSet(authed, ids)
            set({ walletSetDbFor: authed })
            return ids
          }
          // Empty/absent DB row: unlock, then seed it from the local
          // same-browser cache so an existing set starts following the wallet
          // without waiting for the user's next change.
          set({ walletSetDbFor: authed })
          const local = get().walletSets[authed]
          if (local?.length) {
            void fetch('/api/working-set', {
              method: 'PUT',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ serviceIds: local }),
            }).catch(() => {})
          }
          return null
        } catch {
          return null
        }
      },

      shortlistIds: [],
      toggleShortlist: (id) => {
        const cur = get().shortlistIds
        const has = cur.includes(id)
        if (!has && cur.length >= MAX_SHORTLIST) return false // at cap — reject add
        const next = has ? cur.filter((x) => x !== id) : [...cur, id]
        set({ shortlistIds: next })
        persistShortlist(get, next)
        return true
      },
      setShortlist: (ids) => {
        const next = ids.slice(0, MAX_SHORTLIST)
        set({ shortlistIds: next })
        persistShortlist(get, next)
      },
      loadShortlist: async () => {
        if (!get().authedAddress) return
        try {
          const res = await fetch('/api/shortlist', { cache: 'no-store' })
          if (!res.ok) return
          const data = await res.json()
          if (Array.isArray(data.serviceIds)) set({ shortlistIds: data.serviceIds })
        } catch {
          // keep whatever's in memory
        }
      },

      // Auto Router is DISABLED for now (feature hidden in the UI, code kept for
      // later — see ChatInterface). Force-off by default; the v2 migration below
      // also flips anyone who had it persisted on, so it behaves as if the
      // feature never existed. Flip back to `true` + restore the toggle to revive.
      autoRouter: false,
      setAutoRouter: (on) => set({ autoRouter: on }),
      routerTrace: [],
      pushRouterTrace: (event) => set((s) => ({ routerTrace: [...s.routerTrace, event] })),
      setRouterTrace: (events) => set({ routerTrace: events }),
      clearRouterTrace: () => set({ routerTrace: [] }),
      engineWindowOpen: false,
      setEngineWindowOpen: (open) => set({ engineWindowOpen: open }),

      authedAddress: null,
      setAuthedAddress: (address) => set({ authedAddress: address }),

      chats: [],
      currentChatId: null,
      chatsLoading: false,
      setCurrentChatId: (id) => set({ currentChatId: id }),

      createChat: async (title = 'New chat') => {
        // A new chat starts from the current working set, or — if none is
        // selected — the saved shortlist (the "pick your tools" default), or
        // finally the FREE first-party fleet: a brand-new user gets a working
        // set that actually works, not whole-catalog roulette.
        const { activeServerIds: cur, shortlistIds, servers } = get()
        const fleetIds = DEFAULT_CHAT_FLEET_SLUGS
          .map((slug) => servers.find((s) => s.slug === slug)?.id)
          .filter((id): id is string => !!id)
        const activeServerIds = cur.length ? cur : shortlistIds.length ? shortlistIds : fleetIds
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
        // Persist to the DB in the background (owner-only; system msgs aren't
        // stored). The saved row's id is written back onto the optimistic
        // message as dbId so later facts (signed tx hashes) can target it.
        if (get().authedAddress && (message.role === 'user' || message.role === 'assistant')) {
          void fetch(`/api/chats/${chatId}/messages`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              role: message.role,
              content: message.content,
              meta: message.meta,
            }),
          })
            .then(async (res) => {
              if (!res.ok) return
              const saved = (await res.json()) as { id?: string }
              if (typeof saved.id !== 'string' || !saved.id) return
              set((s) => ({
                chats: s.chats.map((c) =>
                  c.id === chatId
                    ? { ...c, messages: c.messages.map((m) => (m.id === msg.id ? { ...m, dbId: saved.id } : m)) }
                    : c,
                ),
              }))
            })
            .catch(() => {})
        }
      },

      recordSignedTxs: (chatId, messageId, txs) => {
        if (txs.length === 0) return
        const stamped = txs.map((t) => ({ at: new Date().toISOString(), ...t }))
        // Local merge first — the live transcript reflects the signing log
        // immediately, whether or not the DB write below lands.
        set((s) => ({
          chats: s.chats.map((c) =>
            c.id === chatId
              ? {
                  ...c,
                  messages: c.messages.map((m) => {
                    if (m.id !== messageId) return m
                    const prior = (m.meta as { signed?: SignedTxRecord[] } | undefined)?.signed ?? []
                    const merged = [...prior, ...stamped.filter((t) => !prior.some((p) => p.hash === t.hash))]
                    return { ...m, meta: { ...(m.meta as object | undefined), signed: merged } }
                  }),
                }
              : c,
          ),
        }))
        if (!get().authedAddress) return
        // The DB write targets the persisted row id. Confirmation takes long
        // enough that the background save has almost always resolved — but on
        // a fast confirm, retry briefly until dbId lands.
        const post = (attempt: number) => {
          const msg = get()
            .chats.find((c) => c.id === chatId)
            ?.messages.find((m) => m.id === messageId)
          const dbId = msg?.dbId
          if (!dbId) {
            if (attempt < 5) setTimeout(() => post(attempt + 1), 2000)
            return
          }
          void fetch(`/api/chats/${chatId}/messages/${dbId}/signed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ txs: stamped }),
          }).catch(() => {})
        }
        post(0)
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
          if (!res.ok) {
            // Definitive miss on a chat we DO have a list row for (session
            // expired between the list load and this fetch, or the row went
            // away server-side): stamp it settled so the splash hold —
            // `messagesLoaded` — can't spin the loader forever on it.
            if (existing && !existing.messagesLoaded) {
              set((s) => ({
                chats: s.chats.map((c) => (c.id === id ? { ...c, messagesLoaded: true } : c)),
              }))
            }
            return existing ?? null
          }
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

      // Chat history is secondary — closed by default; the MCP rail is the
      // primary left column.
      sidebarOpen: false,
      setSidebarOpen: (open) => set({ sidebarOpen: open }),
      mobileSidebarOpen: false,
      setMobileSidebarOpen: (open) => set({ mobileSidebarOpen: open }),
      mcpRailOpen: true,
      setMcpRailOpen: (open) => set({ mcpRailOpen: open }),
      mobileMcpRailOpen: false,
      setMobileMcpRailOpen: (open) => set({ mobileMcpRailOpen: open }),
    }),
    {
      name: 'yeetful-store',
      // v1: auto routing was on by default. v2: Auto Router is disabled for now
      // (UI hidden, code kept) — force it OFF for EVERY persisted client,
      // including anyone who had it on, so it's as if the feature never existed.
      // v3: chat history rail closed by default — apply the new default once
      // to every persisted client (they can reopen; the choice persists again
      // from there).
      version: 3,
      migrate: (persisted, version) => {
        const s = (persisted ?? {}) as Record<string, unknown>
        if (version < 2) s.autoRouter = false
        if (version < 3) s.sidebarOpen = false
        return s
      },
      // Persist only UI prefs. Chats are DB-backed (signed in) or ephemeral
      // (guest) — never written to localStorage, so one wallet's chats can't
      // leak into another account or survive a sign-out.
      partialize: (state) => ({
        activeServerIds: state.activeServerIds,
        selectedChainId: state.selectedChainId,
        workspaceMode: state.workspaceMode,
        manualSlugs: state.manualSlugs,
        walletSets: state.walletSets,
        shortlistIds: state.shortlistIds,
        sidebarOpen: state.sidebarOpen,
        mcpRailOpen: state.mcpRailOpen,
        autoRouter: state.autoRouter,
        engineWindowOpen: state.engineWindowOpen,
      }),
    }
  )
)
