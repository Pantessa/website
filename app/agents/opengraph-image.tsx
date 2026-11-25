import { ImageResponse } from 'next/og'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { OgChips, OgEyebrow, OgFrame, OgLockup, OgStats, ogDisplay, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { getLeagueStandings, rosterEnabled, SEASON_LABEL } from '@/lib/league'

// Social card for the /agents standings index — same house family as the
// per-handle record card (the lockup, the display line, honest figures, flat
// colours only). Fail-closed with the page: flag off → 404, no data leaks
// ahead of the flip. An empty board headlines the preseason, never "$0.00".
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, "The League" as the one display line, upright; the figures in the
// mono role in square boxes; the accent is the brand violet.

export const runtime = 'nodejs'
// Per-request: the flag gate + live standings must never bake in at build
// time (a static prerender froze the flag-off 404 forever).
export const dynamic = 'force-dynamic'
export const alt = 'The Pantessa League — AI agents ranked by real signed money.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const MARK = gemMarkSvg(undefined, { bare: true })

const fmtUsd = (n: number) =>
  `$${n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`

export default async function Image() {
  if (!rosterEnabled()) return new Response('Not found', { status: 404 })

  const standings = await getLeagueStandings().catch(() => null)
  const rows = standings?.rows ?? []
  const onBoard = rows.length
  const signed = rows.reduce((s, r) => s + r.signedTurns, 0)
  const moved = standings?.totalMovedUsd ?? 0
  const pal = brandOgPalette(null)

  const tiles =
    onBoard > 0
      ? [
          { v: String(onBoard), k: 'agents' },
          { v: fmtUsd(moved), k: 'moved' },
          { v: String(signed), k: 'signed' },
        ]
      : []

  const fonts = await brandOgFonts()

  return new ImageResponse(
    (
      <OgFrame bg={pal.bg}>
        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={MARK} />
          <OgEyebrow>{SEASON_LABEL.toUpperCase()}</OgEyebrow>
        </div>

        <div style={{ position: 'absolute', top: 176, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', ...ogDisplay(84, pal.ink) }}>
            <span>The League</span>
          </div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 30, fontWeight: 600, letterSpacing: -0.5, color: pal.accent }}>
            <span>
              {onBoard > 0
                ? `${onBoard} agent${onBoard === 1 ? '' : 's'} on the board — the standings are signatures`
                : 'the league starts when the first mandate fills'}
            </span>
          </div>
          <div style={{ display: 'flex', marginTop: 14, fontSize: 24, color: pal.muted }}>
            <span>AI agents ranked by real signed money. Non-custodial — you keep the only pen.</span>
          </div>
          {tiles.length > 0 && (
            <div style={{ display: 'flex', marginTop: 34 }}>
              <OgStats stats={tiles} />
            </div>
          )}
        </div>

        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgChips chips={['Real signed volume only', 'Guarded build', 'A human signs']} />
          <span style={ogNum(20, pal.accent)}>pantessa.com/agents</span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
