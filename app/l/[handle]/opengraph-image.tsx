import { ImageResponse } from 'next/og'
import prisma from '@/lib/db'
import { brandFromRow } from '@/lib/brand-denylist'
import { brandOgPalette } from '@/lib/brand-theme'
import { gemMarkSvg } from '@/lib/og-marks'
import { OgChips, OgEyebrow, OgFrame, ogDataUri, ogDisplay, ogNum } from '@/lib/og-brand'
import { OG_DISPLAY, brandOgFonts } from '@/lib/og-brand-fonts'
import { REAL_TRAFFIC_WHERE } from '@/lib/value-origin'

// Social card for a creator page (/l/<handle>) — the handle is the hero,
// the link count + dollars moved are the proof line. Wears the creator's
// white-label brand (bg/logo/accent, luminance-derived ink) so a shared
// storefront looks like THEIR storefront in the feed; unbranded pages keep
// the house card. Same faces + footer family as the /i and /p cards.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): the house
// card is flat on #07080D with the Cut P in its own colours and the brand
// violet as its accent. A creator's card keeps ITS colours (lib/brand-theme
// brandOgPalette) and takes the same flat shapes: no glow, no rounded corner,
// no pill.

export const runtime = 'nodejs'
export const alt = 'A Pantessa creator page — links that move money.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

type Params = { params: Promise<{ handle: string }> }

export default async function Image({ params }: Params) {
  const { handle: rawHandle } = await params
  const handle = rawHandle.toLowerCase()
  let brand = null
  let linkCount = 0
  let movedUsd = 0
  try {
    const row = await prisma.creatorHandle.findUnique({ where: { handle } })
    if (row) {
      brand = brandFromRow(row) // rule 7: denied third-party brands render as house
      const links = await prisma.intentLink.findMany({
        where: { creator: row.creator, revoked: false },
        select: { id: true },
        take: 50,
      })
      linkCount = links.length
      if (links.length) {
        const moved = await prisma.embedTurn.aggregate({
          // The share card is the most public claim of all — same fence as the page.
          where: { intentLinkSlug: { in: links.map((l) => l.id) }, outcome: 'signed', valueUsd: { gt: 0 }, ...REAL_TRAFFIC_WHERE },
          _sum: { valueUsd: true },
        })
        movedUsd = moved._sum.valueUsd ?? 0
      }
    }
  } catch {
    brand = null
  }
  const pal = brandOgPalette(brand)
  const proof = [
    `${linkCount} link${linkCount === 1 ? '' : 's'}`,
    ...(movedUsd > 0 ? [`$${movedUsd >= 1000 ? Math.round(movedUsd).toLocaleString('en-US') : movedUsd.toFixed(2)} moved`] : []),
  ].join(' · ')

  const fonts = await brandOgFonts()

  return new ImageResponse(
    (
      <OgFrame bg={pal.bg}>
        {/* header: the creator's lockup when branded, the house lockup when not */}
        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {brand?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo} width={46} height={46} alt="" />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={ogDataUri(gemMarkSvg(pal.branded ? pal.accent : undefined, { bare: true }))} width={46} height={46} alt="" />
            )}
            <span style={{ color: pal.ink, fontFamily: brand ? 'Geist' : OG_DISPLAY, fontSize: brand ? 34 : 36, fontWeight: 600, letterSpacing: brand ? -1.2 : -0.8 }}>
              {brand ? (brand.name ?? brand.domain ?? 'pantessa') : 'pantessa'}
            </span>
          </div>
          <OgEyebrow color={pal.muted} square={pal.accent}>
            {brand ? 'POWERED BY PANTESSA' : 'CREATOR PAGE'}
          </OgEyebrow>
        </div>

        {/* the handle — the hero — with the proof line under it */}
        <div style={{ position: 'absolute', top: 206, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', whiteSpace: 'nowrap', overflow: 'hidden', ...ogDisplay(handle.length > 24 ? 50 : handle.length > 18 ? 64 : 84, pal.ink) }}>
            <span>@{handle}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 28, fontSize: 30, fontWeight: 600, letterSpacing: -0.5, color: pal.accent }}>
            <span>Links that move money{proof ? ` · ${proof}` : ''}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 16, fontSize: 24, color: pal.muted }}>
            <span>Tap one, connect your own wallet, and the path builds itself.</span>
          </div>
        </div>

        {/* footer: the contract + the door */}
        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgChips chips={['Guarded build', 'Your wallet signs', 'Receipted']} size={18} ink={pal.ink} inkRgb={pal.inkRgb} accent={pal.accent} strong={pal.branded} />
          <span style={ogNum(20, pal.accent)}>pantessa.com</span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
