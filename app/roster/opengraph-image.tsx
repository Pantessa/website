import { ImageResponse } from 'next/og'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { OgFrame, OgLockup, ogDisplay, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { rosterEnabled } from '@/lib/league'

// Social card for /roster — judged as a STRANGER AT DM THUMBNAIL SIZE
// (~300px wide): before this file the page fell back to the generic site
// card, which says nothing about the Roster. At thumbnail only three things
// survive, so the card is exactly three things, huge: the mark (WHOSE),
// the claim (WHAT — "Your wallet gets a staff. / You keep the only pen."),
// and one line carrying the safety contract (non-custodial). Chips and fine
// print deliberately absent — they'd be noise at 300px.
// Satori-flat (flex + solid colors), fail-closed with the page's flag.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the Cut P in its own colours, the claim as the one display line,
// upright and white on both of its lines.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'The Pantessa Roster — your wallet gets a staff; you keep the only pen.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const MARK = gemMarkSvg(undefined, { bare: true })

export default async function Image() {
  if (!rosterEnabled()) return new Response('Not found', { status: 404 })
  const pal = brandOgPalette(null)

  const fonts = await brandOgFonts()

  return new ImageResponse(
    (
      <OgFrame bg={pal.bg}>
        {/* WHOSE — the mark + wordmark, big enough to read at 300px. */}
        <div style={{ position: 'absolute', top: 52, left: 64, display: 'flex' }}>
          <OgLockup mark={MARK} size={60} />
        </div>

        {/* WHAT — the claim, the biggest thing on the card. */}
        <div style={{ position: 'absolute', top: 192, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap', ...ogDisplay(80, pal.ink) }}>
            <span>Your wallet gets a staff.</span>
            <span>You keep the only pen.</span>
          </div>
          {/* The safety contract — one line, still legible at thumbnail. */}
          <div style={{ display: 'flex', marginTop: 32, fontSize: 31, fontWeight: 600, letterSpacing: -0.5, color: pal.muted }}>
            <span>Non-custodial — agents can only propose. You sign, or nothing moves.</span>
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: pal.muted, fontSize: 24 }}>Hire an AI manager · fire it any time · nothing to withdraw</span>
          <span style={ogNum(22, pal.accent)}>pantessa.com/roster</span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
