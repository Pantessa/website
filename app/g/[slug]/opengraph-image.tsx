import { ImageResponse } from 'next/og'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgFrame, OgLockup, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { roomCardText } from '@/components/community/group/room-logic'
import { readRoom } from './room-read'

// Social card for a room (/g/<slug>): what Telegram, Discord and X draw
// under a pasted room link. It has to read as an invitation: the room's
// name, what it is about, how many are in it, the markets it follows, and
// that joining is one tap. The words come from room-logic roomCardText
// (pinned). A room that cannot be read gets an honest card, never a 500.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the room's name as the one display line, its markets in square
// boxes that share their edges, the member count a square box in the brand
// violet.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'A room on Pantessa. Join in one tap.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'
/** T13: a real room's card is cached an hour at the edge (the house pattern:
 *  app/api/og/live sets cache-control on the response; force-dynamic stays
 *  because the read is the database). An unread store (an honest card) and a
 *  404 are cached briefly. */
export const ROOM_CARD_CACHE = 'public, max-age=300, s-maxage=3600, stale-while-revalidate=86400'
export const ROOM_CARD_MISS_CACHE = 'public, max-age=60, s-maxage=60'

type Params = { params: Promise<{ slug: string }> }

export default async function Image({ params }: Params) {
  const { slug } = await params
  const read = await readRoom(slug).catch(() => ({ room: null, known: false, internal: false }))
  // T13: no such room → a 404 with no image drawn (a made-up slug used to cost a full render).
  if (read.known && !read.room) return new Response(null, { status: 404, headers: { 'cache-control': ROOM_CARD_MISS_CACHE } })
  const room = read.room
  const card = roomCardText(room)
  const pal = brandOgPalette(null)
  const fonts = await brandOgFonts()
  const mark = gemMarkSvg(undefined, { bare: true })

  return new ImageResponse(
    (
      <OgFrame bg={pal.bg}>
        {/* header: the lockup left, what this is right */}
        <div style={{ position: 'absolute', top: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={mark} size={48} tag="ROOM" />
          <div style={{ display: 'flex', padding: '10px 18px', border: `1.5px solid ${pal.accent}`, ...ogLabel(17, pal.accent) }}>
            <span>{card.members.toUpperCase()}</span>
          </div>
        </div>

        {/* the room */}
        <div style={{ position: 'absolute', top: 164, left: 64, right: 64, display: 'flex', flexDirection: 'column', gap: 24 }}>
          <div style={{ display: 'flex', maxHeight: 150, overflow: 'hidden', ...ogDisplay(card.name.length > 26 ? 62 : 80, pal.ink) }}>
            <span>{card.name}</span>
          </div>
          <div style={{ display: 'flex', color: pal.muted, fontSize: 30, lineHeight: 1.32, maxWidth: 980 }}>
            <span>{card.about}</span>
          </div>
        </div>

        {/* footer: the markets left, the way in right */}
        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center' }}>
            {card.markets.map((s, i) => (
              <div key={s} style={{ display: 'flex', padding: '9px 16px', marginLeft: i === 0 ? 0 : -1.5, border: `1.5px solid rgba(${OG.inkRgb},0.18)`, color: pal.ink, fontSize: 21, fontWeight: 600 }}>
                <span>{s}</span>
              </div>
            ))}
            {card.moreMarkets && <span style={{ ...ogNum(20, pal.muted, 500), marginLeft: 14 }}>{card.moreMarkets}</span>}
            {card.markets.length === 0 && <span style={{ color: pal.muted, fontSize: 22 }}>Chart ideas, calls, and trades with proof</span>}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: 8 }}>
            <span style={{ color: pal.ink, fontSize: 24, fontWeight: 600 }}>Join in one tap</span>
            <span style={ogNum(18, pal.accent, 500)}>{card.url}</span>
          </div>
        </div>
      </OgFrame>
    ),
    {
      ...size,
      headers: { 'cache-control': room ? ROOM_CARD_CACHE : ROOM_CARD_MISS_CACHE },
      fonts,
    },
  )
}
