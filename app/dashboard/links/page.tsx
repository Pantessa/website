'use client'

// Dashboard · Intent links — mint short links that carry an ask, and watch
// each link's funnel: opens → connects → built → signed → dollars moved.
// The link is the ad; the funnel is the creator's scoreboard. Funnel values
// here are per-link telemetry (client-reported) — the global money-moved
// metric stays guardrail-priced in embed_turns and is NOT fed from this.

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, Plus } from 'lucide-react'

interface LinkRow {
  slug: string
  url: string
  ask: string
  agent: string | null
  redirectUrl: string | null
  revoked: boolean
  createdAt: string
  funnel: { open: number; connect: number; built: number; signed: number; valueUsd: number }
}

export default function DashboardLinksPage() {
  const [links, setLinks] = useState<LinkRow[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  const [minting, setMinting] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)

  const load = useCallback(() => {
    void fetch('/api/intent-links', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          setError('Sign in with your wallet to mint and track intent links.')
          return null
        }
        return r.json()
      })
      .then((d: { links: LinkRow[] } | null) => {
        if (d) setLinks(d.links)
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
        body: JSON.stringify({ ask: ask.trim(), redirectUrl: redirectUrl.trim() || undefined }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Mint failed.')
        return
      }
      setAsk('')
      setRedirectUrl('')
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
        <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-3 block">
          Return URL after signing (optional, https — e.g. your site)
        </label>
        <input
          value={redirectUrl}
          onChange={(e) => setRedirectUrl(e.target.value)}
          placeholder="https://yoursite.com/thanks"
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
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
                <th className="py-2 font-medium text-right">$ moved</th>
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
                  </td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.open}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.connect}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.built}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.signed}</td>
                  <td className="py-2.5 text-right mono text-[13px]">
                    {l.funnel.valueUsd > 0 ? `$${l.funnel.valueUsd.toFixed(2)}` : '—'}
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
