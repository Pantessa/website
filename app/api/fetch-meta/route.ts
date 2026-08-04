import { NextRequest, NextResponse } from 'next/server'

interface MetaResult {
  title: string | null
  description: string | null
  iconUrl: string | null
  color: string | null
}

export async function POST(req: NextRequest) {
  try {
    const { url } = await req.json()
    if (!url) return NextResponse.json({ error: 'url required' }, { status: 400 })

    const controller = new AbortController()
    const timeout = setTimeout(() => controller.abort(), 8000)

    try {
      const res = await fetch(url, {
        signal: controller.signal,
        headers: { 'User-Agent': 'Pantessa-MetaFetcher/1.0' },
      })
      clearTimeout(timeout)

      if (!res.ok) throw new Error(`HTTP ${res.status}`)

      const html = await res.text()
      const result: MetaResult = {
        title: null,
        description: null,
        iconUrl: null,
        color: null,
      }

      // Extract title
      const titleMatch =
        html.match(/<meta[^>]+property="og:title"[^>]+content="([^"]+)"/i) ||
        html.match(/<title[^>]*>([^<]+)<\/title>/i)
      result.title = titleMatch?.[1]?.trim() || null

      // Extract description
      const descMatch =
        html.match(/<meta[^>]+property="og:description"[^>]+content="([^"]+)"/i) ||
        html.match(/<meta[^>]+name="description"[^>]+content="([^"]+)"/i)
      result.description = descMatch?.[1]?.trim() || null

      // Extract favicon / og:image
      const ogImageMatch = html.match(/<meta[^>]+property="og:image"[^>]+content="([^"]+)"/i)
      if (ogImageMatch) {
        result.iconUrl = ogImageMatch[1]
      } else {
        // Try apple-touch-icon then favicon
        const appleMatch = html.match(/<link[^>]+rel="apple-touch-icon"[^>]+href="([^"]+)"/i)
        if (appleMatch) {
          const href = appleMatch[1]
          result.iconUrl = href.startsWith('http') ? href : new URL(href, url).href
        } else {
          // Default favicon
          const origin = new URL(url).origin
          result.iconUrl = `${origin}/favicon.ico`
        }
      }

      // Extract theme color
      const colorMatch = html.match(/<meta[^>]+name="theme-color"[^>]+content="([^"]+)"/i)
      result.color = colorMatch?.[1]?.trim() || null

      return NextResponse.json(result)
    } catch (fetchErr) {
      clearTimeout(timeout)
      // Return partial result using just the URL
      const origin = new URL(url).origin
      return NextResponse.json({
        title: null,
        description: null,
        iconUrl: `${origin}/favicon.ico`,
        color: null,
      })
    }
  } catch (error) {
    return NextResponse.json({ error: 'Invalid request' }, { status: 400 })
  }
}
