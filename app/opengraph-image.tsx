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

export const alt = 'Yeetful — Mega dapps are here. Every dapp, one chat.'
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

// The hub mark from app/icon.svg, tinted for the dark card (faint tile
// border so the tile reads against #050708; emerald center ring = the core).
const MARK = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 52 52" fill="none">
  <rect x="0.75" y="0.75" width="50.5" height="50.5" rx="11.5" fill="#0B0E0D" stroke="rgba(255,255,255,0.16)" stroke-width="1.5"/>
  <g transform="translate(6 5)">
    <mask id="hub"><rect width="40" height="40" fill="#fff"/><circle cx="20" cy="20" r="1.9" fill="#000"/></mask>
    <g mask="url(#hub)" stroke="#ffffff" stroke-width="2.2" stroke-linecap="round">
      <line x1="20" y1="20" x2="9" y2="9"/><line x1="20" y1="20" x2="31" y2="9"/><line x1="20" y1="20" x2="20" y2="33"/>
    </g>
    <g fill="#ffffff"><circle cx="9" cy="9" r="4.4"/><circle cx="31" cy="9" r="4.4"/><circle cx="20" cy="33" r="4.4"/></g>
    <circle cx="20" cy="20" r="3" fill="none" stroke="${ACCENT}" stroke-width="2.2"/>
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
            <span style={{ color: INK, fontSize: 62, fontWeight: 600, letterSpacing: -2.5 }}>yeetful</span>
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
