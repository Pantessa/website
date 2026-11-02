import { NextRequest, NextResponse } from 'next/server'
import { buildVenueManifest, venueOf } from '@/lib/venue-manifest'

// GET /api/venues/manifest — what Pantessa can build, exactly, per venue: the
// pinned contracts per chain, the selectors a build may emit, the signing
// domains, the guard that fences each venue, the bounds. Every value is read
// from the same lib/ constant the builders and guards use (lib/venue-manifest.ts).
//
// Public, no auth, CORS-open for GET (a compliance desk pins it from its own
// tooling), cached five minutes at the edge. `?venue=<slug>` narrows the
// `venues` array to one; the envelope (commit, integrity) stays the whole
// manifest's, so a narrowed read still names the document it came from.
// The printable twin is /docs/venues.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const CORS = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, OPTIONS',
  'access-control-allow-headers': 'content-type',
} as const

const HEADERS = {
  ...CORS,
  'cache-control': 'public, max-age=60, s-maxage=300, stale-while-revalidate=600',
} as const

export async function GET(req: NextRequest) {
  const manifest = buildVenueManifest()
  const slug = req.nextUrl.searchParams.get('venue')
  if (slug !== null) {
    const venue = venueOf(manifest, slug)
    if (!venue) {
      return NextResponse.json(
        { error: `No venue "${slug.slice(0, 40)}".`, venues: manifest.venues.map((v) => v.slug) },
        { status: 404, headers: CORS },
      )
    }
    return NextResponse.json({ ...manifest, venues: [venue] }, { headers: HEADERS })
  }
  return NextResponse.json(manifest, { headers: HEADERS })
}

export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS })
}
