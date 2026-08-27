'use client'

// The storefront, as a guided moment: name it, paste your site, share it.
// Claiming is still the privacy contract — no page exists until it's named —
// and once it exists the preview IS the real /l share card (the OG PNG),
// i.e. exactly what a feed will show. Extracted from /dashboard/links so the
// same guided moment can open from other surfaces.
//
// The state lives in useCreatorPage (lib/creator-page) — shared verbatim with
// the full studio at /dashboard/customize, which this panel links out to for
// the colors. Two surfaces, one set of calls and refusals.

import { useState } from 'react'
import Link from 'next/link'
import { useCreatorPage } from '@/lib/creator-page'
import { absoluteUrl } from '@/lib/site-url'

export function CreatorPagePanel({
  className,
  /** Set on the studio's own surface, where a link back to it is noise. */
  hideStudioLink,
}: {
  className?: string
  hideStudioLink?: boolean
}) {
  const page = useCreatorPage()
  const { myHandle, handleMsg, claiming, brand, branding, brandMsg, palette, ogNonce } = page
  // Local input drafts — the hook owns the server state, these own the fields.
  const [handleInput, setHandleInput] = useState('')
  const [brandUrl, setBrandUrl] = useState('')

  const claimHandle = async () => {
    if (await page.claim(handleInput)) setHandleInput('')
  }

  const matchSite = async () => {
    if (await page.matchSite(brandUrl)) setBrandUrl('')
  }

  const setBg = (bg: string) => page.setColors({ bg })

  const removeBrand = () => page.removeBrand()

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
              {!hideStudioLink && (
                // The colors (and everything else) have their own section now
                // — this row is the compact surface, that one is the studio.
                <Link
                  href="/dashboard/customize"
                  className="mono text-[12px] text-[color:var(--muted)] underline hover:text-[color:var(--fg)]"
                >
                  customize
                </Link>
              )}
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
