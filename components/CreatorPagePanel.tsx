'use client'

// The storefront, as a guided moment: name it, paste your site, share it.
// Claiming is still the privacy contract — no page exists until it's named —
// and once it exists the preview IS the real /l share card (the OG PNG),
// i.e. exactly what a feed will show. Extracted from /dashboard/links so the
// same guided moment can open from other surfaces.

import { useEffect, useState } from 'react'
import type { Brand } from '@/lib/intent-links-ui'
import { sampleBrandColors } from '@/lib/brand-sample'
import { absoluteUrl } from '@/lib/site-url'

export function CreatorPagePanel({ className }: { className?: string }) {
  // The public page name (/l/<handle>) — opt-in storefront for these links.
  const [myHandle, setMyHandle] = useState<string | null>(null)
  const [handleInput, setHandleInput] = useState('')
  // A claim refusal, with the taken page's URL when the API knows it — the
  // "@x is taken" case where x is YOUR page under another wallet needs the
  // link, or the page is unfindable.
  const [handleMsg, setHandleMsg] = useState<{ text: string; url?: string } | null>(null)
  const [claiming, setClaiming] = useState(false)
  // White-label brand for the /l page — one pasted URL, no form.
  const [brand, setBrand] = useState<Brand | null>(null)
  const [brandUrl, setBrandUrl] = useState('')
  const [branding, setBranding] = useState(false)
  const [brandMsg, setBrandMsg] = useState<string | null>(null)
  // Cache-buster for the live share-card preview (the real /l OG PNG) —
  // bumped on every claim/brand mutation so the card repaints in place.
  const [ogNonce, setOgNonce] = useState(0)
  // Every brand color the scan surfaced (declared + logo-sampled) — the
  // one-tap background swatches shown right after a scan.
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

  const claimHandle = async () => {
    if (claiming || !handleInput.trim()) return
    setClaiming(true)
    setHandleMsg(null)
    try {
      const res = await fetch('/api/intent-links/handle', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ handle: handleInput.trim() }),
      })
      const data = (await res.json()) as { handle?: string; error?: string; url?: string }
      if (!res.ok) {
        setHandleMsg({ text: data.error ?? 'Claim failed.', url: data.url })
        return
      }
      setMyHandle(data.handle ?? null)
      setHandleInput('')
      setHandleMsg(null)
      setOgNonce((n) => n + 1)
    } finally {
      setClaiming(false)
    }
  }

  // One paste → scan → save. Colors the site didn't declare get sampled
  // from the just-stored logo on canvas here (bg from the edge ring,
  // accent from the colorful interior) and PATCHed back. Everything found
  // lands in the swatch row so the background is a one-tap switch.
  const matchSite = async () => {
    if (branding || !brandUrl.trim()) return
    setBranding(true)
    setBrandMsg(null)
    try {
      const res = await fetch('/api/intent-links/brand', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ url: brandUrl.trim() }),
      })
      const data = (await res.json()) as { error?: string; brand?: Brand | null; palette?: string[]; needsSample?: boolean }
      if (!res.ok) {
        setBrandMsg(data.error ?? 'Scan failed — try again.')
        return
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
      setBrandUrl('')
      setOgNonce((n) => n + 1)
    } finally {
      setBranding(false)
    }
  }

  const setBg = async (bg: string) => {
    const res = await fetch('/api/intent-links/brand', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ bg }),
    })
    const data = (await res.json()) as { brand?: Brand | null }
    if (res.ok && data.brand) setBrand(data.brand)
    setOgNonce((n) => n + 1)
  }

  const removeBrand = async () => {
    await fetch('/api/intent-links/brand', { method: 'DELETE' })
    setBrand(null)
    setPalette([])
    setBrandMsg(null)
    setOgNonce((n) => n + 1)
  }

  return (
    <div className={`rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-4${className ? ` ${className}` : ''}`}>
      {!myHandle ? (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          {/* min-w keeps the copy readable — at phone widths the claim
              controls wrap BELOW instead of crushing this column */}
          <div className="min-w-[240px] flex-1">
            {/* var(--fg), not text-white — this panel renders on the themed
                dashboard AND in the rail modal; white vanishes in light mode. */}
            <p className="text-[14px] font-medium text-[color:var(--fg)]">Name your page</p>
            <p className="text-[12px] text-[color:var(--muted-2)] mt-0.5">
              One name — <span className="mono">/l/your-name</span> — and every link you mint
              lives on one shareable page. Then paste your site and the page wears your brand.
            </p>
          </div>
          <span className="inline-flex items-center gap-2">
            <input
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value)}
              placeholder="your-name"
              maxLength={20}
              className="w-36 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
            />
            <button
              type="button"
              onClick={() => void claimHandle()}
              disabled={claiming || !handleInput.trim()}
              className="btn btn--solid text-[12px] disabled:opacity-50"
            >
              {claiming ? 'Claiming…' : 'Claim'}
            </button>
          </span>
          {handleMsg && (
            <span className="text-[12px] text-amber-400 w-full">
              {handleMsg.text}
              {handleMsg.url && (
                <>
                  {' '}
                  <a href={handleMsg.url} className="mono underline hover:text-[color:var(--accent)]">
                    {handleMsg.url}
                  </a>
                </>
              )}
            </span>
          )}
        </div>
      ) : (
        <div className="flex flex-col md:flex-row gap-4">
          {/* The live share card — the real OG route, re-rendered on every
              claim/brand change. Tapping it opens the page itself. */}
          <a href={`/l/${myHandle}`} className="block w-full md:w-[280px] flex-shrink-0" title="Open your page">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={`/l/${myHandle}/opengraph-image?v=${ogNonce}`}
              alt={`The /l/${myHandle} share card`}
              className="w-full rounded-lg border border-[var(--line)]"
            />
          </a>
          <div className="min-w-0 flex-1 flex flex-col gap-2.5">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
              <a href={`/l/${myHandle}`} className="mono text-[13px] text-[color:var(--accent)] hover:underline">
                /l/{myHandle}
              </a>
              <a
                href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Links that move money — @${myHandle}`)}&url=${encodeURIComponent(absoluteUrl(`/l/${myHandle}`))}`}
                target="_blank"
                rel="noopener noreferrer"
                className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline"
              >
                tweet it
              </a>
              <span className="inline-flex items-center gap-2 ml-auto">
                <input
                  value={handleInput}
                  onChange={(e) => setHandleInput(e.target.value)}
                  placeholder="rename…"
                  maxLength={20}
                  className="w-28 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1 text-[12px] text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => void claimHandle()}
                  disabled={claiming || !handleInput.trim()}
                  className="text-[11px] mono text-[color:var(--muted-2)] hover:text-[color:var(--fg)] disabled:opacity-40 transition-colors"
                >
                  {claiming ? 'renaming…' : 'rename'}
                </button>
              </span>
            </div>
            {handleMsg && (
              <span className="text-[12px] text-amber-400">
                {handleMsg.text}
                {handleMsg.url && (
                  <>
                    {' '}
                    <a href={handleMsg.url} className="mono underline hover:text-[color:var(--accent)]">
                      {handleMsg.url}
                    </a>
                  </>
                )}
              </span>
            )}
            {/* White-label: paste the site, the page wears its logo + colors.
                No pickers, no uploads — the scan does the whole thing, and
                the page keeps its "Powered by Pantessa" mark. */}
            {brand ? (
              <span className="inline-flex flex-wrap items-center gap-2">
                {brand.logo && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={brand.logo} alt="" className="w-5 h-5 rounded object-contain" />
                )}
                <span className="mono text-[12px] text-[color:var(--muted)]">{brand.name ?? brand.domain}</span>
                {brand.bg && (
                  <span
                    className="w-3 h-3 rounded border border-[var(--line)] inline-block"
                    style={{ background: brand.bg }}
                    title={`background ${brand.bg}`}
                  />
                )}
                {brand.accent && (
                  <span
                    className="w-3 h-3 rounded-full border border-[var(--line)] inline-block"
                    style={{ background: brand.accent }}
                    title={`accent ${brand.accent}`}
                  />
                )}
                <span className="text-[11px] text-[color:var(--muted-2)]">— your page wears it, powered by Pantessa</span>
                <button
                  type="button"
                  onClick={() => void removeBrand()}
                  className="text-[11px] mono text-[color:var(--muted-2)] hover:text-red-400 transition-colors"
                >
                  remove
                </button>
              </span>
            ) : (
              <span className="inline-flex flex-wrap items-center gap-2">
                <input
                  value={brandUrl}
                  onChange={(e) => setBrandUrl(e.target.value)}
                  placeholder="https://yoursite.com"
                  className="w-56 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
                />
                <button
                  type="button"
                  onClick={() => void matchSite()}
                  disabled={branding || !brandUrl.trim()}
                  className="btn btn--solid text-[12px] disabled:opacity-50"
                >
                  {branding ? 'Scanning…' : 'Match my site'}
                </button>
                <span className="text-[11px] text-[color:var(--muted-2)]">
                  paste your site — we grab the logo and colors, no form
                </span>
              </span>
            )}
            {brand && palette.length > 0 && (
              <span className="inline-flex items-center gap-1.5 flex-wrap">
                <span className="text-[11px] text-[color:var(--muted-2)]">background:</span>
                {palette.map((c) => (
                  <button
                    key={c}
                    type="button"
                    onClick={() => void setBg(c)}
                    title={`Use ${c} as the page background`}
                    aria-pressed={brand.bg === c}
                    className={`w-5 h-5 rounded border-2 transition-colors ${brand.bg === c ? 'border-[var(--accent)]' : 'border-[var(--line)] hover:border-[var(--line-2)]'}`}
                    style={{ background: c }}
                  />
                ))}
                <span className="text-[11px] text-[color:var(--muted-2)]">— every color the scan found; tap to switch</span>
              </span>
            )}
            {brandMsg && <span className="text-[12px] text-amber-400">{brandMsg}</span>}
            <p className="text-[11px] text-[color:var(--muted-2)] mt-auto">
              {brand
                ? 'This card is exactly what a share shows — wearing your brand.'
                : 'This card is exactly what a share shows — brand it and it wears your logo and colors.'}
            </p>
          </div>
        </div>
      )}
    </div>
  )
}
