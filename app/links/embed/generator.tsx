'use client'

// The host button generator form. Mints an intent link through the same
// POST /api/intent-links door as the dashboard (SIWE-gated, ask sanitized,
// redirect validated https at mint, MCP set composed server-side) and emits
// the copy-paste snippet. The snippet is a plain <a> — no script, no iframe:
// the button IS the intent link, so every runtime invariant (consent button,
// transfer asks never auto-run, server-stored redirect) rides along free.

import { useState } from 'react'
import { Check, Copy, Plus } from 'lucide-react'
import { composeMcps, MINTABLE_MCPS } from '@/lib/intent-links'

interface Minted {
  slug: string
  ask: string
  redirectUrl: string | null
}

/** The snippet a host pastes — inline styles only, so it renders the same on
 *  any site with zero CSS dependencies. */
function buttonSnippet(origin: string, minted: Minted, label: string, badge: boolean): string {
  const a = `<a href="${origin}/i/${minted.slug}" style="display:inline-flex;align-items:center;gap:8px;padding:11px 20px;border-radius:999px;background:#0a0a0a;color:#fff;font:600 14px/1.1 system-ui,-apple-system,sans-serif;text-decoration:none;border:1px solid rgba(255,255,255,.14)">${label
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')}</a>`
  if (!badge) return a
  return `<div style="display:inline-flex;flex-direction:column;align-items:center;gap:6px">\n  ${a}\n  <span style="font:500 10.5px/1.2 ui-monospace,monospace;letter-spacing:.04em;color:#8a8a8a">NON-CUSTODIAL · THEIR WALLET SIGNS · PANTESSA</span>\n</div>`
}

