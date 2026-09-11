import { ImageResponse } from 'next/og'
import { gemMarkSvg } from '@/lib/og-marks'
import { publicWatchlistBySlug } from '@/lib/watchlists-store'

// Social card for a public watchlist: the name is the hero, the symbols are
// the proof line. Same fence as the page (public AND not internal); an
// unknown slug renders the house card rather than 404ing the image.

export const runtime = 'nodejs'
export const alt = 'A Pantessa watchlist — live quotes, every row trades.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

type Params = { params: Promise<{ slug: string }> }

export default async function Image({ params }: Params) {
  const { slug } = await params
  const list = await publicWatchlistBySlug(slug).catch(() => null)
  const name = list?.name ?? 'Watchlist'
  const symbols = list?.symbols ?? []
  const mark = toDataUri(gemMarkSvg())
  return new ImageResponse(
    (
      <div style={{ width: 1200, height: 630, display: 'flex', flexDirection: 'column', background: '#0b0b0c', color: '#fff', padding: 64, fontFamily: 'system-ui, sans-serif' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 16, fontSize: 22, letterSpacing: 4, textTransform: 'uppercase', color: '#8a8f8c' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={mark} width={40} height={40} alt="" />
          <span>Public watchlist · {symbols.length} symbols</span>
        </div>
        <div style={{ display: 'flex', fontSize: 84, fontWeight: 600, letterSpacing: -2, marginTop: 40, lineHeight: 1.05 }}>{name}</div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12, marginTop: 40 }}>
          {symbols.slice(0, 18).map((s) => (
            <div key={s} style={{ display: 'flex', padding: '10px 20px', borderRadius: 999, border: '2px solid #2a2d2b', fontSize: 28, color: '#e8ebe9' }}>
              {s}
            </div>
          ))}
          {symbols.length > 18 && <div style={{ display: 'flex', padding: '10px 20px', fontSize: 28, color: '#8a8f8c' }}>+{symbols.length - 18} more</div>}
        </div>
        <div style={{ display: 'flex', marginTop: 'auto', justifyContent: 'space-between', fontSize: 24, color: '#8a8f8c' }}>
          <span>Live quotes · every row trades from one sentence</span>
          <span style={{ color: '#3ECF8E' }}>pantessa.com/lists/{slug}</span>
        </div>
      </div>
    ),
    { ...size },
  )
}
