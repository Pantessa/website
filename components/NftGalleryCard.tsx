'use client'

// Rich NFT gallery card — renders the native gallery read (lib/nft-gallery)
// inside an assistant bubble, so "show my NFTs" answers with the NFTs instead
// of a paragraph about them. PortfolioCard's sibling; same rows as the splash
// dashboard's gallery tile (lib/splash/types NftRow), so a Sell / Transfer tap
// sends the exact prompt the native NFT layer parses back.
//
// Empty is not a card: when the read found nothing, the reply sentence already
// said so honestly and a blank frame would just be noise.

import { Images } from 'lucide-react'
import { useState } from 'react'
import type { NftGalleryDisplay } from '@/lib/nft-display'
import type { NftRow } from '@/lib/splash/types'

const shortAddr = (a: string) => (a.length > 10 ? `${a.slice(0, 6)}…${a.slice(-4)}` : a)

/** Square thumbnail with a lettermark fallback (the splash gallery's twin —
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

function Row({ n, onPick }: { n: NftRow; onPick?: (prompt: string) => void }) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs">
      <div className="flex min-w-0 items-center gap-2">
        <Thumb url={n.imageUrl} label={n.name} />
        <div className="min-w-0">
          <div className="truncate font-medium text-white">{n.name}</div>
          <div className="truncate text-[10px] text-[color:var(--muted-2)]">
            <span className="capitalize">{n.collectionName}</span> · {n.chain}
            {n.standard === 'erc1155' ? ' · 1155' : ''}
          </div>
        </div>
      </div>
      <div className="flex flex-shrink-0 flex-wrap items-center justify-end gap-1">
        {n.floor && <span className="mr-1 text-[10px] text-[color:var(--muted)]">{n.floor}</span>}
        {onPick &&
          (n.actions ?? []).map((a) => (
            <button
              key={a.label}
              onClick={() => onPick(a.prompt)}
              className="rounded-full border border-[var(--line)] bg-white/[0.03] px-2 py-0.5 text-[10px] text-[color:var(--muted)] hover:border-[var(--accent)] hover:text-white"
            >
              {a.label}
            </button>
          ))}
        {n.infoUrl && (
          <a
            href={n.infoUrl}
            target="_blank"
            rel="noopener noreferrer"
            title={n.infoLabel ?? 'View on OpenSea'}
            className="rounded-full border border-[var(--line)] px-1.5 py-0.5 text-[10px] text-[color:var(--muted-2)] hover:text-white"
          >
            ⓘ
          </a>
        )}
      </div>
    </div>
  )
}

export default function NftGalleryCard({ data, onPick }: { data: NftGalleryDisplay; onPick?: (prompt: string) => void }) {
  if (data.nfts.length === 0) return null
  const more = data.found - data.nfts.length
  return (
    <div className="not-prose mt-3 rounded-2xl border border-[var(--line)] bg-[var(--surf-2)]/60 p-4">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <div className="flex items-center gap-2">
          <Images className="h-3.5 w-3.5 text-[color:var(--muted-2)]" />
          <span className="mono text-[10px] uppercase tracking-wider text-[color:var(--muted-2)]">NFTs · {shortAddr(data.owner)}</span>
        </div>
        <span className="text-[10px] text-[color:var(--muted-2)]">{data.chains.join(' · ')}</span>
      </div>

      <div className="mt-3 space-y-2">
        {data.nfts.map((n) => (
          <Row key={`${n.chain}:${n.contract}:${n.tokenId}`} n={n} onPick={onPick} />
        ))}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-[var(--line)] pt-2 text-[10px] text-[color:var(--muted-2)]">
        <span>{more > 0 ? `${more} more not shown` : 'Live OpenSea data'}</span>
        {data.failedChains.length > 0 && <span className="mono">{data.failedChains.join(', ')} unreadable</span>}
      </div>
    </div>
  )
}
