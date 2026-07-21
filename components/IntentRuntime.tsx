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
import { ArrowRight, ExternalLink, ShieldCheck, Zap } from 'lucide-react'
import ChatInterface from '@/components/ChatInterface'
import { YeetfulMark } from '@/components/Logo'
import { isTransferShaped } from '@/lib/intent-links'
import { useYeetfulStore, McpServer } from '@/lib/store'
import { CATALOG } from '@/lib/mcp-data'
import { FREE_FLEET_FALLBACK } from '@/lib/free-fleet'

const STATIC_SERVERS: McpServer[] = [...FREE_FLEET_FALLBACK, ...CATALOG]

const CONTRACT = [
  'Yeetful rebuilds this ask from scratch with deterministic builders — no AI writes the calldata, and a link can never smuggle a transaction.',
  'Every build is guarded fail-closed, priced in dollars, and receipted.',
  'Your wallet is the only thing that can sign. Close the tab and nothing happens.',
]

export default function IntentRuntime({
  slug,
  ask,
  mcps,
  agent,
  redirectUrl,
}: {
  slug: string
  ask: string
  mcps: string
  agent: string
  redirectUrl: string
}) {
  const { address, isConnected } = useAccount()
  const { openConnectModal } = useConnectModal()
  const { servers, setServers, setActiveServerIds } = useYeetfulStore()

  const [started, setStarted] = useState(false)
  const [signed, setSigned] = useState(false)
  const [prompt, setPrompt] = useState<{ text: string; send: boolean; at: number } | null>(null)
  const transferShaped = isTransferShaped(ask)

  // Best-effort funnel events — never block or throw into the runtime.
  const posted = useRef(new Set<string>())
  const postEvent = (kind: string, extra?: { valueUsd?: number }) => {
    const once = kind === 'open' || kind === 'connect'
    if (once && posted.current.has(kind)) return
    posted.current.add(kind)
    void fetch(`/api/intent-links/${slug}/events`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ kind, wallet: address, ...extra }),
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
  // press of send.
  useEffect(() => {
    if (!isConnected || started) return
    setStarted(true)
    postEvent('connect')
    setPrompt({ text: ask, send: !transferShaped, at: Date.now() })
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
    return (
      <main className="min-h-[calc(100vh-4rem)] max-w-xl mx-auto px-4 py-12 flex flex-col">
        <div className="flex items-center gap-2 mb-8">
          <YeetfulMark size={18} />
          <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
            Intent link{agent ? ` · from ${agent}` : ''}
          </span>
        </div>
        <blockquote className="text-2xl leading-snug font-medium text-[color:var(--fg)] border-l-2 border-[var(--accent)] pl-4 mb-8">
          &ldquo;{ask}&rdquo;
        </blockquote>
        <ul className="space-y-3 mb-9">
          {CONTRACT.map((line) => (
            <li key={line} className="flex gap-3 items-start">
              <ShieldCheck className="w-4 h-4 mt-0.5 flex-shrink-0" style={{ color: 'var(--accent)' }} />
              <p className="text-[13px] leading-relaxed text-[color:var(--muted)]">{line}</p>
            </li>
          ))}
        </ul>
        <button
          type="button"
          onClick={() => (isConnected ? setStarted(true) : openConnectModal?.())}
          className="btn btn--solid inline-flex items-center justify-center gap-2 self-start"
        >
          <Zap className="w-4 h-4" /> Connect &amp; build my path
        </button>
        <p className="text-[12px] text-[color:var(--muted-2)] mt-3">
          Connecting runs the scan and the build for your wallet — signing stays yours
          {transferShaped ? '. This ask involves a transfer, so nothing runs until you press send.' : '.'}
        </p>
      </main>
    )
  }

  return (
    <div className="min-h-[calc(100vh-4rem)] flex flex-col">
      <div className="max-w-3xl w-full mx-auto px-4 pt-6 pb-2">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2 min-w-0">
            <YeetfulMark size={16} />
            <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)] truncate">
              {ask}
            </span>
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
      <div className="flex-1 max-w-3xl w-full mx-auto px-4 pb-4 min-h-0">
        <ChatInterface injectedPrompt={prompt} onEmbedEvent={onTurnEvent} />
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
