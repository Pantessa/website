// White-label brand scanning — the "paste your site, we do the rest" flow.
// A creator gives ONE url; we fetch its HTML, read the declared brand
// signals (theme-color, og:site_name, icon links), pick the cleanest logo,
// and store everything on their creator_handles row. No color pickers, no
// upload widgets. Everything here treats the URL and the fetched bytes as
// hostile input: https-only public hosts, bounded reads, and the logo is
// re-encoded as a size-capped data URI so the storefront never hotlinks or
// re-fetches a foreign host at render time.

import { hexLuminance, normalizeHex } from '@/lib/brand-theme'

// The pure color helpers live in lib/brand-theme.ts (client-safe, shared
// with the branded pages); re-exported here so this module stays the one
// import for the scan API + harness.
export { hexLuminance, normalizeHex }

const FETCH_TIMEOUT_MS = 6000
const HTML_MAX_BYTES = 600_000
export const LOGO_MAX_BYTES = 200_000
const LOGO_CONTENT_TYPES = /^image\/(png|jpeg|webp|gif|svg\+xml|x-icon|vnd\.microsoft\.icon|avif)/i

/** SSRF gate for creator-supplied URLs: https only, default port only, no
 *  credentials, and a public-looking hostname (no localhost, IP literals,
 *  or internal-suffix names). Deliberately mirrors validateRedirect in
 *  lib/intent-links.ts, tightened for server-side fetching. */
export function validateBrandUrl(raw: string): { ok: true; url: URL } | { ok: false; reason: string } {
  let u: URL
  try {
    u = new URL(raw.trim())
  } catch {
    return { ok: false, reason: 'That doesn’t look like a URL — paste your site’s address, e.g. https://yoursite.com' }
  }
  if (u.protocol !== 'https:') return { ok: false, reason: 'Site URLs must be https.' }
  if (u.username || u.password) return { ok: false, reason: 'Site URLs must not carry credentials.' }
  if (u.port && u.port !== '443') return { ok: false, reason: 'Site URLs must use the default https port.' }
  const host = u.hostname.toLowerCase()
  if (
    host === 'localhost' ||
    host.endsWith('.localhost') ||
    host.endsWith('.local') ||
    host.endsWith('.internal') ||
    !host.includes('.') ||
    /^\d+\.\d+\.\d+\.\d+$/.test(host) ||
    host.startsWith('[')
  ) {
    return { ok: false, reason: 'Site URLs must be a public hostname.' }
  }
  return { ok: true, url: u }
}

export interface BrandSignals {
  siteName: string | null
  themeColor: string | null
  /** PWA manifest href (absolute), when the page declares one. */
  manifestHref: string | null
  /** Best-first logo candidate URLs (absolute). */
  logoCandidates: string[]
}

/** Numeric size of an icon's `sizes` attr ("180x180" → 180); 0 when absent. */
function sizeOf(sizes: string | null): number {
  const m = sizes?.match(/(\d+)x\d+/i)
  return m ? Number(m[1]) : 0
}

/** Pull one attribute out of a matched tag body — attribute order varies
 *  wildly in the wild, so tags are matched first and attrs second. */
function attrOf(tag: string, name: string): string | null {
  const m = tag.match(new RegExp(`${name}\\s*=\\s*("([^"]*)"|'([^']*)')`, 'i'))
  return m ? (m[2] ?? m[3] ?? null) : null
}

/** PURE — parse brand signals out of an HTML document. Regex over the head
 *  tags (no DOM dependency, harness-checkable with fixture strings).
 *  Logo ranking: apple-touch-icon (largest) > declared icons (largest,
 *  svg preferred at equal size) > /favicon.ico > og:image — social cards
 *  are posters, not logos, so og:image is the last resort. */
export function parseBrandHtml(html: string, baseUrl: string): BrandSignals {
  const head = html.slice(0, HTML_MAX_BYTES)
  const abs = (href: string): string | null => {
    try {
      const u = new URL(href, baseUrl)
      return u.protocol === 'https:' ? u.toString() : null
    } catch {
      return null
    }
  }

  const metas = head.match(/<meta\b[^>]*>/gi) ?? []
  let themeColor: string | null = null
  let siteName: string | null = null
  let ogImage: string | null = null
  for (const tag of metas) {
    const name = (attrOf(tag, 'name') ?? attrOf(tag, 'property'))?.toLowerCase()
    const content = attrOf(tag, 'content')
    if (!name || !content) continue
    if (name === 'theme-color' && !themeColor) themeColor = content.trim()
    if (name === 'og:site_name' && !siteName) siteName = content.trim().slice(0, 80)
    if (name === 'og:image' && !ogImage) ogImage = content.trim()
  }

  const links = head.match(/<link\b[^>]*>/gi) ?? []
  const touch: Array<{ href: string; size: number }> = []
  const icons: Array<{ href: string; size: number; svg: boolean }> = []
  let manifestHref: string | null = null
  for (const tag of links) {
    const rel = attrOf(tag, 'rel')?.toLowerCase() ?? ''
    const href = attrOf(tag, 'href')
    if (!href) continue
    const size = sizeOf(attrOf(tag, 'sizes'))
    if (/\bapple-touch-icon\b/.test(rel)) touch.push({ href, size })
    else if (/\bicon\b/.test(rel)) icons.push({ href, size, svg: /svg/i.test(attrOf(tag, 'type') ?? '') || /\.svg(\?|$)/i.test(href) })
    else if (rel === 'manifest' && !manifestHref) manifestHref = href
  }
  touch.sort((a, b) => b.size - a.size)
  icons.sort((a, b) => b.size - a.size || Number(b.svg) - Number(a.svg))

  const candidates = [
    ...touch.map((t) => t.href),
    ...icons.map((i) => i.href),
    '/favicon.ico',
    ...(ogImage ? [ogImage] : []),
  ]
  const logoCandidates = [...new Set(candidates.map(abs).filter((x): x is string => !!x))]
  return { siteName, themeColor, manifestHref: manifestHref ? abs(manifestHref) : null, logoCandidates }
}