export default function ButtonGenerator() {
  const [ask, setAsk] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [label, setLabel] = useState('')
  const [badge, setBadge] = useState(true)
  const [minting, setMinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [minted, setMinted] = useState<Minted | null>(null)
  const [copied, setCopied] = useState<'snippet' | 'url' | null>(null)

  const effectiveLabel = label.trim() || (ask.trim() ? `${ask.trim()} →` : 'Your button')
  const autoPreview = composeMcps(ask)

  const mint = async () => {
    if (minting || ask.trim().length < 8) return
    setMinting(true)
    setError(null)
    try {
      const res = await fetch('/api/intent-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ ask: ask.trim(), redirectUrl: redirectUrl.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(
          res.status === 401
            ? 'Sign in with your wallet (top right) to mint — the link is yours, so are its conversions.'
            : (data.error ?? 'Mint failed.'),
        )
        return
      }
      setMinted({ slug: data.slug, ask: data.ask, redirectUrl: data.redirectUrl ?? null })
    } catch {
      setError('Network hiccup — try again.')
    } finally {
      setMinting(false)
    }
  }

  const copy = (what: 'snippet' | 'url') => {
    if (!minted) return
    const origin = window.location.origin
    const text = what === 'snippet' ? buttonSnippet(origin, minted, effectiveLabel, badge) : `${origin}/i/${minted.slug}`
    void navigator.clipboard.writeText(text).then(() => {
      setCopied(what)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div className="space-y-6">
      {/* the form */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-4">
        <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
          The ask (a plain sentence, amounts included)
        </label>
        <textarea
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder='e.g. "Buy $10 of AAPL" · "Stake 0.05 ETH with Lido" · "DCA $25 into ETH weekly"'
          rows={2}
          maxLength={400}
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
        />
        {ask.trim().length >= 8 && (
          <p className="mt-1.5 text-[12px] text-[color:var(--muted-2)]">
            The link will carry:{' '}
            {autoPreview.map((slug) => (
              <span key={slug} className="mono text-[11px] text-[color:var(--accent)] mr-1.5">
                {MINTABLE_MCPS.find((m) => m.slug === slug)?.label ?? slug}
              </span>
            ))}
          </p>
        )}

        <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-4 block">
          Return URL after signing (https — your site)
        </label>
        <input
          value={redirectUrl}
          onChange={(e) => setRedirectUrl(e.target.value)}
          placeholder="https://yoursite.com/thanks"
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
        />
        <p className="mt-1.5 text-[12px] text-[color:var(--muted-2)]">
          Validated and stored at mint — after a visitor signs, they get a &ldquo;Return to{' '}
          {(() => {
            try {
              return new URL(redirectUrl).hostname
            } catch {
              return 'your site'
            }
          })()}
          &rdquo; button. Never automatic, never read from the URL.
        </p>

        <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-4 block">
          Button label (optional)
        </label>
        <input
          value={label}
          onChange={(e) => setLabel(e.target.value)}
          placeholder={ask.trim() ? `${ask.trim()} →` : 'Buy $10 of AAPL on ours →'}
          maxLength={80}
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
        />

        <div className="mt-4 flex items-center gap-4">
          <button
            type="button"
            onClick={() => void mint()}
            disabled={minting || ask.trim().length < 8}
            className="btn btn--solid inline-flex items-center gap-1.5 text-[13px] disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> {minting ? 'Minting…' : 'Mint the button'}
          </button>
          <label className="inline-flex items-center gap-2 text-[13px] text-[color:var(--muted)] cursor-pointer">
            <input type="checkbox" checked={badge} onChange={(e) => setBadge(e.target.checked)} className="accent-[var(--accent)]" />
            Include the trust badge
          </label>
        </div>
        {error && <p className="mt-3 text-[13px] text-amber-400">{error}</p>}
      </div>

      {/* the output */}
      {minted && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-4">
          <div className="flex items-center justify-between gap-3 mb-3">
            <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">Preview</span>
            <button
              type="button"
              onClick={() => copy('url')}
              className="inline-flex items-center gap-1.5 mono text-[12px] text-[color:var(--accent)] hover:underline"
            >
              {copied === 'url' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
              /i/{minted.slug}
            </button>
          </div>

          {/* live preview — same inline styles the snippet ships */}
          <div className="rounded-lg border border-dashed border-[var(--line-2)] bg-[var(--bg)] p-6 grid place-items-center">
            <div className="inline-flex flex-col items-center gap-1.5">
              <a
                href={`/i/${minted.slug}`}
                target="_blank"
                rel="noopener noreferrer"
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 8,
                  padding: '11px 20px',
                  borderRadius: 999,
                  background: '#0a0a0a',
                  color: '#fff',
                  font: '600 14px/1.1 system-ui, -apple-system, sans-serif',
                  textDecoration: 'none',
                  border: '1px solid rgba(255,255,255,.14)',
                }}
              >
                {effectiveLabel}
              </a>
              {badge && (
                <span className="mono text-[10.5px] tracking-wider text-[color:var(--muted-2)]">
                  NON-CUSTODIAL · THEIR WALLET SIGNS · PANTESSA
                </span>
              )}
            </div>
          </div>

          <div className="mt-3">
            <div className="flex items-center justify-between gap-3 mb-1.5">
              <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
                Copy-paste snippet (plain HTML, no script)
              </span>
              <button
                type="button"
                onClick={() => copy('snippet')}
                className="inline-flex items-center gap-1.5 mono text-[12px] text-[color:var(--accent)] hover:underline"
              >
                {copied === 'snippet' ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                copy
              </button>
            </div>
            <pre className="rounded-lg border border-[var(--line)] bg-[var(--bg)] p-3 text-[11.5px] mono text-[color:var(--muted)] overflow-x-auto whitespace-pre-wrap break-all">
              {buttonSnippet(typeof window === 'undefined' ? '' : window.location.origin, minted, effectiveLabel, badge)}
            </pre>
            <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">
              Track opens, connects, builds, and signs — and what you earned on conversions — on{' '}
              <a href="/dashboard/links" className="text-[color:var(--accent)] hover:underline">
                your links dashboard
              </a>
              .
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
