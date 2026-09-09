// ─────────────────────────────────────────────────────────────────────────
//  Vendor token + stock icons into public/tokens/ — `npm run vendor:icons`.
//
//  Holdings surfaces (splash cards, the wallet drawer, portfolio cards, chat
//  tables) render a symbol as a 3-letter monogram unless we have real art.
//  This vendors that art, following the repo's marks philosophy (BrandIcon /
//  protocol-marks): no network at render time, no 404 flash, checked-in files.
//
//  TWO NAMESPACES — a ticker means different things on different chains
//  (QNT is the Quant coin everywhere and Quantinuum on Robinhood Chain; COIN
//  and ARM are stocks, not tokens). Keeping them apart is what lets
//  tokenMark() answer correctly with the holding's chain in hand:
//
//   · public/tokens/<SYMBOL>.svg          coins  — full-color, transparent
//   · public/tokens/stocks/<TICKER>.(svg|png)  Robinhood Chain equities
//
//  Sources:
//   · @web3icons/core (MIT, devDependency) — branded token SVGs for coins.
//   · assets.parqet.com/logos/symbol/<TICKER> — the company mark for a listed
//     equity, keyed by ticker, keyless, SVG where they have one and a 100px
//     PNG otherwise. Company marks are the trademarks of their owners and are
//     vendored here only to LABEL a holding the user already owns (the same
//     nominative use every brokerage makes of them).
//   · simple-icons (CC0) — fallback glyph for a ticker parqet doesn't carry,
//     tinted with the brand hex, lifted until it reads on a dark card.
//
//  The stock universe is not hand-typed: it is read from the live Uniswap
//  token list (chain 4663) at vendor time, so a re-run picks up new listings.
//
//  PLATE ANALYSIS — most of this art is a full-bleed brand tile (Apple's is
//  black, Microsoft's white), but ~8% is a bare glyph on transparency, and a
//  white glyph on a light card (or a black one on a dark card) is invisible.
//  Every mark is decoded here (a small PNG reader + an SVG fill scan, both
//  checked against a real browser's canvas) and the manifest records the
//  plate the client must paint behind it. The art itself is never modified.
//
//  Re-runnable + idempotent. Add a coin → COINS; the stocks look after
//  themselves.
// ─────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync, readdirSync, rmSync } from 'fs'
import { join, resolve } from 'path'
import { inflateSync } from 'zlib'
import * as simpleIcons from 'simple-icons'

const OUT_DIR = resolve(__dirname, '../public/tokens')
const STOCK_DIR = join(OUT_DIR, 'stocks')
const MANIFEST = resolve(__dirname, '../lib/token-icons.ts')
const W3_TOKENS = resolve(__dirname, '../node_modules/@web3icons/core/dist/svgs/tokens/branded')
const W3_NETWORKS = resolve(__dirname, '../node_modules/@web3icons/core/dist/svgs/networks/branded')
const W3_EXCHANGES = resolve(__dirname, '../node_modules/@web3icons/core/dist/svgs/exchanges/branded')

const UNISWAP_LIST = 'https://tokens.uniswap.org'
const ROBINHOOD_CHAIN_ID = 4663
const STOCK_ART = (ticker: string) => `https://assets.parqet.com/logos/symbol/${encodeURIComponent(ticker)}`

