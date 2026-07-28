'use client'

import { analytics } from '@/lib/analytics'
import { Fragment, useState, useRef, useEffect, useSyncExternalStore } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Zap, Check, Loader2, Bot, User, Boxes, ListChecks, MessageSquare, PanelRight, Sparkles, Copy, Plus, Link2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { useAccount, useSignTypedData, useConnect } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { getHostWalletServerState, getHostWalletState, HOST_WALLET_CONNECTOR_ID, subscribeHostWallet } from '@/lib/host-wallet'
import { cn } from '@/lib/utils'
import MessageReceipts from '@/components/MessageReceipts'
import RouteReport from '@/components/RouteReport'
import SignVoteButton from '@/components/SignVoteButton'
import SignOrderButton from '@/components/SignOrderButton'
import SignNftListingButton from '@/components/SignNftListingButton'
import SignHlActionButton from '@/components/SignHlActionButton'
import JobCard from '@/components/JobCard'
import SpendPolicyFix, { type PolicyBlockInfo } from '@/components/SpendPolicyFix'
import GuardianPolicyCard from '@/components/GuardianPolicyCard'
import SendTxButton from '@/components/SendTxButton'
import SendTxChain from '@/components/SendTxChain'
import { orderRequestOf, txRequestOf, txChainOf } from '@/lib/transaction-layer'
import { portfolioOf } from '@/lib/portfolio-display'
import { nftGalleryOf } from '@/lib/nft-display'
import PortfolioCard from '@/components/PortfolioCard'
import NftGalleryCard from '@/components/NftGalleryCard'
import VoteChoiceButtons from '@/components/VoteChoiceButtons'
import VoteCandidates from '@/components/VoteCandidates'
import ClarifyChips from '@/components/ClarifyChips'
import PaymentConfirm from '@/components/PaymentConfirm'
import { voteRequestOf, voteCandidatesOf, voteProposalOf } from '@/lib/snapshot-vote'
import { clarifyRequestOf } from '@/lib/clarify'
import { useYeetfulStore, type RouterTraceEvent } from '@/lib/store'
import { useRunningWork } from '@/lib/use-running-work'
import { useSession } from '@/lib/session'
import { latestWorkingContext, type WorkingContext } from '@/lib/working-context'
import { EXAMPLE_PROMPTS, TRY_PROMPTS } from '@/lib/examples'
import { GUEST_TRIAL_LIMIT, bumpGuestTurns, guestTurnsUsed } from '@/lib/guest-trial'
import SampleCallDemo from '@/components/SampleCallDemo'
import { SplashDashboard } from '@/components/SplashDashboard'
import ChatLoader from '@/components/ChatLoader'
import { splashCapable } from '@/lib/splash/types'
import ShareButton from '@/components/ShareButton'
import ShareReceiptButton from '@/components/ShareReceiptButton'
import { signedTxsOf } from '@/components/SignedTxLines'
import EmbedThisChat from '@/components/EmbedThisChat'
import ChainPicker from '@/components/ChainPicker'
import { chainById } from '@/lib/chains'
import AppModeWorkspace from '@/components/AppModeWorkspace'
import JobDetailOverlay from '@/components/JobDetailOverlay'
import Link from 'next/link'
import NavAccount from '@/components/NavAccount'
import { YeetfulMark } from '@/components/Logo'
import { useAppShellMode } from '@/components/AppShell'
import ChatMarkdown from '@/components/ChatMarkdown'
import BrandIcon from '@/components/BrandIcon'
import { respondingServers } from '@/lib/responding-mcp'

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

/** Hover mint affordance on USER turns — an aha becomes a shareable intent
 *  link: /dashboard/links opens prefilled with this ask + the working set
 *  that produced it. Sits left of the copy button. */
function MintLinkTurn({ ask, mcpsCsv }: { ask: string; mcpsCsv: string }) {
  const href = `/dashboard/links?ask=${encodeURIComponent(ask.slice(0, 400))}${mcpsCsv ? `&mcps=${encodeURIComponent(mcpsCsv)}` : ''}`
  return (
    <a
      href={href}
      aria-label="Create an intent link from this ask"
      title="Create an intent link — share this ask as one tap"
      className={cn(
        'absolute -top-2.5 -right-11 w-7 h-7 rounded-full grid place-items-center border backdrop-blur-md',
        'opacity-0 group-hover/bubble:opacity-100 focus-visible:opacity-100 transition-opacity duration-150',
        'bg-black/70 border-black/30 text-white',
      )}
    >
      <Link2 className="w-3.5 h-3.5" />
    </a>
  )
}

