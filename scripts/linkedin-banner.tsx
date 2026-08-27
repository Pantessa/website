/**
 * scripts/linkedin-banner.tsx — the LinkedIn company-page cover, rendered from
 * the same parts every other Pantessa card is made of (assets/og-fonts,
 * lib/og-marks' pangolin, the house palette), so the banner can never drift
 * from the OG cards.
 *
 *   npx tsx scripts/linkedin-banner.tsx
 *
 * LinkedIn company page cover = 1128 × 191 (their published spec). We render
 * at 2× (2256 × 382) — same aspect ratio, so LinkedIn never crops, and the
 * type stays crisp on the retina layout that upscales the 1× file. The 1×
 * file is emitted alongside it for anywhere the exact spec is wanted.
 *
 * Two safe zones drive the layout:
 *   · the company LOGO tile overlaps the cover's lower LEFT on desktop, so
 *     nothing but ambient light lives left of ~x300 (logical units)
 *   · mobile crops the sides, so the block sits inboard of both edges
 */

import { ImageResponse } from 'next/og'
import { readFile, writeFile } from 'node:fs/promises'
import { inflateSync } from 'node:zlib'
import { join } from 'node:path'
import { pangolinMarkSvg } from '../lib/og-marks'

// The house palette — same constants as app/opengraph-image.tsx.
const BG = '#050708'
const INK = '#FAFAF7'
const ACCENT = '#34e3a0'
const MUTED = '#8a9186'
// The hero's italic gradient (emerald → gold), verbatim.
const ASK_GRADIENT = `linear-gradient(92deg, #7df0bd 6%, ${ACCENT} 46%, #ffd25e 104%)`

// The canonical first ask from components/typed-asks — a real, parseable
// shape, never an invented sentence that would dead-end if pasted.
const ASK = 'Buy $12 of AAPL'

const W = 1128
const H = 191
// The company logo tile overlaps the cover's lower left — nothing but ambient
// light is allowed to live in this column.
const LOGO_RESERVE = 220

const toDataUri = (svg: string) => `data:image/svg+xml;base64,${Buffer.from(svg).toString('base64')}`

/** One soft emerald bloom, right of the logo zone — the only artwork. */
const ambient = (w: number, h: number) => `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}" viewBox="0 0 ${w} ${h}">
  <defs>
    <radialGradient id="amb" cx="0.56" cy="0.5" r="0.62">
      <stop offset="0" stop-color="rgba(52,227,160,0.11)"/>
      <stop offset="0.7" stop-color="rgba(52,227,160,0)"/>
    </radialGradient>
  </defs>
  <rect width="${w}" height="${h}" fill="url(#amb)"/>
</svg>`

/** The shell every variant shares: the near-black field, one emerald bloom,
 *  and a content row that reserves the logo's corner and optically centers
 *  in what's left (LOGO_RESERVE → the right edge). */
function Shell({ s, padTop, children }: { s: number; padTop: number; children: React.ReactNode }) {
  return (
    <div
      style={{
        width: '100%',
        height: '100%',
        display: 'flex',
        position: 'relative',
        background: BG,
        fontFamily: 'Geist',
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={toDataUri(ambient(W * s, H * s))} width={W * s} height={H * s} alt="" style={{ position: 'absolute', top: 0, left: 0 }} />
      <div
        style={{
          position: 'absolute',
          top: 0,
          left: 0,
          width: W * s,
          height: H * s,
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          paddingLeft: LOGO_RESERVE * s,
          // set by the auto-centering pass below — the serif's line box is not
          // symmetric, so the INK is centered, not the box
          paddingTop: padTop,
        }}
      >
        {children}
      </div>
    </div>
  )
}

/** The eyebrow the site wears, verbatim from the hero. */
function Eyebrow({ s, text }: { s: number; text: string }) {
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 11 * s }}>
      <div style={{ display: 'flex', width: 7 * s, height: 7 * s, borderRadius: 4 * s, background: ACCENT }} />
      <span style={{ fontSize: 13 * s, letterSpacing: 4.1 * s, color: MUTED }}>{text}</span>
    </div>
  )
}

