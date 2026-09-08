import { NextRequest, NextResponse } from 'next/server'
import { getSessionAddress } from '@/lib/auth'
import { validateBrandUrl } from '@/lib/brand-scan'

// Page-meta preview for the "Request an MCP" modal (title / description /
// icon / theme color off a pasted URL). Hardened 2026-09-08 (squad security
// round 3, SECURITY-AUDIT §LOW): it used to fetch ANY url for ANY caller —
// http://169.254.169.254/, http://localhost:5432, a private CIDR — with the
// body's first 8s of text returned. Now: a signed-in caller (the modal is
// signed-in-only past this step anyway), the same SSRF fence the brand scan
// uses (https, default port, no credentials, public-looking host), a
// post-redirect re-validation of where the fetch LANDED, and a bounded read.

interface MetaResult {
  title: string | null
  description: string | null
  iconUrl: string | null
  color: string | null
}

const HTML_MAX_BYTES = 512_000

const empty = (origin: string | null): MetaResult => ({ title: null, description: null, iconUrl: origin ? `${origin}/favicon.ico` : null, color: null })

export async function POST(req: NextRequest) {
  const viewer = await getSessionAddress().catch(() => null)
  if (!viewer) return NextResponse.json({ error: 'Sign in to request an MCP.' }, { status: 401 })
  let raw: unknown
  try {
    raw = ((await req.json()) as { url?: unknown }).url
  } catch {
    return NextResponse.json({ error: 'Invalid JSON body.' }, { status: 400 })
  }
  if (typeof raw !== 'string' || !raw.trim()) return NextResponse.json({ error: 'url required' }, { status: 400 })
  const gate = validateBrandUrl(raw)
  if (!gate.ok) return NextResponse.json({ error: gate.reason }, { status: 400 })
  const url = gate.url

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 8000)
  try {
    const res = await fetch(url, { signal: controller.signal, headers: { 'User-Agent': 'Pantessa-MetaFetcher/1.0' } })
    clearTimeout(timeout)
    // Where it LANDED must pass the same fence — an https public host that
    // 302s to an internal address is the classic bypass.
    const landed = validateBrandUrl(res.url || url.toString())
    if (!landed.ok) return NextResponse.json({ error: 'That site redirected somewhere we won’t follow.' }, { status: 400 })
    if (!res.ok) return NextResponse.json(empty(landed.url.origin))
    const ctype = res.headers.get('content-type') ?? ''
    if (!/text\/html|application\/xhtml/i.test(ctype)) return NextResponse.json(empty(landed.url.origin))
    const html = (await res.text()).slice(0, HTML_MAX_BYTES)
    const result: MetaResult = empty(landed.url.origin)

    const titleMatch =
      html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) || html.match(/<title[^>]*>([^<]+)<\/title>/i)
    result.title = titleMatch?.[1]?.trim().slice(0, 200) || null

    const descMatch =
      html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
      html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
    result.description = descMatch?.[1]?.trim().slice(0, 500) || null

    // Icon: og:image, else apple-touch-icon, else /favicon.ico — resolved
    // against the LANDED page and fenced again (an icon URL is fetched by the
    // browser, not us, but never hand a client an internal address).
    const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
    const appleMatch = html.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/i)
    const iconRaw = ogImageMatch?.[1] ?? appleMatch?.[1] ?? null
    if (iconRaw) {
      try {
        const abs = new URL(iconRaw, landed.url).toString()
        if (validateBrandUrl(abs).ok) result.iconUrl = abs
      } catch {
        /* keep the favicon default */
      }
    }

    const colorMatch = html.match(/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/i)
    const color = colorMatch?.[1]?.trim() ?? ''
    result.color = /^#[0-9a-f]{3,8}$/i.test(color) ? color : null

    return NextResponse.json(result)
  } catch {
    clearTimeout(timeout)
    // Unreachable / timed out: the partial result off the validated URL only.
    return NextResponse.json(empty(url.origin))
  }
}
