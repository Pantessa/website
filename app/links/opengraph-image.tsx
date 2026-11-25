import { ImageResponse } from 'next/og'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgChips, OgEyebrow, OgFrame, OgLockup, ogDisplay, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'

// Social card for the link surfaces that have no ask of their own — /links
// (the public board), /links/embed, /sign, /inbox. These are the pages
// people SHARE ("here's the board", "here's your inbox"), and until
// 2026-09-08 they unfurled with no image at all: a page-level `openGraph`
// block replaces the root's, and Next does not carry the root file-based
// card into it. Same family as the /i card — the display line, the promise
// line, the contract boxes — so every Pantessa link on a timeline reads as
// one set.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): the /i
// card's own, flat on #07080D with the Cut P in its colours.

export const runtime = 'nodejs'
export const alt = 'Pantessa intent links — a link that moves money. Your wallet signs.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const MARK = gemMarkSvg(undefined, { bare: true })
const CONTRACT_PILLS = ['Guarded build', 'Your wallet signs', 'Receipted']

export default async function Image() {
  const fonts = await brandOgFonts()

  return new ImageResponse(
    (
      <OgFrame>
        {/* header: the house lockup + the eyebrow */}
        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={MARK} />
          <OgEyebrow>INTENT LINKS · YOUR WALLET SIGNS</OgEyebrow>
        </div>

        {/* the hero */}
        <div style={{ position: 'absolute', top: 190, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', ...ogDisplay(72), lineHeight: 1.12 }}>
            <span>A link that moves money.</span>
          </div>
          <div style={{ display: 'flex', marginTop: 28, fontSize: 38, fontWeight: 600, letterSpacing: -0.5, color: OG.ink }}>
            <span>Mint a sentence. Share the link. Their wallet signs.</span>
          </div>
          <div style={{ display: 'flex', marginTop: 14, fontSize: 26, color: OG.muted }}>
            <span>Nothing moves until someone signs — in their own wallet.</span>
          </div>
        </div>

        {/* footer: the contract boxes + the door */}
        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgChips chips={CONTRACT_PILLS} size={18} />
          <span style={ogNum(20, OG.violet)}>pantessa.com</span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
