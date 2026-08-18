import { ImageResponse } from 'next/og'
import { readFile } from 'node:fs/promises'
import { join } from 'node:path'
import prisma from '@/lib/db'
import { brandFromRow } from '@/lib/brand-denylist'
import { brandOgPalette, hexLuminance, normalizeHex } from '@/lib/brand-theme'
import { pangolinMarkSvg } from '@/lib/og-marks'
import { parseMosaicAsk } from '@/lib/mosaic'

// Social card for an intent link (/i/<slug>) — the ASK is the hero: the
// sentence in serif quotes, the one-tap promise under it, the guardrail
// strip as the footer. Same palette + fonts as the /p and /r cards so every
// Pantessa link on a timeline reads as one family. A creator's white-label
// brand re-inks the whole card (bg/logo/accent, luminance-derived text) so
// their links look like THEIR links in the feed — house links stay pure
// Pantessa, byte-identical to before.
//
// MOSAIC links get their own card: the ask stays the hero, but the star is
// the tessera bar — one flat tile per slice, width proportional to its
// percent, an 8-step accent→bg ramp so the shape reads at timeline size
// before a single word does. Mosaic cards always wear the HOUSE palette in
// v1 (a creator brand re-inking the ramp is a conscious later flip, not a
// free side effect), and the branch is additive — non-mosaic links render
// byte-identical to before it existed.

export const runtime = 'nodejs'
export const alt = 'A Pantessa intent link — one tap from ask to signed.'
export const size = { width: 1200, height: 630 }
export const contentType = 'image/png'

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

/** Soft radial glow behind the ask, tinted by the card's accent. */
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

const CONTRACT_PILLS = ['Guarded build', 'Your wallet signs', 'Receipted']

// ── Mosaic tessera helpers ──────────────────────────────────────────────────

/** Flat hex mix of `a` toward `b` (satori renders no CSS color-mix, so the
 *  ramp has to be plain computed colors). */
const mixHex = (a: string, b: string, t: number): string => {
  const av = a.slice(1)
  const bv = b.slice(1)
  const out = [0, 2, 4].map((i) => {
    const c = Math.round(parseInt(av.slice(i, i + 2), 16) * (1 - t) + parseInt(bv.slice(i, i + 2), 16) * t)
    return c.toString(16).padStart(2, '0')
  })
  return `#${out.join('')}`
}

/** 8-step tile ramp: the house accent walked toward the house card bg, one
 *  step per slice in shape order (the grammar caps a shape at 8 tiles). The
 *  walk stops at t=0.78, short of the bg on purpose — a tile that reaches
 *  the background reads as a hole in the wall, not a tessera. */
const MOSAIC_TILE_RAMP = Array.from({ length: 8 }, (_, i) => mixHex('#34e3a0', '#050708', (i * 0.78) / 7))

/** Percent label for a tile — the grammar allows decimals ("12.5% wstETH")
 *  but a card label never needs more than one place. */
const fmtTilePct = (n: number): string => String(Math.round(n * 10) / 10)

type Params = { params: Promise<{ slug: string }> }

