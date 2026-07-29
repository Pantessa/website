'use client'

// The per-link funnel table: opens → connects → built → signed → dollars
// moved → earned, with copy / tweet / revoke on each row. The link is the
// ad; this table is the creator's scoreboard. Extracted from /dashboard/links.

import { useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { formatEarnedUsd } from '@/lib/fees'
import type { LinkRow } from '@/lib/intent-links-ui'

export function LinkFunnelTable({ links, onChanged }: { links: LinkRow[]; onChanged?: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)

  const copy = (slug: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/i/${slug}`).then(() => {
      setCopied(slug)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
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
                {/* A/B: the per-phrasing funnel — which wording converts. */}
                {l.funnelVariants && (
                  <div className="mt-1 space-y-0.5">
                    {l.funnelVariants.map((v) => (
                      <div key={v.variant} className="mono text-[11px] text-[color:var(--muted-2)] truncate">
                        {String.fromCharCode(65 + v.variant)} · &ldquo;{v.ask}&rdquo; — {v.open} open · {v.connect} connect
                        · {v.built} built ·{' '}
                        <span className={v.signed > 0 ? 'text-[color:var(--accent)]' : undefined}>{v.signed} signed</span>
                      </div>
                    ))}
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
              <td
                className="py-2.5 pr-3 text-right mono text-[13px] text-[color:var(--accent)]"
                title={
                  l.earnedUsd <= 0 && l.signedUsd > 0
                    ? 'Fee-free route — bridges, transfers, stakes and sales move money but earn nothing.'
                    : undefined
                }
              >
                {l.earnedUsd > 0 ? formatEarnedUsd(l.earnedUsd) : '—'}
              </td>
              <td className="py-2.5 text-right whitespace-nowrap">
                {/* never offer sharing a revoked link — it 404s */}
                {!l.revoked && (
                  <a
                    href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`“${l.ask}” — tap it, connect your wallet, done.`)}&url=${encodeURIComponent(`https://yeetful.com/i/${l.slug}`)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    title="Tweet this link — the card wears your brand"
                    className="text-[11px] mono text-[color:var(--muted-2)] hover:text-[color:var(--accent)] transition-colors mr-3"
                  >
                    tweet
                  </a>
                )}
                <button
                  type="button"
                  title="Revoke — the link stops working; its history and earnings stay"
                  onClick={() => {
                    if (!window.confirm(`Revoke /i/${l.slug}? Anyone holding the link gets a 404. Earnings history stays.`)) return
                    void fetch(`/api/intent-links/${l.slug}`, { method: 'DELETE' }).then(() => onChanged?.())
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
  )
}
