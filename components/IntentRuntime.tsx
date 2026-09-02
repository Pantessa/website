'use client'

// The intent-link runtime shell. Pre-connect: the ask + the guardrail
// contract + ONE button — "Connect & build my path". Connecting IS the
// consent: the ask then runs through the full chat machinery (scan, funding
// cascade, guarded build) with no typing. Transfer-shaped asks are the
// exception — they prefill but never auto-run (the phishing shape).
//
// Auth model: CONNECT TO ACT, SIGN IN TO KEEP. The run itself never demands
// SIWE — the tx signature is the ownership proof that matters, and the
// pre-ask SIWE wall was pure funnel loss. A live matching session still runs
// authed (DB chat, cross-device); everyone else runs the guest lane, and the
// post-receipt save bar offers sign-in to adopt the thread + receipt.
//
// Funnel events (open → connect → built → signed) post best-effort to the
// link's event sink; the post-receipt "Return to <host>" button renders only
// from the MINT-TIME redirect stored on the link row — never from the URL.

import { useEffect, useRef, useState } from 'react'
import Link from 'next/link'
import { useAccount, useSignMessage } from 'wagmi'
import { declineCard } from '@/lib/decline-client'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { ArrowRight, BellRing, ExternalLink, Fingerprint, Link2, MessageSquare, ReceiptText, ShieldCheck, Zap } from 'lucide-react'
import ChatInterface from '@/components/ChatInterface'
import ChatLoader from '@/components/ChatLoader'
import { SignatureWaitModal } from '@/components/SignatureWaitTakeover'
import CreateAccountButton from '@/components/CreateAccountButton'
import NavAccount from '@/components/NavAccount'
import ShareButton from '@/components/ShareButton'
import SignInFlowLink from '@/components/SignInFlowLink'
import { YeetfulMark } from '@/components/Logo'
import { useSession } from '@/lib/session'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { brandBloomTint, brandCtaStyle, brandThemeStyle, type LinkBrand } from '@/lib/brand-theme'
import { isTransferShaped, linkEyebrow } from '@/lib/intent-links'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import { FREE_FLEET_FALLBACK } from '@/lib/free-fleet'

const STATIC_SERVERS: McpServer[] = [...FREE_FLEET_FALLBACK, ...CATALOG]

const CONTRACT = [
  {
    icon: ShieldCheck,
    title: 'Deterministic builders',
    body: 'Pantessa rebuilds this ask from scratch — no AI writes the calldata, and a link can never smuggle a transaction.',
  },
  {
    icon: ReceiptText,
    title: 'Guarded & receipted',
    body: 'Every build is guarded fail-closed, priced in dollars, and receipted.',
  },
  {
    icon: Fingerprint,
    title: 'Only you can sign',
    body: 'Your wallet is the only thing that can sign. Close the tab and nothing happens.',
  },
]

