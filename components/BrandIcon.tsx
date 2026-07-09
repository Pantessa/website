'use client'

import { useState } from 'react'
import type { McpServer } from '@/lib/store'
import { getProtocolMark } from '@/components/protocol-marks'

/**
 * Monochrome brand glyph for an agent. Resolution order:
 *   1. a hand-vendored protocol mark (Uniswap / CoW / Snapshot — see
 *      components/protocol-marks), which wins for the free fleet whose slugs
 *      Simple Icons doesn't carry;
 *   2. the Simple Icons CDN by slug;
 *   3. an Archivo lettermark.
 * Active cards invert the tile to white, and the
 * `.card.is-active .card__tile img { filter: invert(1) }` rule flips the glyph
 * to black — so this just renders white art.
 *
 * To add a logo as new server pages come in, add it to the protocol-marks
 * registry (one row) — no change needed here.
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

// Inline glyphs for brands Simple Icons doesn't carry. Keyed by iconSlug (or
// catalog slug). Rendered as monochrome `currentColor` art so it tracks the
// tile's foreground — white on a dark tile, black when an active card inverts.
// (Multi-path brand marks like Uniswap/CoW/Snapshot live in protocol-marks.)
const INLINE_ICONS: Record<string, string> = {}

export default function BrandIcon({ server, size = 22 }: { server: McpServer; size?: number }) {
  const [failed, setFailed] = useState(false)
  const [logoFailed, setLogoFailed] = useState(false)
  // Prefer the DB-provided Simple Icons slug, then the local map, then lettermark.
  const slug = server.iconSlug ?? ICON_SLUG[server.slug] ?? ICON_SLUG[server.id]
  const letter = server.name.replace(/[^A-Za-z]/g, '').charAt(0).toUpperCase() || '?'

  // A real image logo (uploaded or linked, or auto-pulled from the MCP's own
  // serverInfo.icons / site favicon at add time) wins over everything. Unlike
  // the monochrome CDN glyphs it renders in full color, so it's NOT tile-
  // inverted — a brand logo should look like itself. On load failure we fall
  // through to the protocol-mark / slug / lettermark chain below.
  const logoUrl = server.logoUrl ?? server.iconUrl
  if (logoUrl && !logoFailed) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={logoUrl}
        alt=""
        width={size}
        height={size}
        onError={() => setLogoFailed(true)}
        style={{ display: 'block', objectFit: 'contain', borderRadius: size * 0.18 }}
        draggable={false}
      />
    )
  }

  // A hand-vendored protocol mark (Uniswap / CoW / Snapshot) wins over the CDN —
  // no network, no failure mode, and it catches the `-free` fleet slugs.
  const Mark = getProtocolMark(server.iconSlug, server.slug, server.id, server.name)
  if (Mark) return <Mark size={size} />

  // Inline single-path glyph fallback (kept for future simple additions).
  const inlinePath = INLINE_ICONS[slug ?? ''] ?? INLINE_ICONS[server.slug]
  if (inlinePath) {
    return (
      <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" style={{ display: 'block' }} aria-hidden>
        <path d={inlinePath} />
      </svg>
    )
  }

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