// Coins vendored from @web3icons/core tokens/branded — the symbols our
// surfaces actually paint (chat chains Ethereum/Base/Arbitrum/Optimism/
// Robinhood, Aave/Lido/Hyperliquid/CoW positions) plus the broad top-100 tail.
const COINS = [
  'ETH', 'BTC', 'WBTC', 'USDC', 'USDT', 'DAI', 'ARB', 'OP', 'UNI', 'AAVE',
  'LINK', 'SOL', 'PEPE', 'CBETH', 'RETH', 'EURC', 'GHO', 'LDO', 'ENS', 'NEAR',
  'SHIB', 'SUI', 'APT', 'TIA', 'SEI', 'GMX', 'DYDX', 'BLUR', 'JUP', 'MATIC',
  'POL', 'DOGE', 'ADA', 'XRP', 'AVAX', 'DOT', 'ATOM', 'LTC', 'BCH', 'CRV',
  'COMP', 'MKR', 'SNX', 'YFI', 'SUSHI', 'RPL', 'FRAX', 'LUSD', 'CAKE', 'IMX',
  'GALA', 'AXS', 'SAND', 'MANA', 'APE', 'RUNE', 'KAS', 'HBAR', 'ICP', 'FIL',
  'GRT', 'ALGO', 'XLM', 'TRX', 'VET', 'XTZ', 'FLOW', 'MINA', 'ROSE', 'ZEC',
  'XMR', 'QNT', 'STRK', '1INCH', 'ZRX', 'BAT', 'CHZ', 'ENJ', 'EOS', 'DASH',
  'ETC', 'PYTH', 'WELL', 'DEGEN', 'TOSHI',
]

// Symbols web3icons carries under another catalog (or that borrow a sibling
// mark): HYPE is Hyperliquid's gas token, stETH/wstETH read as Lido, the
// wrapped/bridged dollars read as their underlying.
const COIN_RESCUES: Record<string, { dir: string; file: string }> = {
  HYPE: { dir: W3_NETWORKS, file: 'hyper-evm' },
  TON: { dir: W3_NETWORKS, file: 'ton' },
  INJ: { dir: W3_NETWORKS, file: 'injective' },
  WLD: { dir: W3_NETWORKS, file: 'world' },
  BAL: { dir: W3_EXCHANGES, file: 'balancer' },
}
const COIN_ALIASES: Record<string, string> = {
  WETH: 'ETH',
  STETH: 'LDO',
  WSTETH: 'LDO',
  USDBC: 'USDC',
}

// Ticker → simple-icons brand slug, used ONLY when the equity source has no
// art for that ticker. Curated (a slug guess would paint the wrong company);
// brands simple-icons has since removed upstream simply aren't here.
const STOCK_SLUG_FALLBACK: Record<string, string> = {
  FIG: 'figma',
  CRCL: 'circle',
  SOFI: 'sofi',
  NAVN: 'navan',
}

export type Plate = 'none' | 'dark' | 'light'

