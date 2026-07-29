'use client'

// The mint card — ask, dapp picker, return URL, and the partner-promo limits
// (expiry / sign cap / allowlist). Extracted from /dashboard/links so the
// same form can open from other surfaces (the chat rail's Links tab); every
// consumer mints through the same POST /api/intent-links door.

import { useEffect, useState } from 'react'
import { Plus, Sparkles } from 'lucide-react'
import { MINTABLE_MCPS, composeMcps } from '@/lib/intent-links'
import { getProtocolMark } from '@/components/protocol-marks'

/** The vendored brand glyph for a mintable MCP, sized for a picker chip.
 *  Marks render in `currentColor`, so they inherit whatever the chip's text
 *  color is — same hue selected or not, by construction. Landscape marks
 *  (CoW, Aave) center inside the fixed box so labels stay aligned. */
function McpMark({ slug, label, size = 14 }: { slug: string; label: string; size?: number }) {
  const Mark = getProtocolMark(slug, label)
  if (!Mark) return null
  return (
    <span className="inline-flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <Mark size={size} />
    </span>
  )
}

/** Keep only mintable slugs, capped at the picker's 4 — same rule the
 *  query-prefill path applies. */
function sanitizePicks(slugs: string[]): string[] {
  const known = new Set(MINTABLE_MCPS.map((x) => x.slug))
  return slugs.map((s) => s.trim()).filter((s) => known.has(s)).slice(0, 4)
}

