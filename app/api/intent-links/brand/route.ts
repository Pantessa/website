import { NextRequest, NextResponse } from 'next/server'
import prisma from '@/lib/db'
import { getAuthAddress } from '@/lib/api-key'
import { fetchLogoDataUri, normalizeAccent, scanBrand, validateBrandUrl } from '@/lib/brand-scan'

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

function brandOf(row: { brandDomain: string | null; brandName: string | null; brandLogo: string | null; brandAccent: string | null }) {
  return row.brandDomain || row.brandLogo || row.brandAccent
    ? { domain: row.brandDomain, name: row.brandName, logo: row.brandLogo, accent: row.brandAccent }
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
  const accent = normalizeAccent(scanned.signals.themeColor)
  if (!logo && !accent)
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
      brandUpdatedAt: new Date(),
    },
  })
  return NextResponse.json({ handle: row.handle, url: `/l/${row.handle}`, brand: brandOf(saved), needsAccent: !accent && !!logo })
}

export async function PATCH(req: NextRequest) {
  const { row, res } = await ownedHandle(req)
  if (!row) return res
  let body: { accent?: string }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON.' }, { status: 400 })
  }
  const accent = normalizeAccent(String(body.accent ?? ''))
  if (!accent) return NextResponse.json({ error: 'Accent must be a hex color that isn’t near-white or near-black.' }, { status: 400 })
  const saved = await prisma.creatorHandle.update({
    where: { handle: row.handle },
    data: { brandAccent: accent, brandUpdatedAt: new Date() },
  })
  return NextResponse.json({ handle: row.handle, brand: brandOf(saved) })
}

export async function DELETE(req: NextRequest) {
  const { row, res } = await ownedHandle(req)
  if (!row) return res
  await prisma.creatorHandle.update({
    where: { handle: row.handle },
    data: { brandDomain: null, brandName: null, brandLogo: null, brandAccent: null, brandUpdatedAt: null },
  })
  return NextResponse.json({ ok: true })
}
