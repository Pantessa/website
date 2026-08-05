import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'

// Social card for the site (og:image + twitter:image via app/twitter-image.tsx).
// The Mega-dapps pivot card, drawn in the fusion hero's language: protocol
// rivers converging into one emerald core on #050708, a big serif headline
// with the emerald→gold gradient italic, and a prominent logo lockup + tag.
// Deliberately NO body copy — share previews render too small to read it.
// Fonts are embedded from assets/og-fonts (static TTF instances of the same
// Google-Fonts families the site loads: Newsreader 500 + Geist 500/600).

export const alt = 'Pantessa — Mega dapps are here. Every dapp, one chat.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#050708'
const INK = '#FAFAF7'
const ACCENT = '#34e3a0'

// Where the rivers fuse (the hero's transmuting core).
const CX = 600
const CY = 345

// The living artwork as one SVG layer: ambient glow → four protocol rivers
// with particles → the core → a dark veil ellipse that damps the glow behind
// the headline (the hero's .fhero__veil, baked in).
const ART = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="amb" cx="0.5" cy="0.42" r="0.7">
      <stop offset="0" stop-color="rgba(52,227,160,0.07)"/>
      <stop offset="0.65" stop-color="rgba(52,227,160,0)"/>
    </radialGradient>
    <radialGradient id="core" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="rgba(52,227,160,0.26)"/>
      <stop offset="1" stop-color="rgba(52,227,160,0)"/>
    </radialGradient>
    <radialGradient id="veil" cx="0.5" cy="0.5" r="0.5">
      <stop offset="0" stop-color="rgba(5,7,8,0.62)"/>
      <stop offset="1" stop-color="rgba(5,7,8,0)"/>
    </radialGradient>
    <linearGradient id="gU" gradientUnits="userSpaceOnUse" x1="130" y1="195" x2="${CX}" y2="${CY}">
      <stop offset="0" stop-color="rgba(255,107,175,0.12)"/><stop offset="0.4" stop-color="rgba(255,107,175,0.75)"/><stop offset="1" stop-color="rgba(255,107,175,0.2)"/>
    </linearGradient>
    <linearGradient id="gS" gradientUnits="userSpaceOnUse" x1="1070" y1="185" x2="${CX}" y2="${CY}">
      <stop offset="0" stop-color="rgba(255,201,77,0.12)"/><stop offset="0.4" stop-color="rgba(255,201,77,0.75)"/><stop offset="1" stop-color="rgba(255,201,77,0.2)"/>
    </linearGradient>
    <linearGradient id="gC" gradientUnits="userSpaceOnUse" x1="150" y1="480" x2="${CX}" y2="${CY}">
      <stop offset="0" stop-color="rgba(122,167,255,0.12)"/><stop offset="0.4" stop-color="rgba(122,167,255,0.75)"/><stop offset="1" stop-color="rgba(122,167,255,0.2)"/>
    </linearGradient>
    <linearGradient id="gY" gradientUnits="userSpaceOnUse" x1="1050" y1="492" x2="${CX}" y2="${CY}">
      <stop offset="0" stop-color="rgba(52,227,160,0.12)"/><stop offset="0.4" stop-color="rgba(52,227,160,0.8)"/><stop offset="1" stop-color="rgba(52,227,160,0.25)"/>
    </linearGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#amb)"/>
  <g fill="none" stroke-linecap="round">
    <path d="M130,195 C300,130 430,210 585,330" stroke="url(#gU)" stroke-width="2.5"/>
    <path d="M138,213 C305,152 432,228 580,338" stroke="rgba(255,107,175,0.28)" stroke-width="1.3"/>
    <path d="M1070,185 C900,115 760,210 618,328" stroke="url(#gS)" stroke-width="2.5"/>
    <path d="M1062,203 C898,138 762,228 622,336" stroke="rgba(255,201,77,0.28)" stroke-width="1.3"/>
    <path d="M150,480 C330,545 460,470 585,362" stroke="url(#gC)" stroke-width="2.5"/>
    <path d="M158,462 C332,522 458,452 582,355" stroke="rgba(122,167,255,0.28)" stroke-width="1.3"/>
    <path d="M1050,492 C880,555 745,470 618,360" stroke="url(#gY)" stroke-width="2.5" stroke-dasharray="7 8"/>
  </g>
  <g fill="#FF6BAF"><circle cx="223" cy="166" r="3.5" opacity="0.9"/><circle cx="320" cy="175" r="3" opacity="0.7"/><circle cx="416" cy="214" r="2.5" opacity="0.55"/><circle cx="505" cy="269" r="2" opacity="0.4"/></g>
  <g fill="#FFC94D"><circle cx="975" cy="160" r="3.5" opacity="0.9"/><circle cx="880" cy="172" r="3" opacity="0.7"/><circle cx="788" cy="213" r="2.5" opacity="0.55"/><circle cx="700" cy="266" r="2" opacity="0.4"/></g>
  <g fill="#7AA7FF"><circle cx="256" cy="502" r="3.5" opacity="0.9"/><circle cx="356" cy="494" r="3" opacity="0.7"/><circle cx="450" cy="462" r="2.5" opacity="0.55"/><circle cx="521" cy="414" r="2" opacity="0.4"/></g>
  <g fill="#34e3a0"><circle cx="947" cy="510" r="3.5" opacity="0.9"/><circle cx="849" cy="497" r="3" opacity="0.7"/><circle cx="757" cy="459" r="2.5" opacity="0.55"/><circle cx="683" cy="413" r="2" opacity="0.4"/></g>
  <circle cx="${CX}" cy="${CY}" r="185" fill="url(#core)"/>
  <g fill="none">
    <circle cx="${CX}" cy="${CY}" r="96" stroke="rgba(255,210,94,0.16)" stroke-width="1"/>
    <circle cx="${CX}" cy="${CY}" r="66" stroke="rgba(52,227,160,0.45)" stroke-width="1.4"/>
    <circle cx="${CX}" cy="${CY}" r="42" stroke="rgba(52,227,160,0.75)" stroke-width="2"/>
    <circle cx="${CX}" cy="${CY}" r="20" stroke="rgba(125,240,189,0.9)" stroke-width="2" fill="rgba(52,227,160,0.16)"/>
  </g>
  <ellipse cx="${CX}" cy="${CY}" rx="360" ry="160" fill="url(#veil)"/>
