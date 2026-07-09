'use client'

// The embeddable chat surface (/embed) — the full Yeetful chat (receipts,
// guardrails, sign/order/tx buttons) rendered chrome-less inside a
// cross-origin iframe, scoped to a caller-selected MCP set. Guests chat
// immediately (burner mode). Signing: with an SDK-0.9 host the HOST page's
// wallet is bridged in (see below) — signatures pop the user's own wallet on
// the host page; otherwise an in-iframe wallet connection still works
// (RainbowKit is provided by the root layout's Providers).
//
// ── Embed contract v1 (mirrored by the `yeetful/embed` SDK module) ─────────
//   {origin}/embed?mcps=<comma slugs>&address=<0x…>&theme=<dark|light>&host=<parent origin>
//   All postMessage payloads: { source:'yeetful-embed', v:1, type, ... }
//   child→parent: 'ready' (once mounted) · 'resize' {height} · 'event' {name,data?}
//   parent→child: 'address' {address:string|null} · 'theme' {theme}
//                 · 'prompt' {text, send?} — prefill the input, or (send:true)
//                   submit it as the user's message (host CTAs like cowswap's
//                   "ask about this order")
//   Messages are only accepted from / posted to the decoded `host` origin.
//   With no host param we don't listen, and post only 'ready'/'resize' to '*'
//   (nothing sensitive in those).
//
// ── Wallet bridge (contract v1.1, SDK >= 0.9.0) — lib/host-wallet.ts ───────
//   child→parent: 'rpc' {id, method, params?}
//   parent→child: 'rpc:result' {id, result} · 'rpc:error' {id, error:{code,message}}
//                 · 'wallet' {accounts, chainId} — the host announces its
//                   EIP-1193 provider (empty accounts = available, not connected)
//   The bridge's own listener carries the same origin discipline; the
//   'yeetfulHost' wagmi connector makes the chat REALLY wallet-connected.
//   Auto-connects when the host announces accounts; when the announce is
//   empty we show a "Connect host wallet" affordance instead of prompting.
//   Address-context precedence: bridged account > postMessage 'address' >
//   URL ?address= > in-iframe wagmi connection.
// ────────────────────────────────────────────────────────────────────────────

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import { Maximize2, Minimize2 } from 'lucide-react'
import { useAccount, useConnect } from 'wagmi'
import {
  getHostWalletServerState,
  getHostWalletState,
  HOST_WALLET_CONNECTOR_ID,
  initHostWalletBridge,
  subscribeHostWallet,
} from '@/lib/host-wallet'
import ChatInterface from '@/components/ChatInterface'
import BrandIcon from '@/components/BrandIcon'
import { YeetfulMark } from '@/components/Logo'
import { useYeetfulStore, type McpServer } from '@/lib/store'
import { DEFAULT_CHAT_FLEET_SLUGS } from '@/lib/free-fleet'
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
  embedKey,
  page,
}: {
  mcps: string[]
  address?: string
  theme?: string
  host?: string
  /** Public `yfe_…` embed key (?key=) — attributes this embed + its YEET
   *  credit spend to the owning account's plan. Optional; keyless embeds
   *  run on the visitor's own (free-tier) metering. */
  embedKey?: string
  /** Full parent-page URL, passed by SDK >= 0.10 (?page=). Falls back to
   *  document.referrer, which the host's referrer policy may trim to origin. */
  page?: string
}) {
  const { setServers, setActiveServerIds, setCurrentChatId } = useYeetfulStore()
  const [resolved, setResolved] = useState<McpServer[]>([])
  const [theme, setTheme] = useState<'dark' | 'light'>(themeParam === 'light' ? 'light' : 'dark')
  // undefined = no 'address' message received yet (param applies);
  // null = parent explicitly cleared the context (fall back to the connected wallet).
  const [msgAddress, setMsgAddress] = useState<`0x${string}` | null | undefined>(undefined)
  const [injectedPrompt, setInjectedPrompt] = useState<{ text: string; send: boolean; at: number } | null>(null)
  const [isFull, setIsFull] = useState(false)
  useEffect(() => {
    const onFs = () => setIsFull(!!document.fullscreenElement)
    document.addEventListener('fullscreenchange', onFs)
    return () => document.removeEventListener('fullscreenchange', onFs)
  }, [])
  // One session per mount — groups this visit's turns in the owner's embed
  // telemetry so dead-end conversations are computable.
  const [embedSession] = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`,
  )

  // Host-wallet bridge state (contract v1.1): the announce store + the wagmi
  // connection it drives. A connection through the 'yeetfulHost' connector IS
  // the host page's wallet — it supersedes the plain address context.
  const hostWallet = useSyncExternalStore(subscribeHostWallet, getHostWalletState, getHostWalletServerState)
  const { address: wagmiAddress, isConnected, connector: activeConnector } = useAccount()
  const { connectAsync, connectors, isPending: connectPending } = useConnect()
  const hostConnector = useMemo(
    () => connectors.find((c) => c.id === HOST_WALLET_CONNECTOR_ID),
    [connectors],
  )
  const bridgedAddress =
    isConnected && activeConnector?.id === HOST_WALLET_CONNECTOR_ID ? wagmiAddress : undefined

  const paramAddress = isHexAddress(address) ? address : undefined
  // Precedence: bridged account > postMessage 'address' > URL param. All
  // undefined → ChatInterface falls back to the in-iframe wagmi connection.
  const contextAddress = bridgedAddress ?? (msgAddress === undefined ? paramAddress : msgAddress ?? undefined)

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
  // dropped, capped), and pin them as the active set. No ?mcps= at all →
  // the DEFAULT free fleet (same set a fresh /chat starts with), so a bare
  // 5-line embed still answers swaps, governance, and portfolio asks out of
  // the box. Slugs given but none resolving → empty set (explicit choice is
  // respected — house model + native tx tools still work).
  const mcpsKey = mcps.join(',')
  useEffect(() => {
    let cancelled = false
    const wire = (catalog: McpServer[]) => {
      if (cancelled) return
      setServers(catalog)
      const bySlug = new Map(catalog.map((s) => [s.slug, s]))
      const asked = [...new Set(mcpsKey.split(',').filter(Boolean))]
      const slugs = asked.length > 0 ? asked : [...DEFAULT_CHAT_FLEET_SLUGS]
      const picked = slugs
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

  // Where this embed lives: the SDK-reported page URL first, else the
  // referrer (the embedding page — trimmed to origin under the default
  // referrer policy), else the host param. Drives the sighting beacon and
  // per-turn attribution.
  const embedPage = page || (typeof document !== 'undefined' ? document.referrer : '') || host || ''
  const embedOrigin = useMemo(() => {
    try {
      return embedPage ? new URL(embedPage).origin : undefined
    } catch {
      return undefined
    }
  }, [embedPage])

  // Sighting beacon — once per mount: "this origin embedded the chat (under
  // this key)". Powers the dashboard embeds list + the adoption surface.
  useEffect(() => {
    if (!embedPage && !embedKey) return
    void fetch('/api/embed/sight', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: embedKey || undefined, page: embedPage || undefined }),
    }).catch(() => {})
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Wallet bridge transport: pin it to the host origin BEFORE 'ready' posts
  // (declared above the ready effect — mount effects run in order) so the
  // host's initial 'wallet' announce is never missed.
  useEffect(() => {
    if (hostOrigin) initHostWalletBridge(hostOrigin)
  }, [hostOrigin])

  // AUTO-CONNECT once when the host announces already-connected accounts and
  // wagmi isn't connected. The connector consumes the announced accounts
  // (silent — no prompt); empty announces never auto-prompt, the header
  // affordance below covers that.
  const autoConnectTried = useRef(false)
  useEffect(() => {
    if (autoConnectTried.current || isConnected || !hostConnector) return
    if (!hostWallet.available || hostWallet.accounts.length === 0) return
    autoConnectTried.current = true
    connectAsync({ connector: hostConnector }).catch(() => {
      /* host provider refused — the manual affordance remains */
    })
  }, [hostWallet, isConnected, hostConnector, connectAsync])

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
      const d = e.data as { source?: unknown; v?: unknown; type?: unknown; address?: unknown; theme?: unknown; text?: unknown; send?: unknown } | null
      if (!d || d.source !== SOURCE || d.v !== V) return
      if (d.type === 'address') setMsgAddress(isHexAddress(d.address) ? d.address : null)
      else if (d.type === 'theme' && (d.theme === 'dark' || d.theme === 'light')) setTheme(d.theme)
      else if (d.type === 'prompt' && typeof d.text === 'string' && d.text.trim() && d.text.length <= 2000)
        setInjectedPrompt({ text: d.text, send: d.send === true, at: Date.now() })
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
      <header className="flex-shrink-0 flex items-center gap-2 px-3 py-2 border-b border-white/[0.07] bg-[var(--surf-1)]/70 backdrop-blur-md overflow-x-auto scrollbar-none">
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
        <span className="ml-auto flex-shrink-0 inline-flex items-center gap-2">
          {/* Fullscreen — works inside host iframes that grant the fullscreen
              permission (the SDK + our own surfaces do); fails silently and
              hides itself where the host forbids it. */}
          <button
            type="button"
            aria-label={isFull ? 'Exit fullscreen' : 'Fullscreen'}
            title={isFull ? 'Exit fullscreen' : 'Fullscreen'}
            onClick={() => {
              if (document.fullscreenElement) void document.exitFullscreen().catch(() => {})
              else void document.documentElement.requestFullscreen().catch(() => {})
            }}
            className="flex-shrink-0 grid place-items-center w-6 h-6 rounded-md text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
          >
            {isFull ? <Minimize2 className="w-3.5 h-3.5" /> : <Maximize2 className="w-3.5 h-3.5" />}
          </button>
          {hostWallet.available && !isConnected && hostConnector && (
            <button
              type="button"
              disabled={connectPending}
              onClick={() =>
                connectAsync({ connector: hostConnector }).catch(() => {
                  /* user dismissed the host wallet prompt */
                })
              }
              className="flex-shrink-0 inline-flex items-center px-2 py-0.5 rounded-full border border-[var(--line)] bg-[var(--surf-2)] text-[11px] text-[color:var(--fg)] cursor-pointer disabled:opacity-60 disabled:cursor-default hover:border-[var(--accent,#34d399)] transition-colors"
              title="Connect the wallet from the host page — the approval pops there, not in this frame"
            >
              {connectPending ? 'Connecting…' : 'Connect host wallet'}
            </button>
          )}
          {contextAddress && (
            <span
              className="flex-shrink-0 mono text-[11px] text-[color:var(--muted-2)]"
              title={
                bridgedAddress
                  ? `Connected via the host page's wallet: ${contextAddress}`
                  : `Wallet context from the host page: ${contextAddress}`
              }
            >
              {bridgedAddress ? 'wallet' : 'context'}: {shortAddr(contextAddress)}
            </span>
          )}
        </span>
      </header>
      <main className="flex-1 min-h-0 flex flex-col">
        <ChatInterface
          embedded
          contextAddress={contextAddress}
          onEmbedEvent={emitEvent}
          injectedPrompt={injectedPrompt}
          embedKey={embedKey}
          embedOrigin={embedOrigin}
          embedSession={embedSession}
        />
      </main>
    </div>
  )
}