/** Relative luminance of a hex color (0 black → 1 white). */
function luminance(hex: string): number {
  const n = parseInt(hex, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Lift a brand hex toward white until it reads on a dark card, keeping the
 *  hue (Ford navy → steel blue). The floor is deliberately well above "just
 *  visible": at 0.32 the near-black brands (Apple, Palantir) rendered as a
 *  charcoal glyph you had to hunt for on the wallet drawer's dark rows. */
const DARK_INK_FLOOR = 0.58

function liftForDark(hex: string): string {
  let r = (parseInt(hex, 16) >> 16) & 255
  let g = (parseInt(hex, 16) >> 8) & 255
  let b = parseInt(hex, 16) & 255
  let guard = 0
  while (luminance(((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')) < DARK_INK_FLOOR && guard++ < 20) {
    r = Math.round(r + (255 - r) * 0.18)
    g = Math.round(g + (255 - g) * 0.18)
    b = Math.round(b + (255 - b) * 0.18)
  }
  return `#${(((r << 16) | (g << 8) | b) >>> 0).toString(16).padStart(6, '0')}`
}

// ── Art probes ───────────────────────────────────────────────────────────
//  Answer two questions per mark: does it bring its own opaque background,
//  and (if not) is its ink light or dark? Both implementations were checked
//  pixel-for-pixel against Chrome's canvas over the whole live set.

const NAMED_FILLS: Record<string, string> = {
  black: '000000', white: 'ffffff', red: 'ff0000', blue: '0000ff',
  green: '008000', gray: '808080', grey: '808080', silver: 'c0c0c0',
}

function hexLuminance(raw: string): number | null {
  let h = raw.replace('#', '').toLowerCase()
  if (h.length === 3) h = h.split('').map((c) => c + c).join('')
  if (h.length === 8) h = h.slice(0, 6)
  if (h.length !== 6 || /[^0-9a-f]/.test(h)) return null
  return luminance(h)
}

/** Full-bleed background rect? Mean luminance of the remaining fills? */
function probeSvg(src: string): { bgOpaque: boolean; lum: number | null } {
  const vb = /viewBox\s*=\s*"([^"]+)"/.exec(src)?.[1].trim().split(/[\s,]+/).map(Number)
  const vw = vb?.[2] ?? 0
  const vh = vb?.[3] ?? 0
  let bgOpaque = false
  let bgFill: string | null = null
  for (const m of src.matchAll(/<rect\b[^>]*>/g)) {
    const tag = m[0]
    const w = /\bwidth\s*=\s*"([^"]+)"/.exec(tag)?.[1]
    const h = /\bheight\s*=\s*"([^"]+)"/.exec(tag)?.[1]
    const fill = /\bfill\s*=\s*"([^"]+)"/.exec(tag)?.[1]
    if (!w || !h || !fill || fill === 'none' || fill === 'transparent') continue
    const covers = (v: string, span: number) => v === '100%' || (span > 0 && parseFloat(v) >= span - 0.01)
    if (covers(w, vw) && covers(h, vh)) { bgOpaque = true; bgFill = fill; break }
  }
  const fills: number[] = []
  for (const m of src.matchAll(/fill\s*=\s*"(#[0-9a-fA-F]{3,8}|[a-zA-Z]+)"/g)) {
    const raw = m[1]
    if (raw === bgFill) { bgFill = null; continue } // the background's own fill, once
    const l = hexLuminance(raw.startsWith('#') ? raw : NAMED_FILLS[raw.toLowerCase()] ?? '')
    if (l != null) fills.push(l)
  }
  return { bgOpaque, lum: fills.length ? fills.reduce((a, b) => a + b, 0) / fills.length : null }
}

/** Corner alpha + mean ink luminance of an 8-bit, non-interlaced PNG.
 *  (Enough of a decoder for logo art: inflate, un-filter, read pixels.) */
function probePng(buf: Buffer): { bgOpaque: boolean; lum: number | null } | null {
  let p = 8
  let ihdr: Buffer | null = null
  let plte: Buffer | null = null
  let trns: Buffer | null = null
  const idat: Buffer[] = []
  while (p + 8 <= buf.length) {
    const len = buf.readUInt32BE(p)
    const type = buf.toString('ascii', p + 4, p + 8)
    const data = buf.subarray(p + 8, p + 8 + len)
    if (type === 'IHDR') ihdr = data
    else if (type === 'PLTE') plte = data
    else if (type === 'tRNS') trns = data
    else if (type === 'IDAT') idat.push(data)
    else if (type === 'IEND') break
    p += 12 + len
  }
  if (!ihdr) return null
  const w = ihdr.readUInt32BE(0)
  const h = ihdr.readUInt32BE(4)
  const depth = ihdr[8], colorType = ihdr[9], interlace = ihdr[12]
  const channels = ({ 0: 1, 2: 3, 3: 1, 4: 2, 6: 4 } as Record<number, number>)[colorType]
  if (depth !== 8 || interlace !== 0 || !channels) return null

  const raw = inflateSync(Buffer.concat(idat))
  const bpp = channels
  const stride = w * bpp
  const px = Buffer.alloc(h * stride)
  let q = 0
  for (let y = 0; y < h; y++) {
    const filter = raw[q++]
    const row = raw.subarray(q, q + stride)
    q += stride
    const cur = px.subarray(y * stride, (y + 1) * stride)
    const prev = y ? px.subarray((y - 1) * stride, y * stride) : null
    for (let i = 0; i < stride; i++) {
      const a = i >= bpp ? cur[i - bpp] : 0
      const b = prev ? prev[i] : 0
      const c = prev && i >= bpp ? prev[i - bpp] : 0
      let v = row[i]
      if (filter === 1) v += a
      else if (filter === 2) v += b
      else if (filter === 3) v += (a + b) >> 1
      else if (filter === 4) {
        const est = a + b - c
        const pa = Math.abs(est - a), pb = Math.abs(est - b), pc = Math.abs(est - c)
        v += pa <= pb && pa <= pc ? a : pb <= pc ? b : c
      }
      cur[i] = v & 255
    }
  }
  const at = (x: number, y: number): [number, number, number, number] => {
    const o = y * stride + x * bpp
    if (colorType === 6) return [px[o], px[o + 1], px[o + 2], px[o + 3]]
    if (colorType === 2) return [px[o], px[o + 1], px[o + 2], 255]
    if (colorType === 4) return [px[o], px[o], px[o], px[o + 1]]
    if (colorType === 0) return [px[o], px[o], px[o], 255]
    const i = px[o]
    const alpha = trns && i < trns.length ? trns[i] : 255
    return plte ? [plte[i * 3], plte[i * 3 + 1], plte[i * 3 + 2], alpha] : [0, 0, 0, alpha]
  }
  const inset = Math.max(1, Math.round(w * 0.03))
  const corners: [number, number][] = [
    [inset, inset], [w - 1 - inset, inset], [inset, h - 1 - inset], [w - 1 - inset, h - 1 - inset],
  ]
  const bgOpaque = corners.every(([x, y]) => at(x, y)[3] > 200)
  let sum = 0, n = 0
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const [r, g, b, a] = at(x, y)
      if (a > 128) { sum += (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255; n++ }
    }
  }
  return { bgOpaque, lum: n ? sum / n : null }
}

