'use client'

import { useEffect, useRef, useState } from 'react'
import { CircleDollarSign, Check, PenLine, Copy } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { RouterTraceEvent } from '@/lib/store'

/**
 * The routing-engine trace renderer — the single source of truth for how a
 * routed turn's reasoning looks. Shared by BOTH the chat engine window
 * (RouterEngineWindow) and the public Activity live feed (LiveRoutingFeed), so
 * any improvement to a trace line shows up on both pages. Purely presentational:
 * give it a RouterTraceEvent[] and it renders the terminal body.
 */
export default function RouteTraceTerminal({
  trace,
  emptyHint,
  autoscroll = true,
  className,
}: {
  trace: RouterTraceEvent[]
  emptyHint?: React.ReactNode
  autoscroll?: boolean
  className?: string
}) {
  const bodyRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    if (autoscroll) bodyRef.current?.scrollTo({ top: bodyRef.current.scrollHeight, behavior: 'smooth' })
  }, [trace.length, autoscroll])

  return (
    <div ref={bodyRef} className={cn('overflow-y-auto px-3 py-3 mono text-[11px] leading-relaxed', className)}>
      {trace.length === 0 ? (
        <p className="text-[color:var(--muted-2)]">
          {emptyHint ?? (
            <>
              <span style={{ color: 'var(--accent)' }}>$</span> idle — send a message and the engine&apos;s routing
              decisions stream here.
            </>
          )}
        </p>
      ) : (
        <div className="space-y-1.5">
          {trace.map((e, i) => (
            <TraceLine key={i} event={e} />
          ))}
          <span className="inline-block w-1.5 h-3 align-middle animate-pulse" style={{ background: 'var(--accent)' }} />
        </div>
      )}
    </div>
  )
}

/** A copy-to-clipboard affordance for error lines — so a failure can be grabbed
 *  verbatim and pasted into a debug thread. */
function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)
  return (
    <button
      type="button"
      onClick={() => {
        navigator.clipboard?.writeText(text).then(
          () => {
            setCopied(true)
            setTimeout(() => setCopied(false), 1200)
          },
          () => {},
        )
      }}
      title="Copy error"
      aria-label="Copy error"
      className="ml-1 inline-flex items-center align-middle opacity-60 hover:opacity-100 transition-opacity"
    >
      {copied ? <Check className="w-3 h-3" strokeWidth={3} /> : <Copy className="w-3 h-3" />}
    </button>
  )
}

/** Shorten a URL to host + a trimmed path for the dense terminal rows. */
function shortEndpoint(url?: string): string {
  if (!url) return ''
  try {
    const u = new URL(url)
    const path = u.pathname.length > 22 ? u.pathname.slice(0, 21) + '…' : u.pathname
    return u.host + (path === '/' ? '' : path)
  } catch {
    return url
  }
}