/** The h1, as one line: the quoted ask in the gradient italic, the payoff in
 *  ink — the landing hero's exact construction. */
function Claim({ s, size }: { s: number; size: number }) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'baseline',
        fontFamily: 'Newsreader',
        fontWeight: 500,
        fontSize: size * s,
        letterSpacing: -1.1 * s,
      }}
    >
      <span
        style={{
          fontStyle: 'italic',
          backgroundImage: ASK_GRADIENT,
          backgroundClip: 'text',
          color: 'transparent',
          paddingRight: 4 * s,
        }}
      >
        &ldquo;{ASK}&rdquo;
      </span>
      <span style={{ color: INK, paddingLeft: 12 * s }}>We do the rest.</span>
    </div>
  )
}

/** A — the claim. The eyebrow carries the qualifier a first-time visitor
 *  needs (non-custodial), the line carries the product. */
function ClaimBanner({ s, padTop = 0 }: { s: number; padTop?: number }) {
  return (
    <Shell s={s} padTop={padTop}>
      <div style={{ display: 'flex', flexDirection: 'column' }}>
        <Eyebrow s={s} text="INTENT LINKS · NON-CUSTODIAL · YOUR WALLET SIGNS" />
        <div style={{ display: 'flex', marginTop: 17 * s }}>
          <Claim s={s} size={46} />
        </div>
      </div>
    </Shell>
  )
}

/** B — the lockup: mark + wordmark + the one-line claim, for a more classic
 *  corporate read (the avatar repeats the mark, which is why this is the
 *  alternate and not the default). */
function LockupBanner({ s, padTop = 0 }: { s: number; padTop?: number }) {
  return (
    <Shell s={s} padTop={padTop}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 26 * s }}>
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={toDataUri(pangolinMarkSvg(ACCENT))} width={62 * s} height={62 * s} alt="" />
        <span style={{ color: INK, fontSize: 46 * s, fontWeight: 600, letterSpacing: -1.9 * s }}>pantessa</span>
        <div style={{ display: 'flex', width: 1 * s, height: 62 * s, background: 'rgba(255,255,255,0.14)' }} />
        <div style={{ display: 'flex', flexDirection: 'column', gap: 9 * s }}>
          <span
            style={{
              fontFamily: 'Newsreader',
              fontStyle: 'italic',
              fontWeight: 500,
              fontSize: 27 * s,
              backgroundImage: ASK_GRADIENT,
              backgroundClip: 'text',
              color: 'transparent',
            }}
          >
            You have an intent. We do the rest.
          </span>
          <Eyebrow s={s} text="INTENT LINKS · YOUR WALLET SIGNS" />
        </div>
      </div>
    </Shell>
  )
}

/** C — nothing but the claim. The least a banner can carry and still say
 *  what the company does. */
function MinimalBanner({ s, padTop = 0 }: { s: number; padTop?: number }) {
  return (
    <Shell s={s} padTop={padTop}>
      <div style={{ display: 'flex' }}>
        <Claim s={s} size={52} />
      </div>
    </Shell>
  )
}

/** Minimal PNG reader — enough to get RGBA pixels back out of what resvg
 *  just wrote (8-bit RGBA is all next/og emits). Node ships the inflate. */
