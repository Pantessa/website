'use client'

import { useEffect, useState } from 'react'
import AppModeWorkspace from '@/components/AppModeWorkspace'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import { FREE_FLEET_FALLBACK, DEFAULT_CHAT_FLEET_SLUGS } from '@/lib/free-fleet'

/**
 * Client half of /dev-workspace (see the page for the env gate): loads the
 * server directory, seeds the default fleet plus any ?mcps= slugs, and renders
 * the App Mode workspace for the ?as= address. Drives the exact production
 * component — only the wagmi wiring is bypassed.
 */
export default function DevWorkspaceHarness() {
  const { servers, setServers, setActiveServerIds } = useYeetfulStore()
  const [address, setAddress] = useState<string | undefined>()

  useEffect(() => {
    const params = new URLSearchParams(window.location.search)
    setAddress(params.get('as') ?? undefined)
    if (servers.length === 0) {
      fetch('/api/servers')
        .then((r) => r.json())
        .then((data: McpServer[]) =>
          setServers(data.length > 0 ? data : [...FREE_FLEET_FALLBACK, ...CATALOG]),
        )
        .catch(() => setServers([...FREE_FLEET_FALLBACK, ...CATALOG]))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    if (servers.length === 0) return
    const params = new URLSearchParams(window.location.search)
    const slugs = params.get('mcps')?.split(',').map((s) => s.trim()).filter(Boolean)
    const ids = (slugs?.length ? slugs : [...DEFAULT_CHAT_FLEET_SLUGS])
      .map((slug) => servers.find((s) => s.slug === slug)?.id)
      .filter((id): id is string => !!id)
    if (ids.length) setActiveServerIds(ids)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [servers.length])

  return (
    <div className="min-h-dvh overflow-y-auto px-4 py-6" data-harness="dev-workspace">
      <AppModeWorkspace address={address} onPick={(p) => console.log('[dev-workspace] pick:', p)} />
    </div>
  )
}
