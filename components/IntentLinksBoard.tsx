import Link from 'next/link'
import type { LinkBoardRow } from '@/lib/links-board'

// The ranked intent-links list — one markup source for /links (the full
// board) and /activity (the link-economy section). Every row is a live
// link; asks only, never creators' wallets.

export default function IntentLinksBoard({ rows }: { rows: LinkBoardRow[] }) {
  return (
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
            <span className="mono text-[12px] text-[color:var(--muted-2)] flex-shrink-0">
              {r.opens} opens
            </span>
            <span className="mono text-[13px] text-[color:var(--accent)] flex-shrink-0">
              ${r.movedUsd.toFixed(2)}
            </span>
          </Link>
        </li>
      ))}
    </ol>
  )
}
