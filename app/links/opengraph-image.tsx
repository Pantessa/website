import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gemMarkSvg } from '@/lib/og-marks'

// Social card for the link surfaces that have no ask of their own — /links
// (the public board), /links/embed, /sign, /inbox. These are the pages
// people SHARE ("here's the board", "here's your inbox"), and until
// 2026-09-08 they unfurled with no image at all: a page-level `openGraph`
// block replaces the root's, and Next does not carry the root file-based
// card into it. Same family as the /i card — serif hero, promise line,
// contract pills — so every Pantessa link on a timeline reads as one set.

export const runtime = 'nodejs'
export const alt = 'Pantessa intent links — a link that moves money. Your wallet signs.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = 'rgba(250,250,247,0.62)'
const ACCENT = '#34e3a0'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const AMBIENT = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="amb" cx="0.5" cy="0.35" r="0.8">
      <stop offset="0" stop-color="rgba(52,227,160,0.10)"/>
      <stop offset="0.7" stop-color="rgba(52,227,160,0)"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#amb)"/>
</svg>`

const CONTRACT_PILLS = ['Guarded build', 'Your wallet signs', 'Receipted']

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

        {/* header: the house lockup + the eyebrow */}
        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(gemMarkSvg())} width={46} height={46} alt="" />
            <span style={{ fontSize: 34, fontWeight: 600, letterSpacing: -0.5, color: INK }}>pantessa</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 19, letterSpacing: 3, color: MUTED }}>
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: ACCENT }} />
            <span>INTENT LINKS · YOUR WALLET SIGNS</span>
          </div>
        </div>

        {/* the hero */}
        <div style={{ position: 'absolute', top: 190, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontFamily: 'Newsreader', fontStyle: 'italic', fontWeight: 500, fontSize: 72, lineHeight: 1.12, color: INK }}>
            <span>A link that moves money.</span>
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 28,
              fontSize: 38,
              fontWeight: 600,
              letterSpacing: -0.5,
              backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`,
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            <span>Mint a sentence. Share the link. Their wallet signs.</span>
          </div>
          <div style={{ display: 'flex', marginTop: 14, fontSize: 26, color: MUTED }}>
            <span>Nothing moves until someone signs — in their own wallet.</span>
          </div>
        </div>

        {/* footer: contract pills + the door */}
        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {CONTRACT_PILLS.map((label) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '10px 18px',
                  borderRadius: 999,
                  border: '1.5px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.03)',
                  fontSize: 23,
                  color: INK,
                }}
              >
                <div style={{ display: 'flex', width: 9, height: 9, borderRadius: 5, background: ACCENT }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <span style={{ color: ACCENT, fontWeight: 600, fontSize: 21 }}>pantessa.com</span>
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
