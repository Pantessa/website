'use client'

// The embeddable chat surface (/embed) — the full Yeetful chat (receipts,
// guardrails, sign/order/tx buttons) rendered chrome-less inside a
// cross-origin iframe, scoped to a caller-selected MCP set. Guests chat
// immediately (burner mode); signing still requires an in-iframe wallet
// connection (RainbowKit is provided by the root layout's Providers).
//
// ── Embed contract v1 (mirrored by the `yeetful/embed` SDK module) ─────────
//   {origin}/embed?mcps=<comma slugs>&address=<0x…>&theme=<dark|light>&host=<parent origin>
//   All postMessage payloads: { source:'yeetful-embed', v:1, type, ... }
//   child→parent: 'ready' (once mounted) · 'resize' {height} · 'event' {name,data?}
//   parent→child: 'address' {address:string|null} · 'theme' {theme}
//   Messages are only accepted from / posted to the decoded `host` origin.
//   With no host param we don't listen, and post only 'ready'/'resize' to '*'
//   (nothing sensitive in those).
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useState } from 'react'
import ChatInterface from '@/components/ChatInterface'
import BrandIcon from '@/components/BrandIcon'
import { YeetfulMark } from '@/components/Logo'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'

const SOURCE = 'yeetful-embed'
const V = 1
/** Contract cap: at most 4 caller-selected MCPs. */
const MAX_MCPS = 4

const isHexAddress = (s: unknown): s is `0x${string}` =>
  typeof s === 'string' && /^0x[0-9a-fA-F]{40}$/.test(s)

const shortAddr = (a: string) => `${a.slice(0, 4)}…${a.slice(-2)}`

export default function EmbedChat({
  mcps,
  address,
  theme: themeParam,
  host,
}: {
  mcps: string[]
  address?: string
  theme?: string
  host?: string
}) {
  const { setServers, setActiveServerIds, setCurrentChatId } = useYeetfulStore()
  const [resolved, setResolved] = useState<McpServer[]>([])
  const [theme, setTheme] = useState<'dark' | 'light'>(themeParam === 'light' ? 'light' : 'dark')
  // undefined = no 'address' message received yet (param applies);
  // null = parent explicitly cleared the context (fall back to the connected wallet).
  const [msgAddress, setMsgAddress] = useState<`0x${string}` | null | undefined>(undefined)

  const paramAddress = isHexAddress(address) ? address : undefined
  const contextAddress = msgAddress === undefined ? paramAddress : msgAddress ?? undefined

  // The one origin we exchange messages with. No (or malformed) host → null.
  const hostOrigin = useMemo(() => {
    if (!host) return null
    try {
      return new URL(host).origin
    } catch {
      return null
    }
  }, [host])

  const post = useMemo(
    () =>
      (msg: Record<string, unknown>, allowStar = false) => {
        if (window.parent === window) return
        const target = hostOrigin ?? (allowStar ? '*' : null)
        if (!target) return
        window.parent.postMessage({ source: SOURCE, v: V, ...msg }, target)
      },
    [hostOrigin],
  )

  // Directory scope: fetch the catalog, resolve the caller's slugs (unknown
  // dropped, capped), and pin them as the active set. None resolve → empty
  // active set, exactly what a fresh guest /chat starts with (house model +
  // native tx tools still work).
  const mcpsKey = mcps.join(',')
  useEffect(() => {
    let cancelled = false
    const wire = (catalog: McpServer[]) => {
      if (cancelled) return
      setServers(catalog)
      const bySlug = new Map(catalog.map((s) => [s.slug, s]))
      const picked = [...new Set(mcpsKey.split(',').filter(Boolean))]
        .map((slug) => bySlug.get(slug))
        .filter((s): s is McpServer => !!s)
        .slice(0, MAX_MCPS)
      setResolved(picked)
      setActiveServerIds(picked.map((s) => s.id))
    }
    fetch('/api/servers')
      .then((r) => r.json())
      .then((data: McpServer[]) => wire(data.length > 0 ? data : (CATALOG as unknown as McpServer[])))
      .catch(() => wire(CATALOG as unknown as McpServer[]))
    return () => {
      cancelled = true
    }
  }, [mcpsKey, setServers, setActiveServerIds])

  // Every embed mount is a fresh (ephemeral, guest) chat.
  useEffect(() => setCurrentChatId(null), [setCurrentChatId])

  // child→parent: 'ready' once mounted, 'resize' as the document grows/shrinks.
  useEffect(() => {
    post({ type: 'ready' }, true)
    let lastHeight = 0
    const measure = () => {
      const height = Math.ceil(document.documentElement.scrollHeight)
      if (height !== lastHeight) {
        lastHeight = height
        post({ type: 'resize', height }, true)
      }
    }
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(document.body)
    return () => ro.disconnect()
  }, [post])

  // parent→child: only when a host origin is pinned — otherwise stay deaf.
  useEffect(() => {
    if (!hostOrigin) return
    const onMessage = (e: MessageEvent) => {
      if (e.origin !== hostOrigin) return
      const d = e.data as { source?: unknown; v?: unknown; type?: unknown; address?: unknown; theme?: unknown } | null
      if (!d || d.source !== SOURCE || d.v !== V) return
      if (d.type === 'address') setMsgAddress(isHexAddress(d.address) ? d.address : null)
      else if (d.type === 'theme' && (d.theme === 'dark' || d.theme === 'light')) setTheme(d.theme)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [hostOrigin])

  // Notable moments (e.g. 'order-signed') → host page. Host-scoped only —
  // post() drops it when no host origin is pinned.
  const emitEvent = (name: string, data?: Record<string, unknown>) =>
    post({ type: 'event', name, ...(data ? { data } : {}) })

  return (
    <div className="embed-root flex flex-col h-dvh" data-theme={theme} style={{ background: 'var(--bg)', color: 'var(--fg)' }}>
      {/* Slim header: wordmark + the resolved MCP scope + the address context */}
      <header className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-[var(--line)] bg-[var(--surf-1)] overflow-x-auto scrollbar-none">
        <a
          href="/chat"
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 inline-flex items-center gap-1.5 no-underline"
          title="Open the full Yeetful chat"
        >
          <YeetfulMark size={16} />
          <span className="text-[12px] font-semibold text-[color:var(--fg)]" style={{ fontFamily: 'var(--font-display)' }}>
            Yeetful chat
          </span>
        </a>
        {resolved.map((server) => (
          <span
            key={server.id}
            className="flex-shrink-0 inline-flex items-center gap-1.5 px-2 py-0.5 rounded-full border border-[var(--line)] bg-[var(--surf-2)] text-[11px] text-[color:var(--muted)]"
            title={server.description}
          >
            <span className="w-3 h-3 grid place-items-center opacity-90">
              <BrandIcon server={server} size={11} />
            </span>
            <span className="whitespace-nowrap">{server.name}</span>
          </span>
        ))}
        {contextAddress && (
          <span
            className="ml-auto flex-shrink-0 mono text-[11px] text-[color:var(--muted-2)]"
            title={`Wallet context from the host page: ${contextAddress}`}
          >
            context: {shortAddr(contextAddress)}
          </span>
        )}
      </header>
      <main className="flex-1 min-h-0 flex flex-col">
        <ChatInterface embedded contextAddress={contextAddress} onEmbedEvent={emitEvent} />
      </main>
    </div>
  )
}
