'use client'

import { useState } from 'react'
import { tokenMark } from '@/lib/token-icons'

/** Where a holding lives, so a ticker resolves to the right mark: QNT is the
 *  Quant coin on Ethereum and Quantinuum on Robinhood Chain. Either form
 *  works — the numeric id from a chain registry, or the human label a
 *  portfolio row already carries ("Robinhood Chain"). */
export interface MarkContext {
  chainId?: number
  chain?: string | null
}

/**
 * A holding's mark: the vendored art from /public/tokens (top coins via
 * @web3icons/core, Robinhood Chain's tokenized equities via their company
 * marks — see scripts/vendor-token-icons.ts) with a monogram roundel fallback
 * for the long tail. The monogram takes a deterministic hue from the symbol so
 * unknown tokens still read as distinct, intentional marks — not gray boxes.
 *
 * Two shapes, because the art is two shapes. A coin mark is a transparent
 * glyph, inset inside a roundel. A company mark is a full-bleed brand tile
 * (Apple's is black, Microsoft's white) — it fills the circle, the way every
 * brokerage draws it, over a plate for the few that ship bare glyphs. The
 * hairline ring is what keeps a black tile from dissolving into a dark card
 * and a white one from dissolving into a light page.
 *
 * No network at render time: the generated manifest (lib/token-icons.ts)
 * decides art-vs-monogram, so a missing mark never costs a 404 flash.
 */
export default function TokenIcon({
  symbol,
  size = 24,
  chainId,
  chain,
}: { symbol: string; size?: number } & MarkContext) {
  const [failed, setFailed] = useState(false)
  const mark = failed ? null : tokenMark(symbol, { chainId, chain })

  if (mark) {
    const stock = mark.kind === 'stock'
    // A full-bleed brand tile fills its circle; a bare glyph (coin art, or
    // the handful of equities that ship one) is inset on its plate.
    const bleed = stock && mark.plate === 'none'
    const glyph = bleed ? size : Math.round(size * (stock ? 0.68 : 0.72))
    return (
      <span
        className="grid shrink-0 place-items-center overflow-hidden rounded-full"
        style={{
          height: size,
          width: size,
          background:
            mark.plate === 'dark' ? '#101014' : mark.plate === 'light' ? '#ffffff' : 'var(--surf-2, rgba(255,255,255,0.05))',
          // Not a border: a border would shrink the tile inside its own box.
          boxShadow: stock ? 'inset 0 0 0 1px var(--line)' : undefined,
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={mark.src}
          alt={symbol}
          width={glyph}
          height={glyph}
          onError={() => setFailed(true)}
          className="object-contain"
        />
      </span>
    )
  }

  // Deterministic hue from the symbol (same string → same tint, both themes).
  const hue = [...symbol.toUpperCase()].reduce((h, c) => (h * 31 + c.charCodeAt(0)) % 360, 7)
  return (
    <span
      className="mono grid shrink-0 place-items-center rounded-full font-semibold"
      style={{
        height: size,
        width: size,
        fontSize: Math.max(8, Math.round(size * 0.34)),
        background: `hsl(${hue} 45% 52% / 0.16)`,
        color: `hsl(${hue} 42% 58%)`,
      }}
    >
      {symbol.slice(0, 3).toUpperCase()}
    </span>
  )
}
