import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { roomCardText } from '@/components/community/group/room-logic'
import { readRoom } from './room-read'

// Social card for a room (/g/<slug>): what Telegram, Discord and X draw
// under a pasted room link. It has to read as an invitation: the room's
// name, what it is about, how many are in it, the markets it follows, and
// that joining is one tap. The words come from room-logic roomCardText
// (pinned). A room that cannot be read gets an honest card, never a 500.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'A room on Pantessa. Join in one tap.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

type Params = { params: Promise<{ slug: string }> }

export default async function Image({ params }: Params) {
  const { slug } = await params
  const room = await readRoom(slug).then((r) => r.room, () => null)
  const card = roomCardText(room)
  const pal = brandOgPalette(null)
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [sans, sansSemi] = await Promise.all([readFile(join(fonts, 'geist-500.ttf')), readFile(join(fonts, 'geist-600.ttf'))])
  const hair = 'rgba(255,255,255,0.12)'

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: pal.bg, fontFamily: 'Geist' }}>
        {/* header: the lockup left, what this is right */}
        <div style={{ position: 'absolute', top: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(gemMarkSvg())} width={48} height={48} alt="" />
            <span style={{ color: pal.ink, fontSize: 34, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
            <span style={{ color: pal.muted, fontSize: 17, letterSpacing: 4, marginLeft: 10 }}>ROOM</span>
          </div>
          <div style={{ display: 'flex', padding: '10px 20px', borderRadius: 999, border: `1.5px solid ${pal.accent}`, color: pal.accent, fontSize: 19, letterSpacing: 1.5 }}>
            <span>{card.members.toUpperCase()}</span>
          </div>
        </div>

        {/* the room */}
        <div style={{ position: 'absolute', top: 168, left: 64, right: 64, display: 'flex', flexDirection: 'column', gap: 22 }}>
          <div style={{ display: 'flex', color: pal.ink, fontSize: card.name.length > 26 ? 66 : 84, fontWeight: 600, letterSpacing: -2.4, lineHeight: 1.04 }}>
            <span>{card.name}</span>
          </div>
          <div style={{ display: 'flex', color: pal.muted, fontSize: 30, lineHeight: 1.32, maxWidth: 980 }}>
            <span>{card.about}</span>
          </div>
        </div>

        {/* footer: the markets left, the way in right */}
        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
            {card.markets.map((s) => (
              <div key={s} style={{ display: 'flex', padding: '8px 16px', borderRadius: 10, border: `1.5px solid ${hair}`, color: pal.ink, fontSize: 22, fontWeight: 600 }}>
                <span>{s}</span>
              </div>
            ))}
            {card.moreMarkets && <span style={{ color: pal.muted, fontSize: 22, marginLeft: 4 }}>{card.moreMarkets}</span>}
            {card.markets.length === 0 && <span style={{ color: pal.muted, fontSize: 22 }}>Chart ideas, calls, and trades with proof</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 6 }}>
            <span style={{ color: pal.ink, fontSize: 24, fontWeight: 600 }}>Join in one tap</span>
            <span style={{ color: pal.muted, fontSize: 19, letterSpacing: 0.5 }}>{card.url}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
}
