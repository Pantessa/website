import { ImageResponse } from 'next/og'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgChips, OgFrame, OgLockup, ogDataUri, ogDisplay, ogLabel, ogNum, type OgChip } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import { readCall } from '@/lib/chart-calls-read'
import { callCardSvg, fmtCallPrice, fmtCallTime, fmtMove } from '@/lib/chart-calls'

// Social card for a call (/c/<id>) — what X draws under the post. The claim
// in the author's words, the stamp (time + the tape's price then), the move
// since, and the daily tape with the call's own lines and a rule on the day
// it was made. Rendered per request, so the "now" on the card is now. The
// Pantessa lockup is the watermark: a call that travels says where it can be
// checked. A missing call or a dead tape renders an honest card, never a 500.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the claim as the one display line, the stamp's figures in the mono
// role, the tape in a square hairline frame. Green and red are the candles,
// the move since the call and the call's own buy and sell lines; "verified
// on-chain" is green too (the palette's own word for it).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const alt = 'A stamped call on Pantessa — time, price and position verified.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const UP = OG.up
const DOWN = OG.down
const MARK = gemMarkSvg(undefined, { bare: true })

type Params = { params: Promise<{ id: string }> }

export default async function Image({ params }: Params) {
  const { id } = await params
  const call = await readCall(id).catch(() => null)
  const pal = brandOgPalette(null)
  const fonts = await brandOgFonts()
  const post = call?.post
  const title = post ? (post.title.length > 96 ? `${post.title.slice(0, 95)}…` : post.title) : 'This call is not available'
  const moveColor = call?.move == null ? pal.muted : call.move >= 0 ? UP : DOWN
  const chart = callCardSvg(call?.tape ?? [], post?.chartState ?? null, post?.createdAt ?? 0, {
    width: 1070,
    height: 232,
    up: UP,
    down: DOWN,
    grid: OG.rule,
    ink: OG.ink,
    accent: UP,
    sell: DOWN,
    count: 110,
  })
  const verified = call?.heldAtCall ? 'Position verified on-chain' : call && call.fills.length > 0 ? 'Trades verified on-chain' : null
  const chips: OgChip[] = [{ label: 'Time + price stamped', plain: true }, ...(verified ? [{ label: verified, tone: UP, plain: true }] : [])]

  return new ImageResponse(
    (
      <OgFrame bg={pal.bg}>
        {/* header: lockup left, the symbol + author right */}
        <div style={{ position: 'absolute', top: 40, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={MARK} size={44} tag="CALL" />
          {post && (
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 20, color: pal.muted }}>
              <span style={ogNum(24, pal.ink)}>${post.symbol}</span>
              <span>by {post.authorLabel}</span>
            </div>
          )}
        </div>

        {/* the claim */}
        <div style={{ position: 'absolute', top: 108, left: 64, right: 64, height: 112, display: 'flex', alignItems: 'center', overflow: 'hidden', ...ogDisplay(title.length > 52 ? 38 : 48, pal.ink), lineHeight: 1.12 }}>
          <span>{title}</span>
        </div>

        {/* the stamp */}
        {post && (
          <div style={{ position: 'absolute', top: 234, left: 64, right: 64, display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
            <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 21, color: pal.muted }}>
              <span style={ogLabel(13.5, pal.muted)}>CALLED</span>
              <span style={{ color: pal.ink }}>{fmtCallTime(post.createdAt)}</span>
              {call?.stamp && <span>at</span>}
              {call?.stamp && <span style={ogNum(21, pal.ink)}>${fmtCallPrice(call.stamp.price)}</span>}
            </div>
            {call?.last != null && (
              <div style={{ display: 'flex', alignItems: 'baseline', gap: 12, fontSize: 21, color: pal.muted }}>
                <span style={ogLabel(13.5, pal.muted)}>NOW</span>
                <span style={ogNum(21, pal.ink)}>${fmtCallPrice(call.last)}</span>
                {call.move != null && <span style={ogNum(25, moveColor)}>{fmtMove(call.move)}</span>}
              </div>
            )}
          </div>
        )}

        {/* the tape, the lines, the rule on the day of the call */}
        <div style={{ position: 'absolute', top: 284, left: 64, width: 1072, height: 234, display: 'flex', border: `1px solid ${OG.line}`, background: OG.panel, overflow: 'hidden' }}>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={ogDataUri(chart)} width={1070} height={232} alt="" />
          {(call?.daily.length ?? 0) < 2 && (
            <div style={{ position: 'absolute', top: 0, left: 0, width: 1070, height: 232, display: 'flex', alignItems: 'center', justifyContent: 'center', color: pal.muted, fontSize: 24 }}>
              {post ? 'Live chart · feed warming up' : 'No such call'}
            </div>
          )}
        </div>

        {/* footer: what is stamped / where to check it */}
        <div style={{ position: 'absolute', bottom: 36, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgChips chips={chips} size={14} ink={pal.muted} />
          <span style={{ ...ogNum(17, pal.accent, 500), flexShrink: 0 }}>{post ? `pantessa.com/c/${post.id}` : 'pantessa.com'}</span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