</svg>`

// The pangolin mark from app/icon.svg, on a tile tuned for the dark card
// (faint border so the tile reads against #050708; the set plate = the accent).
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" fill="none">
  <rect x="2" y="2" width="124" height="124" rx="27" fill="#0B0E0D" stroke="rgba(255,255,255,0.16)" stroke-width="3.5"/>
  <g transform="translate(15.7 19.6) scale(0.755)">
    <mask id="pgog">
      <rect x="-1" y="18.1" width="130.7" height="80.9" fill="#000"/>
      <path d="M 11.8 89.6 L 12.9 89.5 L 14.4 89.9 L 16.0 90.5 L 17.5 90.7 L 18.6 90.2 L 20.1 90.2 L 22.0 90.7 L 24.3 91.6 L 26.4 92.3 L 28.3 92.5 L 29.7 92.0 L 30.9 91.2 L 32.2 90.6 L 33.7 90.1 L 35.2 89.8 L 36.9 89.5 L 38.5 89.2 L 40.2 89.0 L 41.9 88.7 L 43.5 88.3 L 45.1 87.9 L 46.5 87.2 L 47.8 86.5 L 49.0 85.6 L 50.2 84.8 L 51.6 84.1 L 53.0 83.6 L 54.5 83.1 L 56.0 82.8 L 57.6 82.4 L 59.1 82.2 L 60.6 81.9 L 62.1 81.6 L 63.5 81.3 L 64.8 80.9 L 66.1 80.5 L 67.2 79.9 L 68.3 79.3 L 69.3 78.7 L 70.2 78.1 L 71.2 77.4 L 72.1 76.8 L 73.0 76.2 L 73.8 75.7 L 74.7 75.2 L 75.5 74.7 L 76.3 74.3 L 77.1 74.0 L 77.8 73.7 L 78.4 73.2 L 79.0 72.5 L 79.5 71.7 L 80.0 70.7 L 80.4 69.8 L 81.0 69.0 L 81.5 68.4 L 82.1 68.0 L 82.7 67.9 L 83.2 67.5 L 83.8 66.6 L 84.5 65.5 L 85.4 64.2 L 86.3 63.0 L 87.3 62.2 L 95.5 33.1 L 93.6 31.7 L 91.7 30.2 L 89.7 28.6 L 87.5 27.3 L 85.3 26.4 L 83.1 25.9 L 80.8 25.9 L 78.6 25.7 L 76.3 25.5 L 74.0 25.1 L 71.7 24.9 L 69.4 24.6 L 67.1 24.6 L 64.9 24.7 L 62.7 25.1 L 60.6 25.7 L 58.6 26.4 L 56.5 27.1 L 54.5 27.8 L 52.6 28.6 L 50.6 29.3 L 48.7 30.1 L 46.8 30.9 L 44.9 31.8 L 43.1 32.7 L 41.4 33.7 L 39.7 34.7 L 38.1 35.8 L 36.5 37.1 L 35.1 38.4 L 33.8 39.8 L 32.5 41.3 L 31.3 42.8 L 30.1 44.4 L 29.0 45.9 L 27.8 47.3 L 26.7 48.8 L 25.5 50.1 L 24.3 51.3 L 23.0 52.5 L 21.8 53.5 L 20.6 54.7 L 19.5 55.9 L 18.5 57.2 L 17.7 58.6 L 16.9 60.0 L 16.1 61.4 L 15.4 62.8 L 14.6 64.1 L 13.9 65.3 L 13.1 66.5 L 12.2 67.4 L 11.3 68.3 L 10.6 69.3 L 10.4 70.9 L 10.5 72.8 L 10.7 74.8 L 10.6 76.6 L 10.2 77.7 L 9.6 78.4 L 9.3 79.5 L 9.2 80.9 L 8.9 82.2 L 8.4 82.9 L 5.5 88.2 Z" fill="#fff" stroke="#fff" stroke-width="5" stroke-linejoin="round"/>
      <circle cx="100.9" cy="50.3" r="11" fill="#fff"/>
      <path d="M 95.7 55.5 L 123.2 61.8 L 103.4 43.2 Z" fill="#fff" stroke="#fff" stroke-width="8" stroke-linejoin="round"/>
      <g fill="none" stroke="#000" stroke-linejoin="round" stroke-linecap="round">
        <path d="M 29.6 92.0 L 15.3 82.8 L 11.3 68.3" stroke-width="7"/>
        <path d="M 62.6 81.5 L 40.8 62.9 L 34.2 39.3" stroke-width="7"/>
        <path d="M 80.8 69.3 L 70.9 46.6 L 75.5 25.3" stroke-width="7"/>
        <path d="M 87.3 62.2 L 84.8 45.0 L 95.5 33.1" stroke-width="9"/>
      </g>
      <circle cx="101" cy="54.7" r="4.6" fill="#000"/>
    </mask>
    <rect x="-1" y="18.1" width="130.7" height="80.9" fill="#ffffff" mask="url(#pgog)"/>
    <path d="M 66.3 80.4 L 68.2 79.3 L 69.9 78.3 L 71.6 77.2 L 73.1 76.2 L 74.5 75.2 L 75.9 74.5 L 77.3 73.9 L 78.4 73.2 L 79.3 71.9 L 66.7 48.0 L 68.9 24.6 L 65.0 24.7 L 61.3 25.5 L 57.7 26.7 L 54.3 27.9 L 50.9 29.2 L 47.6 30.6 L 44.4 32.1 L 41.3 33.7 L 38.4 35.5 L 44.6 60.1 Z" fill="${ACCENT}" stroke="${ACCENT}" stroke-width="2.5" stroke-linejoin="round"/>
  </g>
</svg>`

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

