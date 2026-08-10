import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { pangolinMarkSvg } from '@/lib/og-marks'
import prisma from '@/lib/db'
import { factsOf, maskAddressTokens } from '@/lib/share-receipts'

// Social card for a receipt permalink (/r/<id>) — the 3am screenshot, as a
// card. Standing receipts lead with NOBODY WAS AT THE KEYBOARD (the product's
// best screenshot is the one where no one was watching); attended receipts
// lead with the ask-to-signature story. Same palette + fonts as the /p card
// so every Pantessa link on a timeline reads as one family.

export const runtime = 'nodejs'
export const alt = 'A Pantessa receipt — built, guarded, and signed from plain English.'
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

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = pangolinMarkSvg(ACCENT)

type Params = { params: Promise<{ slug: string }> }

export default async function Image({ params }: Params) {
  const { slug } = await params
  let receipt = null
  try {
    receipt = await prisma.shareReceipt.findUnique({ where: { id: slug } })
  } catch {
    receipt = null
  }
  const live = receipt && !receipt.revoked ? receipt : null

  const headline = live?.headline ?? 'A Pantessa receipt'
  // Read-time mask for pre-masking rows — no full addresses on the card.
  const ask = live?.ask ? maskAddressTokens(live.ask) : null
  const standing = live?.standing ?? false
  const facts = live ? factsOf(live.facts).slice(0, 3) : []
  const kicker = standing ? 'NOBODY WAS AT THE KEYBOARD' : 'SIGNED FROM ONE CHAT ASK'
  const headlineSize = headline.length > 30 ? (headline.length > 44 ? 56 : 68) : 84

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

        {/* header: lockup + the kicker */}
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
            <span style={{ color: INK, fontSize: 34, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, letterSpacing: 4, color: standing ? ACCENT : MUTED }}>
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: ACCENT }} />
            <span>{kicker}</span>
          </div>
        </div>

        {/* the receipt: headline number-forward, the ask as the quote under it */}
        <div style={{ position: 'absolute', top: 180, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontSize: headlineSize,
              fontWeight: 600,
              letterSpacing: -2.5,
              lineHeight: 1.05,
              maxHeight: 180,
              overflow: 'hidden',
              backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`,
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            <span>{headline}</span>
          </div>
          {ask && (
            <div
              style={{
                display: 'flex',
                marginTop: 26,
                maxHeight: 116,
                overflow: 'hidden',
                fontFamily: 'Newsreader',
                fontStyle: 'italic',
                fontWeight: 500,
                fontSize: ask.length > 60 ? 34 : 42,
                lineHeight: 1.15,
                color: INK,
              }}
            >
              <span>“{ask}”</span>
            </div>
          )}
          {facts.length > 0 && (
            <div style={{ display: 'flex', gap: 28, marginTop: 34, flexWrap: 'wrap' }}>
              {facts.map((f, i) => (
                <div
                  key={i}
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: 10,
                    padding: '10px 18px',
                    borderRadius: 999,
                    border: '1.5px solid rgba(255,255,255,0.14)',
                    background: 'rgba(255,255,255,0.03)',
                    fontSize: 20,
                    color: MUTED,
                    maxWidth: 520,
                    overflow: 'hidden',
                  }}
                >
                  {/* drawn dot, not '✓' — the loaded fonts have no glyph for it (tofu) */}
                  <div style={{ display: 'flex', width: 9, height: 9, borderRadius: 5, background: ACCENT }} />
                  <span style={{ color: INK, whiteSpace: 'nowrap' }}>{f.value.length > 46 ? `${f.value.slice(0, 45)}…` : f.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* footer strip */}
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
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            <span style={{ color: MUTED }}>Do this yourself</span>
            <span style={{ color: ACCENT, fontWeight: 600 }}>yeetful.com/chat</span>
          </div>
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
