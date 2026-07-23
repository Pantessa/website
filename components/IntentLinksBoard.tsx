'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { LinksBoard } from '@/lib/links-board'

// The ranked intent-links list — one markup source for /links (the full
// board) and /activity (the link-economy section). Three tabs over server
// truth: "Most claimed" (finished flows — the visitor signed) is the
// default; "Dollars moved" ranks by signed notional; "Recently minted"
// lists the newest live creator links straight from mint — the one tab a
// brand-new link can appear on before its first sign. Every row is a live
// link; asks only, never creators' wallets.

const TABS = [
  { key: 'claims', label: 'Most claimed' },
  { key: 'moved', label: 'Dollars moved' },
  { key: 'recent', label: 'Recently minted' },
] as const
type TabKey = (typeof TABS)[number]['key']

// Coarse mint age — minute granularity keeps the server-rendered string
// stable through hydration in all but boundary cases (suppressed below).
function mintAge(iso: string): string {
  const m = Math.floor((Date.now() - new Date(iso).getTime()) / 60_000)
  if (m < 1) return 'just now'
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export default function IntentLinksBoard({ board }: { board: LinksBoard }) {
  const [tab, setTab] = useState<TabKey>('claims')
  const rows = tab === 'claims' ? board.byClaims : tab === 'moved' ? board.byMoved : board.byRecent
  return (
    <div>
      <div className="flex items-center gap-1.5 mb-3" role="tablist" aria-label="Rank links by">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={`mono text-[11px] uppercase tracking-wider px-3 py-1.5 rounded-full border transition-colors ${
              tab === t.key
                ? 'border-[var(--accent)] text-[color:var(--accent)] bg-[var(--surf-1)]'
                : 'border-[var(--line)] text-[color:var(--muted-2)] hover:text-[color:var(--fg)]'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>
      {rows.length === 0 ? (
        <p className="text-[13px] text-[color:var(--muted-2)] border-y border-[var(--line)] py-4">
          {tab === 'recent'
            ? 'No links minted yet — yours would be first.'
            : 'Nothing here yet — the first signed flow fills this tab.'}
        </p>
      ) : (
        <ol className="divide-y divide-[var(--line)] border-y border-[var(--line)]">
          {rows.map((r, i) => (
            <li key={r.slug}>
              <Link
                href={`/i/${r.slug}`}
                className="flex items-center gap-4 py-3 group hover:bg-white/[0.02] transition-colors"
              >
                <span className="mono text-[12px] text-[color:var(--muted-2)] w-6 flex-shrink-0">
                  {i + 1}
                </span>
                <span className="text-[14px] text-[color:var(--fg)] truncate flex-1 group-hover:text-[color:var(--accent)] transition-colors">
                  &ldquo;{r.ask}&rdquo;
                </span>
                <span className="mono text-[12px] text-[color:var(--muted-2)] flex-shrink-0 hidden sm:inline">
                  {r.opens} opens
                </span>
                <span
                  className={`mono text-[12px] flex-shrink-0 ${
                    tab === 'claims' ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted-2)]'
                  }`}
                >
                  {r.claims} claimed
                </span>
                {tab === 'recent' && r.mintedAt ? (
                  <span
                    suppressHydrationWarning
                    className="mono text-[13px] flex-shrink-0 text-[color:var(--accent)]"
                  >
                    {mintAge(r.mintedAt)}
                  </span>
                ) : (
                  <span
                    className={`mono text-[13px] flex-shrink-0 ${
                      tab === 'moved' ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted-2)]'
                    }`}
                  >
                    ${r.movedUsd.toFixed(2)}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ol>
      )}
    </div>
  )
}
