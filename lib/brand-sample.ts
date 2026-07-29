// Client-only canvas sampling of a scanned brand logo. Lives beside
// lib/brand-scan.ts (the server half): the scan stores the logo as a
// same-origin data URI, and the CREATOR'S browser reads its colors — canvas
// never taints, and no foreign host is fetched at render time.

function rgbHue(r: number, g: number, b: number): number {
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  if (max === min) return 0
  const d = max - min
  const h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
  return h * 60
}

/** Sample the scanned logo's colors — runs in the creator's own browser
 *  (the logo is a same-origin data URI, so canvas never taints). Two
 *  reads: BACKGROUND from the edge ring (icons like CoW's carry the brand
 *  bg as a uniform border — validated against real touch icons), and
 *  ACCENT as the densest colorful hue bucket, excluding pixels close to
 *  that bg so a solid-color icon doesn't nominate its own background.
 *  Either can come back null (transparent edges / monochrome art) — the
 *  caller then keeps its defaults. */
export function sampleBrandColors(dataUri: string): Promise<{ bg: string | null; accent: string | null }> {
  return new Promise((resolve) => {
    const img = new Image()
    img.onload = () => {
      try {
        const N = 64
        const c = document.createElement('canvas')
        c.width = N
        c.height = N
        const ctx = c.getContext('2d')
        if (!ctx) return resolve({ bg: null, accent: null })
        ctx.drawImage(img, 0, 0, N, N)
        const { data } = ctx.getImageData(0, 0, N, N)
        const px = (x: number, y: number) => {
          const i = (y * N + x) * 4
          return [data[i], data[i + 1], data[i + 2], data[i + 3]] as const
        }
        const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, '0')).join('')}`

        // Background: the outer 2px ring, when it's opaque and uniform.
        const edge: Array<readonly [number, number, number, number]> = []
        for (let x = 0; x < N; x++) for (const y of [0, 1, N - 2, N - 1]) edge.push(px(x, y))
        for (let y = 2; y < N - 2; y++) for (const x of [0, 1, N - 2, N - 1]) edge.push(px(x, y))
        const opaque = edge.filter((p) => p[3] > 200)
        let bg: number[] | null = null
        if (opaque.length / edge.length >= 0.6) {
          const mean = opaque.reduce((a, p) => [a[0] + p[0], a[1] + p[1], a[2] + p[2]], [0, 0, 0]).map((v) => v / opaque.length)
          const near = opaque.filter((p) => Math.hypot(p[0] - mean[0], p[1] - mean[1], p[2] - mean[2]) < 60)
          if (near.length / opaque.length >= 0.7) bg = mean
        }

        // Accent: densest colorful hue bucket, excluding bg-like pixels.
        const buckets = new Map<number, { r: number; g: number; b: number; n: number }>()
        for (let i = 0; i < data.length; i += 4) {
          const r = data[i]
          const g = data[i + 1]
          const b = data[i + 2]
          if (data[i + 3] < 200) continue
          const lum = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255
          if (Math.max(r, g, b) - Math.min(r, g, b) < 24 || lum > 0.88 || lum < 0.06) continue
          if (bg && Math.hypot(r - bg[0], g - bg[1], b - bg[2]) < 60) continue
          const key = Math.round(rgbHue(r, g, b) / 24)
          const cur = buckets.get(key) ?? { r: 0, g: 0, b: 0, n: 0 }
          cur.r += r
          cur.g += g
          cur.b += b
          cur.n++
          buckets.set(key, cur)
        }
        let best: { r: number; g: number; b: number; n: number } | null = null
        for (const v of buckets.values()) if (!best || v.n > best.n) best = v
        resolve({
          bg: bg ? toHex(bg) : null,
          accent: best && best.n >= 8 ? toHex([best.r / best.n, best.g / best.n, best.b / best.n]) : null,
        })
      } catch {
        resolve({ bg: null, accent: null })
      }
    }
    img.onerror = () => resolve({ bg: null, accent: null })
    img.src = dataUri
  })
}
