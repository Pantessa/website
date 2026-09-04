'use client'

// The per-link funnel table: opens → connects → built → signed → dollars
// moved → earned, with copy / tweet / revoke on each row. The link is the
// ad; this table is the creator's scoreboard. Extracted from /dashboard/links.
//
// Every row here is LIVE — the API lists live links only, so revoking really
// does take the row away rather than leaving a dead one behind (the earnings
// it produced stay in the panel above).

import { useState } from 'react'
import { Check, Copy, Link2 } from 'lucide-react'
import { formatEarnedUsd } from '@/lib/fees'
import type { LinkRow } from '@/lib/intent-links-ui'
import { absoluteUrl } from '@/lib/site-url'

export function LinkFunnelTable({ links, onChanged }: { links: LinkRow[]; onChanged?: () => void }) {
  const [copied, setCopied] = useState<string | null>(null)
  /** Just-revoked slugs, hidden until the reload lands (optimistic). */
  const [gone, setGone] = useState<string[]>([])
  const rows = links.filter((l) => !gone.includes(l.slug))

  const copy = (slug: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/i/${slug}`).then(() => {
      setCopied(slug)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  // Revoking the last row leaves a bare header until the reload lands — the
  // caller's own empty state is the right thing to show for that beat.
  if (rows.length === 0) return null

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)] text-left">
            <th className="py-2 pr-3 font-medium">Link</th>
            <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Opens</th>
            <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Connects</th>
            <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Built</th>
            <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Signed</th>
            <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">$ moved</th>
            <th className="py-2 pr-3 font-medium text-right whitespace-nowrap">Earned</th>
            <th className="py-2 font-medium text-right"></th>
          </tr>
        </thead>
        <tbody>
          {rows.map((l) => (
            <tr key={l.slug} className="border-t border-[var(--line)]">
              {/* w-full + max-w-0: in an auto-layout table a cell grows to its
                  content, so the ask cell never truncated and a long ask pushed
                  "$ moved" and "Earned" off the right edge — the two columns
                  the creator is actually here for. This pins the ask cell to
                  the leftover width; the flex row and the ask span carry
                  min-w-0 so they are actually allowed to shrink into it. */}
              <td className="py-2.5 pr-3 w-full max-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <button
                    type="button"
                    onClick={() => copy(l.slug)}
                    title="Copy the link"
                    className="inline-flex items-center gap-1.5 mono text-[12px] text-[color:var(--accent)] hover:underline flex-shrink-0"
                  >
                    {copied === l.slug ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                    /i/{l.slug}
                  </button>
                  <span className="text-[13px] text-[color:var(--muted)] truncate min-w-0" title={l.ask}>
                    {l.ask}
                  </span>
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
              <td className="py-2.5 pr-3 text-right mono text-[13px] tabular-nums whitespace-nowrap">{l.funnel.open}</td>
              <td className="py-2.5 pr-3 text-right mono text-[13px] tabular-nums whitespace-nowrap">{l.funnel.connect}</td>
              <td className="py-2.5 pr-3 text-right mono text-[13px] tabular-nums whitespace-nowrap">{l.funnel.built}</td>
              <td className="py-2.5 pr-3 text-right mono text-[13px] tabular-nums whitespace-nowrap">{l.funnel.signed}</td>
              <td className="py-2.5 pr-3 text-right mono text-[13px] tabular-nums whitespace-nowrap">
                {l.signedUsd > 0 ? `$${l.signedUsd.toFixed(2)}` : '—'}
              </td>
              <td
                className="py-2.5 pr-3 text-right mono text-[13px] tabular-nums whitespace-nowrap text-[color:var(--accent)]"
                title={
                  l.earnedUsd <= 0 && l.signedUsd > 0
                    ? 'Fee-free route — bridges, transfers, stakes and sales move money but earn nothing.'
                    : undefined
                }
              >
                {l.earnedUsd > 0 ? formatEarnedUsd(l.earnedUsd) : '—'}
              </td>
              <td className="py-2.5 text-right whitespace-nowrap">
                <a
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`“${l.ask}” — tap it, connect your wallet, done.`)}&url=${encodeURIComponent(absoluteUrl(`/i/${l.slug}`))}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  title="Tweet this link — the card wears your brand"
                  className="text-[11px] mono text-[color:var(--muted-2)] hover:text-[color:var(--accent)] transition-colors mr-3"
                >
                  tweet
                </a>
                <button
                  type="button"
                  title="Revoke — the link comes down everywhere; the money it already earned stays yours"
                  onClick={() => {
                    if (
                      !window.confirm(
                        `Revoke /i/${l.slug}?\n\nThe link stops working, and it leaves this table and the public board. Anything it already earned stays in your balance.`,
                      )
                    )
                      return
                    // Drop the row on the spot, then reconcile — the list
                    // re-reads itself every 30s and a row that lingers until
                    // the next poll is exactly what this button looked broken
                    // for.
                    setGone((g) => [...g, l.slug])
                    void fetch(`/api/intent-links/${l.slug}`, { method: 'DELETE' })
                      .then(() => onChanged?.())
                      .catch(() => setGone((g) => g.filter((s) => s !== l.slug)))
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
