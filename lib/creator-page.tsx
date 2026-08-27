'use client'

// lib/creator-page.tsx — the ONE state machine behind the creator page
// (/l/<handle>): claim/rename the name, scan your own site for a logo, set
// the colors, clear it. Extracted from CreatorPagePanel so the compact panel
// (dashboard links + rail modal) and the full studio (/dashboard/customize)
// can never drift apart — the same calls, the same refusals, the same
// cache-busting nonce for the live share-card preview.
//
// Rule 7 lives on the server (POST refuses a denied host by name, and every
// render site reads through brandFromRow), so this hook just surfaces the
// refusal copy the API returns.

import { useCallback, useEffect, useState } from 'react'
import type { Brand } from '@/lib/intent-links-ui'
import { sampleBrandColors } from '@/lib/brand-sample'

export interface CreatorPageState {
  /** The claimed page name, or null until one is claimed. */
  myHandle: string | null
  /** A claim refusal, with the taken page's URL when the API knows it. */
  handleMsg: { text: string; url?: string } | null
  claiming: boolean
  /** Stored white-label brand (logo/name/colors), or null for the house look. */
  brand: Brand | null
  branding: boolean
  brandMsg: string | null
  /** Every color the last scan surfaced — one-tap background swatches. */
  palette: string[]
  /** Bumped on every mutation so the live OG preview repaints in place. */
  ogNonce: number
  /** Resolves true when the name landed — callers clear their input on it. */
  claim: (handle: string) => Promise<boolean>
  /** Resolves true when the scan landed (false on a refusal, incl. rule 7). */
  matchSite: (url: string) => Promise<boolean>
  /** Set the page colors directly — presets and the hex pickers both land
   *  here. No site, no logo, no third party: just the palette. */
  setColors: (patch: { bg?: string; accent?: string }) => Promise<boolean>
  removeBrand: () => Promise<void>
  clearBrandMsg: () => void
}

export function useCreatorPage(): CreatorPageState {
  const [myHandle, setMyHandle] = useState<string | null>(null)
  const [handleMsg, setHandleMsg] = useState<{ text: string; url?: string } | null>(null)
  const [claiming, setClaiming] = useState(false)
  const [brand, setBrand] = useState<Brand | null>(null)
  const [branding, setBranding] = useState(false)
  const [brandMsg, setBrandMsg] = useState<string | null>(null)
  const [ogNonce, setOgNonce] = useState(0)
  const [palette, setPalette] = useState<string[]>([])

  useEffect(() => {
    void fetch('/api/intent-links/handle', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { handle: string | null; brand?: Brand | null } | null) => {
        if (d?.handle) setMyHandle(d.handle)
        setBrand(d?.brand ?? null)
      })
      .catch(() => {})
  }, [])

  const claim = useCallback(async (handle: string) => {
    const next = handle.trim()
    if (!next) return false
    setClaiming(true)
    setHandleMsg(null)
    try {
      const res = await fetch('/api/intent-links/handle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: next }),
      })
      const data = (await res.json()) as { handle?: string; error?: string; url?: string }
      if (!res.ok) {
        setHandleMsg({ text: data.error ?? 'Claim failed.', url: data.url })
        return false
      }
      setMyHandle(data.handle ?? null)
      setHandleMsg(null)
      setOgNonce((n) => n + 1)
      return true
    } finally {
      setClaiming(false)
    }
  }, [])

  // One paste → scan → save. Colors the site didn't declare get sampled from
  // the just-stored logo on canvas here (bg from the edge ring, accent from
  // the colorful interior) and PATCHed back. Everything found lands in the
  // swatch row so the background is a one-tap switch.
  const matchSite = useCallback(async (url: string) => {
    const next = url.trim()
    if (!next) return false
    setBranding(true)
    setBrandMsg(null)
    try {
      const res = await fetch('/api/intent-links/brand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: next }),
      })
      const data = (await res.json()) as {
        error?: string
        brand?: Brand | null
        palette?: string[]
        needsSample?: boolean
      }
      if (!res.ok) {
        // Includes the rule-7 refusal (403 `denied`) verbatim — it names the
        // host and the rule, which is the whole point of showing it.
        setBrandMsg(data.error ?? 'Scan failed — try again.')
        return false
      }
      let b = data.brand ?? null
      const swatches = [...(data.palette ?? [])]
      if (data.needsSample && b?.logo) {
        const sampled = await sampleBrandColors(b.logo)
        for (const c of [sampled.bg, sampled.accent]) if (c && !swatches.includes(c)) swatches.push(c)
        const patch: { bg?: string; accent?: string } = {}
        if (!b.bg && sampled.bg) patch.bg = sampled.bg
        if (!b.accent && sampled.accent) patch.accent = sampled.accent
        if (Object.keys(patch).length) {
          const pr = await fetch('/api/intent-links/brand', {
            method: 'PATCH',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(patch),
          })
          const pd = (await pr.json()) as { brand?: Brand | null }
          if (pr.ok && pd.brand) b = pd.brand
        }
      }
      setBrand(b)
      setPalette(swatches)
      setOgNonce((n) => n + 1)
      return true
    } finally {
      setBranding(false)
    }
  }, [])

  const setColors = useCallback(async (patch: { bg?: string; accent?: string }) => {
    setBrandMsg(null)
    const res = await fetch('/api/intent-links/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(patch),
    })
    const data = (await res.json()) as { brand?: Brand | null; error?: string }
    if (!res.ok) {
      setBrandMsg(data.error ?? 'That color didn’t take.')
      return false
    }
    if (data.brand) setBrand(data.brand)
    setOgNonce((n) => n + 1)
    return true
  }, [])

  const removeBrand = useCallback(async () => {
    await fetch('/api/intent-links/brand', { method: 'DELETE' })
    setBrand(null)
    setPalette([])
    setBrandMsg(null)
    setOgNonce((n) => n + 1)
  }, [])

  const clearBrandMsg = useCallback(() => setBrandMsg(null), [])

  return {
    myHandle,
    handleMsg,
    claiming,
    brand,
    branding,
    brandMsg,
    palette,
    ogNonce,
    claim,
    matchSite,
    setColors,
    removeBrand,
    clearBrandMsg,
  }
}
