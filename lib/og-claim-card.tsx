import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { gemMarkSvg } from '@/lib/og-marks'

// The claim card: one sentence in the house serif on the left, a short table
// of facts on the right. For pages whose share is an argument rather than a
// live object (/pricing, /compare). Same palette, fonts and lockup as the
// site and markets cards; every figure is passed in by the route from the
// module the page itself reads, so a card can never quote a stale number.

export const CLAIM_CARD_SIZE = { width: 1200, height: 630 }

const BG = '#050708'
const INK = '#FAFAF7'
const MUTED = '#8a9186'
const ACCENT = '#34e3a0'
const LINE = 'rgba(255,255,255,0.10)'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

export interface ClaimCard {
  /** The word beside the lockup (PRICING, COMPARE). */
  tag: string
  /** Up to four short words over the claim. */
  eyebrow: string[]
  /** The claim: a plain first line, an italic second. */
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
  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serif, serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(fonts, 'newsreader-500.ttf')),
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
  ])
  const longest = Math.max(card.line1.length, card.line2.length)
  const claimSize = longest <= 14 ? 92 : longest <= 16 ? 76 : longest <= 18 ? 66 : 58
  const rows = card.rows.slice(0, 6)
  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: BG, fontFamily: 'Geist' }}>
        <div style={{ position: 'absolute', right: -140, top: 40, width: 760, height: 560, borderRadius: 380, background: 'radial-gradient(circle, rgba(52,227,160,0.15) 0%, rgba(52,227,160,0) 70%)', display: 'flex' }} />

        <div style={{ position: 'absolute', left: 64, top: 56, display: 'flex', flexDirection: 'column', width: 530 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(gemMarkSvg(ACCENT))} width={58} height={58} alt="" />
            <span style={{ color: INK, fontSize: 44, fontWeight: 600, letterSpacing: -1.8 }}>pantessa</span>
            <span style={{ color: MUTED, fontSize: 19, letterSpacing: 5, marginLeft: 8, marginTop: 6 }}>{card.tag}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 17, letterSpacing: 4.5, color: MUTED, whiteSpace: 'nowrap' }}>
            {card.eyebrow.map((w, i) => (
              <span key={w} style={{ display: 'flex' }}>
                {i > 0 && <span style={{ color: ACCENT, margin: '0 12px' }}>·</span>}
                <span>{w}</span>
              </span>
            ))}
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 44, fontFamily: 'Newsreader', fontWeight: 500, fontSize: claimSize, lineHeight: 1.0, letterSpacing: -2.4 }}>
            <span style={{ color: INK }}>{card.line1}</span>
            <span
              style={{
                fontStyle: 'italic',
                letterSpacing: -1.4,
                backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`,
                backgroundClip: 'text',
                color: 'transparent',
                paddingBottom: 12,
                paddingRight: 10,
              }}
            >
              {card.line2}
            </span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', marginTop: 30, gap: 12, fontSize: 17, letterSpacing: 4, color: MUTED }}>
            <span>{card.under[0]}</span>
            <span style={{ color: '#b8bfb5' }}>{card.under[1]}</span>
          </div>
        </div>

        <div style={{ position: 'absolute', left: 628, top: 86, width: 508, height: 458, display: 'flex', flexDirection: 'column', borderRadius: 22, border: '1.5px solid rgba(255,255,255,0.12)', background: 'rgba(255,255,255,0.03)', overflow: 'hidden' }}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '15px 24px', borderBottom: `1.5px solid ${LINE}` }}>
            <span style={{ color: INK, fontSize: 14, fontWeight: 600, letterSpacing: 3 }}>{card.tableTitle}</span>
            <span style={{ color: ACCENT, fontSize: 12, letterSpacing: 2.5 }}>{card.tableNote}</span>
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', padding: '6px 24px 0' }}>
            {rows.map((r, i) => (
              <div key={r.label} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', height: 58, borderTop: i === 0 ? 'none' : `1px solid ${LINE}`, whiteSpace: 'nowrap' }}>
                <span style={{ color: '#c9cec6', fontSize: 22 }}>{r.label}</span>
                <span style={{ color: r.strong ? ACCENT : INK, fontSize: 24, fontWeight: 600 }}>{r.value}</span>
              </div>
            ))}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginTop: 'auto', padding: '0 24px 16px', fontSize: 12, letterSpacing: 2, whiteSpace: 'nowrap' }}>
            <span style={{ color: MUTED }}>{card.foot}</span>
            <span style={{ color: ACCENT }}>pantessa.com{card.path}</span>
          </div>
        </div>
      </div>
    ),
    {
      ...CLAIM_CARD_SIZE,
      fonts: [
        { name: 'Newsreader', data: serif, weight: 500, style: 'normal' },
        { name: 'Newsreader', data: serifItalic, weight: 500, style: 'italic' },
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
}