function decodePng(buf: Buffer): { width: number; height: number; px: Buffer } {
  if (buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG')
  let pos = 8
  let width = 0
  let height = 0
  const idat: Buffer[] = []
  while (pos < buf.length) {
    const len = buf.readUInt32BE(pos)
    const type = buf.toString('ascii', pos + 4, pos + 8)
    const data = buf.subarray(pos + 8, pos + 8 + len)
    if (type === 'IHDR') {
      width = data.readUInt32BE(0)
      height = data.readUInt32BE(4)
      if (data[8] !== 8 || data[9] !== 6) throw new Error(`expected 8-bit RGBA, got depth ${data[8]} type ${data[9]}`)
    } else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    pos += 12 + len
  }
  const raw = inflateSync(Buffer.concat(idat))
  const bpp = 4
  const stride = width * bpp
  const px = Buffer.alloc(height * stride)
  for (let y = 0; y < height; y++) {
    const filter = raw[y * (stride + 1)]
    const line = raw.subarray(y * (stride + 1) + 1, y * (stride + 1) + 1 + stride)
    for (let x = 0; x < stride; x++) {
      const a = x >= bpp ? px[y * stride + x - bpp] : 0
      const b = y > 0 ? px[(y - 1) * stride + x] : 0
      const c = x >= bpp && y > 0 ? px[(y - 1) * stride + x - bpp] : 0
      let v = line[x]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const p = a + b - c
        const pa = Math.abs(p - a)
        const pb = Math.abs(p - b)
        const pc = Math.abs(p - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      px[y * stride + x] = v & 0xff
    }
  }
  return { width, height, px }
}

/** First and last rows carrying actual ink (the bloom sits far below this
 *  threshold; type and the mark sit far above it). */
function inkRows(buf: Buffer): { top: number; bottom: number; height: number } {
  const { width, height, px } = decodePng(buf)
  let top = -1
  let bottom = -1
  for (let y = 0; y < height; y++) {
    let hit = false
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4
      if (Math.max(px[i], px[i + 1], px[i + 2]) > 90) { hit = true; break }
    }
    if (hit) { if (top < 0) top = y; bottom = y }
  }
  return { top, bottom, height }
}

type Variant = (p: { s: number; padTop?: number }) => React.ReactElement
type OgOptions = NonNullable<ConstructorParameters<typeof ImageResponse>[1]>
type OgFonts = NonNullable<OgOptions['fonts']>

/** Render twice: once to find where the ink actually lands, then again with
 *  the padding that centers it. Guessing at serif metrics is how a banner
 *  ends up subtly high — this measures instead. */
async function render(
  Variant: Variant,
  s: number,
  fonts: OgFonts,
  out: string,
) {
  const shoot = async (padTop: number) =>
    Buffer.from(await new ImageResponse(<Variant s={s} padTop={padTop} />, { width: W * s, height: H * s, fonts }).arrayBuffer())

  const probe = inkRows(await shoot(0))
  // paddingTop moves a centered child's content down by half of it
  const padTop = Math.max(0, Math.round((probe.height / 2 - (probe.top + probe.bottom) / 2) * 2))
  const buf = await shoot(padTop)
  const final = inkRows(buf)
  const off = Math.round((final.top + final.bottom) / 2 - final.height / 2)
  if (Math.abs(off) > 3) throw new Error(`${out}: ink is ${off}px off centre after correction`)
  await writeFile(out, buf)
  console.log(
    `${out.split('/').slice(-1)[0].padEnd(38)} ${W * s}×${H * s}  ${(buf.length / 1024).toFixed(0)} KB  ink rows ${final.top}–${final.bottom} (centre ${off >= 0 ? '+' : ''}${off}px)`,
  )
}

async function main() {
  const dir = join(process.cwd(), 'assets', 'og-fonts')
  const [serif, serifItalic, sans, sansSemi] = await Promise.all([
    readFile(join(dir, 'newsreader-500.ttf')),
    readFile(join(dir, 'newsreader-500-italic.ttf')),
    readFile(join(dir, 'geist-500.ttf')),
    readFile(join(dir, 'geist-600.ttf')),
  ])
  const fonts: OgFonts = [
    { name: 'Newsreader', data: serif, weight: 500 as const, style: 'normal' as const },
    { name: 'Newsreader', data: serifItalic, weight: 500 as const, style: 'italic' as const },
    { name: 'Geist', data: sans, weight: 500 as const, style: 'normal' as const },
    { name: 'Geist', data: sansSemi, weight: 600 as const, style: 'normal' as const },
  ]
  const out = join(process.cwd(), 'brand', 'linkedin')
  await render(ClaimBanner, 2, fonts, join(out, 'pantessa-linkedin-cover.png'))
  await render(ClaimBanner, 1, fonts, join(out, 'pantessa-linkedin-cover@1x.png'))
  await render(LockupBanner, 2, fonts, join(out, 'pantessa-linkedin-cover-lockup.png'))
  await render(MinimalBanner, 2, fonts, join(out, 'pantessa-linkedin-cover-minimal.png'))
}

void main()
