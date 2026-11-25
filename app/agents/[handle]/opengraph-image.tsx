import { ImageResponse } from 'next/og'
import { brandOgPalette } from '@/lib/brand-theme'
import { getAgentRecord } from '@/lib/agent-record'
import { foundingHandles } from '@/lib/league'
import { gemMarkSvg } from '@/lib/og-marks'
import { OgChips, OgEyebrow, OgFrame, OgLockup, OgStats, ogDisplay, ogLabel, ogNum } from '@/lib/og-brand'
import { brandOgFonts } from '@/lib/og-brand-fonts'

// Social card for an agent's public track record (/agents/<handle>). Until
// now the page shipped og:title only — a shared record rendered as a bare
// link in the feed. Same house palette, faces and footer family as the /i
// and /l cards: the agent's name is the hero, the honest figures are the
// proof line (real signed money only — the harness can never inflate it).
//
// THE LOOK (2026-11-25; brand guidelines section 7, lib/og-brand): flat on
// #07080D, the agent's name as the one display line, upright; the figures in
// the mono role in square boxes; the accent is the brand violet.

export const runtime = 'nodejs'
export const alt = 'A Pantessa agent track record — money moved through the guarded desk.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const MARK = gemMarkSvg(undefined, { bare: true })

const fmtUsd = (n: number) =>
  `$${n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`

type Params = { params: Promise<{ handle: string }> }

export default async function Image({ params }: Params) {
  const { handle } = await params
  const rec = await getAgentRecord(handle).catch(() => null)
  // Founding Manager variant (FOUNDING-MANAGERS.md): a flat accent box in the
  // header — cosmetic + historical, never a rank. Satori-safe (flex + solid
  // colors only); zero founding rows today ⇒ the same card.
  const founding = rec
    ? (await foundingHandles([rec.handle]).catch(() => new Set<string>())).has(rec.handle)
    : false
  const pal = brandOgPalette(null)
  const name = rec ? (rec.displayName ?? `Agent ${rec.handle.slice(0, 8)}`) : 'Agent track record'
  const tiles = rec
    ? [
        { v: fmtUsd(rec.moneyMovedUsd), k: 'moved' },
        { v: String(rec.signedTurns), k: 'signed' },
        { v: String(rec.intents), k: 'intents' },
        { v: String(rec.handoffs), k: 'handoffs' },
      ]
    : []

  const fonts = await brandOgFonts()

  return new ImageResponse(
    (
      <OgFrame bg={pal.bg}>
        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgLockup mark={MARK} />
          <div style={{ display: 'flex', alignItems: 'center', gap: 16 }}>
            {founding && (
              <div style={{ display: 'flex', alignItems: 'center', padding: '7px 14px', background: pal.accent, ...ogLabel(15, pal.bg), fontWeight: 600 }}>
                <span>FOUNDING</span>
              </div>
            )}
            <OgEyebrow>AGENT TRACK RECORD</OgEyebrow>
          </div>
        </div>

        <div style={{ position: 'absolute', top: 176, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div style={{ display: 'flex', maxHeight: 142, overflow: 'hidden', ...ogDisplay(name.length > 30 ? 52 : name.length > 18 ? 64 : 84, pal.ink) }}>
            <span>{name}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 24, fontSize: 30, fontWeight: 600, letterSpacing: -0.5, color: pal.accent }}>
            <span>{rec && rec.moneyMovedUsd > 0 ? `cleared ${fmtUsd(rec.moneyMovedUsd)} through Pantessa` : 'brokers intents through the guarded desk'}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 14, fontSize: 24, color: pal.muted }}>
            <span>Public, non-custodial. Every transaction guard-checked; only a human signs.</span>
          </div>
          {tiles.length > 0 && (
            <div style={{ display: 'flex', marginTop: 34 }}>
              <OgStats stats={tiles} />
            </div>
          )}
        </div>

        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <OgChips chips={['Guarded build', 'A human signs', 'Real traffic only']} />
          <span style={ogNum(20, pal.accent)}>pantessa.com</span>
        </div>
      </OgFrame>
    ),
    { ...size, fonts },
  )
}
