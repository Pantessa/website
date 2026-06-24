// Read-only routing-trace render (B16/B23). Server-renderable (no hooks/store,
// native <details> for collapse), so it works on the public /p/[slug] share
// page as well as anywhere a stored Message.meta.routerTrace exists. Styled like
// the live engine window (monospace terminal), text glyphs only (no icon deps).

import type { RouterTraceEvent } from '@/lib/store'

const ACCENT = 'var(--accent)'

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

function Line({ event }: { event: RouterTraceEvent }) {
  switch (event.type) {
    case 'status':
      return <p className="text-[color:var(--muted)]"><span className="text-[color:var(--muted-2)]">▸</span> {event.label}</p>
    case 'analyze':
      return (
        <div className="text-[color:var(--fg)]">
          <p><span style={{ color: ACCENT }}>◆ intent</span> {event.intent}</p>
          {event.needs.length > 0 && (
            <ul className="mt-0.5 pl-3 text-[color:var(--muted)]">{event.needs.map((n, i) => <li key={i}>· {n}</li>)}</ul>
          )}
        </div>
      )
    case 'shortlist':
      return (
        <div className="text-[color:var(--muted)]">
          <p><span style={{ color: ACCENT }}>≡ shortlisted</span> {event.candidates.length}:</p>
          <ul className="mt-0.5 pl-3 text-[color:var(--muted-2)]">
            {event.candidates.slice(0, 12).map((c, i) => (
              <li key={i}>· {c.service}{c.endpoint ? ` ${shortEndpoint(c.endpoint)}` : ''}{c.priceUsd ? ` $${c.priceUsd}` : ''}</li>
            ))}
          </ul>
        </div>
      )
    case 'candidate':
      return (
        <p className="text-[color:var(--muted)]">
          <span className="text-[color:var(--muted-2)]">·</span> {event.service}
          {event.endpoint ? <span className="text-[color:var(--muted-2)]"> {shortEndpoint(event.endpoint)}</span> : null}
          {event.priceUsd ? <span className="text-[color:var(--muted-2)]"> ${event.priceUsd}</span> : null}
          {event.proven && event.proven > 0 ? <span style={{ color: ACCENT }}> ✓proven({event.proven}{typeof event.successRate === 'number' ? ` · ${Math.round(event.successRate * 100)}%` : ''})</span> : null}
          <span className="text-[color:var(--muted-2)]"> ({Math.round(event.score * 100)}%)</span>
          {event.reason ? ` — ${event.reason}` : ''}
        </p>
      )
    case 'select':
      return (
        <p className="text-white">
          <span style={{ color: ACCENT }}>✓ selected</span> {event.service}
          {event.endpoint ? <span className="text-[color:var(--muted)]"> {shortEndpoint(event.endpoint)}</span> : null}
          {event.priceUsd ? <span className="text-[color:var(--muted)]"> ${event.priceUsd}</span> : null}
          {event.reason ? <span className="text-[color:var(--muted)]"> — {event.reason}</span> : null}
        </p>
      )
    case 'pay':
      return <p className="text-[color:var(--muted)]">$ paying {event.service} <span className="text-[color:var(--muted-2)]">({event.host})</span> ${event.priceUsd}…</p>
    case 'receipt': {
      const r = event.receipt
      return r.ok ? (
        <p style={{ color: ACCENT }}>✓ settled {r.name} ${r.priceUsd ?? ''}{r.txHash ? <span className="text-[color:var(--muted)]"> · {r.txHash.slice(0, 10)}…</span> : null}</p>
      ) : (
        <p className="text-[#ff6b6b]">✗ {r.name} — {r.note ?? 'failed'}</p>
      )
    }
    case 'tool': {
      const mark = event.status === 'ok' ? '✓' : event.status === 'error' ? '✗' : '⋯'
      const color = event.status === 'ok' ? ACCENT : event.status === 'error' ? '#ff6b6b' : 'var(--muted)'
      return <p style={{ color }}><span className="text-[color:var(--muted-2)]">⚙</span> {event.name} {mark}{event.detail ? <span className="text-[color:var(--muted)]"> {event.detail}</span> : null}</p>
    }
    case 'eip712':
      return <p className="text-white"><span style={{ color: ACCENT }}>✎ sign {event.scheme.toUpperCase()}</span> <span className="text-[color:var(--muted)]">{event.summary}</span><span className="text-[color:var(--muted-2)]"> · {event.signer}</span></p>
    case 'note':
      return <p style={{ color: event.level === 'warn' ? '#f4b740' : 'var(--muted-2)' }}>{event.level === 'warn' ? '⚠' : 'ℹ'} {event.label}</p>
    case 'error':
      return <p className="text-[#ff6b6b]">✗ error — {event.message}</p>
    default:
      return null
  }
}

/** Renders Message.meta.routerTrace as a collapsible read-only terminal block. */
export default function RouterTraceLines({ meta }: { meta: unknown }) {
  if (!meta || typeof meta !== 'object') return null
  const trace = (meta as { routerTrace?: unknown }).routerTrace
  if (!Array.isArray(trace) || trace.length === 0) return null
  return (
    <details className="mt-2 text-[11px] mono [overflow-wrap:anywhere]">
      <summary className="cursor-pointer text-[color:var(--muted-2)] hover:text-white select-none">⚙ Routing trace ({trace.length} steps)</summary>
      <div className="mt-2 rounded-lg border border-[var(--line)] bg-black/40 p-3 space-y-1">
        {(trace as RouterTraceEvent[]).map((e, i) => (
          <Line key={i} event={e} />
        ))}
      </div>
    </details>
  )
}
