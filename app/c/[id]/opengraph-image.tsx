import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { readCall } from '@/lib/chart-calls-read'
import { callCardSvg, fmtCallPrice, fmtCallTime, fmtMove } from '@/lib/chart-calls'

// Social card for a call (/c/<id>) — what X draws under the post. The claim
// in the author's words, the stamp (time + the tape's price then), the move
// since, and the daily tape with the call's own lines and a rule on the day
// it was made. Rendered per request, so the "now" on the card is now. The
// Pantessa lockup is the watermark: a call that travels says where it can be
// checked. A missing call or a dead tape renders an honest card, never a 500.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'A stamped call on Pantessa — time, price and position verified.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`
const UP = '#34e3a0'
const DOWN = '#ff5d5d'

type Params = { params: Promise<{ id: string }> }

export default async function Image({ params }: Params) {
  const { id } = await params
  const call = await readCall(id).catch(() => null)
  const pal = brandOgPalette(null)
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [sans, sansSemi] = await Promise.all([readFile(join(fonts, 'geist-500.ttf')), readFile(join(fonts, 'geist-600.ttf'))])
  const post = call?.post
  const title = post ? (post.title.length > 96 ? `${post.title.slice(0, 95)}…` : post.title) : 'This call is not available'
  const moveColor = call?.move == null ? pal.muted : call.move >= 0 ? UP : DOWN
  const chart = callCardSvg(call?.tape ?? [], post?.chartState ?? null, post?.createdAt ?? 0, {
    width: 1072,
    height: 232,
    up: UP,
    down: DOWN,
    grid: 'rgba(255,255,255,0.06)',
    ink: '#f2f5f3',
    accent: UP,
    sell: DOWN,
    count: 110,
  })
  const pills = [
    'Time + price stamped',
    call?.heldAtCall ? 'Position verified on-chain' : call && call.fills.length > 0 ? 'Trades verified on-chain' : null,
  ].filter((p): p is string => !!p)

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', flexDirection: 'column', position: 'relative', background: pal.bg, fontFamily: 'Geist' }}>
        {/* header: lockup left, the symbol + author right */}
        <div style={{ position: 'absolute', top: 40, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(gemMarkSvg())} width={44} height={44} alt="" />
            <span style={{ color: pal.ink, fontSize: 32, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
            <span style={{ color: pal.muted, fontSize: 17, letterSpacing: 4, marginLeft: 10 }}>CALL</span>
          </div>
          {post && (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, fontSize: 20, color: pal.muted }}>
              <span style={{ color: pal.ink, fontWeight: 600, fontSize: 26 }}>${post.symbol}</span>
              <span>by {post.authorLabel}</span>
            </div>
          )}
        </div>

        {/* the claim */}
        <div style={{ position: 'absolute', top: 112, left: 64, right: 64, display: 'flex', color: pal.ink, fontSize: title.length > 52 ? 38 : 48, fontWeight: 600, letterSpacing: -1.4, lineHeight: 1.12 }}>
          <span>{title}</span>
        </div>

        {/* the stamp */}
        {post && (
          <div style={{ position: 'absolute', top: 234, left: 64, right: 64, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 21, color: pal.muted }}>
              <span style={{ letterSpacing: 2.5, fontSize: 15 }}>CALLED</span>
              <span style={{ color: pal.ink }}>{fmtCallTime(post.createdAt)}</span>
              {call?.stamp && <span>at</span>}
              {call?.stamp && <span style={{ color: pal.ink, fontWeight: 600 }}>${fmtCallPrice(call.stamp.price)}</span>}
            </div>
            {call?.last != null && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 21, color: pal.muted }}>
                <span style={{ letterSpacing: 2.5, fontSize: 15 }}>NOW</span>
                <span style={{ color: pal.ink, fontWeight: 600 }}>${fmtCallPrice(call.last)}</span>
                {call.move != null && <span style={{ color: moveColor, fontWeight: 600, fontSize: 26 }}>{fmtMove(call.move)}</span>}
              </div>
            )}
          </div>
        )}

        {/* the tape, the lines, the rule on the day of the call */}
        <div style={{ position: 'absolute', top: 284, left: 64, right: 64, display: 'flex', borderRadius: 18, border: '1.5px solid rgba(255,255,255,0.10)', background: 'rgba(255,255,255,0.025)', overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={toDataUri(chart)} width={1072} height={232} alt="" />
          {(call?.daily.length ?? 0) < 2 && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: 1072, height: 232, display: 'flex', alignItems: 'center', justifyContent: 'center', color: pal.muted, fontSize: 24 }}>
              {post ? 'Live chart · feed warming up' : 'No such call'}
            </div>
          )}
        </div>

        {/* footer: what is stamped / where to check it */}
        <div style={{ position: 'absolute', bottom: 36, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 12 }}>
            {pills.map((label, i) => (
              <div key={label} style={{ display: 'flex', padding: '8px 16px', borderRadius: 999, border: `1.5px solid ${i === 1 ? UP : 'rgba(255,255,255,0.12)'}`, color: i === 1 ? UP : pal.muted, fontSize: 16, letterSpacing: 1.5 }}>
                <span>{label.toUpperCase()}</span>
              </div>
            ))}
          </div>
          <span style={{ color: pal.muted, fontSize: 18, letterSpacing: 0.5, whiteSpace: 'nowrap', flexShrink: 0 }}>{post ? `pantessa.com/c/${post.id}` : 'pantessa.com'}</span>
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