export function MintLinkForm({
  readQueryPrefill,
  initialAsk,
  initialMcps,
  externalError,
  onMinted,
  className,
}: {
  /** Read the chat handoff (?ask= + ?mcps=) from the URL once on mount —
   *  the dashboard page's contract with ~10 prefill call sites. */
  readQueryPrefill?: boolean
  /** Direct prefill for non-URL surfaces (the rail's mint modal). */
  initialAsk?: string
  initialMcps?: string[]
  /** A load-level error (the 401 sign-in line) shown in the mint card's
   *  error slot when the form itself hasn't errored. */
  externalError?: string | null
  /** Fires after a successful mint with the new link — surfaces that want a
   *  "here's your link" moment (the rail's mint modal) read it; the
   *  dashboard just reloads its table and ignores the payload. */
  onMinted?: (link: { slug: string; url: string; ask: string }) => void
  className?: string
}) {
  const [ask, setAsk] = useState(() => (initialAsk ?? '').slice(0, 400))
  const [redirectUrl, setRedirectUrl] = useState('')
  // Partner-promo limits — all optional, validated server-side at mint.
  const [expiresAt, setExpiresAt] = useState('')
  const [maxSigns, setMaxSigns] = useState('')
  const [allowText, setAllowText] = useState('')
  const [minting, setMinting] = useState(false)
  const [mintError, setMintError] = useState<string | null>(null)
  // Dapp attachment: the picker is the one surface — chips always visible,
  // creator picks up to 4. "Decide for me" reads the ask and lights up the
  // suggested set (composeMcps — same rules the mint API falls back to when
  // nothing is picked). A chat handoff (?ask= + ?mcps=) arrives with the
  // working set that produced the aha already lit.
  const [pickedMcps, setPickedMcps] = useState<string[]>(() => sanitizePicks(initialMcps ?? []))

  // Prefill from the chat's "create intent link" handoff — read once.
  useEffect(() => {
    if (!readQueryPrefill) return
    const sp = new URLSearchParams(window.location.search)
    const a = sp.get('ask')
    if (a) setAsk(a.slice(0, 400))
    const m = sp.get('mcps')
    if (m) {
      const picked = sanitizePicks(m.split(','))
      if (picked.length) setPickedMcps(picked)
    }
  }, [readQueryPrefill])

  const togglePick = (slug: string) =>
    setPickedMcps((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : cur.length >= 4 ? cur : [...cur, slug]))

  const mint = async () => {
    if (minting || ask.trim().length < 8) return
    setMinting(true)
    setMintError(null)
    try {
      const res = await fetch('/api/intent-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ask: ask.trim(),
          redirectUrl: redirectUrl.trim() || undefined,
          mcps: pickedMcps.length ? pickedMcps : undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          maxSigns: maxSigns.trim() ? Number(maxSigns) : undefined,
          allowWallets: allowText.trim()
            ? allowText
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMintError(data.error ?? 'Mint failed.')
        return
      }
      const minted = ask.trim()
      setAsk('')
      setRedirectUrl('')
      setExpiresAt('')
      setMaxSigns('')
      setAllowText('')
      onMinted?.({ slug: String(data.slug), url: String(data.url), ask: minted })
    } finally {
      setMinting(false)
    }
  }

  const error = mintError ?? externalError ?? null

  return (
    <div className={`rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-4${className ? ` ${className}` : ''}`}>
      <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
        The ask (a plain sentence, amounts included)
      </label>
      <textarea
        value={ask}
        onChange={(e) => setAsk(e.target.value)}
        placeholder='e.g. "Buy $12 of AAPL" · "DCA $25 into ETH weekly" · "Stake 0.05 ETH with Lido"'
        rows={2}
        maxLength={400}
        className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
      />
      <div className="mt-3 flex items-center gap-2">
        <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">Dapps</span>
        <button
          type="button"
          onClick={() => setPickedMcps(composeMcps(ask))}
          disabled={ask.trim().length < 8}
          title={ask.trim().length < 8 ? 'Type the ask first — the suggestion reads it' : 'Suggest dapps from the ask'}
          className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] text-[12px] text-[color:var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[color:var(--fg)] disabled:opacity-50 disabled:hover:border-[var(--line)] disabled:hover:text-[color:var(--muted)]"
        >
          <Sparkles className="w-3.5 h-3.5" /> Decide for me
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        {/* Chip content keeps ONE color whether picked or not — the mark
            renders in currentColor so logo + label always match; selection
            reads from the accent border + tint, never a text-color flip.
            (Tint via color-mix: Tailwind's `/10` on a CSS-var color
            silently paints transparent.) */}
        {MINTABLE_MCPS.map((m) => (
          <button
            key={m.slug}
            type="button"
            onClick={() => togglePick(m.slug)}
            aria-pressed={pickedMcps.includes(m.slug)}
            className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] text-[color:var(--fg)] transition-colors ${
              pickedMcps.includes(m.slug)
                ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]'
                : 'border-[var(--line)] hover:border-[var(--line-2)] hover:bg-[color-mix(in_srgb,var(--fg)_6%,transparent)]'
            }`}
          >
            <McpMark slug={m.slug} label={m.label} />
            {m.label}
          </button>
        ))}
        <span className="text-[11px] text-[color:var(--muted-2)] self-center ml-1">up to 4</span>
      </div>
      {pickedMcps.length === 0 && (
        <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">
          None picked — the link decides from the ask at mint. &ldquo;Decide for me&rdquo; previews
          that pick: NFTs pull OpenSea, swaps pull Uniswap, stock tickers pull Robinhood, and
          NEAR Intents rides along for bridging.
        </p>
      )}

      <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-3 block">
        Return URL after signing (optional, https — e.g. your site)
      </label>
      <input
        value={redirectUrl}
        onChange={(e) => setRedirectUrl(e.target.value)}
        placeholder="https://yoursite.com/thanks"
        className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
      />
      {/* Partner-promo limits: expiry, sign cap, wallet allowlist — the
          knobs a big-partner promo needs ("dies after 1000 signs"). */}
      <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
        <div>
          <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] block">
            Expires (optional)
          </label>
          <input
            type="datetime-local"
            value={expiresAt}
            onChange={(e) => setExpiresAt(e.target.value)}
            className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
        <div>
          <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] block">
            Max signs (optional — server-truth count)
          </label>
          <input
            type="number"
            min={1}
            value={maxSigns}
            onChange={(e) => setMaxSigns(e.target.value)}
            placeholder="e.g. 1000"
            className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
          />
        </div>
      </div>
      <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-3 block">
        Wallet allowlist (optional — one 0x address per line; the list never appears on the page)
      </label>
      <textarea
        value={allowText}
        onChange={(e) => setAllowText(e.target.value)}
        placeholder="0x…"
        rows={2}
        className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm mono text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
      />

      <div className="mt-3 flex items-center gap-3">
        <button
          type="button"
          onClick={() => void mint()}
          disabled={minting || ask.trim().length < 8}
          className="btn btn--solid inline-flex items-center gap-1.5 text-[13px] disabled:opacity-50"
        >
          <Plus className="w-4 h-4" /> {minting ? 'Minting…' : 'Mint link'}
        </button>
        {error && <span className="text-[13px] text-amber-400">{error}</span>}
      </div>
    </div>
  )
}
