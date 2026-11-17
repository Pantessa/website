'use client'

// OPENSEA on the apps page (squad apps-page, lane PORTFOLIO): the wallet's
// NFTs (`opensea-nfts`, sources.ts openseaSource: up to twelve, each with its
// own Sell / Transfer asks and its OpenSea page). The pictures ARE the data:
//   full  a gallery grid; pick one and its name, collection, floor and asks
//         open beside it.
//   side  the sentence, three thumbnails, one ask.
//   line  one sentence, one button.

import { useState } from 'react'
import { ExternalLink } from 'lucide-react'
import { AppLineRow, AskButton, Eyebrow, Fact, FactRow, SectionFrame, SectionPending } from '@/components/apps/parts'
import { nftCounts, nftSentence, spellCount } from '@/lib/apps-portfolio'
import type { NftRow, NftsTile, SplashTile } from '@/lib/splash/types'
import { TileState } from './uniswap'
import type { AppSectionProps, SectionModule } from './types'
import '../portfolio.css'

const NOTHING = 'No NFTs in this wallet on Ethereum, Base or Arbitrum.'
const idOf = (n: NftRow) => `${n.chain}|${n.contract}|${n.tokenId}`
const nftsOf = (tiles: SplashTile[]) => (tiles.find((t) => t.render === 'nfts' && t.nfts.length > 0) as NftsTile | undefined) ?? null

