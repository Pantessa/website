'use client'

// The intent-link runtime shell. Pre-connect: the ask + the guardrail
// contract + ONE button — "Connect & build my path". Connecting IS the
// consent: the ask then runs through the full chat machinery (scan, funding
// cascade, guarded build) with no typing. Transfer-shaped asks are the
// exception — they prefill but never auto-run (the phishing shape).
//
// Funnel events (open → connect → built → signed) post best-effort to the
// link's event sink; the post-receipt "Return to <host>" button renders only
// from the MINT-TIME redirect stored on the link row — never from the URL.

import { useEffect, useRef, useState } from 'react'
import { useAccount } from 'wagmi'
import { useConnectModal } from '@rainbow-me/rainbowkit'
import { ArrowRight, ExternalLink, Fingerprint, Loader2, PenLine, ReceiptText, ShieldCheck, X, Zap } from 'lucide-react'
import ChatInterface from '@/components/ChatInterface'
import CreateAccountButton from '@/components/CreateAccountButton'
import { YeetfulMark } from '@/components/Logo'
import { useSession } from '@/lib/session'
import { cdpEnabled } from '@/lib/cdp-embedded'
import { isTransferShaped } from '@/lib/intent-links'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import { FREE_FLEET_FALLBACK } from '@/lib/free-fleet'

const STATIC_SERVERS: McpServer[] = [...FREE_FLEET_FALLBACK, ...CATALOG]

