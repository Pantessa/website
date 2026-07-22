'use client'

// Dashboard · Intent links — mint short links that carry an ask, and watch
// each link's funnel: opens → connects → built → signed → dollars moved.
// The link is the ad; the funnel is the creator's scoreboard. Funnel values
// here are per-link telemetry (client-reported) — the global money-moved
// metric stays guardrail-priced in embed_turns and is NOT fed from this.

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, Plus, Sparkles, SlidersHorizontal } from 'lucide-react'
import { MINTABLE_MCPS, composeMcps } from '@/lib/intent-links'

interface LinkRow {
  slug: string
  url: string
  ask: string
  agent: string | null
  redirectUrl: string | null
  revoked: boolean
  createdAt: string
  expiresAt: string | null
  maxSigns: number | null
  allowCount: number
  /** Server-truth signed turns (embed_turns) — what the maxSigns cap counts. */
  signsCount: number
  funnel: { open: number; connect: number; built: number; signed: number; valueUsd: number }
  /** Server-truth signed notional attributed to this link (embed_turns). */
  signedUsd: number
  /** Creator's accrued half of the fee on fee-bearing conversions. */
  earnedUsd: number
}

interface Earnings {
  totalEarnedUsd: number
  claimedUsd: number
  claimableUsd: number
  minClaimUsd: number
}

