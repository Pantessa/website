import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import prisma from '@/lib/db'
import { brandFromRow } from '@/lib/brand-denylist'
import { brandOgPalette, normalizeHex } from '@/lib/brand-theme'
import { pangolinMarkSvg } from '@/lib/og-marks'

// Social card for a creator page (/l/<handle>) — the handle is the hero,
// the link count + dollars moved are the proof line. Wears the creator's
// white-label brand (bg/logo/accent, luminance-derived ink) so a shared
// storefront looks like THEIR storefront in the feed; unbranded pages keep
// the house dark card. Same fonts + footer family as the /i and /p cards.

export const runtime = 'nodejs'
export const alt = 'A Pantessa creator page — links that move money.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

/** Soft radial glow behind the handle, tinted by the card's accent. */
const ambient = (accent: string) => {
  const hex = normalizeHex(accent)?.slice(1) ?? '34e3a0'
  const rgb = [hex.slice(0, 2), hex.slice(2, 4), hex.slice(4, 6)].map((c) => parseInt(c, 16)).join(',')
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1200" height="630" viewBox="0 0 1200 630">
  <defs>
    <radialGradient id="amb" cx="0.5" cy="0.35" r="0.8">
      <stop offset="0" stop-color="rgba(${rgb},0.10)"/>
      <stop offset="0.7" stop-color="rgba(${rgb},0)"/>
    </radialGradient>
  </defs>
  <rect width="1200" height="630" fill="url(#amb)"/>
</svg>`
}

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
          where: { intentLinkSlug: { in: links.map((l) => l.id) }, outcome: 'signed', valueUsd: { gt: 0 } },
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

  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
  ])

  return new ImageResponse(
    (
      <div
        style={{
          width: '100%',
          height: '100%',
          display: 'flex',
          position: 'relative',
          background: pal.bg,
          fontFamily: 'Geist',
        }}
      >
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toDataUri(ambient(pal.accent))} width={1200} height={630} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />

        {/* header: the creator's lockup when branded, the house lockup when not */}
        <div
          style={{
            position: 'absolute',
            top: 48,
            left: 64,
            right: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            {brand?.logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={brand.logo} width={46} height={46} alt="" style={{ borderRadius: 10 }} />
            ) : (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={toDataUri(pangolinMarkSvg(pal.branded ? pal.accent : undefined))} width={46} height={46} alt="" />
            )}
            <span style={{ color: pal.ink, fontSize: 34, fontWeight: 600, letterSpacing: -1.2 }}>
              {brand ? (brand.name ?? brand.domain ?? 'pantessa') : 'pantessa'}
            </span>
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, letterSpacing: 4, color: pal.muted }}>
            <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: pal.accent }} />
            <span>{brand ? 'POWERED BY PANTESSA' : 'CREATOR PAGE'}</span>
          </div>
        </div>

        {/* the handle — the hero — with the proof line under it */}
        <div style={{ position: 'absolute', top: 218, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Newsreader',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: handle.length > 18 ? 64 : 84,
              lineHeight: 1.05,
              color: pal.ink,
            }}
          >
            <span>@{handle}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 26, fontSize: 30, fontWeight: 600, letterSpacing: -0.5, color: pal.accent }}>
            <span>Links that move money{proof ? ` · ${proof}` : ''}</span>
          </div>
          <div style={{ display: 'flex', marginTop: 16, fontSize: 24, color: pal.muted }}>
            <span>Tap one, connect your own wallet, and the path builds itself.</span>
          </div>
        </div>

        {/* footer: the contract + the door */}
        <div
          style={{
            position: 'absolute',
            bottom: 44,
            left: 64,
            right: 64,
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
          }}
        >
          <div style={{ display: 'flex', gap: 14 }}>
            {['Guarded build', 'Your wallet signs', 'Receipted'].map((label) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '9px 16px',
                  borderRadius: 999,
                  border: pal.branded ? `1.5px solid rgba(${pal.inkRgb},0.28)` : '1.5px solid rgba(255,255,255,0.14)',
                  background: pal.branded ? `rgba(${pal.inkRgb},0.05)` : 'rgba(255,255,255,0.03)',
                  fontSize: 19,
                  color: pal.ink,
                }}
              >
                <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: pal.accent }} />
                <span>{label}</span>
              </div>
            ))}
          </div>
          <span style={{ color: pal.accent, fontWeight: 600, fontSize: 21 }}>pantessa.com</span>
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
