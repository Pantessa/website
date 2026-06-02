'use client'

import { useState } from 'react'
import type { McpServer } from '@/lib/store'

/**
 * Monochrome brand glyph for an agent. Tries the Simple Icons CDN by slug,
 * falls back to an Archivo lettermark. Active cards invert the tile to white,
 * and the `.card.is-active .card__tile img { filter: invert(1) }` rule flips
 * the glyph to black — so this just renders white art.
 *
 * In production, swap the CDN for the real agentic.market icon assets — this
 * component is the single swap point.
 */

// Our catalog slug/id → Simple Icons brand slug. Missing → lettermark.
const ICON_SLUG: Record<string, string> = {
  'yeetful-claude': 'anthropic',
  deepseek: 'deepseek',
  'google-gemini': 'googlegemini',
  tripadvisor: 'tripadvisor',
  'wolfram-alpha': 'wolframmathematica',
  coinmarketcap: 'coinmarketcap',
}

export default function BrandIcon({ server, size = 22 }: { server: McpServer; size?: number }) {
  const [failed, setFailed] = useState(false)
  const slug = ICON_SLUG[server.slug] ?? ICON_SLUG[server.id]
  const letter = server.name.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '?'

  if (!slug || failed) {
    return (
      <span
        style={{
          fontFamily: "'Archivo', sans-serif",
          fontWeight: 800,
          fontSize: size * 0.7,
          lineHeight: 1,
          letterSpacing: '-0.04em',
        }}
      >
        {letter}
      </span>
    )
  }

  return (
    // eslint-disable-next-line @next/next/no-img-element
    <img
      src={`https://cdn.simpleicons.org/${slug}/white`}
      alt=""
      width={size}
      height={size}
      onError={() => setFailed(true)}
      style={{ display: 'block', objectFit: 'contain' }}
      draggable={false}
    />
  )
}
