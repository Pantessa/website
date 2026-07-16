'use client'

import { useState } from 'react'
import { tokenIconPath } from '@/lib/token-icons'

/**
 * A holding's mark: the vendored SVG from /public/tokens (top coins via
 * @web3icons/core, Robinhood tokenized stocks via brand-tinted simple-icons —
 * see scripts/vendor-token-icons.ts) with a monogram roundel fallback for the
 * long tail. The monogram takes a deterministic hue from the symbol so
 * unknown tokens still read as distinct, intentional marks — not gray boxes.
 *
 * No network at render time: the generated manifest (lib/token-icons.ts)
 * decides img-vs-monogram, so a missing mark never costs a 404 flash.
 */
export default function TokenIcon({ symbol, size = 24 }: { symbol: string; size?: number }) {
  const [failed, setFailed] = useState(false)
  const src = failed ? null : tokenIconPath(symbol)

  if (src) {
    return (
      <span
        className="grid shrink-0 place-items-center overflow-hidden rounded-full bg-white/5"
        style={{ height: size, width: size }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src={src}
          alt={symbol}
          width={Math.round(size * 0.72)}
          height={Math.round(size * 0.72)}
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