/** The plate the client paints behind a mark: art that carries its own
 *  background needs none; a bare white glyph needs a dark disc (and the
 *  reverse) or it vanishes on one of the two themes. */
function plateFor(probe: { bgOpaque: boolean; lum: number | null } | null): Plate {
  if (!probe || probe.bgOpaque || probe.lum == null) return 'none'
  if (probe.lum > 0.62) return 'dark'
  if (probe.lum < 0.28) return 'light'
  return 'none'
}

/** Strip anything active out of third-party SVG before it lands in public/.
 *  <img> never runs scripts, but these files are also directly navigable. */
function sanitizeSvg(src: string): string | null {
  if (!src.includes('<svg')) return null
  const clean = src
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<foreignObject[\s\S]*?<\/foreignObject>/gi, '')
    .replace(/\son\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\s(href|xlink:href)\s*=\s*"\s*javascript:[^"]*"/gi, '')
    .trim()
  return clean.includes('<svg') ? clean : null
}

async function svgFromWeb3(dir: string, file: string): Promise<string | null> {
  try {
    const mod = await import(join(dir, `${file}.svg.js`))
    const raw: string = mod.default
    return typeof raw === 'string' && raw.includes('<svg') ? raw.trim() : null
  } catch {
    return null
  }
}

function simpleIconGlyph(slug: string): string | null {
  const key = `si${slug.charAt(0).toUpperCase()}${slug.slice(1)}`
  const icon = (simpleIcons as unknown as Record<string, { path: string; hex: string } | undefined>)[key]
  if (!icon) return null
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${liftForDark(icon.hex)}" d="${icon.path}"/></svg>`
}

interface StockListing { symbol: string; name?: string }

/** The live Robinhood Chain universe — the same document lib/token-list.ts
 *  resolves swaps against, so the marks track the tradable list. */
async function robinhoodTickers(): Promise<StockListing[]> {
  const res = await fetch(UNISWAP_LIST)
  if (!res.ok) throw new Error(`token list ${res.status}`)
  const doc = (await res.json()) as { tokens: { chainId: number; symbol: string; name?: string }[] }
  const seen = new Set<string>()
  return doc.tokens
    .filter((t) => t.chainId === ROBINHOOD_CHAIN_ID)
    .filter((t) => (seen.has(t.symbol) ? false : (seen.add(t.symbol), true)))
    .sort((a, b) => a.symbol.localeCompare(b.symbol))
}

