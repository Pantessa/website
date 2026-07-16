'use client'

import { useEffect, useRef, useState } from 'react'
import { useRouter } from 'next/navigation'
import { useAccount } from 'wagmi'
import ChatInterface from '@/components/ChatInterface'
import ChatRail from '@/components/ChatRail'
import ChatSignInGate from '@/components/ChatSignInGate'
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
  const { servers, setServers, setCurrentChatId, loadChat, setActiveServerIds, activeServerIds, walletSets, saveWalletSet, authedAddress, loadWalletSet } =
    useYeetfulStore()
  const { address } = useAccount()
  const router = useRouter()

  // A deep link like /chat?mcps=uniswap-free,snapshot-free preselects a working
  // set so the landing "Try it live" (and any shared combo link) lands the user
  // in chat with those MCP cards already loaded. Comma-separated slugs — same
  // convention as /embed?mcps=. Applied once, only on the bare /chat surface
  // (an existing chat restores its own agents).
  const appliedMcpParam = useRef(false)

  // ?prompt= PREFILLS the composer (never auto-sends — a URL must not fire a
  // money action; the user reads it and presses enter). Pairs with ?mcps= so
  // the landing's power examples land ready to run: read once on mount into
  // the same injectedPrompt contract the embed's postMessage prompt uses.
  const [urlPrompt, setUrlPrompt] = useState<{ text: string; send: boolean; at: number } | null>(null)
  useEffect(() => {
    const raw = new URLSearchParams(window.location.search).get('prompt')
    const text = raw?.trim().slice(0, 2000)
    if (text) setUrlPrompt({ text, send: false, at: Date.now() })
  }, [])

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
  // `authedAddress` is a dependency on purpose: on a direct load of /chat/[id]
  // this effect fires BEFORE the SIWE session has hydrated, so loadChat bails
  // without fetching (it needs the session cookie's owner). When the session
  // resolves, the re-run performs the real fetch — without it the chat's
  // messages never load and the splash hold spins the loader forever.
  useEffect(() => {
    if (!chatId) {
      setCurrentChatId(null)
      return
    }
    setCurrentChatId(chatId)
    void loadChat(chatId).then((chat) => {
      if (chat) {
        setActiveServerIds(chat.activeServerIds)
      } else if (useYeetfulStore.getState().authedAddress) {
        // Signed in and the chat definitively isn't loadable (deleted, or
        // another wallet's): a dead id would otherwise hold the chat loader
        // forever — fall back to a fresh chat.
        router.replace('/chat')
      }
    })
  }, [chatId, authedAddress, setCurrentChatId, loadChat, setActiveServerIds, router])

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

  // Per-wallet working-set cache: when a wallet connects on the bare /chat
  // surface, restore the MCP set it had last session (wins over the default
  // fleet; defers to an open chat's own set and to a ?mcps= deep link). Once
  // restored, every change writes through — so next login looks like the last
  // session. The restoredFor ref both dedupes the restore per address and
  // gates the write-through: saving before the restore ran would clobber the
  // cache with the pre-hydration set.
  const restoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!address || servers.length === 0) return
    if (restoredFor.current === address) return
    if (chatId || new URLSearchParams(window.location.search).get('mcps')) {
      // An open chat / deep link owns the set — skip the restore but unlock
      // the write-through, so this session still updates the wallet's cache.
      restoredFor.current = address
      return
    }
    restoredFor.current = address
    const cached = walletSets[address.toLowerCase()]
    // Only ids still present in the loaded directory — a stale cached row
    // (deleted custom MCP) must not leave a ghost id in the working set.
    const valid = (cached ?? []).filter((id) => servers.some((s) => s.id === id))
    if (valid.length) setActiveServerIds(valid)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [address, servers, chatId, setActiveServerIds])

  useEffect(() => {
    if (!address || restoredFor.current !== address) return
    if (activeServerIds.length === 0) return // never cache "nothing" — usually just pre-seed
    saveWalletSet(address, activeServerIds)
  }, [address, activeServerIds, saveWalletSet])

  // DB-backed restore for signed-in users: the working set follows the wallet
  // across devices (walletSets above is same-browser only). Runs once the SIWE
  // session hydrates — later than the local restore, so a non-empty DB copy
  // wins over the local cache (it's the freshest cross-device truth). On an
  // open chat / deep link we still load (that unlocks the store's DB
  // write-through, so this session keeps the DB copy fresh) but don't apply.
  const dbRestoredFor = useRef<string | null>(null)
  useEffect(() => {
    if (!authedAddress || servers.length === 0) return
    if (dbRestoredFor.current === authedAddress) return
    dbRestoredFor.current = authedAddress
    const routeOwnsSet = !!chatId || !!new URLSearchParams(window.location.search).get('mcps')
    void loadWalletSet().then((ids) => {
      if (!ids || routeOwnsSet) return
      // Same stale-id guard as the local restore: only ids still in the
      // loaded directory make it into the working set.
      const valid = ids.filter((id) => servers.some((s) => s.id === id))
      if (valid.length) setActiveServerIds(valid)
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authedAddress, servers, chatId, loadWalletSet, setActiveServerIds])

  // Logged in, the top nav is gone (AppShell) — reclaim its 4rem so chat fills
  // the whole viewport.
  const { chrome } = useAppShellMode()

  return (
    <div className={`relative flex ${chrome ? 'h-dvh' : 'h-[calc(100dvh-4rem)]'}`}>
      {/* The single left rail: MCPs (primary tab) + chat history (Chats tab). */}
      <div className="relative flex-shrink-0">
        <ChatRail />
      </div>
      <main className="flex-1 min-w-0 flex flex-col">
        <ChatInterface injectedPrompt={urlPrompt} />
      </main>
      <RouterEngineWindow />
      <ChatSignInGate />
    </div>
  )
}