function buildMeta(receipts: unknown, payer: unknown, voteRequest: unknown, voteCandidates?: unknown, routeReport?: unknown, routerTrace?: unknown, voteProposal?: unknown, orderRequest?: unknown, guardrails?: unknown, txRequest?: unknown, workingContext?: unknown, txChain?: unknown, clarify?: unknown, connectWallet?: unknown, connectAsk?: string, portfolio?: unknown, buildPath?: unknown, jobId?: unknown, guardianPolicyId?: unknown, jobToken?: unknown, nfts?: unknown) {
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
  // Which layer built the artifact (lib/build-path.ts) — persisted so the
  // SIGNED telemetry beacon (fired later from the sign buttons) carries it too.
  if (typeof buildPath === 'string' && buildPath) meta.buildPath = buildPath
  // A compiled multi-step job — JobCard polls /api/jobs/[id] and embeds the
  // per-step sign buttons as the runner offers them. The token is the card's
  // session-less auth (embed visitors — lib/job-token.ts).
  if (typeof jobId === 'string' && jobId) {
    meta.jobId = jobId
    if (typeof jobToken === 'string' && jobToken) meta.jobToken = jobToken
  }
  // A just-armed guardian policy — GuardianPolicyCard watches it live.
  if (typeof guardianPolicyId === 'string' && guardianPolicyId) meta.guardianPolicyId = guardianPolicyId
  // An ambiguous money/governance target the planner refused to guess (RR17)
  // — ClarifyChips reads this; a chip's pick is sent as the next message.
  if (clarify && typeof clarify === 'object') meta.clarify = clarify
  // A portfolio-shaped tool return (wallet MCP) — PortfolioCard renders it as
  // a rich card under the reply text instead of leaving balances as prose.
  if (portfolio && typeof portfolio === 'object') meta.portfolio = portfolio
  // The native NFT gallery read — NftGalleryCard draws the wallet's NFTs (with
  // their Sell / Transfer prompts) under the reply.
  if (nfts && typeof nfts === 'object') meta.nfts = nfts
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

/** A splash-card batch pinned into the chat flow: which MCPs it covers (a
 *  snapshot — later set changes never mutate it once the conversation has
 *  started) and the message index it appeared at. Batches are append-only
 *  history: typing or sending never clears them; they scroll up with the
 *  conversation, and an MCP toggled on mid-chat earns a new batch at the
 *  current point in the flow. */
interface SplashBatch {
  id: string
  serverIds: string[]
  /** Manual picks snapshot — keeps a hand-toggled MCP's "always a card"
   *  status even if the user later untoggles it (the card is history). */
  manualSlugs: string[]
  /** Message count when the batch appeared — it renders before messages[anchor]. */
  anchor: number
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
  /** /i/<slug> attribution — rides value-bearing telemetry so creator
   *  fee-split earnings accrue server-side (lib/fees CREATOR_FEE_SPLIT). */
  intentLinkSlug?: string
  /** Simple mode (the /i/<slug> intent-link runtime): one ask, one focused
   *  surface. Hides the workspace toolbar and splash cards, and never
   *  rewrites the URL to /chat/<id> — a refresh must land back on the link
   *  page, not the full chat workspace. The viral touchpoints (per-bubble
   *  mint-a-link, receipt "mint as link") stay ON — IntentRuntime's header
   *  carries share + onward paths. Unlike `embedded`, the first-party
   *  /api/chat body (SIWE session, intent-link attribution) is unchanged. */
  simple?: boolean
}

export default function ChatInterface({ embedded = false, contextAddress, onEmbedEvent, injectedPrompt, embedKey, embedOrigin, embedSession, intentLinkSlug, simple = false }: ChatInterfaceProps = {}) {
  const {
    servers,
    activeServerIds,
    setActiveServerIds,
    manualSlugs,
    updateChatServers,
    chats,
    currentChatId,
    createChat,
    addMessage,
    recordSignedTxs,
    railTab,
    setRailTab,
    composerPrefill,
    setComposerPrefill,
    autoRouter,
    pushRouterTrace,
    setRouterTrace,
    clearRouterTrace,
    engineWindowOpen,
    setEngineWindowOpen,
    mcpRailOpen,
    setMcpRailOpen,
    mobileMcpRailOpen,
    setMobileMcpRailOpen,
    selectedChainId,
    workspaceMode,
    setWorkspaceMode,
  } = useYeetfulStore()

  // Logged in, the top nav is removed — the chat toolbar carries the home
  // (back to dashboard) mark and the pay-wallet control instead. Never in embed.
  const { chrome: appChrome } = useAppShellMode()
  const showAppChrome = appChrome && !embedded

  // Reactive rail-open state so the toolbar can surface the labeled reopen
  // chips only while the rail is tucked away (the collapse toggle otherwise
  // lives at the TOP of the rail, next to its MCPs/Chats tabs).
  const [isNarrow, setIsNarrow] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia('(max-width: 1023px)')
    const on = (e: MediaQueryListEvent) => setIsNarrow(e.matches)
    setIsNarrow(mql.matches)
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  const railVisible = isNarrow ? mobileMcpRailOpen : mcpRailOpen
  // The collapsed JOBS chip's count — running jobs + recurring buys needing
  // you. Polled only while the chip is actually visible (rail closed,
  // first-party chat); the open rail runs its own instance for its tab badge.
  const { badgeCount: runningBadge } = useRunningWork(!railVisible && !embedded && !simple)
  // A reopen chip names what it opens: clicking "MCPs"/"Chats" opens the rail
  // on that tab — no more anonymous panel icons. The chips only render while
  // the rail is closed; open, the rail's own tabs sit right there instead.
  const openRail = (tab: 'mcps' | 'chats' | 'jobs') => {
    setRailTab(tab)
    isNarrow ? setMobileMcpRailOpen(true) : setMcpRailOpen(true)
  }

  // "New chat" → drop to the bare /chat surface, which resets to a fresh
  // session (currentChatId=null, default fleet seeded) with the row minted
  // lazily on first send. Mirrors the rail's own New Chat button so the two
  // stay in lockstep; a top-level button just makes it reachable without
  // hunting through the Chats tab.
  const router = useRouter()
  const startNewChat = () => router.push('/chat')

  const [input, setInput] = useState('')

  // A rail row's action (a due recurring buy, a pause/cancel verb) lands in
  // the composer — prefill only, the user always sends it. One-shot handoff.
  useEffect(() => {
    if (!composerPrefill) return
    setInput(composerPrefill)
    setComposerPrefill(null)
    textareaRef.current?.focus()
  }, [composerPrefill, setComposerPrefill])
  // App Mode's transcript view-switch: a command-bar send opens the transcript
  // over the panels; the pill flips back. Reset when the mode or chat changes.
  const appMode = workspaceMode === 'app' && !embedded && !simple
  const [appTranscriptOpen, setAppTranscriptOpen] = useState(false)
  // Reset only on mode flips — NOT on currentChatId: a command-bar send mints
  // the chat id right after opening the transcript, and a chat-id-keyed reset
  // would slam it shut mid-send.
  useEffect(() => {
    setAppTranscriptOpen(false)
  }, [appMode])
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  // Boot hold: at first paint we can't know whether the splash is about to
  // take over (wallet auto-reconnect + store hydration are in flight), so the
  // loader is the DEFAULT and the guest empty state only appears once the
  // wallet has conclusively settled — capped so a wedged connector can't hold
  // the screen hostage (Nate: "we should never see this info on page start").
  const [bootHoldElapsed, setBootHoldElapsed] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setBootHoldElapsed(true), 4000)
    return () => clearTimeout(t)
  }, [])
  // A planned wallet-mode turn awaiting the user's OK before the wallet pops —
  // so they see the real $ amount (not the wallet's raw base-units value) first.
  const [pendingPayment, setPendingPayment] = useState<{
    userMsg: string
    chatId: string
    data: { plan: unknown; payments: PaymentToSign[]; listedOnly: unknown; notes?: unknown; turnId?: unknown; capabilities?: unknown }
    history: { role: string; content: string }[]
    workingContext?: WorkingContext
  } | null>(null)
  // Stick-to-bottom scroll (scroller = the overflow container, thread = its
  // content). pinnedRef holds while the reader is AT the newest turn; the
  // thread ResizeObserver re-pins on every content growth — splash scans
  // resolving, cards streaming in — where a one-shot scrollIntoView aims at
  // a layout that's about to grow ~1000px above the thread and strands the
  // just-sent message below the fold. Scrolling up releases the pin (they're
  // reading history); a new turn re-arms it.
  const scrollerRef = useRef<HTMLDivElement>(null)
  const threadRef = useRef<HTMLDivElement>(null)
  const pinnedRef = useRef(true)
  // Mirrored for the observers: pinning only applies once a conversation is
  // on screen — the empty splash surface reads top-down and must NOT chase
  // its own cards to the bottom as their scans resolve.
  const hasThreadRef = useRef(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { address, isConnected, status: walletStatus } = useAccount()
  const { status: sessionStatus } = useSession()
  // Loader is the DEFAULT until the wallet conclusively settles (see the
  // boot-hold state above) — 'connecting'/'reconnecting' means the splash may
  // be about to take over.
  const walletSettled = walletStatus === 'connected' || walletStatus === 'disconnected'
  const bootHolding = !walletSettled && !bootHoldElapsed
  const { signTypedDataAsync } = useSignTypedData()
  // Effective wallet context for /api/chat: an embed-provided address wins,
  // else the connected account. Context alone never signs anything.
  const effectiveAddress = contextAddress ?? (isConnected ? address : undefined)

  const currentChat = chats.find((c) => c.id === currentChatId)
  const activeServers = servers.filter((s) => activeServerIds.includes(s.id))
  // Show the connected-wallet splash when we have a wallet + a MCP that can
  // paint a dashboard tile (Uniswap portfolio / Snapshot proposals / CoW
  // orders / Hyperliquid positions / …) — or one the user hand-picked, which
  // always gets a card (preview when there's no activity).
  const splashEligible =
    !simple &&
    !!effectiveAddress &&
    !autoRouter &&
    activeServers.some((s) => splashCapable(s) || manualSlugs.includes(s.slug))

  // ── Splash cards live IN the chat flow ────────────────────────────────────
  // Each batch is a snapshot of MCP cards anchored at the message index where
  // it appeared: the boot scan is the first batch (anchor 0); toggling a NEW
  // MCP on later appends a batch for just that MCP at the current point in the
  // conversation. Cards behave like chat history — typing never dismisses
  // them, sending scrolls them up with the messages. Only while the chat is
  // still EMPTY does the grid mirror the working set exactly (toggling an MCP
  // off prunes its card — the pre-send splash is a dashboard, not history yet).
  const [splashBatches, setSplashBatches] = useState<SplashBatch[]>([])
  // Per-batch resolved tile counts — the empty state only shows when every
  // batch has settled and none produced a card.
  const [splashCounts, setSplashCounts] = useState<Record<string, number>>({})
  // The (chatId, wallet) surface the batches belong to. handleSend stamps it
  // when the first send mints the chat id, so batches survive that transition;
  // an actual chat switch or wallet change resets them.
  const splashSurfaceRef = useRef<string | null>(null)
  // MCPs absorbed silently when a surface opens on an EXISTING conversation —
  // its set is context, not news, so it never earns retroactive cards.
  const splashSeedRef = useRef<Set<string>>(new Set())
  const splashSeqRef = useRef(0)

  // Simple mode has no splash surface at all — batches never mint, so the
  // link runtime stays a single focused thread (cards were "too much info").
  const splashableServers = simple
    ? []
    : activeServers.filter((s) => splashCapable(s) || manualSlugs.includes(s.slug))
  const splashableKey = splashableServers.map((s) => s.id).sort().join(',')
  useEffect(() => {
    const surface = `${currentChatId ?? ''}|${effectiveAddress ?? ''}`
    if (splashSurfaceRef.current !== surface) {
      // An opened chat's history decides whether its pre-existing MCPs get
      // cards — hold until the messages have actually loaded. But only while
      // a load can still deliver: a settled GUEST session can never fetch a
      // DB chat (wallet connected + expired SIWE cookie is the common case),
      // and holding then spins the chat loader forever.
      if (currentChatId && !currentChat?.messagesLoaded && sessionStatus !== 'guest') return
      splashSurfaceRef.current = surface
      setSplashBatches([])
      setSplashCounts({})
      // Opening a conversation that already has messages: absorb its MCPs
      // silently. The chat's own saved set is included so the agent-restore
      // that follows message-load can't race a "new MCP" card into existence.
      splashSeedRef.current = new Set(
        (currentChat?.messages.length ?? 0) > 0
          ? [...(currentChat?.activeServerIds ?? []), ...splashableServers.map((s) => s.id)]
          : [],
      )
    }
    const emptyChat = (currentChat?.messages.length ?? 0) === 0
    if (autoRouter) {
      // Engine mode has no splash surface. An untouched (empty) chat drops its
      // cards like before; mid-conversation cards stay — they're history.
      if (emptyChat) setSplashBatches((prev) => (prev.length ? [] : prev))
      return
    }
    if (!effectiveAddress) return
    setSplashBatches((prev) => {
      if (emptyChat) {
        // Pre-send the splash is ONE unified dashboard mirroring the working
        // set — NOT an accumulation of per-MCP batches. The boot sequence adds
        // MCPs incrementally (default fleet → wallet-set restore → manual
        // picks), and a batch-per-increment renders as several left-aligned
        // grids stacked on top of each other instead of one responsive 3/2/1
        // grid. Coalesce every splashable server into a single stable batch so
        // the cards flow together; toggling an MCP off just drops it from the
        // set. (A stable id keeps the SplashDashboard mounted — it re-scans on
        // its own server-set key, so absorbing the boot races is a refetch, not
        // a remount flash.)
        const ids = splashableServers.map((s) => s.id)
        if (ids.length === 0) return prev.length ? [] : prev
        const id = prev[0]?.id ?? `splash-${splashSeqRef.current++}`
        const mSlugs = manualSlugs.filter((slug) => splashableServers.some((s) => s.slug === slug))
        const same =
          prev.length === 1 &&
          prev[0].id === id &&
          prev[0].serverIds.length === ids.length &&
          prev[0].serverIds.every((x) => ids.includes(x)) &&
          prev[0].manualSlugs.length === mSlugs.length &&
          prev[0].manualSlugs.every((m) => mSlugs.includes(m))
        if (same) return prev
        return [{ id, serverIds: ids, manualSlugs: mSlugs, anchor: 0 }]
      }
      // Mid-conversation the cards are append-only history: an MCP toggled on
      // after the chat has messages earns its OWN batch at the current point;
      // existing cards never re-fetch and a mid-convo removal keeps its card.
      const covered = new Set([...splashSeedRef.current, ...prev.flatMap((b) => b.serverIds)])
      const fresh = splashableServers.filter((s) => !covered.has(s.id))
      if (fresh.length === 0) return prev
      return [
        ...prev,
        {
          id: `splash-${splashSeqRef.current++}`,
          serverIds: fresh.map((s) => s.id),
          manualSlugs: manualSlugs.filter((slug) => fresh.some((s) => s.slug === slug)),
          anchor: currentChat?.messages.length ?? 0,
        },
      ]
    })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [splashableKey, effectiveAddress, currentChatId, currentChat?.messagesLoaded, autoRouter, sessionStatus])

  // All batches settled with zero tiles → the caller's normal empty state.
  const splashSettledEmpty =
    splashBatches.length > 0 && splashBatches.every((b) => splashCounts[b.id] === 0)
  // The wallet eyebrow rides the first batch that actually painted something
  // (a batch whose scan found nothing renders null — chrome on it would
  // orphan the header).
  const splashChromeBatchId = splashBatches.find((b) => splashCounts[b.id] !== 0)?.id

  const renderSplashBatch = (b: SplashBatch, opts: { chrome: boolean; hint: boolean }) => (
    <SplashDashboard
      key={b.id}
      address={effectiveAddress}
      servers={servers.filter((s) => b.serverIds.includes(s.id))}
      manualSlugs={b.manualSlugs}
      onPick={runExample}
      chrome={opts.chrome}
      hint={opts.hint}
      onResolve={(n) => setSplashCounts((prev) => (prev[b.id] === n ? prev : { ...prev, [b.id]: n }))}
    />
  )

  // "What can I do?" example: prefill the input and toggle the mapped agent on
  // (when it's in the live catalog). Used by deep links (?try/?q/?prompt land
  // prefilled — a URL must never fire a turn) and by chips whose MCP still
  // needs a toggle.
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

  // One-tap RUN for in-page example chips (empty state + splash cards): a
  // click IS the first turn — asking is free, and anything transactional
  // still ends at the wallet signature (wallet-mode payments get the heads-up
  // confirm; native builds get the sign card), so an auto-sent ask can never
  // move money. When the ask's MCP isn't in the working set yet we fall back
  // to prefill: the toggle has to land in state before a send would carry it.
  const runExample = (prompt: string, slug?: string) => {
    const srv = slug ? servers.find((s) => s.slug === slug) : undefined
    if (srv && !activeServerIds.includes(srv.id)) {
      analytics.exampleRun(prompt, false)
      pickExample(prompt, slug)
      return
    }
    analytics.exampleRun(prompt, true)
    void handleSend(prompt)
  }

  // Render-time mirror for the scroll observers (see refs above). App Mode's
  // workspace face scrolls panels, not the thread — growing tiles there must
  // not yank the view to the bottom.
  hasThreadRef.current =
    ((currentChat?.messages.length ?? 0) > 0 || loading) && !(appMode && !appTranscriptOpen)

  // `loading` in the deps re-pins the view when the reply lands AND when a
  // send starts. Instant (not smooth): a smooth scroll animates toward a
  // target computed against the CURRENT layout, and on a splash-heavy
  // surface the cards are still growing the page above the thread — the
  // animation lands somewhere stale and the new turn sits off-screen. The
  // ResizeObserver below keeps the pin honest through that growth.
  useEffect(() => {
    if (!hasThreadRef.current) return
    pinnedRef.current = true
    const el = scrollerRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [currentChat?.messages, loading])

  // Hold the bottom-pin while thread content grows; release it when the
  // reader scrolls away from the bottom. The 80px slack means "within a
  // bubble of the newest turn still counts as reading it" — and absorbs
  // sub-pixel rounding between scrollHeight and scrollTop.
  useEffect(() => {
    const scroller = scrollerRef.current
    const thread = threadRef.current
    if (!scroller || !thread) return
    const ro = new ResizeObserver(() => {
      if (pinnedRef.current && hasThreadRef.current) scroller.scrollTop = scroller.scrollHeight
    })
    ro.observe(thread)
    const onScroll = () => {
      pinnedRef.current = scroller.scrollHeight - scroller.scrollTop - scroller.clientHeight < 80
    }
    scroller.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      ro.disconnect()
      scroller.removeEventListener('scroll', onScroll)
    }
  }, [])

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
      // Per-MCP TRY_PROMPTS give every /servers row a concrete, runnable ask —
      // the old "Try <name>: " stub left the visitor composing from scratch.
      pickExample(q ?? TRY_PROMPTS[trySlug] ?? ex?.prompt ?? `Try ${srv?.name ?? 'this agent'}: `, trySlug)
    } else if (q) {
      setInput(q)
      textareaRef.current?.focus()
    }
    window.history.replaceState(null, '', '/chat')
  }, [servers]) // eslint-disable-line react-hooks/exhaustive-deps

  // ?mode=app deep link — open the workspace face directly (shareable, and
  // the SDK's future embed seam). One-shot; the param is part of the surface,
  // not cleaned like ?try/?q.
  const modeLinkRef = useRef(false)
  useEffect(() => {
    if (modeLinkRef.current || embedded) return
    modeLinkRef.current = true
    const mode = new URLSearchParams(window.location.search).get('mode')
    if (mode === 'app' || mode === 'chat') setWorkspaceMode(mode)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const handleSend = async (textOverride?: string) => {
    // textOverride lets UI affordances (e.g. a vote-candidate chip) submit a
    // composed message without going through the input box.
    const raw = typeof textOverride === 'string' ? textOverride : input
    if (!raw.trim() || loading || pendingPayment) return

    // Guest trial lane (first-party only — the embed has its own contract):
    // signed-out visitors without a wallet get GUEST_TRIAL_LIMIT free turns
    // before the sign-in gate closes. Counted here so every path (composer,
    // run-chips, connect-wallet re-runs) shares one meter; the gate watches
    // the same counter and swaps its banner for the scrim at zero.
    const guestTrialTurn = !embedded && sessionStatus === 'guest' && !effectiveAddress
    if (guestTrialTurn) {
      if (guestTurnsUsed() >= GUEST_TRIAL_LIMIT) return // scrim is up — belt & suspenders
      bumpGuestTurns()
    }
    analytics.chatMessage(activeServers.length, isConnected)

    // App Mode: a command-bar send slides the transcript view over the panels
    // (same markup, every artifact behavior intact) — the workspace is one tap
    // away and the answer is never invisible behind the panels.
    if (workspaceMode === 'app' && !embedded) setAppTranscriptOpen(true)

    let chatId = currentChatId
    // Guest dead-id guard: a guest's chats are ephemeral (local only), so a
    // reload of /chat/<localId> leaves currentChatId pointing at nothing —
    // addMessage against it would silently drop the turn. Mint a fresh local
    // chat instead. (Authed chats load from the DB, so their id resolves.)
    if (chatId && !currentChat && sessionStatus === 'guest') chatId = null
    if (!chatId) {
      // Title from the MESSAGE, not the composer — chip taps send via
      // textOverride with an empty input box (they used to title chats '').
      chatId = await createChat(raw.trim().slice(0, 40) + (raw.trim().length > 40 ? '...' : ''))
      // The splash batches were born on the bare surface — adopt the freshly
      // minted chat id so the id change reads as the SAME surface and the
      // cards ride into the conversation instead of resetting.
      splashSurfaceRef.current = `${chatId}|${effectiveAddress ?? ''}`
      // Reflect the new chat in the URL without a remount (which would refetch
      // an empty message list and clobber the optimistic messages below).
      // Not in the embed: the iframe URL carries the embed params. Not in
      // simple mode either: /i/<slug> IS the mode flag — rewriting it to
      // /chat/<id> made a refresh reopen the full chat workspace.
      if (!embedded && !simple) window.history.replaceState(null, '', `/chat/${chatId}`)
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
            meta: buildMeta(out.receipts, out.payer, out.voteRequest, undefined, out.routeReport, out.routerTrace, out.voteProposal, out.orderRequest, undefined, out.txRequest, out.workingContext, out.txChain, out.clarify, undefined, undefined, out.portfolio, out.buildPath, out.jobId, out.guardianPolicyId, out.jobToken),
          })
          // Same standing-intent rail signal as the manual path.
          if (!embedded && (typeof out.jobId === 'string' || typeof out.guardianPolicyId === 'string')) {
            setRailTab('jobs')
          }
          reportEmbedTurn(userMsg, { ...out, reply: out.content })
        }
        return
      }

      // Phase 1 — plan. If a wallet is connected, the server returns the
      // payments to sign; otherwise it pays with the house wallet and replies.
      setStatus(isConnected ? 'Reasoning…' : null)
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
            selectedChainId, // chain picker — swap asks build on this chain
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
          meta: buildMeta(data.receipts, data.payer, data.voteRequest, data.voteCandidates, undefined, undefined, data.voteProposal, data.orderRequest, data.guardrails, data.txRequest, data.workingContext, data.txChain, data.clarify, data.connectWallet, userMsg, data.portfolio, data.buildPath, data.jobId, data.guardianPolicyId, data.jobToken, data.nfts),
        })
        // A standing intent was born this turn (job / DCA schedule / guardian
        // policy): the JobCard renders inline, AND the rail flips to Jobs so
        // its badge shows the new running work — the user never has to guess
        // which tab their schedule landed in.
        if (!embedded && (typeof data.jobId === 'string' || typeof data.guardianPolicyId === 'string')) {
          setRailTab('jobs')
        }
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

  // ── Turn telemetry (keyed embeds + first-party money flow) ───────────────
  // One compact beacon per turn → /api/embed/telemetry, so the owner
  // dashboard can render asks → outcomes → transactions and detect dead-end
  // sessions. Classified from exactly what the UI received; fire-and-forget.
  // First-party chat (yeetful.com itself, no embed key) reports ONLY its
  // value-bearing outcomes (tx-built / signed) — no prompt ever leaves the
  // client on that lane — so "money moved" counts the whole product.
  const chainLabel = (id: unknown): string | undefined => {
    const n = typeof id === 'string' ? parseInt(id, 16) || Number(id) : typeof id === 'number' ? id : NaN
    if (Number.isNaN(n)) return undefined
    return { 1: 'ethereum', 100: 'gnosis', 8453: 'base', 42161: 'arbitrum' }[n] ?? String(n)
  }
  // The guardrail layer prices every transaction it builds (policy caps are
  // USD) — that notional rides the beacon as valueUsd.
  const guardrailUsdOf = (source: unknown): number | undefined => {
    const v = (source as { guardrails?: { valueUsd?: unknown } } | null | undefined)?.guardrails?.valueUsd
    return typeof v === 'number' && Number.isFinite(v) && v > 0 ? v : undefined
  }
  // Which layer built the artifact (native-* | planner | manual) — read from
  // the chat response on tx-built, from the persisted msg.meta on signed, so
  // the dashboard's per-layer built → signed breakdown pairs both ends.
  const buildPathOf = (source: unknown): string | undefined => {
    const v = (source as { buildPath?: unknown } | null | undefined)?.buildPath
    return typeof v === 'string' && v ? v : undefined
  }
  // One session id per first-party mount — same role embedSession plays for embeds.
  const [chatSession] = useState(() =>
    typeof crypto !== 'undefined' && 'randomUUID' in crypto
      ? crypto.randomUUID()
      : `s-${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`,
  )
  const postEmbedTelemetry = (payload: Record<string, unknown>) => {
    const body = embedded
      ? embedKey && embedSession
        ? { key: embedKey, sessionId: embedSession, page: embedOrigin, ...payload }
        : null // keyless third-party embeds record nothing
      : payload.outcome === 'tx-built' || payload.outcome === 'signed'
        ? {
            firstParty: true,
            sessionId: chatSession,
            page: typeof window !== 'undefined' ? window.location.href : undefined,
            intentLinkSlug,
            ...payload,
            prompt: undefined,
            detail: undefined,
          }
        : null // first-party lane carries value-bearing outcomes only
    if (!body) return
    void fetch('/api/embed/telemetry', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    }).catch(() => {})
  }
  const reportEmbedTurn = (prompt: string, data: Record<string, unknown> | null, error?: string) => {
    let outcome = 'answered'
    let artifact: string | undefined
    let chain: string | undefined
    let detail: string | undefined
    if (error || !data) {
      outcome = 'error'
      detail = error?.slice(0, 200)
    } else if (data.jobId) {
      outcome = 'tx-built'
      artifact = 'job'
      chain = 'multi'
    } else if (data.orderRequest) {
      outcome = 'tx-built'
      const isHl = (data.orderRequest as { protocol?: unknown }).protocol === 'hyperliquid'
      artifact = isHl ? 'hl-order' : 'cow-order'
      chain = isHl ? 'hyperliquid' : (chainLabel((data.orderRequest as { chainId?: unknown }).chainId) ?? 'ethereum')
    } else if (data.txChain) {
      outcome = 'tx-built'
      artifact = 'tx-chain'
      // A chain carries no top-level chainId — the steps' txs do.
      const tc = data.txChain as { chainId?: unknown; steps?: Array<{ tx?: { chainId?: unknown } }> }
      chain = chainLabel(tc.chainId ?? tc.steps?.[0]?.tx?.chainId) ?? 'base'
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
    // durable telemetry still requires a key. valueUsd rides along for
    // listeners with their own funnels (intent links) — guardrail-priced.
    onEmbedEvent?.('turn', { outcome, artifact, valueUsd: outcome === 'tx-built' ? guardrailUsdOf(data) : undefined })
    postEmbedTelemetry({
      prompt: prompt.slice(0, 280),
      outcome,
      artifact,
      chain,
      detail,
      valueUsd: outcome === 'tx-built' ? guardrailUsdOf(data) : undefined,
      buildPath: outcome === 'tx-built' ? buildPathOf(data) : undefined,
      // Job-driven turns carry the job id so the server can tag DCA-schedule
      // runs as standing dca-run origin (attended vs standing money-moved).
      jobId: data && typeof data.jobId === 'string' ? data.jobId : undefined,
    })
  }
  const reportEmbedSigned = (info: { artifact: string; chain?: string; txUrl?: string; detail?: string; valueUsd?: number; buildPath?: string; jobId?: string }) => {
    onEmbedEvent?.('turn', { outcome: 'signed', artifact: info.artifact, valueUsd: info.valueUsd })
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
    | { kind: 'reply'; content: string; receipts?: unknown; payer?: string; voteRequest?: unknown; voteProposal?: unknown; routeReport?: unknown; routerTrace?: unknown; orderRequest?: unknown; txRequest?: unknown; txChain?: unknown; clarify?: unknown; workingContext?: unknown; portfolio?: unknown; buildPath?: unknown; jobId?: unknown; jobToken?: unknown; guardianPolicyId?: unknown }
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
        selectedChainId,
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
    let reply: { kind: 'reply'; content: string; receipts?: unknown; payer?: string; voteRequest?: unknown; voteProposal?: unknown; routeReport?: unknown; routerTrace?: unknown; orderRequest?: unknown; txRequest?: unknown; txChain?: unknown; clarify?: unknown; workingContext?: unknown; portfolio?: unknown; buildPath?: unknown; jobId?: unknown; jobToken?: unknown; guardianPolicyId?: unknown } | null = null
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
            portfolio: event.portfolio,
            buildPath: event.buildPath,
            jobId: event.jobId,
            jobToken: event.jobToken,
            guardianPolicyId: event.guardianPolicyId,
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
  ): Promise<{ reply: string; receipts?: unknown[]; payer?: string; portfolio?: unknown }> => {
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
        selectedChainId,
      }),
    })
    const out = await res.json()
    return {
      reply: out.reply || out.error || 'No response.',
      receipts: Array.isArray(out.receipts) ? out.receipts : undefined,
      payer: typeof out.payer === 'string' ? out.payer : undefined,
      portfolio: out.portfolio,
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
        meta: buildMeta(out.receipts, out.payer, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, undefined, out.portfolio),
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
    <div className="relative flex flex-col h-full">
      {/* Toolbar: the rail reopen chips + view toggle + chain picker. Hidden
          in the embed — EmbedChat renders its own slim header — and in simple
          mode, where IntentRuntime's own header carries the ask. */}
      {!embedded && !simple && (
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-[var(--line)] bg-black/40 flex items-center gap-2">
        {/* Home mark — a PERMANENT, predictable path back to the dashboard
            (it used to appear only while the chats sidebar was collapsed,
            which read as chrome shuffling around). */}
        {showAppChrome && (
          <Link
            href="/dashboard"
            aria-label="Yeetful dashboard — keys, embeds, billing"
            title="Yeetful dashboard — keys, embeds, billing"
            className="flex-shrink-0 grid place-items-center w-10 h-10 md:w-8 md:h-8 rounded-lg text-white hover:bg-[var(--surf-1)] transition-colors"
          >
            <YeetfulMark size={20} />
          </Link>
        )}
        {/* New chat — always visible, so starting fresh never means hunting
            through the Chats tab. Lands on the bare /chat surface. */}
        <button
          onClick={startNewChat}
          aria-label="Start a new chat"
          title="Start a new chat"
          className="flex-shrink-0 flex items-center gap-1.5 px-2.5 min-h-[40px] md:min-h-[32px] rounded-lg border bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors"
        >
          <Plus className="w-4 h-4" />
          <span className="text-[11px] whitespace-nowrap font-medium mono">NEW</span>
        </button>
        {/* Labeled reopen chips — only while the rail is collapsed (open, the
            rail's own MCPs/Chats tabs are visible right below). */}
        {!railVisible && (
          <div className="chatreopen flex-shrink-0 flex items-center gap-1.5">
            <button
              onClick={() => openRail('mcps')}
              aria-label="Show the MCP rail"
              title="Show your MCP set"
              className="flex-shrink-0 flex items-center gap-1.5 px-2.5 min-h-[40px] md:min-h-[32px] rounded-lg border bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors"
            >
              <Boxes className="w-4 h-4" />
              <span className="text-[11px] whitespace-nowrap font-medium mono">MCPS · {activeServers.length}</span>
            </button>
            <button
              onClick={() => openRail('jobs')}
              aria-label="Show jobs and recurring buys running on this wallet"
              title="Jobs and recurring buys running on this wallet"
              className="flex-shrink-0 flex items-center gap-1.5 px-2.5 min-h-[40px] md:min-h-[32px] rounded-lg border bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors"
            >
              <ListChecks className="w-4 h-4" />
              <span className="text-[11px] whitespace-nowrap font-medium mono">
                JOBS{runningBadge > 0 ? ` · ${runningBadge}` : ''}
              </span>
            </button>
            <button
              onClick={() => openRail('chats')}
              aria-label="Show your chat history"
              title="Show your chat history"
              className="flex-shrink-0 flex items-center gap-1.5 px-2.5 min-h-[40px] md:min-h-[32px] rounded-lg border bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors"
            >
              <MessageSquare className="w-4 h-4" />
              <span className="text-[11px] whitespace-nowrap font-medium mono">CHATS</span>
            </button>
          </div>
        )}
        <div className="flex-1 min-w-0 flex items-center">
          {/* Auto Router + the spending-policy master switch are DISABLED for
              now — the toggles are hidden and the features behave as if they
              never existed (Auto Router forced off in the store; policy never
              read here). The wiring is kept for a later revival. */}
          {autoRouter ? (
            <span className="text-[11px] text-[color:var(--muted-2)] whitespace-nowrap pl-1">
              Sharp routing — Yeetful picks the best MCP for each message
            </span>
          ) : (
            activeServers.length > 0 && (
              <span className="text-[11px] text-[color:var(--muted-2)] truncate pl-1">
                {activeServers.map((s) => s.name).join(' · ')}
              </span>
            )
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
          {/* The Chat|App ModeToggle came off the toolbar (nav rethink,
              2026-07-17) — App Mode stays in-tree behind ?mode=app. */}
          <ChainPicker />
          <EmbedThisChat slugs={activeServers.map((s) => s.slug)} />
          <ShareButton />
          {showAppChrome && (
            <div className="flex-shrink-0 pl-1">
              {/* The consolidated account pill (same dropdown as the brochure
                  nav: Dashboard / Wallet details / Sign out) — not RainbowKit's
                  copy-address/disconnect-only modal. Chain switching lives in
                  the ChainPicker to the left, so the pill needs no chain chip. */}
              <NavAccount />
            </div>
          )}
        </div>
      )}

      {/* The rail's job detail card (portaled — renders nothing until a
          jobs-tab row opens it). First-party chat only. */}
      {!embedded && !simple && <JobDetailOverlay />}

      {/* Messages area — or, in App Mode, the structured workspace (panels
          fed by the working set; the input below stays docked as the command
          bar). A command-bar send slides the transcript view over the panels
          (appTranscriptOpen) — same markup, every artifact intact — with a
          pill to flip back. Never in the embed (v2 seam). */}
      <div ref={scrollerRef} className="flex-1 overflow-y-auto px-4 py-6">
        {/* Inner thread wrapper: the stick-to-bottom ResizeObserver watches
            THIS element — content growth (splash scans resolving, replies
            streaming) re-pins the scroll, which the container itself can't
            report. min-h-full + flex-col so centered empty states (flex-1 /
            h-full children) still fill the viewport. */}
        <div ref={threadRef} className="min-h-full flex flex-col space-y-4">
        {appMode && appTranscriptOpen && (
          <div className="sticky top-0 z-10 flex justify-center">
            <button
              type="button"
              onClick={() => setAppTranscriptOpen(false)}
              className="rounded-full border border-[var(--line)] bg-[var(--surf-1)] px-3 py-1 text-[11px] text-[color:var(--muted)] shadow-sm transition-colors hover:border-[var(--line-2)] hover:text-white"
            >
              ↓ Back to workspace
            </button>
          </div>
        )}
        {appMode && !appTranscriptOpen ? (
          <>
            {(currentChat?.messages.length ?? 0) > 0 && (
              <div className="sticky top-0 z-10 flex justify-center">
                <button
                  type="button"
                  onClick={() => setAppTranscriptOpen(true)}
                  className="rounded-full border border-[var(--line)] bg-[var(--surf-1)] px-3 py-1 text-[11px] text-[color:var(--muted)] shadow-sm transition-colors hover:border-[var(--line-2)] hover:text-white"
                >
                  ↑ Transcript · {currentChat!.messages.length}
                </button>
              </div>
            )}
            <AppModeWorkspace address={effectiveAddress} onPick={pickExample} />
          </>
        ) : (
          <>
            {/* Boot splash batches (anchor 0) render at this SAME tree slot on
                both the empty surface and the conversation — the first send
                must not move them in the tree: a remount re-runs every card's
                scan, and the collapsing-then-regrowing cards yank ~1000px of
                layout out from under the just-sent message (the "glitchy
                scroll" report). Mid-conversation batches (anchor > 0) still
                render inline with their message below. */}
            {(splashEligible || splashBatches.length > 0) && (
              <>
                {/* The batch effect hasn't committed yet (first paint after
                    connect / chat-load) — hold with the loader, same as a
                    batch's own in-flight scan. */}
                {splashBatches.length === 0 &&
                  (!currentChat || currentChat.messages.length === 0) && <ChatLoader inline />}
                {splashBatches
                  .filter((b) => b.anchor === 0)
                  .map((b) =>
                    renderSplashBatch(b, {
                      chrome: b.id === splashChromeBatchId,
                      hint:
                        (!currentChat || currentChat.messages.length === 0) &&
                        b.id === splashChromeBatchId,
                    }),
                  )}
              </>
            )}
            {!currentChat || currentChat.messages.length === 0 ? (
              splashEligible || splashBatches.length > 0 ? (
                splashSettledEmpty ? (
                  <EmptyState activeCount={activeServers.length} autoRouter={autoRouter} onPick={runExample} />
                ) : null
              ) : bootHolding ? (
                // Wallet auto-reconnect / store hydration in flight: the splash may
                // be about to take over — hold with the loader instead of flashing
                // the guest empty state and swapping a beat later.
                <ChatLoader inline />
              ) : simple ? (
                // Simple mode: the link's ask auto-runs the moment it lands (or
                // sits prefilled in the composer for transfer-shaped asks), so an
                // example gallery here is noise — hold the surface clean.
                null
              ) : (
                <EmptyState activeCount={activeServers.length} autoRouter={autoRouter} onPick={runExample} />
              )
            ) : (
          <>
            <AnimatePresence initial={false}>
              {currentChat.messages.map((msg, i) => (
                <Fragment key={msg.id}>
                {/* Splash batches anchored at this point in the conversation —
                    an MCP added mid-conversation slots in right where it
                    joined (anchor-0 boot cards render above, outside this
                    map, so they survive the 0→1 message transition). */}
                {splashBatches
                  .filter((b) => b.anchor === i && b.anchor > 0)
                  .map((b) => renderSplashBatch(b, { chrome: false, hint: false }))}
                <motion.div
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn(
                    'flex gap-3',
                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row',
                    // Phones: stack the responder marks ABOVE the reply so the
                    // copy owns the full column. Side-by-side, the avatar + gap
                    // ate ~44px of a 375px screen and wrapped every reply into a
                    // narrow ribbon (Nate, mobile /i). Assistant turns only — the
                    // user's own short bubble reads fine right-aligned.
                    msg.role === 'assistant' && 'max-sm:flex-col max-sm:gap-2',
                  )}
                >
                  {/* Avatar — assistant turns show the MCP(s) that answered,
                      resolved from the turn's receipts (falling back to the
                      active working set on pure-inference turns, so talking TO
                      an agent always shows its mark). A multi-MCP turn keeps
                      the coin treatment but overlaps only the circle EDGES
                      (-ml-1.5 + the 2px ring = 8px intrusion, exactly the
                      margin around a 16px icon in a 32px coin) — every mark
                      stays fully legible, never buried under the coin above
                      it. Only a turn with no MCPs anywhere falls back to the
                      robot. */}
                  {(() => {
                    const responders =
                      msg.role === 'assistant' ? respondingServers(msg.meta, servers, activeServers) : []
                    const stack = responders.slice(0, 3)
                    if (msg.role === 'assistant' && stack.length > 1) {
                      return (
                        <div
                          className="flex-shrink-0 flex items-center self-start"
                          title={stack.map((s) => s.name).join(' + ')}
                        >
                          {stack.map((s, i) => (
                            <div
                              key={s.slug}
                              className={cn(
                                'relative w-8 h-8 rounded-full flex items-center justify-center overflow-hidden bg-[var(--surf-2)] border border-[var(--line-2)] ring-2 ring-[var(--bg)]',
                                i > 0 && '-ml-1.5'
                              )}
                              style={{ zIndex: stack.length - i }}
                            >
                              <BrandIcon server={s} size={16} />
                            </div>
                          ))}
                        </div>
                      )
                    }
                    const responder = stack[0] ?? null
                    return (
                      <div
                        title={responder ? responder.name : undefined}
                        className={cn(
                          'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center overflow-hidden',
                          msg.role === 'user'
                            ? 'bg-white text-black'
                            : 'bg-[var(--surf-2)] border border-[var(--line)] text-[color:var(--fg)]'
                        )}
                      >
                        {msg.role === 'user' ? (
                          <User className="w-4 h-4" />
                        ) : responder ? (
                          <BrandIcon server={responder} size={18} />
                        ) : (
                          <Bot className="w-4 h-4 text-[color:var(--muted)]" />
                        )}
                      </div>
                    )
                  })()}

                  {/* Bubble */}
                  <div
                    className={cn(
                      // min-w-0: as a flex child next to the avatar the bubble
                      // must be allowed to shrink — at 85vw alone it clipped
                      // off-screen on phones (avatar + gap + 85vw > 100vw).
                      'group/bubble relative min-w-0 max-w-[85vw] lg:max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed',
                      // Stacked on a phone: no avatar sits beside the reply, so
                      // it takes the full column instead of 85vw.
                      msg.role === 'assistant' && 'max-sm:max-w-full',
                      msg.role === 'user'
                        ? 'chat-bubble--user rounded-br-sm'
                        : 'bg-[var(--surf-1)]/70 text-[color:var(--fg)] border border-white/[0.06] rounded-tl-sm'
                    )}
                  >
                    <CopyTurn text={msg.content} dark={msg.role === 'user'} />
                    {/* The mint-a-link affordance stays in simple mode too —
                        a visitor remixing an ask into their OWN link is the
                        viral loop, not workspace chrome. */}
                    {msg.role === 'user' && !embedded && (
                      <MintLinkTurn ask={msg.content} mcpsCsv={activeServers.map((s) => s.slug).join(',')} />
                    )}
                    {msg.role === 'assistant' ? (
                      <ChatMarkdown content={msg.content} />
                    ) : (
                      <pre className="whitespace-pre-wrap [font-family:var(--font-chat-body)] [overflow-wrap:anywhere]">{msg.content}</pre>
                    )}
                    {msg.role === 'assistant' &&
                      (() => {
                        // Display layer: a portfolio-shaped tool return renders
                        // as a rich card under the reply text (never prose-only).
                        const p = portfolioOf(msg.meta)
                        return p ? <PortfolioCard data={p} /> : null
                      })()}
                    {msg.role === 'assistant' &&
                      (() => {
                        // The native NFT gallery — the wallet's NFTs drawn under
                        // the reply, each row one tap from a sell or transfer.
                        const g = nftGalleryOf(msg.meta)
                        return g ? <NftGalleryCard data={g} onPick={(prompt) => runExample(prompt)} /> : null
                      })()}
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
                        if (order?.protocol === 'opensea') {
                          return (
                            <SignNftListingButton
                              order={order}
                              onPlaced={(info) => {
                                onEmbedEvent?.('order-signed', info)
                                reportEmbedSigned({
                                  artifact: 'opensea-listing',
                                  chain: String(order.chainId ?? 1),
                                  txUrl: info.explorerUrl ?? undefined,
                                  detail: info.orderUid?.slice(0, 60),
                                  valueUsd: guardrailUsdOf(msg.meta),
                                  buildPath: buildPathOf(msg.meta),
                                })
                              }}
                            />
                          )
                        }
                        if (order?.protocol === 'hyperliquid') {
                          return (
                            <SignHlActionButton
                              order={order}
                              onPlaced={(info) => {
                                onEmbedEvent?.('order-signed', info)
                                reportEmbedSigned({
                                  artifact: 'hl-order',
                                  chain: 'hyperliquid',
                                  txUrl: info.explorerUrl,
                                  detail: info.detail?.slice(0, 60),
                                  valueUsd: info.valueUsd ?? guardrailUsdOf(msg.meta),
                                  buildPath: buildPathOf(msg.meta),
                                })
                              }}
                            />
                          )
                        }
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
                                valueUsd: guardrailUsdOf(msg.meta),
                                buildPath: buildPathOf(msg.meta),
                              })
                            }}
                          />
                        ) : null
                      })()}
                    {msg.role === 'assistant' &&
                      typeof (msg.meta as { guardianPolicyId?: unknown } | undefined)?.guardianPolicyId === 'string' && (
                        <GuardianPolicyCard policyId={(msg.meta as { guardianPolicyId: string }).guardianPolicyId} />
                      )}
                    {msg.role === 'assistant' &&
                      typeof (msg.meta as { jobId?: unknown } | undefined)?.jobId === 'string' && (
                        <JobCard
                          jobId={(msg.meta as { jobId: string }).jobId}
                          token={typeof (msg.meta as { jobToken?: unknown }).jobToken === 'string' ? (msg.meta as { jobToken: string }).jobToken : undefined}
                          onStepSigned={(info) => {
                            reportEmbedSigned({
                              artifact: 'job-step',
                              chain: 'multi',
                              detail: info.detail?.slice(0, 60),
                              valueUsd: info.valueUsd ?? undefined,
                              buildPath: info.builder,
                              jobId: (msg.meta as { jobId: string }).jobId,
                            })
                          }}
                        />
                      )}
                    {msg.role === 'assistant' &&
                      (() => {
                        const builtTx = txRequestOf(msg.meta)
                        return builtTx ? (
                          <SendTxButton
                            tx={builtTx}
                            onConfirmed={(hash) => {
                              const chainId = builtTx.chainId ?? 8453
                              // Explorer base from the chain registry (the single
                              // source of truth) so Robinhood/Arbitrum/etc. link to
                              // the right explorer, not a basescan fallback.
                              const explorer = chainById(chainId)?.explorerTx ?? 'https://basescan.org/tx/'
                              reportEmbedSigned({ artifact: 'tx', chain: chainLabel(chainId), txUrl: `${explorer}${hash}`, valueUsd: guardrailUsdOf(msg.meta), buildPath: buildPathOf(msg.meta) })
                              // Durable signing log → the message's DB meta
                              // (the /p share page renders it with explorer links).
                              if (currentChatId) recordSignedTxs(currentChatId, msg.id, [{ hash, chainId, title: builtTx.action ?? 'transaction' }])
                            }}
                          />
                        ) : null
                      })()}
                    {msg.role === 'assistant' &&
                      (() => {
                        const chain = txChainOf(msg.meta)
                        return chain ? (
                          <SendTxChain
                            chain={chain}
                            // The chain's money moves when its FINAL step (the
                            // swap, not the approve) confirms — that's the
                            // signed event for the money-flow metric.
                            onCompleted={({ hash, chainId, txs }) => {
                              const explorer = chainById(chainId)?.explorerTx ?? 'https://basescan.org/tx/'
                              reportEmbedSigned({
                                artifact: 'tx-chain',
                                chain: chainLabel(chainId),
                                txUrl: `${explorer}${hash}`,
                                valueUsd: guardrailUsdOf(msg.meta),
                                buildPath: buildPathOf(msg.meta),
                              })
                              // Every confirmed step (approve AND swap AND fee)
                              // → durable meta.signed for the share page's log.
                              if (currentChatId) recordSignedTxs(currentChatId, msg.id, txs)
                            }}
                          />
                        ) : null
                      })()}
                    {/* One-tap receipt share, the moment a signed turn settles
                        (store merges meta.signed locally; the sign buttons above
                        already show the hashes — this row is the share, not a
                        second log). Needs the persisted row id to snapshot from. */}
                    {msg.role === 'assistant' &&
                      signedTxsOf(msg.meta).length > 0 &&
                      currentChatId &&
                      msg.dbId && (
                        <div className="mt-2 pt-1.5 border-t border-[var(--line)] flex items-center gap-2">
                          <span className="text-[10.5px] mono text-[color:var(--muted-2)]">✍️ signed &amp; settled</span>
                          <ShareReceiptButton kind="tx" chatId={currentChatId} messageId={msg.dbId} />
                          {/* The aha→link loop closes itself: the receipt that
                              just proved the ask offers to become an intent
                              link (same /dashboard/links prefill handoff as the
                              user-bubble mint icon). */}
                          {!embedded &&
                            (() => {
                              let ask = ''
                              for (let j = i - 1; j >= 0; j--) {
                                if (currentChat.messages[j].role === 'user') {
                                  ask = currentChat.messages[j].content
                                  break
                                }
                              }
                              if (!ask) return null
                              const mcpsCsv = activeServers.map((s) => s.slug).join(',')
                              const href = `/dashboard/links?ask=${encodeURIComponent(ask.slice(0, 400))}${mcpsCsv ? `&mcps=${encodeURIComponent(mcpsCsv)}` : ''}`
                              return (
                                <a
                                  href={href}
                                  title="Mint this ask as an intent link — one tap for anyone you share it with"
                                  className="inline-flex items-center gap-1 text-[10.5px] mono text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
                                >
                                  <Link2 className="w-3 h-3" aria-hidden />
                                  mint as link
                                </a>
                              )
                            })()}
                        </div>
                      )}
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
                    {/* A spend-policy refusal (blocked build) is fixable right
                        here: the guardrails report carries the structured
                        block; "ask again" re-runs the ask that was refused. */}
                    {msg.role === 'assistant' &&
                      (() => {
                        const pb = (msg.meta as { guardrails?: { policyBlock?: PolicyBlockInfo } } | undefined)?.guardrails?.policyBlock
                        if (!pb) return null
                        const prevAsk = currentChat.messages
                          .slice(0, i)
                          .reverse()
                          .find((m) => m.role === 'user')?.content
                        return (
                          <SpendPolicyFix
                            block={pb}
                            onFixed={prevAsk ? () => void handleSend(prevAsk) : undefined}
                            retryLabel="Ask again"
                          />
                        )
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
                </Fragment>
              ))}
            </AnimatePresence>

            {/* Batches newer than the latest message (an MCP toggled on just
                now) flow in at the bottom, like the next turn arriving. */}
            {splashBatches
              .filter((b) => b.anchor >= currentChat.messages.length)
              .map((b) => renderSplashBatch(b, { chrome: false, hint: false }))}

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

          </>
            )}
          </>
        )}
        </div>
      </div>

      {/* Input area. Simple mode (the /i link runtime) docks the composer as
          a free-floating pill: no full-width border-t — on a mostly-empty
          stage that rule read as a stray line hanging under the chat — and
          the keyboard hint only fades in once the composer has focus. */}
      <div
        className={cn(
          'flex-shrink-0 p-4 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))]',
          simple ? 'group/composer pb-5' : 'border-t border-[var(--line)]',
        )}
      >
        <div
          className={cn(
            'flex items-center gap-3 py-2 pl-4 pr-2 rounded-full border border-[var(--line)] bg-[color-mix(in_srgb,var(--surf-1)_85%,transparent)] backdrop-blur-md transition-[border-color,box-shadow] duration-200 focus-within:border-[color:var(--accent)]/45 focus-within:shadow-[0_0_0_4px_rgba(52,227,160,0.07),0_0_24px_rgba(52,227,160,0.06)]',
            simple && 'shadow-[0_10px_36px_-14px_rgba(0,0,0,0.55)]',
          )}
        >
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              simple
                ? 'Ask a follow-up, or tweak the ask…'
                : autoRouter
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
        <p
          className={cn(
            'text-[11px] text-[color:var(--muted-2)] mt-2 text-center mono',
            simple && 'opacity-0 transition-opacity duration-300 group-focus-within/composer:opacity-100',
          )}
        >
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}