const CONTRACT = [
  {
    icon: ShieldCheck,
    title: 'Deterministic builders',
    body: 'Yeetful rebuilds this ask from scratch — no AI writes the calldata, and a link can never smuggle a transaction.',
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
  restricted = false,
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
  /** The link carries a wallet allowlist — the connected wallet must pass
   *  the membership probe before the ask auto-runs. The list itself never
   *  reaches the client. */
  restricted?: boolean
}) {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { needsSignIn, signIn, signingIn } = useSession()
  const { servers, setServers, setActiveServerIds, setCurrentChatId } = useYeetfulStore()

  const [started, setStarted] = useState(false)
  const [signed, setSigned] = useState(false)
  const [blocked, setBlocked] = useState(false)
  const [sigDismissed, setSigDismissed] = useState(false)
  const [prompt, setPrompt] = useState<{ text: string; send: boolean; at: number } | null>(null)
  const transferShaped = isTransferShaped(ask)

  // The moment the runtime starts with a connected-but-unsigned wallet, fire
  // the SIWE request ONCE and hold the "waiting for signature" takeover —
  // a raw wallet connect never asks on its own, and a visitor who missed
  // the prompt reads the page as stalled.
  const sigAsked = useRef(false)
  useEffect(() => {
    if (!started || !needsSignIn || signingIn || sigAsked.current) return
    sigAsked.current = true
    void signIn()
  }, [started, needsSignIn, signingIn, signIn])

  /** Where sign-in should land: this link, exactly as opened. */
  const hereHref = () =>
    typeof window === 'undefined' ? `/i/${slug}` : window.location.pathname + window.location.search

  // Best-effort funnel events — never block or throw into the runtime.
  const posted = useRef(new Set<string>())
  const postEvent = (kind: string, extra?: { valueUsd?: number }) => {
    const once = kind === 'open' || kind === 'connect'
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
    const ids = mcps
      .split(',')
      .map((s) => servers.find((srv) => srv.slug === s.trim())?.id)
      .filter((id): id is string => !!id)
    if (ids.length) {
      appliedMcps.current = true
      setActiveServerIds(ids)
    }
  }, [servers, mcps, setActiveServerIds])

  // Connect IS the consent: the moment a wallet is present, run the ask —
  // except transfer-shaped asks, which land prefilled and wait for a human
  // press of send. Restricted links insert the allowlist probe between
  // connect and run — fail CLOSED (a partner's "reserved" promise beats a
  // flaky network), with the ask still one honest click away in /chat.
  useEffect(() => {
    if (!isConnected || started) return
    setStarted(true)
    postEvent('connect')
    // The link runtime is its own thread: never append the ask into whatever
    // chat the visitor happened to have open (same-session nav from /chat
    // keeps the store's currentChatId — EmbedChat isolates the same way).
    setCurrentChatId(null)
    const run = () => setPrompt({ text: ask, send: !transferShaped, at: Date.now() })
    if (!restricted) {
      run()
      return
    }
    fetch(`/api/intent-links/${slug}/allowed?wallet=${address}`)
      .then((r) => r.json())
      .then((d: { allowed?: boolean }) => (d.allowed ? run() : setBlocked(true)))
      .catch(() => setBlocked(true))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isConnected, started])

  const onTurnEvent = (name: string, data?: Record<string, unknown>) => {
    if (name !== 'turn' || !data) return
    const valueUsd = typeof data.valueUsd === 'number' ? data.valueUsd : undefined
    if (data.outcome === 'tx-built') postEvent('built', { valueUsd })
    if (data.outcome === 'signed') {
      postEvent('signed', { valueUsd })
      setSigned(true)
    }
  }

  const redirectHost = (() => {
    try {
      return redirectUrl ? new URL(redirectUrl).hostname : null
    } catch {
      return null
    }
  })()
  const returnHref = redirectUrl ? `${redirectUrl}${redirectUrl.includes('?') ? '&' : '?'}yeetful=signed&ilink=${slug}` : null

  if (!started) {
    const ctaLabel = (
      <>
        <Zap className="w-4 h-4" /> Connect &amp; build my path
      </>
    )
    const ctaClass =
      'btn btn--solid inline-flex items-center justify-center gap-2 h-[54px] px-8 rounded-full text-[15px]'
    return (
      <main className="relative min-h-dvh overflow-hidden">
        {/* one soft accent bloom behind the ask — the fusion-core glow */}
        <div
          aria-hidden
          className="absolute inset-0 pointer-events-none"
          style={{
            background:
              'radial-gradient(ellipse 60% 42% at 50% 34%, color-mix(in srgb, var(--accent) 13%, transparent), transparent 70%)',
          }}
        />
        <div className="relative max-w-3xl mx-auto px-4 py-16 min-h-dvh flex flex-col items-center justify-center text-center">
          <div className="flex items-center gap-2 mb-8">
            <YeetfulMark size={18} />
            <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
              Intent link{agent ? ` · from ${agent}` : ''}
            </span>
          </div>
          <h1
            className="text-[clamp(1.9rem,4.6vw,3.2rem)] leading-[1.12] font-medium text-[color:var(--fg)] max-w-2xl [text-wrap:balance]"
            style={{ fontFamily: 'var(--font-serif)' }}
          >
            &ldquo;{ask}&rdquo;
          </h1>

          <div className="mt-10 grid grid-cols-1 sm:grid-cols-3 gap-3 w-full max-w-2xl text-left">
            {CONTRACT.map((c) => (
              <div
                key={c.title}
                className="rounded-2xl border border-[var(--line)] bg-[color-mix(in_srgb,var(--surf-1)_72%,transparent)] backdrop-blur-sm px-4 py-4"
              >
                <c.icon className="w-4 h-4 mb-2.5" style={{ color: 'var(--accent)' }} />
                <p className="text-[12.5px] font-semibold text-[color:var(--fg)]">{c.title}</p>
                <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--muted)]">{c.body}</p>
              </div>
            ))}
          </div>

          <div className="mt-10">
            {isConnected ? (
              <button type="button" onClick={() => setStarted(true)} className={ctaClass}>
                {ctaLabel}
              </button>
            ) : cdpEnabled ? (
              // The unified sign-in door — wallet, Google, or email — landing
              // right back on this link (sign-in UX contract, CLAUDE.md).
              <CreateAccountButton className={ctaClass} label={ctaLabel} redirectTo={hereHref()} />
            ) : (
              <button type="button" onClick={() => openConnectModal?.()} className={ctaClass}>
                {ctaLabel}
              </button>
            )}
          </div>
          <p className="text-[12px] text-[color:var(--muted-2)] mt-4 max-w-md">
            Connecting runs the scan and the build for your wallet — signing stays yours
            {transferShaped ? '. This ask involves a transfer, so nothing runs until you press send.' : '.'}
          </p>
          {hasCreator && (
            <p className="mono text-[11px] text-[color:var(--muted-2)] mt-10 pt-4 border-t border-[var(--line)] max-w-md">
              The creator of this link earns half of Yeetful&apos;s 0.20% conversion fee. Sales,
              transfers, and bridges are always fee-free.
            </p>
          )}
        </div>
      </main>
    )
  }

  if (blocked) {
    return (
      <main className="min-h-dvh max-w-xl mx-auto px-4 py-12 flex flex-col justify-center">
        <div className="flex items-center gap-2 mb-8">
          <YeetfulMark size={18} />
          <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
            Intent link{agent ? ` · from ${agent}` : ''}
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
    <div className="relative h-dvh flex flex-col overflow-hidden">
      <div
        aria-hidden
        className="absolute inset-x-0 top-0 h-64 pointer-events-none"
        style={{
          background:
            'radial-gradient(ellipse 70% 100% at 50% 0%, color-mix(in srgb, var(--accent) 8%, transparent), transparent 70%)',
        }}
      />
      {/* Waiting-for-signature takeover: a connected wallet with no SIWE
          session has an open (or missed) signature request — without this,
          the page reads as stalled. Approving proves ownership; nothing
          moves. Dismissable: the guest lane still works underneath. */}
      {needsSignIn && !sigDismissed && (
        <div className="absolute inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm px-6">
          <div className="relative max-w-sm w-full rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] px-6 py-7 text-center">
            <button
              type="button"
              onClick={() => setSigDismissed(true)}
              aria-label="Continue without signing in"
              className="absolute top-3 right-3 p-1 rounded-md text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
            >
              <X className="w-4 h-4" />
            </button>
            <div className="mx-auto w-10 h-10 grid place-items-center rounded-full bg-[color-mix(in_srgb,var(--accent)_16%,transparent)] mb-4">
              {signingIn ? (
                <Loader2 className="w-5 h-5 animate-spin" style={{ color: 'var(--accent)' }} />
              ) : (
                <PenLine className="w-5 h-5" style={{ color: 'var(--accent)' }} />
              )}
            </div>
            <h2 className="text-[17px] font-semibold text-[color:var(--fg)]">
              {signingIn ? 'Waiting for your signature…' : 'One signature to continue'}
            </h2>
            <p className="mt-2 text-[13px] leading-relaxed text-[color:var(--muted)]">
              {signingIn
                ? 'The request is open in your wallet — approving it just proves you own this address. Nothing moves, nothing spends.'
                : 'Your wallet needs to sign one message to finish signing in. It proves ownership — nothing moves, nothing spends.'}
            </p>
            <button
              type="button"
              onClick={() => void signIn()}
              disabled={signingIn}
              className="btn btn--solid mt-5 inline-flex items-center justify-center gap-2 text-[13px] disabled:opacity-60"
            >
              {signingIn ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" /> Waiting…
                </>
              ) : (
                <>
                  <PenLine className="w-4 h-4" /> Open the signature request
                </>
              )}
            </button>
          </div>
        </div>
      )}
      <header className="relative flex-shrink-0 border-b border-[var(--line)] bg-[color-mix(in_srgb,var(--bg)_82%,transparent)] backdrop-blur">
        <div className="max-w-5xl w-full mx-auto px-4 sm:px-6 py-3">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3 min-w-0">
              <YeetfulMark size={18} />
              <div className="min-w-0">
                <p className="mono text-[10px] uppercase tracking-widest text-[color:var(--muted-2)] leading-none">
                  Intent link{agent ? ` · from ${agent}` : ''}
                </p>
                <p
                  className="mt-1 text-[15px] leading-tight text-[color:var(--fg)] truncate"
                  style={{ fontFamily: 'var(--font-serif)' }}
                >
                  &ldquo;{ask}&rdquo;
                </p>
              </div>
            </div>
            {signed && returnHref && redirectHost && (
              <a
                href={returnHref}
                className="btn btn--solid inline-flex items-center gap-1.5 text-[13px] flex-shrink-0"
              >
                Return to {redirectHost} <ArrowRight className="w-3.5 h-3.5" />
              </a>
            )}
          </div>
          {transferShaped && (
            <p className="mt-2 text-[12px] text-amber-400">
              This ask involves a transfer — review it in the composer and press send yourself.
            </p>
          )}
        </div>
      </header>
      <div className="relative flex-1 max-w-5xl w-full mx-auto px-4 sm:px-6 min-h-0">
        <ChatInterface simple injectedPrompt={prompt} onEmbedEvent={onTurnEvent} intentLinkSlug={slug} />
      </div>
      {signed && returnHref && redirectHost && (
        <div className="sticky bottom-0 border-t border-[var(--line)] bg-[var(--bg)]/95 backdrop-blur px-4 py-3">
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
