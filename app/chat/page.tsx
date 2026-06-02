'use client'

import { useEffect } from 'react'
import ChatInterface from '@/components/ChatInterface'
import ChatSidebar from '@/components/ChatSidebar'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'

const STATIC_SERVERS: McpServer[] = CATALOG

export default function ChatPage() {
  const { servers, setServers } = useYeetfulStore()

  useEffect(() => {
    if (servers.length === 0) {
      fetch('/api/servers')
        .then((r) => r.json())
        .then((data: McpServer[]) => {
          if (data.length > 0) setServers(data)
          else setServers(STATIC_SERVERS)
        })
        .catch(() => setServers(STATIC_SERVERS))
    }
  }, [servers.length, setServers])

  return (
    <div className="h-[calc(100vh-4rem)] flex">
      {/* Sidebar */}
      <div className="relative flex-shrink-0">
        <ChatSidebar />
      </div>

      {/* Main chat */}
      <main className="flex-1 min-w-0 flex flex-col">
        <ChatInterface />
      </main>
    </div>
  )
}
