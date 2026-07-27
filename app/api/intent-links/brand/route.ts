import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { fetchLogoDataUri, hexLuminance, normalizeAccent, normalizeBg, scanBrand, validateBrandUrl } from '@/lib/brand-scan'

// White-label brand for the creator's /l/<handle> page. One paste, no form:
// POST {url} scans the creator's own site (theme-color, site name, icons),
// stores the best logo as a data URI + the accent on their handle row, and
// the storefront re-themes. PATCH {accent} closes the no-theme-color gap —
// the dashboard samples the logo's dominant color client-side and files it
// here. DELETE clears the brand. All owner-gated; branding requires a
// claimed handle (there's no page to brand otherwise).

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

async function ownedHandle(req: NextRequest) {
  const addr = await getAuthAddress(req)
  if (!addr) return { row: null, res: NextResponse.json({ error: 'Sign in first.' }, { status: 401 }) }
  const row = await prisma.creatorHandle.findUnique({ where: { creator: addr.toLowerCase() } })
  if (!row)
    return { row: null, res: NextResponse.json({ error: 'Claim your page name first — the brand lives on your /l page.' }, { status: 409 }) }
  return { row, res: null }
}

function brandOf(row: {
  brandDomain: string | null
  brandName: string | null
  brandLogo: string | null
  brandAccent: string | null
  brandBg: string | null
}) {
  return row.brandDomain || row.brandLogo || row.brandAccent || row.brandBg
    ? { domain: row.brandDomain, name: row.brandName, logo: row.brandLogo, accent: row.brandAccent, bg: row.brandBg }
    : null
}

export async function POST(req: NextRequest) {
  const { row, res } = await ownedHandle(req)
  if (!row) return res
  let body: { url?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const v = validateBrandUrl(String(body.url ?? ''))
  if (!v.ok) return NextResponse.json({ error: v.reason }, { status: 400 })

  const scanned = await scanBrand(v.url)
  if (!scanned.ok) return NextResponse.json({ error: scanned.reason }, { status: 502 })

  // First candidate that actually fetches as a real image wins (a declared
  // apple-touch-icon can 404; the ladder just moves on). Cap the attempts —
  // this is a paste-button, not a crawler.
  let logo: string | null = null
  for (const candidate of scanned.signals.logoCandidates.slice(0, 4)) {
    logo = await fetchLogoDataUri(candidate)
    if (logo) break
  }
  // Declared colors, best-first. The page BACKGROUND takes the first one
  // that isn't near-white — a near-white declaration is browser-chrome
  // default noise (swap.cow.fi declares #ffffff over a navy app), and a
  // white page is our default look anyway. The accent takes the first
  // color that passes the accent gate (colorful, mid-luminance).
  const bg = scanned.declaredColors.find((c) => (hexLuminance(c) ?? 1) <= 0.85) ?? null
  const accent = scanned.declaredColors.map(normalizeAccent).find((c) => !!c) ?? null
  if (!logo && !accent && !bg)
    return NextResponse.json(
      { error: `Scanned ${scanned.domain} but found no usable logo or brand color — is that the right site?` },
      { status: 422 },
    )

  const saved = await prisma.creatorHandle.update({
    where: { handle: row.handle },
    data: {
      brandDomain: scanned.domain,
      brandName: scanned.signals.siteName,
      brandLogo: logo,
      brandAccent: accent,
      brandBg: bg,
      brandUpdatedAt: new Date(),
    },
  })
  return NextResponse.json({
    handle: row.handle,
    url: `/l/${row.handle}`,
    brand: brandOf(saved),
    // Every color the site declared — the dashboard's one-tap background
    // swatches, alongside whatever the client samples from the logo.
    palette: scanned.declaredColors,
    needsSample: !!logo && (!accent || !bg),
  })
}

export async function PATCH(req: NextRequest) {
  const { row, res } = await ownedHandle(req)
  if (!row) return res
  let body: { accent?: string; bg?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const accent = body.accent !== undefined ? normalizeAccent(String(body.accent)) : undefined
  const bg = body.bg !== undefined ? normalizeBg(String(body.bg)) : undefined
  if (accent === null) return NextResponse.json({ error: 'Accent must be a hex color that isn’t near-white or near-black.' }, { status: 400 })
  if (bg === null) return NextResponse.json({ error: 'Background must be a hex color.' }, { status: 400 })
  if (accent === undefined && bg === undefined) return NextResponse.json({ error: 'Send accent and/or bg.' }, { status: 400 })
  const saved = await prisma.creatorHandle.update({
    where: { handle: row.handle },
    data: {
      ...(accent !== undefined ? { brandAccent: accent } : {}),
      ...(bg !== undefined ? { brandBg: bg } : {}),
      brandUpdatedAt: new Date(),
    },
  })
  return NextResponse.json({ handle: row.handle, brand: brandOf(saved) })
}

export async function DELETE(req: NextRequest) {
  const { row, res } = await ownedHandle(req)
  if (!row) return res
  await prisma.creatorHandle.update({
    where: { handle: row.handle },
    data: { brandDomain: null, brandName: null, brandLogo: null, brandAccent: null, brandBg: null, brandUpdatedAt: null },
  })
  return NextResponse.json({ ok: true })
}
