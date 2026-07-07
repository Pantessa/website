import { NextRequest, NextResponse } from 'next/server'
import { recordEmbedSighting, resolveEmbedKey, sightingOrigin } from '@/lib/embed-key'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// The embed sighting beacon — EmbedChat POSTs once per mount:
//   { key?: 'yfe_…', page?: '<full parent URL from the SDK>' }
// Origin resolution: the SDK-reported page first, else the request Referer
// (the embedding page; at minimum its origin under the default policy).
// Public + unauthenticated by design (it runs on strangers' sites), so it
// records nothing but (key, origin, page) and never errors loudly.
export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => ({}))) as { key?: unknown; page?: unknown }

  const origin = sightingOrigin(body.page, req.headers.get('referer'))
  if (!origin) return NextResponse.json({ ok: false }, { status: 202 })

  const resolved = typeof body.key === 'string' ? await resolveEmbedKey(body.key) : null
  await recordEmbedSighting({
    embedKeyId: resolved?.id ?? '',
    ownerAddress: resolved?.ownerAddress ?? null,
    origin,
    pageUrl: typeof body.page === 'string' ? body.page : null,
  })
  return NextResponse.json({ ok: true, attributed: Boolean(resolved) })
}
