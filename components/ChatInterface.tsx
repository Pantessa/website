'use client'

import { analytics } from '@/lib/analytics'
import { useState, useRef, useEffect, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Zap, Check, Plus, Loader2, Bot, User, PanelLeft, PanelLeftClose, PanelRight, Sparkles, Copy } from 'lucide-react'
import { useAccount, useSignTypedData, useConnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { getHostWalletServerState, getHostWalletState, HOST_WALLET_CONNECTOR_ID, subscribeHostWallet } from '@/lib/host-wallet'
import { cn } from '@/lib/utils'
import MessageReceipts from '@/components/MessageReceipts'
import RouteReport from '@/components/RouteReport'
import SignVoteButton from '@/components/SignVoteButton'
import SignOrderButton from '@/components/SignOrderButton'
import SendTxButton from '@/components/SendTxButton'
import SendTxChain from '@/components/SendTxChain'
import { orderRequestOf, txRequestOf, txChainOf } from '@/lib/transaction-layer'
import VoteChoiceButtons from '@/components/VoteChoiceButtons'
import VoteCandidates from '@/components/VoteCandidates'
import ClarifyChips from '@/components/ClarifyChips'
import PaymentConfirm from '@/components/PaymentConfirm'
import { voteRequestOf, voteCandidatesOf, voteProposalOf } from '@/lib/snapshot-vote'
import { clarifyRequestOf } from '@/lib/clarify'
import { useYeetfulStore, type RouterTraceEvent } from '@/lib/store'
import { latestWorkingContext, type WorkingContext } from '@/lib/working-context'
import { EXAMPLE_PROMPTS } from '@/lib/examples'
import SampleCallDemo from '@/components/SampleCallDemo'
import { SplashDashboard } from '@/components/SplashDashboard'
import BrandIcon from '@/components/BrandIcon'
import ShareButton from '@/components/ShareButton'
import Link from 'next/link'
import ConnectWallet from '@/components/ConnectWallet'
import { YeetfulMark } from '@/components/Logo'
import { useAppShellMode } from '@/components/AppShell'
import ChatMarkdown from '@/components/ChatMarkdown'

// Typed-data signing request shipped from the server for the wallet to sign.
interface SigningRequest {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` }
  types: Record<string, { name: string; type: string }[]>
  primaryType: string
  message: {
    from: `0x${string}`
    to: `0x${string}`
    value: string
    validAfter: string
    validBefore: string
    nonce: `0x${string}`
  }
}
interface PaymentToSign {
  id: string
  name: string
  host: string
  priceUsd: string
  signing: SigningRequest
}


/** Build the assistant message meta from receipts + an optional vote request /
 *  ambiguous-proposal candidates. */
/** Hover copy affordance on every turn — appears top-right of the bubble,
 * flashes a check on success. Flat, no chrome until you want it. */
function CopyTurn({ text, dark }: { text: string; dark?: boolean }) {
  const [done, setDone] = useState(false)
  return (
    <button
      type="button"
      aria-label="Copy message"
      title="Copy"
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setDone(true)
          setTimeout(() => setDone(false), 1400)
        })
      }}
      className={cn(
        'absolute -top-2.5 -right-2.5 w-7 h-7 rounded-full grid place-items-center border backdrop-blur-md',
        'opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100 transition-opacity duration-150',
        dark
          ? 'bg-black/70 border-black/30 text-white'
          : 'bg-[var(--surf-2)]/90 border-[var(--line)] text-[color:var(--muted)] hover:text-white',
      )}
    >
      {done ? <Check className="w-3.5 h-3.5 text-[color:var(--accent)]" /> : <Copy className="w-3.5 h-3.5" />}
    </button>
  )
}

function buildMeta(receipts: unknown, payer: unknown, voteRequest: unknown, voteCandidates?: unknown, routeReport?: unknown, routerTrace?: unknown, voteProposal?: unknown, orderRequest?: unknown, guardrails?: unknown, txRequest?: unknown, workingContext?: unknown, txChain?: unknown, clarify?: unknown, connectWallet?: unknown, connectAsk?: string) {
  const meta: Record<string, unknown> = {}
  if (Array.isArray(receipts) && receipts.length) {
    meta.receipts = receipts
    if (typeof payer === 'string') meta.payer = payer
  }
  // Structured conversation state (RR2) — persisted on the message so the NEXT
  // turn can echo it to the server (latestWorkingContext scans for it).
  if (workingContext && typeof workingContext === 'object') meta.workingContext = workingContext
  if (voteRequest && typeof voteRequest === 'object') meta.voteRequest = voteRequest
  if (voteProposal && typeof voteProposal === 'object') meta.voteProposal = voteProposal
  if (voteCandidates && typeof voteCandidates === 'object') meta.voteCandidates = voteCandidates
  if (routeReport && typeof routeReport === 'object') meta.routeReport = routeReport
  if (Array.isArray(routerTrace) && routerTrace.length) meta.routerTrace = routerTrace
  // A built CoW/Seaport order awaiting signature (A2c) + its guardrail report
  // (A3) — SignOrderButton (A4) reads these from the persisted message.
  if (orderRequest && typeof orderRequest === 'object') meta.orderRequest = orderRequest
  if (guardrails && typeof guardrails === 'object') meta.guardrails = guardrails
  // A built on-chain transaction awaiting broadcast (evm-tx artifact —
  // Uniswap swaps, transfers, mints…) — SendTxButton reads this.
  if (txRequest && typeof txRequest === 'object') meta.txRequest = txRequest
  // A multi-step transaction chain (approve → swap) — SendTxChain reads this
  // and self-advances as each step confirms.
  if (txChain && typeof txChain === 'object') meta.txChain = txChain
  // An ambiguous money/governance target the planner refused to guess (RR17)
  // — ClarifyChips reads this; a chip's pick is sent as the next message.
  if (clarify && typeof clarify === 'object') meta.clarify = clarify
  // The ask needs a transaction but no wallet is connected — the client
  // renders a Connect-wallet button and re-runs `connectAsk` once one lands.
  if (connectWallet === true) {
    meta.connectWallet = true
    if (connectAsk) meta.connectAsk = connectAsk
  }
  return Object.keys(meta).length ? meta : undefined
}

/** Sum settled receipts into one chat_paid event (no-op when nothing paid). */
function trackPaidReceipts(receipts: unknown) {
  if (!Array.isArray(receipts)) return
  const paid = receipts.filter(
    (r): r is { ok: boolean; name?: string; priceUsd?: string } =>
      !!r && typeof r === 'object' && (r as { ok?: unknown }).ok === true,
  )
  if (paid.length === 0) return
  const totalUsd = paid.reduce((sum, r) => sum + (Number(r.priceUsd) || 0), 0)
  analytics.chatPaid(totalUsd, paid.length, paid.map((r) => r.name ?? '?').join(','))
}

interface ChatInterfaceProps {
  /** Embed mode (/embed): hides the workspace toolbar (sidebar toggle, agent
   *  strip, share) and skips the /chat URL rewrites — the iframe URL carries
   *  the embed params and must not be clobbered. Default false: the normal
   *  /chat workspace is unchanged. */
  embedded?: boolean
  /** Wallet-address CONTEXT supplied by the embedding page (bridged host
   *  wallet, postMessage, or URL param — EmbedChat resolves the precedence).
   *  Feeds the walletAddress field of POST /api/chat ($USER_ADDRESS in the
   *  planner). Context alone never signs — signing goes through the wagmi
   *  connection (which, on a bridged embed, IS the host page's wallet via the
   *  'yeetfulHost' connector). Wins over the connected account. */
  contextAddress?: `0x${string}`
  /** Notable embed moments (e.g. 'order-signed') → the postMessage bridge. */
  onEmbedEvent?: (name: string, data?: Record<string, unknown>) => void
  /** Host-injected prompt (embed contract v1 `prompt` message): prefill the
   *  input, or send immediately when `send`. `at` disambiguates repeats. */
  injectedPrompt?: { text: string; send: boolean; at: number } | null
  /** Public embed key (`yfe_…`) from the embed params — rides every
   *  /api/chat body so house-model credits bill the KEY OWNER's plan and the
   *  turn counts toward that site's embed stats. */
  embedKey?: string
  /** Origin of the page hosting the embed (from the SDK's page URL /
   *  referrer) — per-turn attribution for the embeds ledger. */
  embedOrigin?: string
  /** One id per embed mount (EmbedChat mints it) — groups turns into a
   *  conversation so the owner dashboard can spot dead-end sessions. */
  embedSession?: string
}

export default function ChatInterface({ embedded = false, contextAddress, onEmbedEvent, injectedPrompt, embedKey, embedOrigin, embedSession }: ChatInterfaceProps = {}) {
  const {
    servers,
    activeServerIds,
    setActiveServerIds,
    updateChatServers,
    chats,
    currentChatId,
    createChat,
    addMessage,
    sidebarOpen,
    setSidebarOpen,
    mobileSidebarOpen,
    setMobileSidebarOpen,
    autoRouter,
    pushRouterTrace,
    setRouterTrace,
    clearRouterTrace,
    engineWindowOpen,
    setEngineWindowOpen,
  } = useYeetfulStore()

  // Logged in, the top nav is removed — the chat toolbar carries the home
  // (back to dashboard) mark and the pay-wallet control instead. Never in embed.
  const { chrome: appChrome } = useAppShellMode()
  const showAppChrome = appChrome && !embedded

  // Toggle an agent for this chat; persist the set to the open chat (and DB).
  // Turning one ON pins it to the front of the strip, so scroll home to show
  // it landing there (a chip toggled far down the catalog would otherwise
  // slide out of view).
  const handleToggleServer = (id: string) => {
    const activating = !activeServerIds.includes(id)
    const next = activating ? [...activeServerIds, id] : activeServerIds.filter((x) => x !== id)
    setActiveServerIds(next)
    if (currentChatId) updateChatServers(currentChatId, next)
    const strip = stripRef.current
    if (activating && strip && strip.scrollLeft > 0) {
      const from = strip.scrollLeft
      strip.scrollTo({ left: 0, behavior: 'smooth' })
      // Smooth scrolling is a no-op under reduced motion in some browsers —
      // snap home if it hasn't moved.
      window.setTimeout(() => {
        if (strip.scrollLeft >= from) strip.scrollLeft = 0
      }, 300)
    }
  }

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  // Splash dashboard: tile count the scan resolved (null = not yet), so the
  // normal empty state only shows when the splash finds nothing.
  const [splashCount, setSplashCount] = useState<number | null>(null)
  // A planned wallet-mode turn awaiting the user's OK before the wallet pops —
  // so they see the real $ amount (not the wallet's raw base-units value) first.
  const [pendingPayment, setPendingPayment] = useState<{
    userMsg: string
    chatId: string
    data: { plan: unknown; payments: PaymentToSign[]; listedOnly: unknown; notes?: unknown; turnId?: unknown; capabilities?: unknown }
    history: { role: string; content: string }[]
    workingContext?: WorkingContext
  } | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const stripRef = useRef<HTMLDivElement>(null)

  const { address, isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()
  // Effective wallet context for /api/chat: an embed-provided address wins,
  // else the connected account. Context alone never signs anything.
  const effectiveAddress = contextAddress ?? (isConnected ? address : undefined)

  const currentChat = chats.find((c) => c.id === currentChatId)
  const activeServers = servers.filter((s) => activeServerIds.includes(s.id))
  // Show the connected-wallet splash when we have a wallet + a MCP that can
  // paint a dashboard tile (Uniswap portfolio / Snapshot proposals / …).
  const splashEligible =
    !!effectiveAddress && !autoRouter && activeServers.some((s) => /uniswap|snapshot/i.test(`${s.slug} ${s.name}`))
  // Connected agents render first in the chip strip (in the order they were
  // toggled on) so the chat always shows what it's wired to without scrolling
  // the whole catalog; the rest keep catalog order.
  const connectedServers = activeServerIds
    .map((id) => servers.find((s) => s.id === id))
    .filter((s): s is (typeof servers)[number] => s !== undefined)
  const orderedServers = [...connectedServers, ...servers.filter((s) => !activeServerIds.includes(s.id))]

  // "What can I do?" example: prefill the input and toggle the mapped agent on
  // (when it's in the live catalog). We prefill rather than auto-send so the
  // user reviews before paying for the call.
  const pickExample = (prompt: string, slug?: string) => {
    setInput(prompt)
    if (slug) {
      const srv = servers.find((s) => s.slug === slug)
      if (srv && !activeServerIds.includes(srv.id)) {
        const next = [...activeServerIds, srv.id]
        setActiveServerIds(next)
        if (currentChatId) updateChatServers(currentChatId, next)
      }
    }
    textareaRef.current?.focus()
  }

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentChat?.messages])

  // Deep-link prefill: /chat?try=<slug> (toggle that agent + prefill its example
  // ask) or /chat?q=<text> (just prefill). Fires once the catalog has loaded,
  // then cleans the URL so a refresh doesn't re-trigger.
  const deepLinkRef = useRef(false)
  useEffect(() => {
    if (deepLinkRef.current) return
    if (embedded) {
      // The embed's query string is the contract params (mcps/address/theme/
      // host), not ?try/?q — and it must never be rewritten.
      deepLinkRef.current = true
      return
    }
    const params = new URLSearchParams(window.location.search)
    const trySlug = params.get('try')
    const q = params.get('q')
    if (!trySlug && !q) {
      deepLinkRef.current = true
      return
    }
    if (trySlug && servers.length === 0) return // wait for the catalog
    deepLinkRef.current = true
    if (trySlug) {
      const ex = EXAMPLE_PROMPTS.find((e) => e.slug === trySlug)
      const srv = servers.find((s) => s.slug === trySlug)
      pickExample(q ?? ex?.prompt ?? `Try ${srv?.name ?? 'this agent'}: `, trySlug)
    } else if (q) {
      setInput(q)
      textareaRef.current?.focus()
    }
    window.history.replaceState(null, '', '/chat')
  }, [servers]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleSend = async (textOverride?: string) => {
    // textOverride lets UI affordances (e.g. a vote-candidate chip) submit a
    // composed message without going through the input box.
    const raw = typeof textOverride === 'string' ? textOverride : input
    if (!raw.trim() || loading || pendingPayment) return
    analytics.chatMessage(activeServers.length, isConnected)

    let chatId = currentChatId
    if (!chatId) {
      chatId = await createChat(input.slice(0, 40) + (input.length > 40 ? '...' : ''))
      // Reflect the new chat in the URL without a remount (which would refetch
      // an empty message list and clobber the optimistic messages below).
      // Not in the embed: the iframe URL carries the embed params.
      if (!embedded) window.history.replaceState(null, '', `/chat/${chatId}`)
    }

    const userMsg = raw.trim()
    // Prior turns (before this message is added) → sent so the server can keep
    // conversational context in the planner + the answer. Capped server-side.
    const history = (currentChat?.messages ?? []).map((m) => ({ role: m.role, content: m.content }))
    // Structured continuity (RR2): the most recent turn's working context —
    // the scope + numbered list the user was shown — echoed to the server so
    // follow-ups ("lets vote yes", "the second one") resolve deterministically.
    const workingContext = latestWorkingContext(currentChat?.messages ?? [])
    if (typeof textOverride !== 'string') setInput('')
    setLoading(true)

    addMessage(chatId, { role: 'user', content: userMsg })

    try {
      // ── Auto-Router: stream the engine's reasoning + answer (no manual
      //    agent selection; the server picks across the whole directory). ──
      if (autoRouter) {
        setStatus('Routing…')
        const out = await runAutoRouter(chatId, userMsg, history, workingContext)
        if (out.kind === 'plan') {
          // Wallet mode: the engine routed; now confirm + sign the payments
          // (reuses the heads-up confirm → execute flow from manual mode).
          setPendingPayment({ userMsg, chatId, data: out.data, history, workingContext })
        } else {
          trackPaidReceipts(out.receipts)
          addMessage(chatId, {
            role: 'assistant',
            content: out.content,
            meta: buildMeta(out.receipts, out.payer, out.voteRequest, undefined, out.routeReport, out.routerTrace, out.voteProposal, out.orderRequest, undefined, out.txRequest, out.workingContext, out.txChain, out.clarify),
          })
          reportEmbedTurn(userMsg, { ...out, reply: out.content })
        }
        return
      }

      // Phase 1 — plan. If a wallet is connected, the server returns the
      // payments to sign; otherwise it pays with the house wallet and replies.
      setStatus(isConnected ? 'Planning x402 calls…' : null)
      // Live engine terminal (manual mode): we mint the turn id CLIENT-side so
      // we can poll the server-recorded trace WHILE the request is in flight —
      // the router's thinking (tool picks, MCP calls, receipts) appears in the
      // engine window in near-realtime instead of after the reply lands.
      const turnId = globalThis.crypto?.randomUUID?.() ?? `t-${Date.now()}-${Math.floor(Math.random() * 1e6)}`
      clearRouterTrace()
      const tracePoll = setInterval(async () => {
        try {
          const r = await fetch(`/api/chat/trace?turn=${turnId}`)
          const j = (await r.json()) as { events?: unknown[] }
          if (Array.isArray(j.events) && j.events.length) setRouterTrace(j.events as Parameters<typeof setRouterTrace>[0])
        } catch {
          /* polling is best-effort */
        }
      }, 700)
      // eslint-disable-next-line @typescript-eslint/no-explicit-any — res.json()
      // was untyped before the trace-poll try/finally wrapped it; keep parity.
      let data: any
      try {
        const res = await fetch('/api/chat', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            message: userMsg,
            chatId,
            activeServerIds,
            activeServers, // full objects: endpoint/protocol/price per server
            walletAddress: effectiveAddress,
            history,
            workingContext,
            turnId,
            embedKey,
            embedOrigin,
          }),
        })
        data = await res.json()
      } finally {
        clearInterval(tracePoll)
        // One last read so the terminal has the complete turn.
        fetch(`/api/chat/trace?turn=${turnId}`)
          .then((r) => r.json())
          .then((j: { events?: unknown[] }) => {
            if (Array.isArray(j.events) && j.events.length) setRouterTrace(j.events as Parameters<typeof setRouterTrace>[0])
          })
          .catch(() => {})
      }

      if (data.phase === 'awaiting-signatures') {
        // Don't pop the wallet yet — show the $ amount + warning heads-up first,
        // then sign on the user's explicit OK (see confirmPayment).
        setPendingPayment({ userMsg, chatId, data, history, workingContext })
      } else {
        trackPaidReceipts(data.receipts)
        addMessage(chatId, {
          role: 'assistant',
          content: data.reply || data.error || 'No response.',
          meta: buildMeta(data.receipts, data.payer, data.voteRequest, data.voteCandidates, undefined, undefined, data.voteProposal, data.orderRequest, data.guardrails, data.txRequest, data.workingContext, data.txChain, data.clarify, data.connectWallet, userMsg),
        })
        reportEmbedTurn(userMsg, data as Record<string, unknown>)
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      addMessage(chatId, {
        role: 'assistant',
        content: /rejected|denied|User rejected/i.test(msg)
          ? '🚫 Payment signature rejected — nothing was charged.'
          : '⚠️ Failed to complete the request. ' + (msg || 'Try again.'),
      })
      reportEmbedTurn(userMsg, null, msg || 'request failed')
    } finally {
      setLoading(false)
      setStatus(null)
    }
  }

  // ── Embed telemetry (keyed embeds only) ──────────────────────────────────
  // One compact beacon per turn → /api/embed/telemetry, so the owner
  // dashboard can render asks → outcomes → transactions and detect dead-end
  // sessions. Classified from exactly what the UI received; fire-and-forget.
  const chainLabel = (id: unknown): string | undefined => {
    const n = typeof id === 'string' ? parseInt(id, 16) || Number(id) : typeof id === 'number' ? id : NaN
    if (Number.isNaN(n)) return undefined
    return { 1: 'ethereum', 100: 'gnosis', 8453: 'base', 42161: 'arbitrum' }[n] ?? String(n)
  }
  const postEmbedTelemetry = (payload: Record<string, unknown>) => {
    if (!embedKey || !embedSession) return
    void fetch('/api/embed/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ key: embedKey, sessionId: embedSession, page: embedOrigin, ...payload }),
    }).catch(() => {})
  }
  const reportEmbedTurn = (prompt: string, data: Record<string, unknown> | null, error?: string) => {
    if (!embedded) return
    let outcome = 'answered'
    let artifact: string | undefined
    let chain: string | undefined
    let detail: string | undefined
    if (error || !data) {
      outcome = 'error'
      detail = error?.slice(0, 200)
    } else if (data.orderRequest) {
      outcome = 'tx-built'
      artifact = 'cow-order'
      chain = chainLabel((data.orderRequest as { chainId?: unknown }).chainId) ?? 'ethereum'
    } else if (data.txChain) {
      outcome = 'tx-built'
      artifact = 'tx-chain'
      chain = chainLabel((data.txChain as { chainId?: unknown }).chainId) ?? 'base'
    } else if (data.txRequest) {
      outcome = 'tx-built'
      artifact = 'tx'
      chain = chainLabel((data.txRequest as { chainId?: unknown }).chainId) ?? 'base'
    } else if (data.voteRequest || data.voteProposal) {
      outcome = 'tx-built'
      artifact = 'vote'
    } else if (data.clarify) {
      outcome = 'clarify'
    } else if (data.planGate) {
      outcome = 'credit-gate'
    } else if (typeof data.reply === 'string' && /^(⚡|🚫|⚠️|🪙|🗳️ .*(isn’t|isn't|needs))/u.test(data.reply)) {
      outcome = 'refused'
      detail = (data.reply as string).slice(0, 200)
    } else if (!data.reply && data.error) {
      outcome = 'error'
      detail = String(data.error).slice(0, 200)
    }
    // the host page hears every turn (the fusion hero reacts to these);
    // durable telemetry still requires a key
    onEmbedEvent?.('turn', { outcome, artifact })
    postEmbedTelemetry({ prompt: prompt.slice(0, 280), outcome, artifact, chain, detail })
  }
  const reportEmbedSigned = (info: { artifact: string; chain?: string; txUrl?: string; detail?: string }) => {
    onEmbedEvent?.('turn', { outcome: 'signed', artifact: info.artifact })
    postEmbedTelemetry({ outcome: 'signed', ...info })
  }

  // ── Connect-wallet-to-continue (transactional ask, no wallet) ───────────
  // The server flags connectWallet on swap/vote asks that arrived without a
  // wallet. The button below the reply connects one — the host-page bridge
  // when this is an embed with a bridged provider, else the RainbowKit
  // modal — and the original ask re-runs the moment an address lands.
  const { openConnectModal } = useConnectModal()
  const { connectAsync: connectForTx, connectors: txConnectors } = useConnect()
  const hostBridge = useSyncExternalStore(subscribeHostWallet, getHostWalletState, getHostWalletServerState)
  const [pendingConnectAsk, setPendingConnectAsk] = useState<string | null>(null)
  const connectForAsk = (ask: string) => {
    setPendingConnectAsk(ask)
    const hostConnector = txConnectors.find((c) => c.id === HOST_WALLET_CONNECTOR_ID)
    if (embedded && hostBridge.available && hostConnector) {
      connectForTx({ connector: hostConnector }).catch(() => setPendingConnectAsk(null))
    } else if (openConnectModal) {
      openConnectModal()
    }
  }
  useEffect(() => {
    if (!pendingConnectAsk || !effectiveAddress) return
    const ask = pendingConnectAsk
    setPendingConnectAsk(null)
    void handleSend(ask)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pendingConnectAsk, effectiveAddress])

  // Host-injected prompt (embed `prompt` message): prefill or send. Keyed on
  // `at` so the same text can be injected twice.
  const lastInjectedAt = useRef(0)
  useEffect(() => {
    if (!injectedPrompt || injectedPrompt.at === lastInjectedAt.current) return
    lastInjectedAt.current = injectedPrompt.at
    if (injectedPrompt.send) void handleSend(injectedPrompt.text)
    else setInput(injectedPrompt.text)
  }, [injectedPrompt]) // eslint-disable-line react-hooks/exhaustive-deps

  /** Auto-Router: POST the streaming endpoint, buffer each trace event into the
   *  store (the engine window renders them live), and return the final reply. */
  const runAutoRouter = async (
    chatId: string,
    userMsg: string,
    history: { role: string; content: string }[],
    workingContext?: WorkingContext,
  ): Promise<
    | { kind: 'reply'; content: string; receipts?: unknown; payer?: string; voteRequest?: unknown; voteProposal?: unknown; routeReport?: unknown; routerTrace?: unknown; orderRequest?: unknown; txRequest?: unknown; txChain?: unknown; clarify?: unknown; workingContext?: unknown }
    | { kind: 'plan'; data: { plan: unknown; payments: PaymentToSign[]; listedOnly: unknown; notes?: unknown; turnId?: unknown; capabilities?: unknown } }
  > => {
    clearRouterTrace()
    setEngineWindowOpen(true) // show the engine working as soon as a turn starts
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        message: userMsg,
        chatId,
        autoRouter: true,
        history,
        workingContext,
        // Wallet connected → the engine streams its routing, then hands the
        // data + answer payments back for the wallet to sign (B5).
        walletAddress: effectiveAddress,
        embedKey,
        embedOrigin,
      }),
    })
    if (!res.body) {
      const data = await res.json().catch(() => ({}))
      return { kind: 'reply', content: data.reply || data.error || 'No response.', receipts: data.receipts, payer: data.payer }
    }
    const reader = res.body.getReader()
    const decoder = new TextDecoder()
    let buf = ''
    let reply: { kind: 'reply'; content: string; receipts?: unknown; payer?: string; voteRequest?: unknown; voteProposal?: unknown; routeReport?: unknown; routerTrace?: unknown; orderRequest?: unknown; txRequest?: unknown; txChain?: unknown; clarify?: unknown; workingContext?: unknown } | null = null
    for (;;) {
      const { done, value } = await reader.read()
      if (done) break
      buf += decoder.decode(value, { stream: true })
      const parts = buf.split('\n\n')
      buf = parts.pop() ?? '' // keep the trailing partial frame for the next read
      for (const part of parts) {
        const line = part.trim()
        if (!line.startsWith('data:')) continue
        let event: { type: string; [k: string]: unknown }
        try {
          event = JSON.parse(line.slice(5).trim())
        } catch {
          continue
        }
        if (event.type === 'plan') {
          // Wallet mode: routing is done; the wallet signs the payments next
          // (handed to the existing confirm → execute flow).
          return {
            kind: 'plan',
            data: {
              plan: event.plan,
              payments: (event.payments as PaymentToSign[]) ?? [],
              listedOnly: event.listedOnly ?? [],
              notes: event.notes,
              turnId: event.turnId, // group the execute-phase receipts with this plan in the live feed
            },
          }
        } else if (event.type === 'reply') {
          reply = {
            kind: 'reply',
            content: String(event.content ?? 'No response.'),
            receipts: event.receipts,
            payer: typeof event.payer === 'string' ? event.payer : undefined,
            voteRequest: event.voteRequest,
            voteProposal: event.voteProposal,
            routeReport: event.routeReport,
            routerTrace: event.trace,
            orderRequest: event.orderRequest,
            txRequest: event.txRequest,
            txChain: event.txChain,
            clarify: event.clarify,
            workingContext: event.workingContext,
          }
        } else if (event.type === 'error') {
          const message = typeof event.message === 'string' ? event.message : 'Auto-router failed'
          pushRouterTrace({ type: 'error', message }) // show it in the engine window too
          throw new Error(message)
        } else if (event.type !== 'done') {
          pushRouterTrace(event as RouterTraceEvent)
        }
      }
    }
    return reply ?? { kind: 'reply', content: 'No response.' }
  }

  /** Sign each x402 payment with the connected wallet, then run the calls. */
  const payWithWalletThenAnswer = async (
    userMsg: string,
    data: { plan: unknown; payments: PaymentToSign[]; listedOnly: unknown; notes?: unknown; turnId?: unknown; capabilities?: unknown },
    history: { role: string; content: string }[] = [],
    workingContext?: WorkingContext,
  ): Promise<{ reply: string; receipts?: unknown[]; payer?: string }> => {
    const signatures: Record<string, string> = {}
    let i = 0
    for (const p of data.payments) {
      i += 1
      setStatus(`Sign payment ${i}/${data.payments.length} in your wallet — ${p.name} ($${p.priceUsd})`)
      signatures[p.id] = await signTypedDataAsync({
        domain: p.signing.domain,
        types: p.signing.types,
        primaryType: p.signing.primaryType,
        message: {
          from: p.signing.message.from,
          to: p.signing.message.to,
          value: BigInt(p.signing.message.value),
          validAfter: BigInt(p.signing.message.validAfter),
          validBefore: BigInt(p.signing.message.validBefore),
          nonce: p.signing.message.nonce,
        },
      })
    }

    setStatus('Settling payments and fetching results…')
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase: 'execute',
        message: userMsg,
        plan: data.plan,
        signatures,
        listedOnly: data.listedOnly,
        notes: data.notes, // plan-time diagnostics, echoed into the final reply
        capabilities: data.capabilities, // connected-agent summary → grounds meta-questions in phase 2
        turnId: data.turnId, // groups the settlements with the plan in the live feed
        history,
        workingContext,
        // Answer-prompt context ("my address") — the server falls back to the
        // SIWE session when absent; the plan phase already validated this shape.
        walletAddress: effectiveAddress,
      }),
    })
    const out = await res.json()
    return {
      reply: out.reply || out.error || 'No response.',
      receipts: Array.isArray(out.receipts) ? out.receipts : undefined,
      payer: typeof out.payer === 'string' ? out.payer : undefined,
    }
  }

  /** User confirmed the amount → pop the wallet, sign, run the calls. */
  const confirmPayment = async () => {
    if (!pendingPayment) return
    const { userMsg, chatId, data, history, workingContext } = pendingPayment
    setPendingPayment(null)
    setLoading(true)
    try {
      const out = await payWithWalletThenAnswer(userMsg, data, history, workingContext)
      trackPaidReceipts(out.receipts)
      addMessage(chatId, {
        role: 'assistant',
        content: out.reply,
        // voteRequest is produced by the burner path; wallet mode has none yet.
        meta: buildMeta(out.receipts, out.payer, undefined),
      })
      reportEmbedTurn(userMsg, { reply: out.reply })
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      addMessage(chatId, {
        role: 'assistant',
        content: /rejected|denied|User rejected/i.test(msg)
          ? '🚫 Payment signature rejected — nothing was charged.'
          : '⚠️ Failed to complete the request. ' + (msg || 'Try again.'),
      })
    } finally {
      setLoading(false)
      setStatus(null)
    }
  }

  const cancelPayment = () => {
    if (!pendingPayment) return
    addMessage(pendingPayment.chatId, { role: 'assistant', content: '🚫 Payment cancelled — nothing was charged.' })
    setPendingPayment(null)
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar: sidebar toggle + agent picker (toggle x402 MCPs from chat).
          Hidden in the embed — EmbedChat renders its own slim header. */}
      {!embedded && (
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-[var(--line)] bg-black/40 flex items-center gap-2">
        {showAppChrome && (
          <Link
            href="/dashboard"
            aria-label="Dashboard home"
            title="Back to dashboard"
            className="flex-shrink-0 grid place-items-center w-10 h-10 md:w-8 md:h-8 rounded-lg text-white hover:bg-[var(--surf-1)] transition-colors"
          >
            <YeetfulMark size={20} />
          </Link>
        )}
        <div ref={stripRef} className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1 min-w-0">
          <button
            onClick={() =>
              window.matchMedia('(max-width: 1023px)').matches
                ? setMobileSidebarOpen(!mobileSidebarOpen)
                : setSidebarOpen(!sidebarOpen)
            }
            aria-label={sidebarOpen || mobileSidebarOpen ? 'Collapse chats sidebar' : 'Expand chats sidebar'}
            title={sidebarOpen || mobileSidebarOpen ? 'Collapse chats' : 'Show chats'}
            className="flex-shrink-0 w-10 h-10 md:w-8 md:h-8 grid place-items-center rounded-lg border border-[var(--line)] bg-[var(--surf-1)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors"
          >
            {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </button>
          {/* Auto Router + the spending-policy master switch are DISABLED for
              now — the toggles are hidden and the features behave as if they
              never existed (Auto Router forced off in the store; policy never
              read here). The wiring is kept for a later revival. */}

          {autoRouter ? (
            <span className="text-[11px] text-[color:var(--muted-2)] whitespace-nowrap pl-1">
              Sharp routing — Yeetful picks the best MCP for each message
            </span>
          ) : (
            <>
              <span className="text-[11px] text-[color:var(--muted-2)] whitespace-nowrap font-medium mono pl-1">
                AGENTS · {activeServers.length}
              </span>
              {orderedServers.map((server, i) => {
                const active = activeServerIds.includes(server.id)
                // Thin rule between the connected group and the catalog.
                const divider = connectedServers.length > 0 && i === connectedServers.length
                return (
                  <div key={server.id} className="flex-shrink-0 flex items-center gap-2">
                    {divider && <span aria-hidden className="w-px h-5 bg-[var(--line-2)]" />}
                    <motion.button
                      layout="position"
                      transition={{ layout: { duration: 0.25, ease: 'easeOut' } }}
                      onClick={() => handleToggleServer(server.id)}
                      aria-pressed={active}
                      className={cn(
                        'flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 min-h-[40px] md:min-h-0 rounded-lg border transition-colors',
                        active
                          ? 'bg-[var(--surf-2)] border-white/40 text-white'
                          : 'bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:border-[var(--line-2)] hover:text-white'
                      )}
                    >
                      <span className="w-3.5 h-3.5 grid place-items-center opacity-90">
                        <BrandIcon server={server} size={13} />
                      </span>
                      <span className="text-[11px] whitespace-nowrap">{server.name}</span>
                      {active ? (
                        <Check className="w-2.5 h-2.5 flex-shrink-0" strokeWidth={3} style={{ color: 'var(--accent)' }} />
                      ) : (
                        <Plus className="w-2.5 h-2.5 flex-shrink-0 opacity-70" strokeWidth={2.5} />
                      )}
                    </motion.button>
                  </div>
                )
              })}
            </>
          )}
          </div>
          {autoRouter && (
            <button
              onClick={() => setEngineWindowOpen(!engineWindowOpen)}
              aria-pressed={engineWindowOpen}
              title={engineWindowOpen ? 'Hide the routing engine' : 'Show the routing engine'}
              className={cn(
                'flex-shrink-0 w-10 h-10 md:w-8 md:h-8 grid place-items-center rounded-lg border transition-colors',
                engineWindowOpen
                  ? 'bg-[var(--surf-2)] border-white/30 text-white'
                  : 'bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)]',
              )}
            >
              <PanelRight className="w-4 h-4" />
            </button>
          )}
          <ShareButton />
          {showAppChrome && (
            <div className="flex-shrink-0 pl-1">
              <ConnectWallet />
            </div>
          )}
        </div>
      )}

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {!currentChat || currentChat.messages.length === 0 ? (
          splashEligible ? (
            <>
              <SplashDashboard
                address={effectiveAddress}
                servers={activeServers}
                onPick={pickExample}
                dismissed={input.trim().length > 0}
                onResolve={setSplashCount}
              />
              {splashCount === 0 && (
                <EmptyState activeCount={activeServers.length} autoRouter={autoRouter} onPick={pickExample} />
              )}
            </>
          ) : (
            <EmptyState activeCount={activeServers.length} autoRouter={autoRouter} onPick={pickExample} />
          )
        ) : (
          <>
            <AnimatePresence initial={false}>
              {currentChat.messages.map((msg, i) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn(
                    'flex gap-3',
                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center',
                      msg.role === 'user'
                        ? 'bg-white text-black'
                        : 'bg-[var(--surf-2)] border border-[var(--line)] text-[color:var(--muted)]'
                    )}
                  >
                    {msg.role === 'user' ? (
                      <User className="w-4 h-4" />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )}
                  </div>

                  {/* Bubble */}
                  <div
                    className={cn(
                      'group/bubble relative max-w-[85vw] lg:max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-[color:var(--accent)]/90 text-black rounded-br-sm'
                        : 'bg-[var(--surf-1)]/70 text-[color:var(--fg)] border border-white/[0.06] rounded-tl-sm'
                    )}
                  >
                    <CopyTurn text={msg.content} dark={msg.role === 'user'} />
                    {msg.role === 'assistant' ? (
                      <ChatMarkdown content={msg.content} />
                    ) : (
                      <pre className="whitespace-pre-wrap font-sans [overflow-wrap:anywhere]">{msg.content}</pre>
                    )}
                    {msg.role === 'assistant' && <MessageReceipts meta={msg.meta} />}
                    {msg.role === 'assistant' && <RouteReport meta={msg.meta} />}
                    {msg.role === 'assistant' &&
                      (() => {
                        const t = (msg.meta as { routerTrace?: unknown } | undefined)?.routerTrace
                        if (!Array.isArray(t) || t.length === 0) return null
                        return (
                          <button
                            onClick={() => {
                              clearRouterTrace()
                              ;(t as RouterTraceEvent[]).forEach((e) => pushRouterTrace(e))
                              setEngineWindowOpen(true)
                            }}
                            className="mt-1 text-[11px] text-[color:var(--muted-2)] hover:text-white mono inline-flex items-center gap-1"
                            title="Re-open this turn's routing in the engine window"
                          >
                            ↻ Replay routing
                          </button>
                        )
                      })()}
                    {msg.role === 'assistant' &&
                      (() => {
                        const vote = voteRequestOf(msg.meta)
                        return vote ? <SignVoteButton vote={vote} /> : null
                      })()}
                    {msg.role === 'assistant' &&
                      (() => {
                        const order = orderRequestOf(msg.meta)
                        return order ? (
                          <SignOrderButton
                            order={order}
                            // Embed bridge: surface the placed order as an
                            // 'order-signed' event on the host page, and log
                            // the SIGNED outcome to the owner's telemetry.
                            onPlaced={(info) => {
                              onEmbedEvent?.('order-signed', info)
                              reportEmbedSigned({
                                artifact: 'cow-order',
                                chain: 'ethereum',
                                txUrl: (info as { explorerUrl?: string }).explorerUrl,
                                detail: (info as { orderUid?: string }).orderUid?.slice(0, 60),
                              })
                            }}
                          />
                        ) : null
                      })()}
                    {msg.role === 'assistant' &&
                      (() => {
                        const builtTx = txRequestOf(msg.meta)
                        return builtTx ? (
                          <SendTxButton
                            tx={builtTx}
                            onConfirmed={(hash) => {
                              const chainId = builtTx.chainId ?? 8453
                              const explorer =
                                { 1: 'https://etherscan.io/tx/', 8453: 'https://basescan.org/tx/', 42161: 'https://arbiscan.io/tx/' }[chainId] ??
                                'https://basescan.org/tx/'
                              reportEmbedSigned({ artifact: 'tx', chain: chainLabel(chainId), txUrl: `${explorer}${hash}` })
                            }}
                          />
                        ) : null
                      })()}
                    {msg.role === 'assistant' &&
                      (() => {
                        const chain = txChainOf(msg.meta)
                        return chain ? <SendTxChain chain={chain} /> : null
                      })()}
                    {msg.role === 'assistant' &&
                      (() => {
                        const vp = voteProposalOf(msg.meta)
                        return vp ? <VoteChoiceButtons proposal={vp} /> : null
                      })()}
                    {msg.role === 'assistant' &&
                      (() => {
                        const cands = voteCandidatesOf(msg.meta)
                        return cands ? (
                          <VoteCandidates
                            data={cands}
                            disabled={loading}
                            onPick={(id) => void handleSend(`vote ${cands.choiceText} on ${id}`)}
                          />
                        ) : null
                      })()}
                    {msg.role === 'assistant' &&
                      (() => {
                        const clarify = clarifyRequestOf(msg.meta)
                        return clarify ? (
                          <ClarifyChips clarify={clarify} disabled={loading} onPick={(resume) => void handleSend(resume)} />
                        ) : null
                      })()}
                    {/* Transactional ask, no wallet → one-click connect, then the
                        ask re-runs by itself. Hidden once a wallet is present. */}
                    {msg.role === 'assistant' &&
                      (msg.meta as { connectWallet?: boolean } | undefined)?.connectWallet === true &&
                      !effectiveAddress && (
                        <button
                          className="mt-2 inline-flex items-center gap-2 px-4 h-10 rounded-full bg-[color:var(--accent)] text-black text-[13.5px] font-semibold hover:opacity-90 transition-opacity"
                          disabled={loading || pendingConnectAsk !== null}
                          onClick={() =>
                            connectForAsk(
                              (msg.meta as { connectAsk?: string } | undefined)?.connectAsk ?? '',
                            )
                          }
                        >
                          <Zap className="w-3.5 h-3.5" />
                          {pendingConnectAsk !== null ? 'Connecting…' : 'Connect wallet to continue'}
                        </button>
                      )}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {loading && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3"
              >
                <div className="w-8 h-8 rounded-xl bg-[var(--surf-2)] border border-[var(--line)] flex items-center justify-center">
                  <Bot className="w-4 h-4 text-[color:var(--muted)]" />
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-[var(--surf-1)] border border-[var(--line)] flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-[color:var(--muted)] animate-spin flex-shrink-0" />
                  <span className="text-xs text-[color:var(--muted)]">{status ?? 'Thinking…'}</span>
                </div>
              </motion.div>
            )}

            {pendingPayment && !loading && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3"
              >
                <div className="w-8 h-8 rounded-xl bg-[var(--surf-2)] border border-[var(--line)] flex items-center justify-center flex-shrink-0">
                  <Bot className="w-4 h-4 text-[color:var(--muted)]" />
                </div>
                <PaymentConfirm
                  payments={pendingPayment.data.payments}
                  onConfirm={() => void confirmPayment()}
                  onCancel={cancelPayment}
                />
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 p-4 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-[var(--line)]">
        <div className="flex items-center gap-3 py-2 pl-4 pr-2 rounded-full border border-[var(--line)] bg-[var(--surf-1)]/80 backdrop-blur-md transition-[border-color,box-shadow] duration-200 focus-within:border-[color:var(--accent)]/45 focus-within:shadow-[0_0_0_4px_rgba(52,227,160,0.07),0_0_24px_rgba(52,227,160,0.06)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              autoRouter
                ? 'Ask anything — Yeetful routes it to the best MCP…'
                : activeServers.length > 1
                  ? `Ask your ${activeServers.length} agents anything…`
                  : activeServers.length === 1
                    ? `Message ${activeServers[0].name}…`
                    : 'Type a message…'
            }
            rows={1}
            className="flex-1 self-center bg-transparent text-sm max-lg:text-base text-white placeholder:text-[color:var(--muted-2)] resize-none border-0 focus:outline-none focus-visible:outline-none max-h-40 overflow-y-auto leading-6"
            style={{ minHeight: '24px', outline: 'none', boxShadow: 'none' }}
          />
          <button
            onClick={() => void handleSend()}
            disabled={!input.trim() || loading || !!pendingPayment}
            className={cn(
              'flex-shrink-0 w-11 h-11 md:w-9 md:h-9 rounded-full flex items-center justify-center transition-all duration-200',
              input.trim() && !loading
                ? 'bg-[color:var(--accent)] text-black hover:brightness-110 scale-100 shadow-[0_0_18px_rgba(52,227,160,0.35)]'
                : 'bg-[var(--surf-2)] text-[color:var(--muted-2)] cursor-not-allowed scale-95'
            )}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-[11px] text-[color:var(--muted-2)] mt-2 text-center mono">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}

function ExampleGallery({ onPick }: { onPick: (prompt: string, slug?: string) => void }) {
  return (
    <div className="mt-7 w-full max-w-md">
      <p className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
        Try one
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLE_PROMPTS.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => onPick(ex.prompt, ex.slug)}
            title={ex.prompt}
            className="text-xs px-3 py-1.5 rounded-full border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] hover:bg-white/5 transition-colors"
          >
            {ex.label}
          </button>
        ))}
      </div>
      <div className="flex justify-center">
        <SampleCallDemo />
      </div>
    </div>
  )
}

function EmptyState({
  activeCount,
  autoRouter,
  onPick,
}: {
  activeCount: number
  autoRouter: boolean
  onPick: (prompt: string, slug?: string) => void
}) {
  if (autoRouter) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center py-20">
        <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/50 flex items-center justify-center mb-6">
          <Sparkles className="w-8 h-8" style={{ color: 'var(--accent)' }} />
        </div>
        <h3 className="text-white font-semibold mb-2">Auto Router is on</h3>
        <p className="text-[color:var(--muted)] text-sm max-w-xs">
          Just ask — Yeetful picks the best MCP and endpoint for each message, pays per call, and shows its work in the engine window.
        </p>
        <ExampleGallery onPick={onPick} />
      </div>
    )
  }
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20">
      <div className="w-16 h-16 rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] flex items-center justify-center mb-6">
        <Zap className="w-8 h-8 text-[color:var(--muted-2)]" />
      </div>
      {activeCount === 0 ? (
        <>
          <h3 className="text-white font-semibold mb-2">No agents selected</h3>
          <p className="text-[color:var(--muted)] text-sm max-w-xs">
            Pick x402 agents from the bar above (or the directory) to power up your chat.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-white font-semibold mb-2">
            {activeCount} agent{activeCount > 1 ? 's' : ''} ready
          </h3>
          <p className="text-[color:var(--muted)] text-sm max-w-xs">
            Start chatting — your message is paid for and answered over x402.
          </p>
        </>
      )}
      <ExampleGallery onPick={onPick} />
    </div>
  )
}
