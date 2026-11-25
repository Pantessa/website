import { ImageResponse } from 'next/og'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgEyebrow, OgFrame, OgLockup, OgSquare, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'
import prisma from '@/lib/db'
import { factsOf, maskAddressTokens } from '@/lib/share-receipts'

// Social card for a receipt permalink (/r/<id>) — the 3am screenshot, as a
// card. Standing receipts lead with NOBODY WAS AT THE KEYBOARD (the product's
// best screenshot is the one where no one was watching); attended receipts
// lead with the ask-to-signature story. Same palette + faces as the /p card
// so every Pantessa link on a timeline reads as one family.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D. The receipt's headline is the one display line; the ask is quoted
// under it in the text face; the facts are flat square boxes, as written.

export const runtime = 'nodejs'
export const alt = 'A Pantessa receipt — built, guarded, and signed from plain English.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(undefined, { bare: true })

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
  const headlineSize = headline.length > 30 ? (headline.length > 44 ? 52 : 62) : 78

  const fonts = await brandOgFonts()

  return new ImageResponse(
    (
      <OgFrame>
        {/* header: lockup + the kicker */}
        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={MARK} />
          <OgEyebrow color={standing ? OG.ink : OG.muted}>{kicker}</OgEyebrow>
        </div>

        {/* the receipt: headline number-forward, the ask as the quote under it */}
        <div style={{ position: 'absolute', top: 176, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', maxHeight: 176, overflow: 'hidden', ...ogDisplay(headlineSize) }}>
            <span>{headline}</span>
          </div>
          {ask && (
            <div style={{ display: 'flex', marginTop: 26, maxHeight: 100, overflow: 'hidden', fontSize: ask.length > 60 ? 30 : 38, fontWeight: 500, lineHeight: 1.22, letterSpacing: -0.4, color: OG.soft }}>
              <span>“{ask}”</span>
            </div>
          )}
          {facts.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 34, maxHeight: 102, overflow: 'hidden' }}>
              {/* A fact is the receipt's own words (an amount, a chain, a hash), so it is printed as written, never in capitals. */}
              {facts.map((f, i) => (
                <div key={i} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '10px 18px', border: `1.5px solid rgba(${OG.inkRgb},0.18)`, fontSize: 20, color: OG.ink, maxWidth: 600, overflow: 'hidden' }}>
                  {/* a square, not '✓': the loaded faces have no glyph for it (tofu) */}
                  <OgSquare size={9} />
                  <span style={{ whiteSpace: 'nowrap' }}>{f.value.length > 46 ? `${f.value.slice(0, 45)}…` : f.value}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* footer strip */}
        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={ogLabel(18)}>GUARDED · SIGNED · RECEIPTED</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
            <span style={{ color: OG.muted, fontSize: 20 }}>Do this yourself</span>
            <span style={ogNum(20, OG.violet)}>pantessa.com/chat</span>
          </div>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
