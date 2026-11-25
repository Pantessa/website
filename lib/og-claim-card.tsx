import { ImageResponse } from 'next/og'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgFrame, OgLockup, OgPanel, OgSquare, OgWords, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'

// The claim card: one sentence as the display line on the left, a short table
// of facts on the right. For pages whose share is an argument rather than a
// live object (/pricing, /compare, /community). Same palette, faces and lockup
// as the site and markets cards (lib/og-brand: the flat #07080D ground, the
// Cut P in its own colours, a square hairline panel); every figure is passed
// in by the route from the module the page itself reads, so a card can never
// quote a stale number. A `strong` row is the brand violet: nothing on this
// card is a price that moved, so nothing on it is green or red.

export const CLAIM_CARD_SIZE = { width: 1200, height: 630 }

const MARK = gemMarkSvg(undefined, { bare: true })

export interface ClaimCard {
  /** The word beside the lockup (PRICING, COMPARE). */
  tag: string
  /** Up to four short words over the claim. */
  eyebrow: string[]
  /** The claim, on two lines. */
  line1: string
  line2: string
  /** Two lines under the claim. */
  under: [string, string]
  /** The table's title and its rows (label left, value right; six fit). */
  tableTitle: string
  tableNote: string
  rows: { label: string; value: string; strong?: boolean }[]
  /** Bottom of the table: a quiet line and the page's address. */
  foot: string
  path: string
}

export async function claimCardImage(card: ClaimCard): Promise<ImageResponse> {
  const fonts = await brandOgFonts()
  const longest = Math.max(card.line1.length, card.line2.length)
  const claimSize = longest <= 12 ? 84 : longest <= 14 ? 74 : longest <= 16 ? 64 : longest <= 18 ? 56 : 50
  const rows = card.rows.slice(0, 6)
  return new ImageResponse(
    (
      <OgFrame>
        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 530 }}>
          <OgLockup mark={MARK} size={50} tag={card.tag} />
          <div style={{ display: 'flex', marginTop: 28 }}>
            <OgWords words={card.eyebrow} size={15} />
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 46, whiteSpace: 'nowrap', ...ogDisplay(claimSize) }}>
            <span>{card.line1}</span>
            <span>{card.line2}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 32, gap: 12 }}>
            <span style={ogLabel(15)}>{card.under[0]}</span>
            <span style={ogLabel(15, OG.soft)}>{card.under[1]}</span>
          </div>
        </div>

        <OgPanel left={628} top={86} width={508} height={458}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 24px', borderBottom: `1px solid ${OG.line}` }}>
            <span style={{ ...ogLabel(13.5, OG.ink), fontWeight: 600 }}>{card.tableTitle}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 8, ...ogLabel(12, OG.soft) }}>
              <OgSquare size={7} />
              <span>{card.tableNote}</span>
            </div>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 24px 0' }}>
            {rows.map((r, i) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 58, borderTop: i === 0 ? 'none' : `1px solid ${OG.rule}`, whiteSpace: 'nowrap' }}>
                <span style={{ color: OG.soft, fontSize: 22 }}>{r.label}</span>
                <span style={ogNum(21, r.strong ? OG.violet : OG.ink)}>{r.value}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', padding: '0 24px 16px' }}>
            <span style={ogLabel(11.5)}>{card.foot}</span>
            <span style={ogNum(13, OG.violet)}>{`pantessa.com${card.path}`}</span>
          </div>
        </OgPanel>
      </OgFrame>
    ),
    { ...CLAIM_CARD_SIZE, fonts },
  )
}