export default function DashboardLinksPage() {
  const [links, setLinks] = useState<LinkRow[] | null>(null)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [claimMsg, setClaimMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  // Partner-promo limits — all optional, validated server-side at mint.
  const [expiresAt, setExpiresAt] = useState('')
  const [maxSigns, setMaxSigns] = useState('')
  const [allowText, setAllowText] = useState('')
  const [minting, setMinting] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  // MCP attachment: 'auto' = the composer decides from the ask (live preview
  // below the field); 'manual' = the creator picks up to 4. A chat handoff
  // (?ask= + ?mcps=) arrives in manual mode carrying the working set that
  // produced the aha.
  const [mcpMode, setMcpMode] = useState<'auto' | 'manual'>('auto')
  const [pickedMcps, setPickedMcps] = useState<string[]>([])

  // Prefill from the chat's "create intent link" handoff — read once.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const a = sp.get('ask')
    if (a) setAsk(a.slice(0, 400))
    const m = sp.get('mcps')
    if (m) {
      const known = new Set(MINTABLE_MCPS.map((x) => x.slug))
      const picked = m.split(',').map((s) => s.trim()).filter((s) => known.has(s)).slice(0, 4)
      if (picked.length) {
        setPickedMcps(picked)
        setMcpMode('manual')
      }
    }
  }, [])

  const autoPreview = composeMcps(ask)
  const togglePick = (slug: string) =>
    setPickedMcps((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : cur.length >= 4 ? cur : [...cur, slug]))

  const load = useCallback(() => {
    void fetch('/api/intent-links', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          setError('Sign in with your wallet to mint and track intent links.')
          return null
        }
        return r.json()
      })
      .then((d: { links: LinkRow[]; earnings?: Earnings } | null) => {
        if (d) {
          setLinks(d.links)
          setEarnings(d.earnings ?? null)
        }
      })
      .catch(() => setError('Could not load your links — try a refresh.'))
  }, [])
  useEffect(() => {
    load()
  }, [load])

  const mint = async () => {
    if (minting || ask.trim().length < 8) return
    setMinting(true)
    setError(null)
    try {
      const res = await fetch('/api/intent-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ask: ask.trim(),
          redirectUrl: redirectUrl.trim() || undefined,
          mcps: mcpMode === 'manual' && pickedMcps.length ? pickedMcps : undefined,
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
        setError(data.error ?? 'Mint failed.')
        return
      }
      setAsk('')
      setRedirectUrl('')
      setExpiresAt('')
      setMaxSigns('')
      setAllowText('')
      load()
    } finally {
      setMinting(false)
    }
  }

  const copy = (slug: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/i/${slug}`).then(() => {
      setCopied(slug)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-[color:var(--fg)] mb-1">Intent links</h1>
      <p className="text-sm text-[color:var(--muted)] mb-6 max-w-2xl">
        A short link that carries an ask. Whoever opens it connects a wallet and the path builds
        itself — swaps, stock buys, funding legs — with their wallet as the only signer. Share the
        link; this table is your funnel.
      </p>

      <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-4 mb-8">
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
          <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">MCPs</span>
          <div className="inline-flex rounded-lg border border-[var(--line)] overflow-hidden">
            <button
              type="button"
              onClick={() => setMcpMode('auto')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition-colors ${mcpMode === 'auto' ? 'bg-[var(--accent)] text-black font-semibold' : 'text-[color:var(--muted)] hover:text-white'}`}
            >
              <Sparkles className="w-3.5 h-3.5" /> Decide for me
            </button>
            <button
              type="button"
              onClick={() => setMcpMode('manual')}
              className={`inline-flex items-center gap-1.5 px-3 py-1.5 text-[12px] transition-colors ${mcpMode === 'manual' ? 'bg-[var(--accent)] text-black font-semibold' : 'text-[color:var(--muted)] hover:text-white'}`}
            >
              <SlidersHorizontal className="w-3.5 h-3.5" /> Choose MCPs
            </button>
          </div>
        </div>
        {mcpMode === 'auto' ? (
          <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">
            {ask.trim().length >= 8 ? (
              <>
                From this ask, the link will carry:{' '}
                {autoPreview.map((slug) => (
                  <span key={slug} className="mono text-[11px] text-[color:var(--accent)] mr-1.5">
                    {MINTABLE_MCPS.find((m) => m.slug === slug)?.label ?? slug}
                  </span>
                ))}
              </>
            ) : (
              'Type the ask and the right MCPs attach themselves — stocks pull Robinhood Chain, perps pull Hyperliquid, bridging always rides along.'
            )}
          </p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {MINTABLE_MCPS.map((m) => (
              <button
                key={m.slug}
                type="button"
                onClick={() => togglePick(m.slug)}
                className={`px-2.5 py-1 rounded-full border text-[12px] transition-colors ${
                  pickedMcps.includes(m.slug)
                    ? 'border-[var(--accent)] text-[color:var(--accent)] bg-[color:var(--accent)]/10'
                    : 'border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)]'
                }`}
              >
                {m.label}
              </button>
            ))}
            <span className="text-[11px] text-[color:var(--muted-2)] self-center ml-1">up to 4</span>
          </div>
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

      {earnings && earnings.totalEarnedUsd > 0 && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-[13px] text-[color:var(--muted)]">
            Earned <span className="mono text-[color:var(--accent)]">${earnings.totalEarnedUsd.toFixed(2)}</span>
            {' · '}claimed <span className="mono">${earnings.claimedUsd.toFixed(2)}</span>
            {' · '}claimable <span className="mono text-[color:var(--fg)]">${earnings.claimableUsd.toFixed(2)}</span>
          </span>
          <button
            type="button"
            disabled={earnings.claimableUsd < earnings.minClaimUsd}
            onClick={() =>
              void fetch('/api/intent-links/claims', { method: 'POST' })
                .then((r) => r.json())
                .then((d: { error?: string; amountUsd?: number; note?: string }) => {
                  setClaimMsg(d.error ?? `Claim filed for $${d.amountUsd?.toFixed(2)} — ${d.note ?? ''}`)
                  load()
                })
            }
            className="btn btn--solid text-[12px] disabled:opacity-50"
            title={earnings.claimableUsd < earnings.minClaimUsd ? `Claims open at $${earnings.minClaimUsd}` : 'Claim as USDC on Base'}
          >
            Claim USDC
          </button>
          {claimMsg && <span className="text-[12px] text-[color:var(--muted-2)]">{claimMsg}</span>}
          <span className="text-[11px] text-[color:var(--muted-2)] w-full">
            Half of Yeetful&apos;s 0.20% fee on swaps and stock buys your links produced — sales,
            transfers, and bridges are always fee-free. Paid as USDC on Base from ${earnings.minClaimUsd}.
          </span>
        </div>
      )}

      {links && links.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)] text-left">
                <th className="py-2 pr-3 font-medium">Link</th>
                <th className="py-2 pr-3 font-medium text-right">Opens</th>
                <th className="py-2 pr-3 font-medium text-right">Connects</th>
                <th className="py-2 pr-3 font-medium text-right">Built</th>
                <th className="py-2 pr-3 font-medium text-right">Signed</th>
                <th className="py-2 pr-3 font-medium text-right">$ moved</th>
                <th className="py-2 pr-3 font-medium text-right">Earned</th>
                <th className="py-2 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.slug} className="border-t border-[var(--line)]">
                  <td className="py-2.5 pr-3 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copy(l.slug)}
                        title="Copy the link"
                        className="inline-flex items-center gap-1.5 mono text-[12px] text-[color:var(--accent)] hover:underline flex-shrink-0"
                      >
                        {copied === l.slug ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        /i/{l.slug}
                      </button>
                      <span className="text-[13px] text-[color:var(--muted)] truncate">{l.ask}</span>
                      {l.redirectUrl && (
                        <span title={`Returns to ${l.redirectUrl}`} className="flex-shrink-0">
                          <Link2 className="w-3 h-3 text-[color:var(--muted-2)]" />
                        </span>
                      )}
                    </div>
                    {(l.expiresAt || l.maxSigns !== null || l.allowCount > 0) && (
                      <div className="mt-0.5 mono text-[11px] text-[color:var(--muted-2)]">
                        {[
                          l.expiresAt ? `expires ${new Date(l.expiresAt).toISOString().slice(0, 10)}` : null,
                          l.maxSigns !== null ? `${l.signsCount}/${l.maxSigns} signs` : null,
                          l.allowCount > 0 ? `${l.allowCount} wallets` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.open}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.connect}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.built}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.signed}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">
                    {l.signedUsd > 0 ? `$${l.signedUsd.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px] text-[color:var(--accent)]">
                    {l.earnedUsd > 0 ? `$${l.earnedUsd.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 text-right">
                    <button
                      type="button"
                      title="Revoke — the link stops working; its history and earnings stay"
                      onClick={() => {
                        if (!window.confirm(`Revoke /i/${l.slug}? Anyone holding the link gets a 404. Earnings history stays.`)) return
                        void fetch(`/api/intent-links/${l.slug}`, { method: 'DELETE' }).then(load)
                      }}
                      className="text-[11px] mono text-[color:var(--muted-2)] hover:text-red-400 transition-colors"
                    >
                      revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {links && links.length === 0 && !error && (
        <p className="text-[13px] text-[color:var(--muted-2)]">
          No links yet — mint the first one above. The ask you'd paste in chat is exactly the ask
          that belongs here.
        </p>
      )}
    </div>
  )
}
