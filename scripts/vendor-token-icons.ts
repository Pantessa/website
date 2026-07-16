// ─────────────────────────────────────────────────────────────────────────
//  Vendor token + stock icons into public/tokens/ — `npm run vendor:icons`.
//
//  The splash/portfolio surfaces render holdings as 3-letter monograms; this
//  gives the top coins and Robinhood Chain's tokenized stocks real marks,
//  following the repo's vendored-marks philosophy (BrandIcon/protocol-marks):
//  no network at render time, no failure mode, checked-in art.
//
//  Sources (both devDependencies, assets copied out at vendor time):
//   · @web3icons/core (MIT) — full-color branded token SVGs (~1.8k symbols)
//   · simple-icons (CC0)    — official monochrome brand glyphs for the
//     tokenized stocks (NVDA→nvidia, TSLA→tesla, …), tinted with each
//     brand's hex at vendor time; near-black hexes are lifted toward white
//     until they read on the dark cards (Apple/Palantir render as the gray
//     they commonly ship on dark surfaces anyway).
//
//  Output:
//   · public/tokens/<SYMBOL>.svg  (flat namespace; stocks win collisions —
//     the Robinhood card is where an ambiguous ticker like COIN shows)
//   · lib/token-icons.ts          (generated manifest — the client checks
//     membership instead of 404-probing <img> tags)
//
//  Re-runnable + idempotent. Add a coin → COINS; add a stock → STOCKS.
// ─────────────────────────────────────────────────────────────────────────

import { mkdirSync, writeFileSync, readdirSync } from 'fs'
import { join, resolve } from 'path'
import * as simpleIcons from 'simple-icons'

const OUT_DIR = resolve(__dirname, '../public/tokens')
const MANIFEST = resolve(__dirname, '../lib/token-icons.ts')
const W3_TOKENS = resolve(__dirname, '../node_modules/@web3icons/core/dist/svgs/tokens/branded')
const W3_NETWORKS = resolve(__dirname, '../node_modules/@web3icons/core/dist/svgs/networks/branded')
const W3_EXCHANGES = resolve(__dirname, '../node_modules/@web3icons/core/dist/svgs/exchanges/branded')

// Coins vendored from @web3icons/core tokens/branded — the symbols our
// surfaces actually paint (chat chains Ethereum/Base/Arbitrum/Robinhood,
// Aave/Lido/Hyperliquid/CoW positions) plus the broad top-100 tail.
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

// Robinhood Chain tokenized stocks ↔ simple-icons brand slugs. Only brands
// simple-icons still carries (Amazon/Microsoft/Oracle were takedown-removed
// upstream); everything else falls back to the TokenIcon monogram.
const STOCKS: Record<string, string> = {
  AAPL: 'apple', AMD: 'amd', ARM: 'arm', BA: 'boeing', BABA: 'alibabadotcom',
  AVGO: 'broadcom', COIN: 'coinbase', DDOG: 'datadog', DELL: 'dell', F: 'ford',
  GOOGL: 'google', INTC: 'intel', INTU: 'intuit', MDB: 'mongodb', META: 'meta',
  NFLX: 'netflix', NOK: 'nokia', NVDA: 'nvidia', PLTR: 'palantir',
  QCOM: 'qualcomm', RBLX: 'roblox', RDDT: 'reddit', SHOP: 'shopify',
  TSLA: 'tesla', UPS: 'ups', ZM: 'zoom',
}

/** Relative luminance of a hex color (0 black → 1 white). */
function luminance(hex: string): number {
  const n = parseInt(hex, 16)
  const r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
}

/** Lift a brand hex toward white until it reads on the dark cards, keeping
 *  the hue (Ford navy → steel blue) — pure black brands become the gray they
 *  ship on dark surfaces anyway. */
function liftForDark(hex: string): string {
  let n = parseInt(hex, 16)
  let r = (n >> 16) & 255, g = (n >> 8) & 255, b = n & 255
  let guard = 0
  while (luminance(((r << 16) | (g << 8) | b).toString(16).padStart(6, '0')) < 0.32 && guard++ < 12) {
    r = Math.round(r + (255 - r) * 0.18)
    g = Math.round(g + (255 - g) * 0.18)
    b = Math.round(b + (255 - b) * 0.18)
  }
  return `#${(((r << 16) | (g << 8) | b) >>> 0).toString(16).padStart(6, '0')}`
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

async function main() {
  mkdirSync(OUT_DIR, { recursive: true })
  const written: string[] = []
  const skipped: string[] = []

  // Coins — copy the branded mark as-is (full-color, transparent bg).
  const available = new Set(
    readdirSync(W3_TOKENS).filter((f) => f.endsWith('.svg.js')).map((f) => f.replace('.svg.js', '')),
  )
  for (const sym of COINS) {
    if (!available.has(sym)) { skipped.push(sym); continue }
    const svg = await svgFromWeb3(W3_TOKENS, sym)
    if (!svg) { skipped.push(sym); continue }
    writeFileSync(join(OUT_DIR, `${sym}.svg`), svg)
    written.push(sym)
  }
  for (const [sym, src] of Object.entries(COIN_RESCUES)) {
    const svg = await svgFromWeb3(src.dir, src.file)
    if (!svg) { skipped.push(sym); continue }
    writeFileSync(join(OUT_DIR, `${sym}.svg`), svg)
    written.push(sym)
  }
  for (const [alias, target] of Object.entries(COIN_ALIASES)) {
    if (!written.includes(target)) { skipped.push(alias); continue }
    const svg = await svgFromWeb3(W3_TOKENS, target)
    if (!svg) { skipped.push(alias); continue }
    writeFileSync(join(OUT_DIR, `${alias}.svg`), svg)
    written.push(alias)
  }

  // Stocks — simple-icons path, tinted with the (dark-lifted) brand hex.
  // Stocks intentionally OVERWRITE a same-named coin (Robinhood context wins).
  for (const [ticker, slug] of Object.entries(STOCKS)) {
    const key = `si${slug.charAt(0).toUpperCase()}${slug.slice(1)}`
    const icon = (simpleIcons as unknown as Record<string, { path: string; hex: string } | undefined>)[key]
    if (!icon) { skipped.push(ticker); continue }
    const fill = liftForDark(icon.hex)
    const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24"><path fill="${fill}" d="${icon.path}"/></svg>`
    writeFileSync(join(OUT_DIR, `${ticker}.svg`), svg)
    if (!written.includes(ticker)) written.push(ticker)
  }

  // Manifest — a Set the client checks before rendering an <img>.
  written.sort()
  const manifest = `// GENERATED by scripts/vendor-token-icons.ts — do not edit by hand.
// Symbols with a vendored mark at /tokens/<SYMBOL>.svg. Everything else
// renders the TokenIcon monogram. Regenerate: npm run vendor:icons

const VENDORED = new Set<string>([
${written.map((s) => `  '${s}',`).join('\n')}
])

/** Path to the vendored mark for a symbol, or null → monogram fallback. */
export function tokenIconPath(symbol: string): string | null {
  const sym = symbol.trim().toUpperCase()
  return VENDORED.has(sym) ? \`/tokens/\${sym}.svg\` : null
}
`
  writeFileSync(MANIFEST, manifest)
  console.log(`vendored ${written.length} marks → public/tokens/ (manifest: lib/token-icons.ts)`)
  if (skipped.length) console.log(`skipped (no art upstream): ${skipped.join(' ')}`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