// One-tap example asks: a click SENDS the turn (the caller passes runExample).
// Asking is free — anything transactional still ends at the wallet signature —
// so the chip is the whole first turn, not a writing prompt.
function ExampleGallery({ onPick }: { onPick: (prompt: string, slug?: string) => void }) {
  return (
    <div className="mt-7 w-full max-w-md">
      <p className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mb-2">
        Run one — a tap sends it
      </p>
      <div className="flex flex-wrap justify-center gap-2">
        {EXAMPLE_PROMPTS.map((ex) => (
          <button
            key={ex.label}
            type="button"
            onClick={() => onPick(ex.prompt, ex.slug)}
            title={ex.prompt}
            className="group flex items-center gap-1.5 text-xs px-3 py-1.5 rounded-full border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[color:var(--accent)]/45 hover:bg-white/5 transition-colors"
          >
            <Send className="w-3 h-3 text-[color:var(--muted-2)] group-hover:text-[color:var(--accent)] transition-colors" />
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
  return (
    // flex-1 (not h-full): the thread wrapper is a min-h-full flex column,
    // so percentage heights don't resolve — growing into the free space
    // keeps the vertical centering instead.
    <div className="flex flex-col items-center justify-center flex-1 text-center py-20">
      <div className="w-16 h-16 rounded-2xl bg-[var(--accent)]/15 border border-[var(--accent)]/50 flex items-center justify-center mb-6">
        <Sparkles className="w-8 h-8" style={{ color: 'var(--accent)' }} />
      </div>
      <h3 className="text-white font-semibold mb-2" style={{ fontFamily: 'var(--font-serif)', fontSize: '1.5rem' }}>
        Say what should happen.
      </h3>
      <p className="text-[color:var(--muted)] text-sm max-w-sm">
        {autoRouter
          ? 'Auto Router picks the right MCP for each ask and shows its work. Anything that moves money is compiled into a guarded transaction — only your wallet can sign it.'
          : activeCount === 0
            ? 'Pick MCPs from the rail, or just ask — swaps, schedules, stop-losses, and portfolios are built in. Only your wallet can sign what comes back.'
            : `Your ${activeCount} MCP${activeCount > 1 ? 's' : ''} answer questions free; anything that moves money is compiled into a guarded transaction only your wallet can sign.`}
      </p>
      <ExampleGallery onPick={onPick} />
    </div>
  )
}