/** Normalize a page BACKGROUND color: any valid hex goes — a white or black
 *  background is a legitimate brand statement, unlike an accent. */
export function normalizeBg(raw: string | null | undefined): string | null {
  return normalizeHex(raw)
}

/** Normalize an accent color for the storefront: #rgb/#rrggbb only, and
 *  never near-white or near-black — those are backgrounds, not accents, and
 *  would paint invisible buttons in one theme or the other. Returns null
 *  when unusable (the caller falls back to Yeetful's default accent, or to
 *  client-side logo sampling). */
export function normalizeAccent(raw: string | null | undefined): string | null {
  const hex = normalizeHex(raw)
  const lum = hexLuminance(hex)
  if (hex === null || lum === null) return null
  if (lum > 0.88 || lum < 0.06) return null
  return hex
}

async function boundedFetch(url: string): Promise<Response> {
  const ctl = new AbortController()
  const timer = setTimeout(() => ctl.abort(), FETCH_TIMEOUT_MS)
  try {
    return await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: { 'user-agent': 'YeetfulBrandScan/1 (+https://yeetful.com)', accept: '*/*' },
    })
  } finally {
    clearTimeout(timer)
  }
}

/** Fetch + parse a creator's site. The URL must already have passed
 *  validateBrandUrl; the post-redirect landing URL is re-validated so a
 *  redirect can't tunnel to an internal host. `declaredColors` collects
 *  every color the site declares about itself, best-first: meta
 *  theme-color, then the PWA manifest's theme_color and background_color. */
export async function scanBrand(
  url: URL,
): Promise<{ ok: true; domain: string; signals: BrandSignals; declaredColors: string[] } | { ok: false; reason: string }> {
  let res: Response
  try {
    res = await boundedFetch(url.toString())
  } catch {
    return { ok: false, reason: 'Couldn’t reach that site — check the URL and try again.' }
  }
  const landed = validateBrandUrl(res.url || url.toString())
  if (!landed.ok) return { ok: false, reason: 'That site redirected somewhere we won’t follow.' }
  if (!res.ok) return { ok: false, reason: `That site answered ${res.status} — check the URL and try again.` }
  const html = (await res.text()).slice(0, HTML_MAX_BYTES)
  const signals = parseBrandHtml(html, landed.url.toString())

  const declared: Array<string | null> = [signals.themeColor]
  if (signals.manifestHref && validateBrandUrl(signals.manifestHref).ok) {
    try {
      const mres = await boundedFetch(signals.manifestHref)
      if (mres.ok) {
        const manifest = JSON.parse((await mres.text()).slice(0, 50_000)) as { theme_color?: string; background_color?: string }
        declared.push(manifest.theme_color ?? null, manifest.background_color ?? null)
      }
    } catch {
      // fail-soft: a broken manifest never blocks the scan
    }
  }
  const declaredColors = [...new Set(declared.map(normalizeHex).filter((x): x is string => !!x))]
  return { ok: true, domain: landed.url.hostname.toLowerCase(), signals, declaredColors }
}

/** Fetch a logo candidate and re-encode it as a data URI. Content-type must
 *  be an image, size hard-capped — the row stores the bytes, so the page
 *  never depends on the foreign host again. */
export async function fetchLogoDataUri(rawUrl: string): Promise<string | null> {
  const v = validateBrandUrl(rawUrl)
  if (!v.ok) return null
  let res: Response
  try {
    res = await boundedFetch(v.url.toString())
  } catch {
    return null
  }
  if (!res.ok) return null
  const ct = (res.headers.get('content-type') ?? '').split(';')[0].trim()
  if (!LOGO_CONTENT_TYPES.test(ct)) return null
  const buf = Buffer.from(await res.arrayBuffer())
  if (buf.byteLength === 0 || buf.byteLength > LOGO_MAX_BYTES) return null
  return `data:${ct};base64,${buf.toString('base64')}`
}
