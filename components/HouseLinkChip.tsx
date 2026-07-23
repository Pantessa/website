// House-link chip — the tappable "ask in quotes" pill used by the landing
// LinkLane and the /links start-here strip. Wears the MCP marks the ask
// actually runs through (houseLinkMarks: the composed /i set + declared
// venue marks) stacked like coins seen sideways — the same treatment as the
// chat's multi-MCP responder avatar — so a visitor can see which apps the
// link calls before they open it.

import Link from 'next/link'
import { getProtocolMark } from '@/components/protocol-marks'
import { houseLinkMarks, type HouseLink } from '@/lib/house-links'

export default function HouseLinkChip({ link }: { link: HouseLink }) {
  const marks = houseLinkMarks(link)
    .map((m) => ({ ...m, Mark: getProtocolMark(m.key) }))
    .filter((m): m is { key: string; name: string; Mark: NonNullable<ReturnType<typeof getProtocolMark>> } => m.Mark !== null)
  return (
    <Link
      href={`/i/${link.slug}`}
      className="group flex items-center gap-2.5 rounded-full border border-[var(--line)] bg-[var(--surf-1)] pl-2.5 pr-4 py-1.5 hover:border-[var(--accent)] transition-colors"
      title={marks.length ? `${link.label} · via ${marks.map((m) => m.name).join(' + ')}` : link.label}
    >
      {marks.length > 0 && (
        <span className="flex items-center flex-shrink-0" aria-hidden>
          {marks.map((m, i) => (
            <span
              key={m.key}
              className={`relative flex h-6 w-6 items-center justify-center overflow-hidden rounded-full border border-[var(--line-2)] bg-[var(--surf-2)] ring-2 ring-[var(--surf-1)] text-[color:var(--fg)]${i > 0 ? ' -ml-2' : ''}`}
              style={{ zIndex: marks.length - i }}
            >
              <m.Mark size={12} />
            </span>
          ))}
        </span>
      )}
      <span className="text-[13px] text-[color:var(--fg)] group-hover:text-[color:var(--accent)] transition-colors">
        &ldquo;{link.ask}&rdquo;
      </span>
    </Link>
  )
}
