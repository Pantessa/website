'use client'

import { useState } from 'react'
import Link from 'next/link'
import type { LinksBoard } from '@/lib/links-board'

// The ranked intent-links list — one markup source for /links (the full
// board) and /activity (the link-economy section). Two tabs over the same
// signed-turns truth: "Most claimed" (finished flows — the visitor signed)
// is the default; "Dollars moved" ranks by signed notional. Every row is a
// live link; asks only, never creators' wallets.

const TABS = [
  { key: 'claims', label: 'Most claimed' },
  { key: 'moved', label: 'Dollars moved' },
] as const
type TabKey = (typeof TABS)[number]['key']

export default function IntentLinksBoard({ board }: { board: LinksBoard }) {
  const [tab, setTab] = useState<TabKey>('claims')
  const rows = tab === 'claims' ? board.byClaims : board.byMoved
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
              <span
                className={`mono text-[13px] flex-shrink-0 ${
                  tab === 'moved' ? 'text-[color:var(--accent)]' : 'text-[color:var(--muted-2)]'
                }`}
              >
                ${r.movedUsd.toFixed(2)}
              </span>
            </Link>
          </li>
        ))}
      </ol>
    </div>
  )
}
