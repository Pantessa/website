'use client'

// The working set, as the apps page edits it. Same writes as the drawer's
// rows (components/AppsRailTab): the set, the open chat's copy, and the
// "hand-picked" mark that makes an app earn a section with no activity.

import { useMemo } from 'react'
import { useYeetfulStore, type McpServer } from '@/lib/store'

export function useAppSet() {
  const { servers, activeServerIds, setActiveServerIds, updateChatServers, markManualMcp, currentChatId } = useYeetfulStore()
  const active = useMemo(
    () => activeServerIds.map((id) => servers.find((s) => s.id === id)).filter((s): s is McpServer => s !== undefined),
    [servers, activeServerIds],
  )
  const persist = (next: string[]) => {
    setActiveServerIds(next)
    if (currentChatId) updateChatServers(currentChatId, next)
  }
  const isOn = (server: McpServer) => activeServerIds.includes(server.id)
  const toggle = (server: McpServer) => {
    const on = !isOn(server)
    markManualMcp(server.slug, on)
    persist(on ? [...activeServerIds, server.id] : activeServerIds.filter((id) => id !== server.id))
  }
  return { servers, active, isOn, toggle }
}
