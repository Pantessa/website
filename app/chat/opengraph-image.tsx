import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gemMarkSvg } from '@/lib/og-marks'

// Social card for /chat — the deep-link surface (?prompt= handoffs from
// shares, splash chips, docs examples all land here). The card shows the
// product's shape in one glance: a composer holding a real ask, and the
// receipt line it becomes. Defining og metadata on the segment without this
// file would ship NO image (the /p lesson) — hence the explicit card.

export const runtime = 'nodejs'
export const alt = 'Pantessa chat — say what should happen; sign what it builds.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
const ACCENT = '#34e3a0'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const AMBIENT = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="amb" cx="0.5" cy="0.42" r="0.8">
      <stop offset="0" stop-color="rgba(52,227,160,0.10)"/>
      <stop offset="0.7" stop-color="rgba(52,227,160,0)"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#amb)"/>
</svg>`

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(ACCENT)

export default async function Image() {
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
  ])

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toDataUri(AMBIENT)} width={1200} height={630} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />

        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(MARK)} width={46} height={46} alt="" />
            <span style={{ color: INK, fontSize: 34, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, letterSpacing: 4, color: MUTED }}>
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: ACCENT }} />
            <span>EVERY DAPP · ONE CHAT</span>
          </div>
        </div>

        {/* the claim */}
        <div style={{ position: 'absolute', top: 170, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontSize: 66, fontWeight: 600, letterSpacing: -2.2, lineHeight: 1.08, color: INK }}>
            <span>Say what should happen.</span>
          </div>
          <div
            style={{
              display: 'flex',
              fontSize: 66,
              fontWeight: 600,
              letterSpacing: -2.2,
              lineHeight: 1.08,
              backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`,
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            <span>Sign what it builds.</span>
          </div>

          {/* the composer, holding a real standing ask */}
          <div
            style={{
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
              marginTop: 52,
              padding: '22px 30px',
              borderRadius: 22,
              border: '1.5px solid rgba(255,255,255,0.16)',
              background: 'rgba(255,255,255,0.04)',
            }}
          >
            <span style={{ fontFamily: 'Newsreader', fontStyle: 'italic', fontWeight: 500, fontSize: 34, color: INK }}>
              buy $10 of AAPL every week…
            </span>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                width: 52,
                height: 52,
                borderRadius: 26,
                background: ACCENT,
                color: '#04120c',
                fontSize: 28,
                fontWeight: 600,
              }}
            >
              ↑
            </div>
          </div>
        </div>

        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: 64,
            right: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            fontSize: 21,
          }}
        >
          <span style={{ color: MUTED, letterSpacing: 3.5 }}>GUARDED · SIGNED · RECEIPTED</span>
          <span style={{ color: ACCENT, fontWeight: 600 }}>pantessa.com/chat</span>
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