async function main() {
  rmSync(OUT_DIR, { recursive: true, force: true })
  mkdirSync(STOCK_DIR, { recursive: true })
  const coins: string[] = []
  const skipped: string[] = []

  // ── Coins — the branded mark as-is (full-color, transparent background).
  const available = new Set(
    readdirSync(W3_TOKENS).filter((f) => f.endsWith('.svg.js')).map((f) => f.replace('.svg.js', '')),
  )
  for (const sym of COINS) {
    const svg = available.has(sym) ? await svgFromWeb3(W3_TOKENS, sym) : null
    if (!svg) { skipped.push(sym); continue }
    writeFileSync(join(OUT_DIR, `${sym}.svg`), svg)
    coins.push(sym)
  }
  for (const [sym, src] of Object.entries(COIN_RESCUES)) {
    const svg = await svgFromWeb3(src.dir, src.file)
    if (!svg) { skipped.push(sym); continue }
    writeFileSync(join(OUT_DIR, `${sym}.svg`), svg)
    coins.push(sym)
  }
  for (const [alias, target] of Object.entries(COIN_ALIASES)) {
    const svg = coins.includes(target) ? await svgFromWeb3(W3_TOKENS, target) : null
    if (!svg) { skipped.push(alias); continue }
    writeFileSync(join(OUT_DIR, `${alias}.svg`), svg)
    coins.push(alias)
  }

  // ── Stocks — every listed ticker, company art where it exists.
  const listings = await robinhoodTickers()
  const stocks: { sym: string; ext: 'svg' | 'png'; plate: Plate }[] = []
  const listed = listings.map((l) => l.symbol).sort()
  const noArt: string[] = []
  let fromFallback = 0

  for (const listing of listings) {
    const sym = listing.symbol
    let ext: 'svg' | 'png' | null = null
    let probe: { bgOpaque: boolean; lum: number | null } | null = null
    try {
      const res = await fetch(STOCK_ART(sym), { redirect: 'follow' })
      const type = res.headers.get('content-type') ?? ''
      if (res.ok && type.includes('svg')) {
        const svg = sanitizeSvg(await res.text())
        if (svg) {
          writeFileSync(join(STOCK_DIR, `${sym}.svg`), svg)
          probe = probeSvg(svg)
          ext = 'svg'
        }
      } else if (res.ok && type.includes('png')) {
        const buf = Buffer.from(await res.arrayBuffer())
        writeFileSync(join(STOCK_DIR, `${sym}.png`), buf)
        probe = probePng(buf)
        ext = 'png'
      }
    } catch {
      // Network hiccup on one ticker → monogram, never a half-written file.
    }
    if (!ext) {
      const slug = STOCK_SLUG_FALLBACK[sym]
      const glyph = slug ? simpleIconGlyph(slug) : null
      if (glyph) {
        writeFileSync(join(STOCK_DIR, `${sym}.svg`), glyph)
        probe = probeSvg(glyph)
        ext = 'svg'
        fromFallback++
      }
    }
    if (!ext) { noArt.push(sym); continue }
    stocks.push({ sym, ext, plate: plateFor(probe) })
  }

  writeFileSync(
    join(STOCK_DIR, 'README.txt'),
    [
      'Company marks for the tokenized equities listed on Robinhood Chain (4663).',
      '',
      'Vendored by scripts/vendor-token-icons.ts from assets.parqet.com (and, for a',
      'few tickers it does not carry, from simple-icons, CC0). They are used to',
      'label a holding the wallet already owns — nothing here is a Pantessa mark.',
      'Every logo remains the trademark of its owner.',
      '',
      `Regenerate: npm run vendor:icons  (last run ${new Date().toISOString().slice(0, 10)})`,
      '',
    ].join('\n'),
  )

  // ── Manifest — membership + plate, so the client never 404-probes an <img>.
  coins.sort()
  stocks.sort((a, b) => a.sym.localeCompare(b.sym))
  const stockLines = stocks.map((s) => `  ${/^[A-Za-z_$][\w$]*$/.test(s.sym) ? s.sym : `'${s.sym}'`}: ['${s.ext}', '${s.plate}'],`)
  const manifest = `// GENERATED by scripts/vendor-token-icons.ts — do not edit by hand.
// Regenerate: npm run vendor:icons

/** A vendored mark: where the file is, and what the client paints behind it. */
export type MarkPlate = 'none' | 'dark' | 'light'
export interface TokenMark {
  src: string
  /** Coins are transparent glyphs (inset in a roundel); stock art is a
   *  full-bleed brand tile (clipped to the circle). */
  kind: 'coin' | 'stock'
  plate: MarkPlate
}

/** Coins with a mark at /tokens/<SYMBOL>.svg. */
const COINS = new Set<string>([
${coins.map((s) => `  '${s}',`).join('\n')}
])

/** Every ticker listed on Robinhood Chain — including the handful we have no
 *  art for. A listed ticker is a COMPANY there, so this set is what stops a
 *  same-named coin's mark from standing in for one (QNT is Quant the token
 *  and Quantinuum the company); no art means the monogram, not the wrong
 *  logo. */
const LISTED = new Set<string>([
${listed.map((s) => `  '${s}',`).join('\n')}
])

/** Robinhood Chain equities we have art for: ticker → [extension, plate]. */
const STOCKS: Record<string, ['svg' | 'png', MarkPlate]> = {
${stockLines.join('\n')}
}

const ROBINHOOD_CHAIN_ID = ${ROBINHOOD_CHAIN_ID}

/** A ticker means different things on different chains (QNT is the Quant
 *  coin, and Quantinuum on Robinhood Chain), so a holding's chain decides
 *  which namespace answers first. With no chain in hand — a chat table, a
 *  bare symbol — coins lead and equities fill the gap, which is right:
 *  nothing lists AAPL as a token. */
export function tokenMark(
  symbol: string,
  where?: { chainId?: number; chain?: string | null },
): TokenMark | null {
  const sym = symbol.trim().toUpperCase()
  if (!sym) return null
  const stock = STOCKS[sym]
  const equity = (): TokenMark => ({ src: \`/tokens/stocks/\${sym}.\${stock![0]}\`, kind: 'stock', plate: stock![1] })
  const coin = COINS.has(sym)
  const onRobinhood =
    where?.chainId === ROBINHOOD_CHAIN_ID || /robinhood/i.test(where?.chain ?? '')
  // On Robinhood Chain a listed ticker is that company, full stop: its art or
  // nothing. Anything else there (ETH, USDG) reads as a normal token.
  if (onRobinhood && LISTED.has(sym)) return stock ? equity() : null
  if (stock && !coin) return equity()
  if (coin) return { src: \`/tokens/\${sym}.svg\`, kind: 'coin', plate: 'none' }
  return stock ? equity() : null
}

/** Path to the vendored mark, or null → the TokenIcon monogram. */
export function tokenIconPath(
  symbol: string,
  where?: { chainId?: number; chain?: string | null },
): string | null {
  return tokenMark(symbol, where)?.src ?? null
}
`
  writeFileSync(MANIFEST, manifest)

  const plated = stocks.filter((s) => s.plate !== 'none')
  console.log(`coins:  ${coins.length} → public/tokens/`)
  console.log(`stocks: ${stocks.length} of ${listings.length} listed → public/tokens/stocks/ (${fromFallback} from simple-icons, ${plated.length} plated)`)
  if (plated.length) console.log(`  plated: ${plated.map((s) => `${s.sym}:${s.plate}`).join(' ')}`)
  if (noArt.length) console.log(`  no art (monogram): ${noArt.join(' ')}`)
  if (skipped.length) console.log(`skipped coins (no art upstream): ${skipped.join(' ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
