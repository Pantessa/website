import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brandOgPalette } from '@/lib/brand-theme'
import { pangolinMarkSvg } from '@/lib/og-marks'
import { rosterEnabled } from '@/lib/league'

// Social card for /roster — judged as a STRANGER AT DM THUMBNAIL SIZE
// (~300px wide): before this file the page fell back to the generic site
// card, which says nothing about the Roster. At thumbnail only three things
// survive, so the card is exactly three things, huge: the pangolin (WHOSE),
// the claim (WHAT — "Your wallet gets a staff. / You keep the only pen."),
// and one accent line carrying the safety contract (non-custodial). Chips
// and fine print deliberately absent — they'd be noise at 300px.
// Satori-flat (flex + solid colors), fail-closed with the page's flag.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'The Pantessa Roster — your wallet gets a staff; you keep the only pen.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const ambient = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="amb" cx="0.3" cy="0.4" r="0.9">
      <stop offset="0" stop-color="rgba(52,227,160,0.12)"/>
      <stop offset="0.7" stop-color="rgba(52,227,160,0)"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#amb)"/>
</svg>`

export default async function Image() {
  if (!rosterEnabled()) return new Response('Not found', { status: 404 })
  const pal = brandOgPalette(null)

  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
  ])

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: pal.bg, fontFamily: 'Geist' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toDataUri(ambient())} width={1200} height={630} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />

        {/* WHOSE — the pangolin + wordmark, big enough to read at 300px. */}
        <div style={{ position: 'absolute', top: 52, left: 64, display: 'flex', alignItems: 'center', gap: 18 }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={toDataUri(pangolinMarkSvg())} width={64} height={64} alt="" />
          <span style={{ color: pal.ink, fontSize: 44, fontWeight: 600, letterSpacing: -1.6 }}>pantessa</span>
        </div>

        {/* WHAT — the claim, the biggest thing on the card. */}
        <div style={{ position: 'absolute', top: 200, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              fontFamily: 'Newsreader',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: 88,
              lineHeight: 1.04,
              color: pal.ink,
            }}
          >
            <span>Your wallet gets a staff.</span>
            <span style={{ color: pal.accent }}>You keep the only pen.</span>
          </div>
          {/* The safety contract — one line, still legible at thumbnail. */}
          <div style={{ display: 'flex', marginTop: 30, fontSize: 32, fontWeight: 600, letterSpacing: -0.5, color: pal.muted }}>
            <span>Non-custodial — agents can only propose. You sign, or nothing moves.</span>
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={{ color: pal.muted, fontSize: 24 }}>Hire an AI manager · fire it any time · nothing to withdraw</span>
          <span style={{ color: pal.accent, fontWeight: 600, fontSize: 24 }}>pantessa.com/roster</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Newsreader', data: serifItalic, weight: 500, style: 'italic' },
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
}
