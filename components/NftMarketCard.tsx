'use client'

// The NFT market answer — floors + a value estimate, or live bids — rendered
// as a card under the reply. NftGalleryCard's sibling: the gallery shows what
// the wallet HOLDS, this shows what the market says about it.
//
// Every number arrives pre-formatted (lib/nft-market.ts), so this file does no
// math and can never disagree with the sentence above it. Rows that could not
// be priced still render, greyed — "we looked and found nothing" is an answer,
// and hiding them would quietly shrink the set the reply just counted.

import { Coins, Gavel } from 'lucide-react'
import { useState } from 'react'
import type { NftMarketDisplay, NftMarketRow } from '@/lib/nft-display'

const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

/** Square thumbnail with a lettermark fallback (the gallery card's twin —
 *  OpenSea CDN images 404 often enough that the fallback is load-bearing). */
function Thumb({ url, label }: { url: string | null; label: string }) {
  const [failed, setFailed] = useState(false)
  if (failed || !url) {
    return (
      <span className="grid h-10 w-10 flex-shrink-0 place-items-center rounded-lg bg-white/10 text-[11px] font-semibold text-[color:var(--muted)]">
        {label.replace(/^#/, '').slice(0, 1).toUpperCase() || '?'}
      </span>
    )
  }
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img src={url} alt={label} width={40} height={40} onError={() => setFailed(true)} loading="lazy" className="h-10 w-10 flex-shrink-0 rounded-lg object-cover" />
  )
}

function Row({ r, onPick }: { r: NftMarketRow; onPick?: (prompt: string) => void }) {
  const priced = (r.actions ?? []).length > 0
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <Thumb url={r.imageUrl} label={r.name} />
        <div className="min-w-0">
          <div className="truncate font-medium capitalize text-white">{r.name}</div>
          <div className="truncate text-[10px] text-[color:var(--muted-2)]">{r.detail}</div>
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
        {/* Fixed width so the numbers line up down the card even when one row
            says "no floor yet" and the next says "0.0006 ETH". */}
        <div className="mr-1 min-w-[86px] text-right">
          {r.value && <div className={`text-[11px] font-medium ${priced ? 'text-white' : 'text-[color:var(--muted-2)]'}`}>{r.value}</div>}
          {r.note && <div className="text-[10px] text-[color:var(--muted-2)]">{r.note}</div>}
        </div>
        {onPick &&
          (r.actions ?? []).map((a) => (
            <button
              key={a.label}
              onClick={() => onPick(a.prompt)}
              className="rounded-full border border-[var(--line)] bg-white/[0.03] px-2 py-0.5 text-[10px] text-[color:var(--muted)] hover:border-[var(--accent)] hover:text-white"
            >
              {a.label}
            </button>
          ))}
        {r.infoUrl && (
          <a
            href={r.infoUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={r.infoLabel ?? 'View on OpenSea'}
            className="rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[color:var(--muted-2)] hover:text-white"
          >
            ⓘ
          </a>
        )}
      </div>
    </div>
  )
}

export default function NftMarketCard({ data, onPick }: { data: NftMarketDisplay; onPick?: (prompt: string) => void }) {
  if (data.rows.length === 0) return null
  const offers = data.kind === 'offers'
  const Icon = offers ? Gavel : Coins
  return (
    <div className="not-prose mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surf-2)]/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-[color:var(--muted-2)]" />
          <span className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">
            {offers ? 'Live bids' : 'Floor value'} · {shortAddr(data.owner)}
          </span>
        </div>
        <span className="text-[10px] text-[color:var(--muted-2)]">{data.chains.join(' · ')}</span>
      </div>

      {data.total && (
        <div className="mt-3">
          <div className="text-lg font-semibold text-white">{data.total}</div>
          {data.totalNote && <div className="text-[10px] text-[color:var(--muted-2)]">{data.totalNote}</div>}
        </div>
      )}

      <div className="mt-3 space-y-2">
        {data.rows.map((r) => (
          <Row key={`${r.name}:${r.detail}`} r={r} onPick={onPick} />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-[10px] text-[color:var(--muted-2)]">
        <span>{offers ? 'Live OpenSea bids · a collection bid covers any token in it' : 'Live OpenSea floors · an estimate, not a quote'}</span>
        {data.scanned && <span className="mono">{data.scanned}</span>}
        {data.failedChains.length > 0 && <span className="mono">{data.failedChains.join(', ')} unreadable</span>}
      </div>
    </div>
  )
}