export default function IntentRuntime({
  slug,
  ask,
  variant = 0,
  mcps,
  agent,
  redirectUrl,
  hasCreator = false,
  creatorHandle = null,
  restricted = false,
  brand = null,
  notify = null,
  roster = null,
  recipient = null,
}: {
  slug: string
  ask: string
  /** Which A/B phrasing this visit was served (0 = the base ask) — rides
   *  every funnel event so the creator sees conversion per phrasing. */
  variant?: number
  mcps: string
  agent: string
  redirectUrl: string
  hasCreator?: boolean
  /** The creator's CLAIMED /l handle, when any — the eyebrow says WHOSE. */
  creatorHandle?: string | null
  /** The link carries a wallet allowlist — the connected wallet must pass
   *  the membership probe before the ask auto-runs. The list itself never
   *  reaches the client. */
  restricted?: boolean
  /** The creator's white-label brand — the splash wears it (bg + accent +
   *  logo, powered by Pantessa); the post-connect runtime keeps the chat
   *  legible and takes only the accent + a logo chip. */
  brand?: LinkBrand | null
  /** U2 — desk-bound / addressed links close the loop on screen: who sent
   *  this, and whether they're webhook-notified (push) or watching the
   *  status feed. Label + mode only; never a URL. */
  notify?: { label: string; push: boolean } | null
  /** THE ROSTER (R2): a proposal from a HIRED agent wears its mandate —
   *  kind label + the canonical (grammar-constrained, DB-stored) mandate
   *  sentence + the cap the wallet's hire consent named. */
  roster?: { label: string; mandate: string; capUsd: number } | null
  /** The wallet this card is ADDRESSED to (M5), lowercased — lights the
   *  Decline verb for exactly that wallet (doors run). Null = plain link. */
  recipient?: string | null
}) {
  const { address, isConnected, status: walletStatus } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { status, needsSignIn, signIn, signingIn } = useSession()
  const { servers, setServers, setActiveServerIds, setCurrentChatId } = useYeetfulStore()

  const [started, setStarted] = useState(false)
  const [built, setBuilt] = useState(false)
  const [signed, setSigned] = useState(false)
  // The Decline verb (doors run) — addressed cards only, recipient only.
  const { signMessageAsync } = useSignMessage()
  const [declined, setDeclined] = useState(false)
  const [declining, setDeclining] = useState(false)
  const [declineError, setDeclineError] = useState<string | null>(null)
  const runDecline = async () => {
    if (!address || !recipient || declining) return
    setDeclining(true)
    setDeclineError(null)
    try {
      await declineCard(slug, address, signMessageAsync)
      setDeclined(true)
    } catch (e) {
      setDeclineError((e as Error).message)
    } finally {
      setDeclining(false)
    }
  }
  // The fourth stop: a compiled job reached 'done' (JobCard's one-shot
  // settlement signal, forwarded as turn outcome 'settled'). Lone artifacts
  // (a plain swap sign) have no settlement signal — signed stays their 100%.
  const [settled, setSettled] = useState(false)
  const [blocked, setBlocked] = useState(false)
  // A turn settled with nothing to sign (no funds, plain answer, refusal) —
  // the visitor must never dead-end here: surface the onward paths. Cleared
  // the moment any turn actually builds.
  const [flowNudge, setFlowNudge] = useState(false)
  const [sigDismissed, setSigDismissed] = useState(false)
  // wagmi sits in 'reconnecting' until every connector settles; a relay that
  // never answers (offline WalletConnect/CDP init) left the splash on
  // "checking for a connected wallet" with NO door forever. After a beat the
  // door renders regardless — a connected wallet still auto-starts.
  const [walletWaitOver, setWalletWaitOver] = useState(false)
  useEffect(() => {
    const t = setTimeout(() => setWalletWaitOver(true), 4000)
    return () => clearTimeout(t)
  }, [])
  const [prompt, setPrompt] = useState<{ text: string; send: boolean; at: number } | null>(null)
  // The post-receipt SIWE round-trip renders the waiting card only for a
  // sign-in the visitor ASKED for (the save bar) — never on arrival.
  useEffect(() => {
    if (!signingIn) setSigDismissed(false)
  }, [signingIn])
  // The link's MCP set must be APPLIED to the store before the ask fires —
  // a visitor arriving with a wallet already connected raced /api/servers
  // and sent the turn against the DEFAULT set (live 2026-07-22: an intent
  // link showing NEAR Intents branding answered "add the NEAR Intents agent
  // to your set"). True immediately when the link composes no set.
  const [mcpsReady, setMcpsReady] = useState(!mcps)
  const transferShaped = isTransferShaped(ask)

  /** Where sign-in should land: this link, exactly as opened. */
  const hereHref = () =>
    typeof window === 'undefined' ? `/i/${slug}` : window.location.pathname + window.location.search

  // Best-effort funnel events — never block or throw into the runtime.
  const posted = useRef(new Set<string>())
  const postEvent = (kind: string, extra?: { valueUsd?: number }) => {
    const once = kind === 'open' || kind === 'connect' || kind === 'settled'
    if (once && posted.current.has(kind)) return
    posted.current.add(kind)
    void fetch(`/api/intent-links/${slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, wallet: address, variant, ...extra }),
    }).catch(() => {})
  }

  useEffect(() => {
    postEvent('open')
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Load the MCP directory once, then apply the link's composed set.
  useEffect(() => {
    if (servers.length === 0) {
      fetch('/api/servers')
        .then((r) => r.json())
        .then((data: McpServer[]) => setServers(data.length > 0 ? data : STATIC_SERVERS))
        .catch(() => setServers(STATIC_SERVERS))
    }
  }, [servers.length, setServers])
  const appliedMcps = useRef(false)
  useEffect(() => {
    if (appliedMcps.current || servers.length === 0 || !mcps) return
    appliedMcps.current = true
    const ids = mcps
      .split(',')
      .map((s) => servers.find((srv) => srv.slug === s.trim())?.id)
      .filter((id): id is string => !!id)
    if (ids.length) setActiveServerIds(ids)
    // Definitive settle either way ([[chat-id-load-race]]): a stale slug
    // list must release the ask (the refusal copy then says what to add),
    // never hold the link's whole flow hostage.
    setMcpsReady(true)
  }, [servers, mcps, setActiveServerIds])

  // Connect IS the consent: the moment a wallet is present, start the
  // runtime. The auto path (wagmi reconnect resolving a beat after load)
  // takes a short branded pause first — the splash announces the wallet was
  // found and fades, instead of hard-cutting to the chat shell mid-read.
  const [autoStarting, setAutoStarting] = useState(false)
  useEffect(() => {
    if (!isConnected || started || !mcpsReady) return
    setAutoStarting(true)
    const t = setTimeout(() => setStarted(true), 900)
    return () => clearTimeout(t)
  }, [isConnected, started, mcpsReady])

  // The start side-effects run once, whichever path flipped `started`.
  // Restricted links insert the allowlist probe between connect and run —
  // fail CLOSED (a partner's "reserved" promise beats a flaky network),
  // with the ask still one honest click away in /chat.
  const [allowCleared, setAllowCleared] = useState(false)
  const startedFx = useRef(false)
  useEffect(() => {
    if (!started || startedFx.current) return
    startedFx.current = true
    postEvent('connect')
    // The link runtime is its own thread: never append the ask into whatever
    // chat the visitor happened to have open (same-session nav from /chat
    // keeps the store's currentChatId — EmbedChat isolates the same way).
    setCurrentChatId(null)
    if (!restricted) {
      setAllowCleared(true)
      return
    }
    fetch(`/api/intent-links/${slug}/allowed?wallet=${address}`)
      .then((r) => r.json())
      .then((d: { allowed?: boolean }) => (d.allowed ? setAllowCleared(true) : setBlocked(true)))
      .catch(() => setBlocked(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started])

  // Connect to act, sign in to keep: the ask injects the moment the session
  // has HYDRATED (a fast /api/auth/me cookie check — never a signature). A
  // returning visitor with a live matching session runs authed into a DB
  // chat; everyone else runs the guest lane into a local chat immediately —
  // no SIWE wall between the click and the build. The tx signature itself is
  // the proof of ownership that matters here; SIWE is offered AFTER the
  // receipt, to keep the thread (the save bar below + adoptLocalChat).
  //
  // Holding for 'loading' is what prevents the historical blank-screen race:
  // firing before hydration once ran the turn into a local chat that a
  // just-settled session's loadChats then wiped (2026-07-22, /i/bridge-usdc
  // — see also isDbChatId gating in the store, and loadChats now preserves
  // local chats regardless). Transfer-shaped asks still only prefill — a
  // human presses send.
  useEffect(() => {
    if (!started || blocked || !allowCleared || prompt) return
    if (status === 'loading') return
    setPrompt({ text: ask, send: !transferShaped, at: Date.now() })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [started, blocked, allowCleared, prompt, status])

  const onTurnEvent = (name: string, data?: Record<string, unknown>) => {
    if (name !== 'turn' || !data) return
    const valueUsd = typeof data.valueUsd === 'number' ? data.valueUsd : undefined
    if (data.outcome === 'tx-built') {
      postEvent('built', { valueUsd })
      setBuilt(true)
    }
    if (data.outcome === 'signed') {
      postEvent('signed', { valueUsd })
      setBuilt(true)
      setSigned(true)
    }
    if (data.outcome === 'settled') {
      setBuilt(true)
      setSigned(true)
      if (data.jobStatus === 'done') {
        setSettled(true)
        postEvent('settled', { valueUsd })
      }
    }
    // Keep-the-flow-going bar: any settled turn that produced nothing to sign
    // (answered / refused / error — the no-funds wall) raises it; a build
    // clears it. 'clarify' is excluded — its chips ARE the continuation.
    const o = data.outcome
    if (o === 'tx-built' || o === 'signed' || o === 'settled') setFlowNudge(false)
    else if (typeof o === 'string' && o !== 'clarify') setFlowNudge(true)
  }

  const redirectHost = (() => {
    try {
      return redirectUrl ? new URL(redirectUrl).hostname : null
    } catch {
      return null
    }
  })()
  const returnHref = redirectUrl ? `${redirectUrl}${redirectUrl.includes('?') ? '&' : '?'}yeetful=signed&ilink=${slug}` : null

  // Onward paths — the visitor never dead-ends on a link. "Make your own
  // link" opens the mint board prefilled with THIS ask + set (remixing is
  // the loop); SignInFlowLink gives guests the unified sign-in door with
  // redirectTo, per the sign-in UX contract.
  const mintHref = `/dashboard/links?ask=${encodeURIComponent(ask.slice(0, 400))}${mcps ? `&mcps=${encodeURIComponent(mcps)}` : ''}`
  const chipClass =
    'flex items-center gap-1.5 px-2.5 min-h-[32px] rounded-lg border bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors mono text-[11px] font-medium whitespace-nowrap'

  if (!started) {
    const ctaLabel = (
      <>
        <Zap className="w-4 h-4" /> Connect &amp; build my path
      </>
    )
    const ctaClass =
      'btn btn--solid inline-flex items-center justify-center gap-2 h-[54px] px-8 rounded-full text-[15px]'
    // On a branded splash the stock fg-on-bg pill reads as a dark blob —
    // repaint the CTA in the creator's accent with luminance-picked ink.
    const ctaStyle = brandCtaStyle(brand)
    // wagmi resolves a returning wallet a beat after load ('reconnecting'),
    // and a found wallet auto-starts the runtime — both moments read as a
    // stall or a hard cut without a stage direction. The loader IS the
    // stage direction: checking → found → fade → the chat takes over.
    const walletResolving = (walletStatus === 'connecting' || walletStatus === 'reconnecting') && !walletWaitOver
    return (
      // The splash wears the creator's brand wholesale (bg + accent + logo,
      // scoped here) — the post-connect chat keeps Pantessa's own legibility.
      <main className="relative min-h-dvh overflow-hidden" style={brandThemeStyle(brand)}>
        {/* One soft bloom behind the ask — the fusion-core glow. It has to
            LIFT: on a light brand an accent-tinted radial darkens the middle
            of the page and reads as a screen over the design, so the tint
            flips to white there (brandBloomTint). */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse 60% 42% at 50% 34%, ${brandBloomTint(brand)}, transparent 70%)`,
          }}
        />
        <div
          className={`relative max-w-3xl mx-auto px-4 py-16 min-h-dvh flex flex-col items-center justify-center text-center transition-opacity duration-700 ${autoStarting ? 'opacity-0' : 'opacity-100'}`}
        >
          {/* flex-wrap: the branded creator lockup is four segments wide
              (logo · brand · CALL · powered-by) and 375px is the drill
              width — wrapping centered beats a clipped row. */}
          <div className="flex flex-wrap justify-center items-center gap-2 mb-8">
            {brand?.logo ? (
              <>
                {/* the creator's mark (data URI from our DB, capped at scan) */}
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img src={brand.logo} alt={brand.name ?? brand.domain ?? 'logo'} className="w-7 h-7 rounded-lg object-contain" />
                <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
                  {brand.name ?? brand.domain}
                </span>
                {/* Each separator travels WITH the segment it introduces, so
                    a wrapped lockup never strands a lone "·" at a line end. */}
                {/* CALL framing survives the white label: a branded creator
                    page is still a posted call, and the brand lockup used to
                    swallow the word entirely. The Powered-by chip stays
                    always-on either way (pinned). */}
                <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)] whitespace-nowrap">
                  <span aria-hidden>· </span>
                  {linkEyebrow({ hasCreator, handle: creatorHandle, agent }, '')}
                </span>
                <span className="inline-flex items-center gap-1.5 mono text-[10.5px] uppercase tracking-widest text-[color:var(--muted-2)] whitespace-nowrap">
                  <span aria-hidden>·</span> Powered by <YeetfulMark size={12} /> Pantessa
                </span>
              </>
            ) : (
              <>
                <YeetfulMark size={15} />
                {/* CALL framing (C3): creator links read as a posted call —
                    the thing a KOL shares. House links (creator=null) keep
                    the neutral "Intent link" lockup, pure Pantessa (pinned). */}
                <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
                  {linkEyebrow({ hasCreator, handle: creatorHandle, agent })}
                </span>
              </>
            )}
          </div>
          {/* THE ROSTER (R2): the slot badge — which mandate is speaking.
              DB-stored canonical text only (threat T2). */}
          {roster && (
            <div className="mb-6 inline-flex flex-wrap items-center justify-center gap-x-2 gap-y-1 rounded-full border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-1.5 max-w-2xl">
              <span className="mono text-[10px] uppercase tracking-widest text-[color:var(--accent)]">
                {roster.label} mandate
              </span>
              <span aria-hidden className="text-[color:var(--muted-2)]">·</span>
              <span className="text-[11px] text-[color:var(--muted)] truncate max-w-[16rem]">&ldquo;{roster.mandate}&rdquo;</span>
              <span aria-hidden className="text-[color:var(--muted-2)]">·</span>
              <span className="mono text-[10px] text-[color:var(--muted-2)]">${roster.capUsd} cap</span>
            </div>
          )}
          <h1
            className="text-[clamp(1.9rem,4.6vw,3.2rem)] leading-[1.12] font-medium text-[color:var(--fg)] max-w-2xl [text-wrap:balance]"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            &ldquo;{ask}&rdquo;
          </h1>

          {/* The DECLINE verb (doors run): an addressed card offers its
              recipient a real "no" — session declines in one tap, otherwise
              one personal_sign over the server's own consent bytes. Ignoring
              stays free; declining frees the sender's stacking fence and
              never benches the agent. */}
          {recipient && address?.toLowerCase() === recipient && !signed && !declined && (
            <button
              type="button"
              onClick={() => void runDecline()}
              disabled={declining}
              className="mt-4 text-[12px] text-[color:var(--muted-2)] underline underline-offset-2 hover:text-[color:var(--fail)] transition-colors disabled:opacity-50"
            >
              {declining ? 'Declining…' : 'Decline this card — the sender sees "declined", not silence'}
            </button>
          )}
          {declined && (
            <p className="mt-4 text-[13px] text-[color:var(--muted)]">
              Declined — this card left your inbox and the sender was told. Nothing moved; the agent is not
              penalized and may propose differently next period.
            </p>
          )}
          {declineError && <p className="mt-2 text-[12px] text-[color:var(--fail)]">{declineError}</p>}

          {/* ≤sm the CTA leads and the three contract cards follow (flex
              order): on a phone the cards pushed the door below the fold —
              the recruit saw guardrail prose and no button. */}
          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl text-left max-sm:order-3 max-sm:mt-8">
            {CONTRACT.map((c) => (
              <div
                key={c.title}
                // Opaque surface, not a 72%-transparent one: over a saturated
                // brand bg the alpha composites the card straight back into
                // the field, and the three contract points stop reading as
                // cards at all.
                className="rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-4"
              >
                <c.icon className="w-4 h-4 mb-2.5" style={{ color: 'var(--accent)' }} />
                <p className="text-[12.5px] font-semibold text-[color:var(--fg)]">{c.title}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--muted)]">{c.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10 max-sm:order-1">
            {autoStarting ? (
              <ChatLoader compact lines={['wallet connected — building your path']} />
            ) : walletResolving ? (
              <ChatLoader compact lines={['checking for a connected wallet']} />
            ) : isConnected ? (
              <button type="button" onClick={() => setStarted(true)} className={ctaClass} style={ctaStyle}>
                {ctaLabel}
              </button>
            ) : cdpEnabled ? (
              // The unified sign-in door — wallet, Google, or email — landing
              // right back on this link (sign-in UX contract, CLAUDE.md).
              // walletConnectOnly: connecting IS the whole step here — the run
              // is the guest lane, and no SIWE popup lands between the click
              // and the build.
              <CreateAccountButton className={ctaClass} style={ctaStyle} label={ctaLabel} redirectTo={hereHref()} walletConnectOnly />
            ) : (
              <button type="button" onClick={() => openConnectModal?.()} className={ctaClass} style={ctaStyle}>
                {ctaLabel}
              </button>
            )}
          </div>
          {!autoStarting && !walletResolving && (
            <p className="text-[12px] text-[color:var(--muted-2)] mt-4 max-w-md max-sm:order-2">
              Connecting runs the scan and the build for your wallet — signing stays yours
              {transferShaped ? '. This ask involves a transfer, so nothing runs until you press send.' : '.'}
            </p>
          )}
          {hasCreator && (
            // The disclosure badge (C3): the counter-position to undisclosed
            // KOL shilling — a paid call says it's paid, and says the WHOLE
            // deal (lifetime first-touch, the #607 rail). Rate-agnostic on
            // purpose ("half of Pantessa's fee") — the tier varies by origin.
            <p className="mono text-[11px] text-[color:var(--muted-2)] mt-10 pt-4 border-t border-[var(--line)] max-w-md max-sm:order-4">
              {/* {' '} is load-bearing: SWC drops a line-leading space after
                  an expression (the standing JSX entity-space gotcha). */}
              {agent ? `${agent} posted this call — its creator` : 'The creator of this call'}
              {' '}earns half of Pantessa&apos;s fee on the trades it produces, and on later trades from wallets it brings
              (lifetime, first touch) — disclosed here because paid calls should say so. Receipts live
              on-chain. Sales, transfers, and bridges are always fee-free.
            </p>
          )}
          {/* The rebrand pointer every other page carries in its footer — /i
              has no site footer, and a first-time visitor who saw the old
              name on a blocklist page deserves the same disclosure here
              (squad round 2, ideation premortem). */}
          <p className={`mono text-[10.5px] uppercase tracking-widest text-[color:var(--muted-2)] max-sm:order-5 ${hasCreator ? 'mt-4' : 'mt-10 pt-4 border-t border-[var(--line)] max-w-md w-full'}`}>
            <Link href="/rebrand" className="hover:text-[color:var(--fg)] underline decoration-dotted underline-offset-2">
              Pantessa · formerly Yeetful
            </Link>
          </p>
        </div>
      </main>
    )
  }

  if (blocked) {
    return (
      <main className="min-h-dvh max-w-xl mx-auto px-4 py-12 flex flex-col justify-center">
        <div className="flex items-center gap-2 mb-8">
          <YeetfulMark size={15} />
          <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
            {linkEyebrow({ hasCreator, handle: creatorHandle, agent })}
          </span>
        </div>
        <h1 className="text-xl font-semibold text-[color:var(--fg)] mb-3">
          This link is reserved for specific wallets.
        </h1>
        <p className="text-[14px] leading-relaxed text-[color:var(--muted)] mb-6">
          The wallet you connected isn&apos;t on this link&apos;s list, so nothing was run and
          nothing was signed. The ask itself isn&apos;t a secret — you can take it to the chat
          yourself:
        </p>
        <a
          href={`/chat?prompt=${encodeURIComponent(ask)}`}
          className="btn btn--solid inline-flex items-center gap-2 text-[13px]"
        >
          <Zap className="w-4 h-4" /> Open in chat (prefilled, never auto-sent)
        </a>
      </main>
    )
  }

  return (
    // Full-screen shell: the global nav is hidden on /i (Navigation.tsx), so
    // the runtime owns the viewport — header pinned, the thread scrolls
    // inside ChatInterface. Simple mode keeps the surface to ONE focused ask:
    // no workspace toolbar, no splash cards, URL stays on /i/<slug>.
    // Brand carries over as ACCENT + the logo chip only — the chat thread
    // keeps Pantessa's bg for legibility; the fade-in meets the splash's
    // fade-out so the handoff reads as one motion, not a hard cut.
    <div
      className="relative h-dvh flex flex-col overflow-hidden yf-runtime-in"
      style={brand ? brandThemeStyle({ ...brand, bg: null }) : undefined}
    >
      <style>{'@keyframes yfRuntimeIn { from { opacity: 0 } to { opacity: 1 } } .yf-runtime-in { animation: yfRuntimeIn 0.5s ease-out }'}</style>
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-64 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 100% at 50% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%)',
        }}
      />
      {/* Waiting-for-signature takeover (shared card — the global mount in
          Providers skips /i, so this instance covers it): shown ONLY while a
          SIWE round-trip the visitor asked for (the save bar) is in flight —
          a silent stall reads as broken. Arrival never fires a signature;
          the run itself is the guest lane. */}
      {signingIn && !sigDismissed && (
        <SignatureWaitModal
          signingIn
          onOpenRequest={() => void signIn()}
          onDismiss={() => setSigDismissed(true)}
          dismissLabel="Continue without signing in"
          overlayClassName="absolute inset-0 z-50"
        />
      )}
      {/* z-20: backdrop-blur makes this header a stacking context, and the
          thread wrapper below is a LATER positioned sibling — without a
          z-index the header's dropdowns (Share popover, account menu) render
          visibly but the thread's scroll container wins hit-testing over
          them: visible, unclickable controls. */}
      <header className="relative z-20 flex-shrink-0 bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur">
        <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <Link
                href="/"
                title="Pantessa home"
                aria-label="Pantessa home"
                className="flex-shrink-0 grid place-items-center w-8 h-8 rounded-lg text-white hover:bg-[var(--surf-1)] transition-colors"
              >
                <YeetfulMark size={15} />
              </Link>
              {brand?.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo} alt={brand.name ?? brand.domain ?? ''} className="w-5 h-5 rounded flex-shrink-0 object-contain" />
              )}
              <div className="min-w-0">
                <p className="mono text-[10px] uppercase tracking-widest text-[color:var(--muted-2)] leading-none">
                  {/* The framing has to survive the splash: a visitor spends
                      the whole run under this header, and it read "intent
                      link" on posted calls too. */}
                  {brand
                    ? `${brand.name ?? brand.domain} · ${linkEyebrow({ hasCreator, handle: creatorHandle, agent }, '').toLowerCase()} · powered by Pantessa`
                    : linkEyebrow({ hasCreator, handle: creatorHandle, agent })}
                </p>
                <p
                  className="mt-1 text-[15px] leading-tight text-[color:var(--fg)] truncate"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  &ldquo;{ask}&rdquo;
                </p>
              </div>
            </div>
            <div className="flex items-center gap-1.5 flex-shrink-0">
              {signed && returnHref && redirectHost && (
                <a
                  href={returnHref}
                  className="btn btn--solid inline-flex items-center gap-1.5 text-[13px] flex-shrink-0"
                >
                  Return to {redirectHost} <ArrowRight className="w-3.5 h-3.5" />
                </a>
              )}
              {/* Share this run — the owner-gated chat share (renders once
                  the visitor's link chat persists). */}
              <ShareButton />
              {/* Exit ramps stay off the header while the ask is building or
                  awaiting the signature (the one job on this surface); they
                  return on the receipt — or when a turn settled with nothing
                  to sign (the flow-nudge bar carries them then too). */}
              {(signed || flowNudge) && (
                <>
                  <SignInFlowLink href={mintHref} className={`${chipClass} max-sm:hidden`}>
                    <Link2 className="w-4 h-4" /> MAKE A LINK
                  </SignInFlowLink>
                  <Link href="/chat" className={`${chipClass} max-sm:hidden`}>
                    <MessageSquare className="w-4 h-4" /> OPEN THE APP
                  </Link>
                </>
              )}
              {/* Dashboard / wallet / sign-out live in the account pill — a
                  bare "Dashboard" button would dead-end signed-out visitors. */}
              <NavAccount />
            </div>
          </div>
          {transferShaped && (
            <p className="mt-2 text-[12px] text-amber-400">
              This ask involves a transfer — review it in the composer and press send yourself.
            </p>
          )}
        </div>
        {/* The header's bottom rule doubles as the run's progress line:
            connected → built → signed fills it in thirds. Decorative-only
            (the funnel events are the truth), but it turns the chrome into
            the stage's arc instead of a static border. */}
        <div aria-hidden className={`yprog absolute inset-x-0 bottom-0 rounded-none ${settled ? 'yprog--full' : ''}`} style={{ height: '1px', background: 'var(--line)' }}>
          <div className="yprog__fill" style={{ width: signed ? '100%' : built ? '66%' : '33%' }} />
        </div>
      </header>
      {/* One focused reading column — the runtime is a single ask on a
          stage, not a workspace; a 5xl-wide thread scattered the user bubble
          and the reply to opposite edges of big screens. */}
      <div className="relative flex-1 max-w-3xl w-full mx-auto px-4 sm:px-6 min-h-0">
        <ChatInterface simple injectedPrompt={prompt} onEmbedEvent={onTurnEvent} intentLinkSlug={slug} />
      </div>
      {/* Soft floor bloom grounding the docked composer — the stage has a
          top light and a footlight, never a bare line. */}
      <div
        aria-hidden
        className="absolute inset-x-0 bottom-0 h-48 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 72% 100% at 50% 100%, color-mix(in srgb, var(--accent) 5%, transparent), transparent 70%)',
        }}
      />
      {/* Keep-the-flow-going bar: a turn settled with nothing to sign (the
          no-funds wall, a refusal, a plain answer) — never a dead end. */}
      {flowNudge && !signed && (
        <div className="relative flex-shrink-0 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur px-4 py-2.5">
          <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-2">
            <span className="text-[12px] text-[color:var(--muted)]">
              Don&apos;t stop here — the full app scans any wallet, funds shortfalls, and builds the path.
            </span>
            <div className="flex items-center gap-1.5">
              <Link href="/chat" className={chipClass}>
                <MessageSquare className="w-4 h-4" /> OPEN THE APP
              </Link>
              <SignInFlowLink href={mintHref} className={chipClass}>
                <Link2 className="w-4 h-4" /> MAKE YOUR OWN LINK
              </SignInFlowLink>
            </div>
          </div>
        </div>
      )}
      {/* U2 — the closed loop, on screen: this link came from an agent (or a
          sender), and the signature just reached them. Push = the M3 webhook
          fired at the signed event; feed = broker_status server truth. The
          invisible back-and-forth, made visible at the aha moment. */}
      {signed && notify && (
        <div className="yenter relative flex-shrink-0 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur px-4 py-2.5">
          <div className="max-w-3xl mx-auto flex items-center gap-2.5">
            <BellRing className="w-4 h-4 flex-shrink-0 text-[color:var(--accent)]" />
            <span className="text-[13px] text-[color:var(--muted)]">
              <strong className="text-[color:var(--fg)]">{notify.label}</strong>{' '}
              {notify.push
                ? 'was notified the moment you signed — the loop is closed.'
                : 'can see this signature on their status feed — the loop is closed.'}
            </span>
          </div>
        </div>
      )}
      {/* Post-receipt save bar — the one moment SIWE is worth a signature to
          a visitor: the trade is explicit (keep this thread + receipt on your
          dashboard), and it comes AFTER the aha, never before it. Guest runs
          live in a local chat; signing in adopts it into the DB
          (session.tsx → adoptLocalChat). */}
      {signed && needsSignIn && (
        <div className="yenter relative flex-shrink-0 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur px-4 py-3">
          <div className="max-w-3xl mx-auto flex flex-wrap items-center justify-between gap-3">
            <span className="text-[13px] text-[color:var(--muted)]">
              <strong className="text-[color:var(--fg)] font-medium">Optional — </strong>
              you&apos;re done here; the money moved. Sign in only if you want this chat and
              receipt kept on your dashboard{' '}
              (one wallet signature, nothing moves).
            </span>
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={signingIn}
              className="btn btn--solid inline-flex items-center gap-1.5 text-[13px] disabled:opacity-60"
            >
              <Fingerprint className="w-3.5 h-3.5" /> {signingIn ? 'Waiting…' : 'Sign in & save'}
            </button>
          </div>
        </div>
      )}
      {signed && returnHref && redirectHost && (
        <div className="relative sticky bottom-0 border-t border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_92%,transparent)] backdrop-blur px-4 py-3">
          <div className="max-w-3xl mx-auto flex items-center justify-between gap-3">
            <span className="text-[13px] text-[color:var(--muted)]">
              Signed and receipted — all done here.
            </span>
            <a href={returnHref} className="btn btn--solid inline-flex items-center gap-1.5 text-[13px]">
              Return to {redirectHost} <ExternalLink className="w-3.5 h-3.5" />
            </a>
          </div>
        </div>
      )}
    </div>
  )
}
