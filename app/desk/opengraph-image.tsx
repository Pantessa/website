import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gemMarkSvg } from '@/lib/og-marks'

// Social card for /desk — the governed desk (squad five-million, DESKPAGE
// lane, 2026-11-03). The house dark card: the lockup, the line in Newsreader
// italic, the three words a compliance desk is buying, the same pill footer
// family as the /i, /p and /l cards. Static: no DB, no env.

export const runtime = 'nodejs'
export const alt = 'Pantessa — the governed desk. Your custody signs.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const AMBIENT = `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="amb" cx="0.78" cy="0.3" r="0.75">
      <stop offset="0" stop-color="rgba(62,207,142,0.14)"/>
      <stop offset="0.7" stop-color="rgba(62,207,142,0)"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#amb)"/>
</svg>`

export default async function Image() {
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
  ])

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: '#000', fontFamily: 'Geist' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toDataUri(AMBIENT)} width={1200} height={630} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />

        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(gemMarkSvg())} width={46} height={46} alt="" />
            <span style={{ color: '#fff', fontSize: 34, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, letterSpacing: 4, color: 'rgba(255,255,255,0.55)' }}>
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: '#3ECF8E' }} />
            <span>THE GOVERNED DESK</span>
          </div>
        </div>

        <div style={{ position: 'absolute', top: 196, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', fontFamily: 'Newsreader', fontStyle: 'italic', fontWeight: 500, fontSize: 66, lineHeight: 1.08, color: '#fff', maxWidth: 1040 }}>
            <span>The DeFi execution desk that lives inside your controls.</span>
          </div>
          <div style={{ display: 'flex', marginTop: 28, fontSize: 28, fontWeight: 600, letterSpacing: -0.4, color: '#3ECF8E' }}>
            <span>Your custody signs · your policy decides the venues · the chain proves the receipt</span>
          </div>
          <div style={{ display: 'flex', marginTop: 14, fontSize: 23, color: 'rgba(255,255,255,0.62)' }}>
            <span>Deterministic builders write every transaction. No model ever writes calldata.</span>
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {['Default-deny policy', 'Hash-chained blotter', 'Pinned venues'].map((label) => (
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
                  color: '#fff',
                }}
              >
                <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: '#3ECF8E' }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <span style={{ color: '#3ECF8E', fontWeight: 600, fontSize: 21 }}>pantessa.com/desk</span>
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