// Glyph medallions at the river sources (the hero's protocol chips, glyph-only
// so the card carries zero fine print).
const MEDALLIONS = [
  { x: 130, y: 195, color: '#FF6BAF', rgb: '255,107,175', glyph: 'U', dashed: false },
  { x: 1070, y: 185, color: '#FFC94D', rgb: '255,201,77', glyph: 'S', dashed: false },
  { x: 150, y: 480, color: '#7AA7FF', rgb: '122,167,255', glyph: 'C', dashed: false },
  { x: 1050, y: 492, color: '#34e3a0', rgb: '52,227,160', glyph: '+', dashed: true },
]

export default async function Image() {
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serif, serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(fonts, 'newsreader-500.ttf')),
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: BG,
          fontFamily: 'Geist',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toDataUri(ART)} width={1200} height={630} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />

        {MEDALLIONS.map((m) => (
          <div
            key={m.glyph}
            style={{
              position: 'absolute',
              left: m.x - 33,
              top: m.y - 33,
              width: 66,
              height: 66,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'center',
              borderRadius: 33,
              border: `1.5px ${m.dashed ? 'dashed' : 'solid'} rgba(${m.rgb},0.55)`,
              background: `rgba(${m.rgb},0.09)`,
              boxShadow: `0 0 36px rgba(${m.rgb},0.28)`,
              color: m.color,
              fontSize: 30,
              fontWeight: 600,
            }}
          >
            {m.glyph}
          </div>
        ))}

        <div
          style={{
            position: 'absolute',
            top: 0,
            left: 0,
            width: 1200,
            height: 630,
            display: 'flex',
            flexDirection: 'column',
            alignItems: 'center',
            paddingTop: 58,
          }}
        >
          {/* logo lockup + tag */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 22 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(MARK)} width={82} height={82} alt="" />
            <span style={{ color: INK, fontSize: 62, fontWeight: 600, letterSpacing: -2.5 }}>pantessa</span>
          </div>
          <div style={{ display: 'flex', marginTop: 20, fontSize: 25, letterSpacing: 6.5, color: '#8a9186' }}>
            <span>EVERY DAPP</span>
            <span style={{ color: ACCENT, margin: '0 18px' }}>·</span>
            <span>ONE CHAT</span>
          </div>

          {/* the headline — hero serif, gradient italic on the payoff line */}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              alignItems: 'center',
              marginTop: 52,
              fontFamily: 'Newsreader',
              fontWeight: 500,
              fontSize: 148,
              lineHeight: 0.98,
              letterSpacing: -4.4,
            }}
          >
            <span style={{ color: INK }}>Mega dapps</span>
            <span
              style={{
                fontStyle: 'italic',
                letterSpacing: -1.8,
                backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`,
                backgroundClip: 'text',
                color: 'transparent',
                paddingBottom: 14,
                paddingLeft: 10,
                paddingRight: 10,
              }}
            >
              are here.
            </span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Newsreader', data: serif, weight: 500, style: 'normal' },
        { name: 'Newsreader', data: serifItalic, weight: 500, style: 'italic' },
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
}