export default async function Image({ params }: Params) {
  const { slug } = await params
  let link = null
  try {
    link = await prisma.intentLink.findUnique({ where: { id: slug } })
  } catch {
    link = null
  }
  const live = link && !link.revoked ? link : null
  const ask = live?.ask ?? 'One tap from ask to signed'
  // Size ladder with a 64 step: a 27–44 char ask at 72px (the H1 drill's
  // "Swap $20 of USDC to ETH on Base") wrapped with a one-word widow; at 64
  // it sits on one line. Asks ≤26 chars (every house link) are untouched.
  const askSize = ask.length > 80 ? 44 : ask.length > 44 ? 56 : ask.length > 26 ? 64 : 72

  // MOSAIC pick: kind:'mosaic' stamps new mints, but rows minted before the
  // column carry the grammar in the ask alone — a successful parse is the
  // one test that covers both (isMosaicAsk is exactly this check). A
  // kind-stamped row whose ask somehow stopped parsing fails CLOSED to the
  // standard card below: the known-good card beats an empty tile bar.
  const parsedMosaic = live ? parseMosaicAsk(live.ask) : null
  const mosaic = parsedMosaic && !('problem' in parsedMosaic) ? parsedMosaic : null

  // The creator's white-label brand re-inks the card; house/unbranded links
  // keep the stock dark palette (brandOgPalette falls back byte-identically).
  // Mosaic cards skip the fetch entirely — they wear the house palette in
  // v1, so reading the brand row would be a query spent on nothing.
  let brand = null
  // WHOSE link: a claimed @handle names the sender on the card (the unfurl
  // is the first thing a DM'd stranger sees — "from @nate" beats an
  // anonymous "CALL"). Read off the same row as the brand.
  let handle: string | null = null
  if (live?.creator && !mosaic) {
    try {
      const row = await prisma.creatorHandle.findUnique({ where: { creator: live.creator } })
      if (row?.handle) handle = row.handle
      brand = brandFromRow(row) // rule 7: denied third-party brands render as house
    } catch {
      brand = null
    }
  }
  const pal = brandOgPalette(brand)

  const fonts = join(process.cwd(), 'assets', 'og-fonts')
  const [serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(fonts, 'newsreader-500-italic.ttf')),
    readFile(join(fonts, 'geist-500.ttf')),
    readFile(join(fonts, 'geist-600.ttf')),
  ])

  if (mosaic) {
    // The tessera card. `pal` is the house palette here by construction —
    // the brand fetch is skipped for mosaic rows above — so every color
    // below is the stock dark family the /p and /r cards already wear.
    // Mosaic asks run longer than most (8 tiles + a chain word), so the
    // hero gets its own size ladder.
    const mosaicAskSize = ask.length > 108 ? 34 : ask.length > 76 ? 42 : ask.length > 48 ? 50 : 60
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

          {/* header: the house lockup + the mosaic eyebrow */}
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
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={toDataUri(pangolinMarkSvg())} width={46} height={46} alt="" />
              <span style={{ color: pal.ink, fontSize: 34, fontWeight: 600, letterSpacing: -1.2 }}>pantessa</span>
            </div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, fontSize: 17, letterSpacing: 4, color: pal.muted }}>
              <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: pal.accent }} />
              <span>MOSAIC · EXECUTABLE ALLOCATION</span>
            </div>
          </div>

          {/* the shape sentence — same serif voice as every other card */}
          <div
            style={{
              position: 'absolute',
              top: 152,
              left: 64,
              right: 64,
              display: 'flex',
              fontFamily: 'Newsreader',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: mosaicAskSize,
              lineHeight: 1.14,
              maxHeight: 176,
              overflow: 'hidden',
              color: pal.ink,
            }}
          >
            <span>“{ask}”</span>
          </div>

          {/* the tile bar — the star. Full-bleed, one flex tile per slice,
              width ∝ percent (flexGrow carries the ratio), grout lines are
              the card bg showing through the gaps. */}
          <div style={{ position: 'absolute', top: 352, left: 0, display: 'flex', width: 1200, height: 140, gap: 5 }}>
            {mosaic.slices.map((s, i) => {
              const fill = MOSAIC_TILE_RAMP[i]
              // Bright early tiles take dark ink, the walked-down tail takes
              // light — computed per tile, never eyeballed, so re-tuning the
              // ramp can't silently strand a label.
              const darkInk = (hexLuminance(fill) ?? 0) > 0.35
              const labelInk = darkInk ? '#052015' : '#eefff7'
              const subInk = darkInk ? 'rgba(5,32,21,0.72)' : 'rgba(238,255,247,0.66)'
              // Below 8% the symbol has no room — the percent alone stays,
              // smaller, and the sentence above still names every token.
              const showSymbol = s.pct >= 8
              return (
                <div
                  key={s.token}
                  style={{
                    display: 'flex',
                    flexGrow: s.pct,
                    flexBasis: 0,
                    flexDirection: 'column',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: fill,
                    overflow: 'hidden',
                  }}
                >
                  <span style={{ fontSize: showSymbol ? 34 : 22, fontWeight: 600, letterSpacing: -0.5, color: labelInk }}>
                    {`${fmtTilePct(s.pct)}%`}
                  </span>
                  {showSymbol ? (
                    <span style={{ marginTop: 4, fontSize: 19, letterSpacing: 2, color: subInk }}>{s.token}</span>
                  ) : null}
                </div>
              )
            })}
          </div>

          {/* footer: the door + fork provenance when this shape has one */}
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
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={toDataUri(pangolinMarkSvg())} width={36} height={36} alt="" />
              <div style={{ display: 'flex', fontSize: 21 }}>
                <span style={{ color: pal.accent, fontWeight: 600 }}>pantessa.com</span>
                <span style={{ color: pal.muted }}>{' — connect a wallet, sign the whole shape'}</span>
              </div>
            </div>
            {live?.parentSlug ? (
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '9px 16px',
                  borderRadius: 999,
                  border: '1.5px solid rgba(255,255,255,0.14)',
                  background: 'rgba(255,255,255,0.03)',
                  fontSize: 17,
                  letterSpacing: 3,
                  color: pal.ink,
                }}
              >
                <div style={{ display: 'flex', width: 8, height: 8, borderRadius: 4, background: pal.accent }} />
                <span>FORKED SHAPE</span>
              </div>
            ) : null}
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
            <span>
              {/* The share card is the thing that lands in a feed, so the
                  CALL framing has to outrank the white label — a branded
                  creator card used to read as a plain powered-by. */}
              {/* Reconciled with GTM's stranger-eye read (2026-08-18): a
                  creator link says WHOSE ("FROM @HANDLE" — "CALL BY" read
                  as a trade tip), and the old tap-to-run eyebrow hinted auto-run, which it
                  isn't — the wallet signs. The eyebrow now says so. */}
              {brand
                ? live?.creator
                  ? handle
                    ? `FROM @${handle.toUpperCase().slice(0, 16)} · POWERED BY PANTESSA`
                    : 'CALL · POWERED BY PANTESSA'
                  : 'POWERED BY PANTESSA'
                : live?.creator
                  ? live.agent
                    ? `CALL BY ${live.agent.toUpperCase().slice(0, 18)} · YOUR WALLET SIGNS`
                    : handle
                      ? `FROM @${handle.toUpperCase().slice(0, 16)} · YOUR WALLET SIGNS`
                      : 'CALL · YOUR WALLET SIGNS'
                  : 'INTENT LINK · YOUR WALLET SIGNS'}
            </span>
          </div>
        </div>

        {/* the ask — the hero */}
        <div style={{ position: 'absolute', top: 190, left: 64, right: 64, display: 'flex', flexDirection: 'column' }}>
          <div
            style={{
              display: 'flex',
              fontFamily: 'Newsreader',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: askSize,
              lineHeight: 1.12,
              maxHeight: 250,
              overflow: 'hidden',
              color: pal.ink,
            }}
          >
            <span>“{ask}”</span>
          </div>
          {/* The promise + the contract pills are sized for the UNFURL — an
              iMessage/Telegram thumbnail is ~300px wide (0.25×): 30px read
              as 7.5px there, invisible. 38/23px put "your wallet signs" in
              the thumbnail, where the stranger decides whether to tap. */}
          <div
            style={{
              display: 'flex',
              marginTop: 28,
              fontSize: 38,
              fontWeight: 600,
              letterSpacing: -0.5,
              // the tri-color gradient is tuned for the house dark card — a
              // branded card takes its promise line flat in the accent
              ...(pal.branded
                ? { color: pal.accent }
                : {
                    backgroundImage: `linear-gradient(92deg, #7df0bd 6%, ${pal.accent} 46%, #ffd25e 104%)`,
                    backgroundClip: 'text',
                    color: 'transparent',
                  }),
            }}
          >
            <span>Connect a wallet and the path builds itself.</span>
          </div>
          {/* the non-custodial line, verbatim from the /i splash's third card
              — the unfurl and the page say the same sentence */}
          <div style={{ display: 'flex', marginTop: 14, fontSize: 26, color: pal.muted }}>
            <span>Nothing moves until you sign — in your own wallet.</span>
          </div>
        </div>

        {/* footer: contract pills + the door */}
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
            {CONTRACT_PILLS.map((label) => (
              <div
                key={label}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 9,
                  padding: '10px 18px',
                  borderRadius: 999,
                  border: pal.branded ? `1.5px solid rgba(${pal.inkRgb},0.28)` : '1.5px solid rgba(255,255,255,0.14)',
                  background: pal.branded ? `rgba(${pal.inkRgb},0.05)` : 'rgba(255,255,255,0.03)',
                  fontSize: 23,
                  color: pal.ink,
                }}
              >
                <div style={{ display: 'flex', width: 9, height: 9, borderRadius: 5, background: pal.accent }} />
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
