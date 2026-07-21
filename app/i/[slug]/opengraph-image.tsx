import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import prisma from '@/lib/db'

// Social card for an intent link (/i/<slug>) — the ASK is the hero: the
// sentence in serif quotes, the one-tap promise under it, the guardrail
// strip as the footer. Same palette + fonts as the /p and /r cards so every
// Yeetful link on a timeline reads as one family.

export const runtime = 'nodejs'
export const alt = 'A Yeetful intent link — one tap from ask to signed.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
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

const CONTRACT_PILLS = ['Guarded build', 'Your wallet signs', 'Receipted']

type Params = { params: Promise<{ slug: string }> }

export default async function Image({ params }: Params) {
  const { slug } = await params
  let link = null
  try {
    link = await prisma.intentLink.findUnique({ where: { id: slug } })
  } catch {
    link = null
  }
  const live = link && !link.revoked ? link : null
  const ask = live?.ask ?? 'One tap from ask to signed'
  const askSize = ask.length > 80 ? 44 : ask.length > 44 ? 56 : 72

  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serifItalic, sans, sansSemi] = await Promise.all([
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
        <img src={toDataUri(AMBIENT)} width={1200} height={630} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />

        {/* header: lockup + kicker */}
        <div
          style={{
            position: 'absolute',
            top: 48,
            left: 64,
            right: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(MARK)} width={46} height={46} alt="" />
            <span style={{ color: INK, fontSize: 34, fontWeight: 600, letterSpacing: -1.2 }}>yeetful</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, letterSpacing: 4, color: MUTED }}>
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: ACCENT }} />
            <span>INTENT LINK · TAP TO RUN</span>
          </div>
        </div>

        {/* the ask — the hero */}
        <div style={{ position: 'absolute', top: 200, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Newsreader',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: askSize,
              lineHeight: 1.12,
              maxHeight: 250,
              overflow: 'hidden',
              color: INK,
            }}
          >
            <span>“{ask}”</span>
          </div>
          <div
            style={{
              display: 'flex',
              marginTop: 30,
              fontSize: 30,
              fontWeight: 600,
              letterSpacing: -0.5,
              backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`,
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            <span>Connect a wallet and the path builds itself.</span>
          </div>
        </div>

        {/* footer: contract pills + the door */}
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: 64,
            right: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: 14 }}>
            {CONTRACT_PILLS.map((label) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '9px 16px',
                  borderRadius: 999,
                  border: '1.5px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.03)',
                  fontSize: 19,
                  color: INK,
                }}
              >
                <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: ACCENT }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <span style={{ color: ACCENT, fontWeight: 600, fontSize: 21 }}>yeetful.com</span>
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
