'use client'

import { useEffect } from 'react'
import ChatInterface from '@/components/ChatInterface'
import ChatSidebar from '@/components/ChatSidebar'
import ChatSignInGate from '@/components/ChatSignInGate'
import McpRail from '@/components/McpRail'
import RouterEngineWindow from '@/components/RouterEngineWindow'
import { useAppShellMode } from '@/components/AppShell'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import { FREE_FLEET_FALLBACK } from '@/lib/free-fleet'

// Free fleet leads the static fallback so the MCP rail's default (free) view
// is never empty when /api/servers is down.
const STATIC_SERVERS: McpServer[] = [...FREE_FLEET_FALLBACK, ...CATALOG]

/**
 * The chat workspace shell (sidebar + interface), shared by /chat and
 * /chat/[id]. When a `chatId` is present we select + lazy-load that chat and
 * restore its active agents; the bare /chat route is a fresh "new chat" surface.
 */
export default function ChatWorkspace({ chatId }: { chatId?: string }) {
  const { servers, setServers, setCurrentChatId, loadChat, setActiveServerIds } =
    useYeetfulStore()

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