export function TraceLine({ event }: { event: RouterTraceEvent }) {
  switch (event.type) {
    case 'status':
      return (
        <p className="text-[color:var(--muted)]">
          <span className="text-[color:var(--muted-2)]">▸</span> {event.label}
        </p>
      )
    case 'analyze':
      return (
        <div className="text-[color:var(--fg)]">
          <p>
            <span style={{ color: 'var(--accent)' }}>◆ intent</span> {event.intent}
          </p>
          {event.needs.length > 0 && (
            <ul className="mt-0.5 pl-3 text-[color:var(--muted)]">
              {event.needs.map((n, i) => (
                <li key={i}>· {n}</li>
              ))}
            </ul>
          )}
        </div>
      )
    case 'shortlist':
      return (
        <div className="text-[color:var(--muted)]">
          <p>
            <span style={{ color: 'var(--accent)' }}>≡ shortlisted</span> {event.candidates.length} relevant{' '}
            {event.candidates.length === 1 ? 'tool' : 'tools'}:
          </p>
          <ul className="mt-0.5 pl-3 [overflow-wrap:anywhere]">
            {event.candidates.slice(0, 12).map((c, i) => (
              <li key={i} className="text-[color:var(--muted-2)]">
                · {c.service}
                {c.endpoint ? <span> {shortEndpoint(c.endpoint)}</span> : null}
                {c.priceUsd ? <span> ${c.priceUsd}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      )
    case 'candidate':
      return (
        <p className="text-[color:var(--muted)] [overflow-wrap:anywhere]">
          <span className="text-[color:var(--muted-2)]">·</span> {event.service}
          {event.endpoint ? <span className="text-[color:var(--muted-2)]"> {shortEndpoint(event.endpoint)}</span> : null}
          {event.priceUsd ? <span className="text-[color:var(--muted-2)]"> ${event.priceUsd}</span> : null}
          {event.proven && event.proven > 0 ? (
            <span style={{ color: 'var(--accent)' }}>
              {' '}✓proven({event.proven}
              {typeof event.successRate === 'number' ? ` · ${Math.round(event.successRate * 100)}%` : ''})
            </span>
          ) : null}
          <span className="text-[color:var(--muted-2)]"> ({Math.round(event.score * 100)}%)</span>
          {event.reason ? ` — ${event.reason}` : ''}
        </p>
      )
    case 'select':
      return (
        <p className="text-white [overflow-wrap:anywhere]">
          <span style={{ color: 'var(--accent)' }}>✓ selected</span> {event.service}
          {event.endpoint ? <span className="text-[color:var(--muted)]"> {shortEndpoint(event.endpoint)}</span> : null}
          {event.priceUsd ? <span className="text-[color:var(--muted)]"> ${event.priceUsd}</span> : null}
          {event.reason ? <span className="text-[color:var(--muted)]"> — {event.reason}</span> : null}
        </p>
      )
    case 'pay':
      return (
        <p className="text-[color:var(--muted)]">
          <CircleDollarSign className="inline w-3 h-3 -mt-0.5 mr-0.5" /> paying {event.service}{' '}
          <span className="text-[color:var(--muted-2)]">({event.host})</span> ${event.priceUsd}…
        </p>
      )
    case 'receipt': {
      const r = event.receipt
      if (r.ok) {
        return (
          <p className="[overflow-wrap:anywhere]" style={{ color: 'var(--accent)' }}>
            <Check className="inline w-3 h-3 -mt-0.5 mr-0.5" strokeWidth={3} /> settled {r.name} ${r.priceUsd ?? ''}
            {r.txHash ? (
              <>
                {' · '}
                <a
                  href={`https://basescan.org/tx/${r.txHash}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="text-[color:var(--muted)] underline decoration-dotted underline-offset-2 hover:text-white"
                  title="View on BaseScan"
                >
                  {r.txHash.slice(0, 10)}…
                </a>
              </>
            ) : null}
          </p>
        )
      }
      return (
        <p className="text-[#ff6b6b] [overflow-wrap:anywhere]">
          ✗ {r.name} — {r.note ?? 'failed'}
          <CopyButton text={`${r.name} — ${r.note ?? 'failed'}`} />
        </p>
      )
    }
    case 'tool': {
      const mark = event.status === 'ok' ? '✓' : event.status === 'error' ? '✗' : '⋯'
      const color = event.status === 'ok' ? 'var(--accent)' : event.status === 'error' ? '#ff6b6b' : 'var(--muted)'
      return (
        <p className="[overflow-wrap:anywhere]" style={{ color }}>
          <span className="text-[color:var(--muted-2)]">⚙</span> {event.name} <span>{mark}</span>
          {event.detail ? <span className="text-[color:var(--muted)]"> {event.detail}</span> : null}
        </p>
      )
    }
    case 'eip712':
      return (
        <p className="text-white [overflow-wrap:anywhere]">
          <PenLine className="inline w-3 h-3 -mt-0.5 mr-0.5" style={{ color: 'var(--accent)' }} />
          <span style={{ color: 'var(--accent)' }}>sign {event.scheme.toUpperCase()}</span>{' '}
          <span className="text-[color:var(--muted)]">{event.summary}</span>
          <span className="text-[color:var(--muted-2)]"> · {event.signer}</span>
        </p>
      )
    case 'note':
      return (
        <p className="[overflow-wrap:anywhere]" style={{ color: event.level === 'warn' ? '#f4b740' : 'var(--muted-2)' }}>
          <span>{event.level === 'warn' ? '⚠' : 'ℹ'}</span> {event.label}
        </p>
      )
    case 'error':
      return (
        <p className="text-[#ff6b6b] [overflow-wrap:anywhere]">
          ✗ error — {event.message}
          <CopyButton text={`error — ${event.message}`} />
        </p>
      )
    default:
      return null
  }
}
