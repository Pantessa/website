'use client'

import { useEffect, useRef } from 'react'
import ChatInterface from '@/components/ChatInterface'
import ChatSidebar from '@/components/ChatSidebar'
import ChatSignInGate from '@/components/ChatSignInGate'
import McpRail from '@/components/McpRail'
import RouterEngineWindow from '@/components/RouterEngineWindow'
import { useAppShellMode } from '@/components/AppShell'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import { FREE_FLEET_FALLBACK, DEFAULT_CHAT_FLEET_SLUGS } from '@/lib/free-fleet'

// Free fleet leads the static fallback so the MCP rail's default (free) view
// is never empty when /api/servers is down.
const STATIC_SERVERS: McpServer[] = [...FREE_FLEET_FALLBACK, ...CATALOG]

/**
 * The chat workspace shell (sidebar + interface), shared by /chat and
 * /chat/[id]. When a `chatId` is present we select + lazy-load that chat and
 * restore its active agents; the bare /chat route is a fresh "new chat" surface.
 */
export default function ChatWorkspace({ chatId }: { chatId?: string }) {
  const { servers, setServers, setCurrentChatId, loadChat, setActiveServerIds, activeServerIds } =
    useYeetfulStore()

  // A deep link like /chat?mcps=uniswap-free,snapshot-free preselects a working
  // set so the landing "Try it live" (and any shared combo link) lands the user
  // in chat with those MCP cards already loaded. Comma-separated slugs — same
  // convention as /embed?mcps=. Applied once, only on the bare /chat surface
  // (an existing chat restores its own agents).
  const appliedMcpParam = useRef(false)

  // Load the MCP directory once (DB-backed, static fallback).
  useEffect(() => {
    if (servers.length === 0) {
      fetch('/api/servers')
        .then((r) => r.json())
        .then((data: McpServer[]) => {
          setServers(data.length > 0 ? data : STATIC_SERVERS)
        })
        .catch(() => setServers(STATIC_SERVERS))
    }
  }, [servers.length, setServers])

  // Follow the route: select the chat, load its messages, restore its agents.
  useEffect(() => {
    if (chatId) {
      setCurrentChatId(chatId)
      void loadChat(chatId).then((chat) => {
        if (chat) setActiveServerIds(chat.activeServerIds)
      })
    } else {
      setCurrentChatId(null)
    }
  }, [chatId, setCurrentChatId, loadChat, setActiveServerIds])

  // Apply the ?mcps= working set once the directory has loaded (need slug→id).
  useEffect(() => {
    if (chatId || appliedMcpParam.current || servers.length === 0) return
    const raw = new URLSearchParams(window.location.search).get('mcps')
    if (!raw) return
    const slugs = raw.split(',').map((s) => s.trim()).filter(Boolean)
    const ids = slugs
      .map((slug) => servers.find((s) => s.slug === slug)?.id)
      .filter((id): id is string => !!id)
    if (ids.length) {
      appliedMcpParam.current = true
      setActiveServerIds(ids)
    }
  }, [chatId, servers, setActiveServerIds])

  // Brand-new visitor on the bare /chat surface with an empty working set: seed
  // the default fleet (Uniswap + Snapshot + Hyperliquid) so the connected-wallet
  // splash has MCPs to build dashboards from the moment they land, instead of an
  // empty state. Defers to a ?mcps= deep link (handled above) and never clobbers
  // an existing selection — returning users keep their persisted set. Needs the
  // directory loaded for slug→id.
  useEffect(() => {
    if (chatId || appliedMcpParam.current || servers.length === 0) return
    if (activeServerIds.length > 0) return
    if (new URLSearchParams(window.location.search).get('mcps')) return
    const seed = DEFAULT_CHAT_FLEET_SLUGS
      .map((slug) => servers.find((s) => s.slug === slug)?.id)
      .filter((id): id is string => !!id)
    if (seed.length) setActiveServerIds(seed)
  }, [chatId, servers, activeServerIds.length, setActiveServerIds])

  // Logged in, the top nav is gone (AppShell) — reclaim its 4rem so chat fills
  // the whole viewport.
  const { chrome } = useAppShellMode()

  return (
    <div className={`relative flex ${chrome ? 'h-dvh' : 'h-[calc(100dvh-4rem)]'}`}>
      <div className="relative flex-shrink-0">
        <ChatSidebar />
      </div>
      {/* The MCP rail — chat's primary left column (history stays secondary
          and closed by default). */}
      <div className="relative flex-shrink-0">
        <McpRail />
      </div>
      <main className="flex-1 min-w-0 flex flex-col">
        <ChatInterface />
      </main>
      <RouterEngineWindow />
      <ChatSignInGate />
    </div>
  )
}