function Thumb({ n, size }: { n: NftRow; size?: number }) {
  const [failed, setFailed] = useState(false)
  if (!n.imageUrl || failed)
    return (
      <span className="apgp-thumb apgp-thumb--letter" style={size ? { width: size, height: size } : undefined} aria-hidden>
        {n.name.replace(/^#/, '').slice(0, 1).toUpperCase()}
      </span>
    )
  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={n.imageUrl}
      alt={n.name}
      loading="lazy"
      onError={() => setFailed(true)}
      className="apgp-thumb"
      style={size ? { width: size, height: size } : undefined}
    />
  )
}

function Detail({ n, onAsk }: { n: NftRow; onAsk: AppSectionProps['onAsk'] }) {
  return (
    <div className="apgp-nftdetail" data-apgp-nft-detail="">
      <Thumb n={n} />
      <div className="apgp-nftdetail__text">
        <div className="apgp-nftdetail__name">{n.name}</div>
        <div className="apgp-muted">
          {n.collectionName}, on {n.chain}
        </div>
        {n.floor && <div className="apgp-num">{n.floor}</div>}
      </div>
      <div className="apgp-asks">
        {(n.actions ?? []).map((a, i) => (
          <AskButton key={a.prompt} strong={i === 0} onClick={() => onAsk(a.prompt)} title={a.prompt} className="apgp-btn">
            {a.label}
          </AskButton>
        ))}
        {n.infoUrl && (
          <a href={n.infoUrl} target="_blank" rel="noopener noreferrer" className="apgp-link">
            {n.infoLabel ?? 'View on OpenSea'}
            <ExternalLink width={12} height={12} aria-hidden />
          </a>
        )}
      </div>
    </div>
  )
}

function OpenseaSection({ server, tiles, pending, density, onAsk, onRetry }: AppSectionProps) {
  const tile = nftsOf(tiles)
  const [sel, setSel] = useState<string | null>(null)
  if (pending && tiles.length === 0) return <SectionPending server={server} line={density === 'line'} />
  const prompts = tiles.flatMap((t) => t.prompts)
  const counts = tile ? nftCounts(tile.nfts, tile.subtitle) : null
  const text = counts ? nftSentence(counts) : NOTHING

  if (density === 'line') {
    const act = prompts[0]
    return <AppLineRow server={server} text={text} act={act ? { label: act.label, onClick: () => onAsk(act.prompt) } : null} />
  }
  if (!tile || !counts)
    return (
      <SectionFrame server={server}>
        <TileState tiles={tiles} onRetry={onRetry} onAsk={onAsk} fallback={NOTHING} />
      </SectionFrame>
    )

  if (density === 'side') {
    const act = prompts[0]
    return (
      <SectionFrame server={server}>
        <div className="apgp-side">
          <p className="apgp-sentence">{text}</p>
          <div className="apgp-thumbs">
            {tile.nfts.slice(0, 3).map((n) => (
              <a
                key={idOf(n)}
                href={n.infoUrl ?? undefined}
                target="_blank"
                rel="noopener noreferrer"
                title={`${n.name}, ${n.collectionName}`}
                className="apgp-thumbs__cell"
              >
                <Thumb n={n} />
              </a>
            ))}
          </div>
          {act && (
            <div className="apgp-asks">
              <AskButton onClick={() => onAsk(act.prompt)} title={act.prompt} className="apgp-btn">
                {act.label}
              </AskButton>
            </div>
          )}
        </div>
      </SectionFrame>
    )
  }

  const selected = tile.nfts.find((n) => idOf(n) === sel) ?? null
  return (
    <SectionFrame server={server} note={`${counts.total}${counts.more ? '+' : ''} NFTS`}>
      <div className="apgp-fullwrap">
        <div className="apgp-full apgp-full--nfts">
          <div className="apgp-full__facts">
            <FactRow>
              <Fact value={`${counts.total}${counts.more ? '+' : ''}`} label="NFTs" sub={counts.total > counts.shown ? `${counts.shown} shown here` : undefined} />
              <Fact value={counts.collections} label={counts.collections === 1 ? 'Collection' : 'Collections'} sub={counts.total > counts.shown ? 'among those shown' : undefined} />
              <Fact value={counts.chains} label={counts.chains === 1 ? 'Chain' : 'Chains'} sub={[...new Set(tile.nfts.map((n) => n.chain))].join(', ')} />
            </FactRow>
          </div>
          <div className="apgp-full__list">
            <div className="apgp-listhead">
              <Eyebrow>Gallery</Eyebrow>
              <span className="apgp-listhead__note">Pick one to sell or send it</span>
            </div>
            <div className="apgp-gallery" role="list">
              {tile.nfts.map((n) => {
                const id = idOf(n)
                const on = sel === id
                return (
                  <button
                    key={id}
                    type="button"
                    role="listitem"
                    aria-pressed={on}
                    onClick={() => setSel(on ? null : id)}
                    className="apgp-gcell"
                    title={`${n.name}, ${n.collectionName}`}
                  >
                    <Thumb n={n} />
                    <span className="apgp-gcell__name">{n.name}</span>
                    <span className="apgp-gcell__sub">{n.floor ?? n.collectionName}</span>
                  </button>
                )
              })}
            </div>
          </div>
          <div className="apgp-full__aside">
            <aside className="apgp-only" aria-label="Selected">
              {selected ? (
                <div className="apgp-block">
                  <Eyebrow>Selected</Eyebrow>
                  <Detail n={selected} onAsk={onAsk} />
                </div>
              ) : (
                <div className="apgp-block">
                  <Eyebrow>Selected</Eyebrow>
                  <p className="apgp-muted apgp-p">Nothing yet. Pick one of the {spellCount(counts.shown)} to sell or send it.</p>
                </div>
              )}
              {prompts.length > 0 && (
                <div className="apgp-block">
                  <Eyebrow>Ask</Eyebrow>
                  <div className="apgp-asks">
                    {prompts.map((p) => (
                      <AskButton key={p.prompt} onClick={() => onAsk(p.prompt)} title={p.prompt} className="apgp-btn apgp-btn--wrap">
                        {p.label}
                      </AskButton>
                    ))}
                  </div>
                </div>
              )}
            </aside>
          </div>
        </div>
      </div>
    </SectionFrame>
  )
}

const mod: SectionModule = {
  Section: OpenseaSection,
  headline: ({ tiles }) => {
    const t = nftsOf(tiles)
    if (t) return `You hold ${nftSentence(nftCounts(t.nfts, t.subtitle)).replace(/^./, (c) => c.toLowerCase())}`
    // The scan answered and found none: say so, not the page's money line.
    return tiles.some((x) => x.render === 'empty') ? 'No NFTs in this wallet yet.' : null
  },
}
export default mod
