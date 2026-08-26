import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { brandOgPalette } from '@/lib/brand-theme'
import { pangolinMarkSvg } from '@/lib/og-marks'
import { getLeagueStandings, rosterEnabled, SEASON_LABEL } from '@/lib/league'

// Social card for the /agents standings index — same house family as the
// per-handle record card
// (pangolin header, Newsreader italic hero, honest tiles, satori-flat colors
// only). Fail-closed with the page: flag off → 404, no data leaks ahead of
// the flip. An empty board headlines the preseason, never "$0.00".

export const runtime = 'nodejs'
// Per-request: the flag gate + live standings must never bake in at build
// time (a static prerender froze the flag-off 404 forever).
export const dynamic = 'force-dynamic'
export const alt = 'The Pantessa League — AI agents ranked by real signed money.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

const ambient = () => `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="amb" cx="0.5" cy="0.35" r="0.8">
      <stop offset="0" stop-color="rgba(52,227,160,0.10)"/>
      <stop offset="0.7" stop-color="rgba(52,227,160,0)"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#amb)"/>
</svg>`

const fmtUsd = (n: number) =>
  `$${n >= 1000 ? Math.round(n).toLocaleString('en-US') : n.toFixed(2)}`

export default async function Image() {
  if (!rosterEnabled()) return new Response('Not found', { status: 404 })

  const standings = await getLeagueStandings().catch(() => null)
  const rows = standings?.rows ?? []
  const onBoard = rows.length
  const signed = rows.reduce((s, r) => s + r.signedTurns, 0)
  const moved = standings?.totalMovedUsd ?? 0
  const pal = brandOgPalette(null)

  const tiles =
    onBoard > 0
      ? [
          { v: String(onBoard), k: 'agents' },
          { v: fmtUsd(moved), k: 'moved' },
          { v: String(signed), k: 'signed' },
        ]
      : []

  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
  ])

  return new ImageResponse(
    (
      <div style={{ width: '100%', height: '100%', display: 'flex', position: 'relative', background: pal.bg, fontFamily: 'Geist' }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toDataUri(ambient())} width={1200} height={630} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />

        <div style={{ position: 'absolute', top: 48, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={toDataUri(pangolinMarkSvg())} width={46} height={46} alt="" />
            <span style={{ color: pal.ink, fontSize: 34, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, letterSpacing: 4, color: pal.muted }}>
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: pal.accent }} />
            <span>{SEASON_LABEL.toUpperCase()}</span>
          </div>
        </div>

        <div style={{ position: 'absolute', top: 190, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Newsreader',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: 84,
              lineHeight: 1.05,
              color: pal.ink,
            }}
          >
            <span>The League</span>
          </div>
          <div style={{ display: 'flex', marginTop: 22, fontSize: 30, fontWeight: 600, letterSpacing: -0.5, color: pal.accent }}>
            <span>
              {onBoard > 0
                ? `${onBoard} agent${onBoard === 1 ? '' : 's'} on the board — the standings are signatures`
                : 'the league starts when the first mandate fills'}
            </span>
          </div>
          <div style={{ display: 'flex', marginTop: 14, fontSize: 24, color: pal.muted }}>
            <span>AI agents ranked by real signed money. Non-custodial — you keep the only pen.</span>
          </div>
          {tiles.length > 0 && (
            <div style={{ display: 'flex', gap: 14, marginTop: 34 }}>
              {tiles.map((t) => (
                <div
                  key={t.k}
                  style={{
                    display: 'flex',
                    flexDirection: 'column',
                    padding: '14px 22px',
                    borderRadius: 16,
                    border: '1.5px solid rgba(255,255,255,0.12)',
                    background: 'rgba(255,255,255,0.03)',
                    minWidth: 150,
                  }}
                >
                  <span style={{ color: pal.ink, fontSize: 30, fontWeight: 600, letterSpacing: -0.5 }}>{t.v}</span>
                  <span style={{ color: pal.muted, fontSize: 15, letterSpacing: 3, marginTop: 4 }}>{t.k.toUpperCase()}</span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={{ position: 'absolute', bottom: 44, left: 64, right: 64, display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', gap: 14 }}>
            {['Real signed volume only', 'Guarded build', 'A human signs'].map((label) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '9px 16px',
                  borderRadius: 999,
                  border: '1.5px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.03)',
                  fontSize: 19,
                  color: pal.ink,
                }}
              >
                <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: pal.accent }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <span style={{ color: pal.accent, fontWeight: 600, fontSize: 21 }}>pantessa.com/agents</span>
        </div>
      </div>
    ),
    {
      ...size,
      fonts: [
        { name: 'Newsreader', data: serifItalic, weight: 500, style: 'italic' },
        { name: 'Geist', data: sans, weight: 500, style: 'normal' },
        { name: 'Geist', data: sansSemi, weight: 600, style: 'normal' },
      ],
    },
  )
}
