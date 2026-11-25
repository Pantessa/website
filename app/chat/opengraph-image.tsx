import { ImageResponse } from 'next/og'
import { gemMarkSvg } from '@/lib/og-marks'
import { OG, OgEyebrow, OgFrame, OgLockup, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'

// Social card for /chat — the deep-link surface (?prompt= handoffs from
// shares, splash chips, docs examples all land here). The card shows the
// product's shape in one glance: a composer holding a real ask, and the
// receipt line it becomes. Defining og metadata on the segment without this
// file would ship NO image (the /p lesson) — hence the explicit card.
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the claim as the one display line, the composer a square hairline
// box with a square send key in the brand violet.

export const runtime = 'nodejs'
export const alt = 'Pantessa chat — say what should happen; sign what it builds.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

// The house mark comes from lib/og-marks — ONE source across every OG card.
const MARK = gemMarkSvg(undefined, { bare: true })

export default async function Image() {
  const fonts = await brandOgFonts()

  return new ImageResponse(
    (
      <OgFrame>
        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={MARK} />
          <OgEyebrow>EVERY DAPP · ONE CHAT</OgEyebrow>
        </div>

        {/* the claim */}
        <div style={{ position: 'absolute', top: 166, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', flexDirection: 'column', whiteSpace: 'nowrap', ...ogDisplay(68) }}>
            <span>Say what should happen.</span>
            <span>Sign what it builds.</span>
          </div>

          {/* the composer, holding a real standing ask */}
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 50, padding: '20px 20px 20px 28px', border: `1px solid ${OG.line}`, background: OG.panel }}>
            <span style={{ fontSize: 32, color: OG.ink }}>protect my HYPE long with a 5% stop…</span>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', width: 52, height: 52, background: OG.violet, color: OG.bg, fontSize: 28, fontWeight: 600 }}>↑</div>
          </div>
        </div>

        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <span style={ogLabel(18)}>GUARDED · SIGNED · RECEIPTED</span>
          <span style={ogNum(20, OG.violet)}>pantessa.com/chat</span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
