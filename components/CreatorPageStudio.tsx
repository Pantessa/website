'use client'

// The full customize surface for /l/<handle> — one place to find every knob
// the creator page has, because the compact panel on /dashboard/links buried
// them in a single row. Three steps, in the order a creator actually cares:
// name it, color it, then (optionally) put your own logo on it.
//
// The preview is the REAL share card (the /l OG route), re-fetched on every
// mutation — what you see here is byte-identical to what a feed will show.
//
// On rule 7: colors are always yours to set (BRAND_PRESETS + free hex, no
// third party involved). The LOGO+NAME step is the one that carries someone's
// identity, so it only ever takes YOUR OWN site, and the server refuses a
// third-party financial brand by name before it fetches anything.

import { useState } from 'react'
import Link from 'next/link'
import { BRAND_PRESETS, presetFor } from '@/lib/brand-presets'
import { useCreatorPage } from '@/lib/creator-page'
import { absoluteUrl } from '@/lib/site-url'
import { BrandColorField } from '@/components/BrandColorField'

function Section({ n, title, blurb, children }: { n: number; title: string; blurb: string; children: React.ReactNode }) {
  return (
    <section className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-4">
      <div className="mb-3 flex items-baseline gap-2">
        <span className="mono text-[11px] text-[color:var(--muted-2)]">{n}</span>
        <h2 className="text-[14px] font-medium text-[color:var(--fg)]">{title}</h2>
      </div>
      <p className="mb-3 text-[12px] leading-relaxed text-[color:var(--muted-2)]">{blurb}</p>
      {children}
    </section>
  )
}

export default function CreatorPageStudio() {
  const page = useCreatorPage()
  const [handleInput, setHandleInput] = useState('')
  const [brandUrl, setBrandUrl] = useState('')

  const { myHandle, brand } = page
  const activePreset = presetFor(brand?.bg, brand?.accent)

  // Clear the field only when the name actually landed — a refusal keeps
  // what was typed so it can be edited rather than retyped.
  const claim = async () => {
    if (await page.claim(handleInput)) setHandleInput('')
  }
  const matchSite = async () => {
    if (await page.matchSite(brandUrl)) setBrandUrl('')
  }

  // Nothing to customize until the page exists — claiming is the privacy
  // contract (no page until it's named), so this is the whole surface.
  if (!myHandle) {
    return (
      <div className="max-w-xl rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-5">
        <p className="text-[14px] font-medium text-[color:var(--fg)]">Name your page first</p>
        <p className="mt-1 text-[12px] leading-relaxed text-[color:var(--muted-2)]">
          One name — <span className="mono">/l/your-name</span> — and every link you mint lives on
          one shareable page. Then this screen colors it and dresses it in your logo.
        </p>
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <input
            value={handleInput}
            onChange={(e) => setHandleInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void claim()
            }}
            placeholder="your-name"
            maxLength={20}
            className="w-40 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] text-[color:var(--fg)] focus:border-[var(--accent)] focus:outline-none"
          />
          <button
            type="button"
            onClick={() => void claim()}
            disabled={page.claiming || !handleInput.trim()}
            className="btn btn--solid text-[12px] disabled:opacity-50"
          >
            {page.claiming ? 'Claiming…' : 'Claim'}
          </button>
        </div>
        {page.handleMsg && (
          <p className="mt-2 text-[12px] text-amber-400">
            {page.handleMsg.text}
            {page.handleMsg.url && (
              <>
                {' '}
                <a href={page.handleMsg.url} className="mono underline hover:text-[color:var(--accent)]">
                  {page.handleMsg.url}
                </a>
              </>
            )}
          </p>
        )}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-5 lg:flex-row">
      {/* Preview rail — sticky on desktop so every change repaints in view. */}
      <div className="w-full flex-shrink-0 lg:sticky lg:top-4 lg:w-[340px] lg:self-start">
        <a href={`/l/${myHandle}`} className="block" title="Open your page">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img
            src={`/l/${myHandle}/opengraph-image?v=${page.ogNonce}`}
            alt={`The /l/${myHandle} share card`}
            className="w-full rounded-lg border border-[var(--line)]"
          />
        </a>
        <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1">
          <a href={`/l/${myHandle}`} className="mono text-[13px] text-[color:var(--accent)] hover:underline">
            /l/{myHandle}
          </a>
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Links that move money — @${myHandle}`)}&url=${encodeURIComponent(absoluteUrl(`/l/${myHandle}`))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-[12px] text-[color:var(--muted)] underline hover:text-[color:var(--fg)]"
          >
            tweet it
          </a>
        </div>
        <p className="mt-2 text-[11px] leading-relaxed text-[color:var(--muted-2)]">
          This is the real share card — exactly what a feed renders when someone posts your page.
          It repaints as you change things.
        </p>
      </div>

      <div className="flex min-w-0 flex-1 flex-col gap-4">
        <Section
          n={1}
          title="Page name"
          blurb="The address people share. Renaming frees the old one immediately — an old link to it stops resolving."
        >
          <div className="flex flex-wrap items-center gap-2">
            <span className="mono text-[13px] text-[color:var(--muted)]">/l/{myHandle}</span>
            <input
              value={handleInput}
              onChange={(e) => setHandleInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') void claim()
              }}
              placeholder="rename…"
              maxLength={20}
              className="ml-auto w-32 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1 text-[12px] text-[color:var(--fg)] focus:border-[var(--accent)] focus:outline-none"
            />
            <button
              type="button"
              onClick={() => void claim()}
              disabled={page.claiming || !handleInput.trim()}
              className="mono text-[11px] text-[color:var(--muted-2)] transition-colors hover:text-[color:var(--fg)] disabled:opacity-40"
            >
              {page.claiming ? 'renaming…' : 'rename'}
            </button>
          </div>
          {page.handleMsg && (
            <p className="mt-2 text-[12px] text-amber-400">
              {page.handleMsg.text}
              {page.handleMsg.url && (
                <>
                  {' '}
                  <a href={page.handleMsg.url} className="mono underline hover:text-[color:var(--accent)]">
                    {page.handleMsg.url}
                  </a>
                </>
              )}
            </p>
          )}
        </Section>

        <Section
          n={2}
          title="Colors"
          blurb="Pick a palette or dial in your own hex. The whole page re-themes — background, text, buttons, and the share card above. No site needed; these are just colors."
        >
          <div className="flex flex-wrap gap-2">
            {BRAND_PRESETS.map((p) => (
              <button
                key={p.id}
                type="button"
                onClick={() => void page.setColors({ bg: p.bg, accent: p.accent })}
                aria-pressed={activePreset?.id === p.id}
                title={`${p.label} — background ${p.bg}, accent ${p.accent}`}
                className={`flex items-center gap-2 rounded-lg border-2 px-2.5 py-1.5 transition-colors ${
                  activePreset?.id === p.id
                    ? 'border-[var(--accent)]'
                    : 'border-[var(--line)] hover:border-[var(--line-2)]'
                }`}
                style={{ background: p.bg }}
              >
                <span
                  className="inline-block h-3 w-3 flex-shrink-0 rounded-full"
                  style={{ background: p.accent }}
                />
                <span className="mono text-[11px]" style={{ color: p.accent }}>
                  {p.label}
                </span>
              </button>
            ))}
          </div>

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-3">
            <BrandColorField
              role="bg"
              label="Background"
              hint="Any hex. The page derives its text color from it."
              value={brand?.bg ?? null}
              onApply={(hex) => page.setColors({ bg: hex })}
            />
            <BrandColorField
              role="accent"
              label="Accent"
              hint="Links, buttons, and the dollar figures."
              value={brand?.accent ?? null}
              onApply={(hex) => page.setColors({ accent: hex })}
            />
          </div>

          {page.palette.length > 0 && (
            <div className="mt-4 flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] text-[color:var(--muted-2)]">from your site:</span>
              {page.palette.map((c) => (
                <button
                  key={c}
                  type="button"
                  onClick={() => void page.setColors({ bg: c })}
                  title={`Use ${c} as the page background`}
                  aria-pressed={brand?.bg === c}
                  className={`h-5 w-5 rounded border-2 transition-colors ${
                    brand?.bg === c ? 'border-[var(--accent)]' : 'border-[var(--line)] hover:border-[var(--line-2)]'
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          )}
        </Section>

        <Section
          n={3}
          title="Logo and name"
          blurb="Paste your own site and we read its logo, name and colors — no upload, no form. This is the step that puts an identity on the page, so it has to be an identity you own."
        >
          {brand?.logo || brand?.name || brand?.domain ? (
            <div className="flex flex-wrap items-center gap-2">
              {brand.logo && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={brand.logo} alt="" className="h-6 w-6 rounded object-contain" />
              )}
              <span className="mono text-[12px] text-[color:var(--muted)]">{brand.name ?? brand.domain}</span>
              <span className="text-[11px] text-[color:var(--muted-2)]">
                — your page wears it, powered by Pantessa
              </span>
              <button
                type="button"
                onClick={() => void page.removeBrand()}
                className="mono text-[11px] text-[color:var(--muted-2)] transition-colors hover:text-red-400"
              >
                remove
              </button>
            </div>
          ) : (
            <div className="flex flex-wrap items-center gap-2">
              <input
                value={brandUrl}
                onChange={(e) => setBrandUrl(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void matchSite()
                }}
                placeholder="https://yoursite.com"
                className="w-56 rounded-lg border border-[var(--line)] bg-[var(--bg)] px-2.5 py-1.5 text-[13px] text-[color:var(--fg)] focus:border-[var(--accent)] focus:outline-none"
              />
              <button
                type="button"
                onClick={() => void matchSite()}
                disabled={page.branding || !brandUrl.trim()}
                className="btn btn--solid text-[12px] disabled:opacity-50"
              >
                {page.branding ? 'Scanning…' : 'Match my site'}
              </button>
            </div>
          )}
          {page.brandMsg && <p className="mt-2 text-[12px] text-amber-400">{page.brandMsg}</p>}
          <p className="mt-3 text-[11px] leading-relaxed text-[color:var(--muted-2)]">
            Someone else&rsquo;s wallet, exchange or DEX brand is refused here by name. A
            financial brand&rsquo;s logo on a domain that isn&rsquo;t theirs is what a wallet
            drainer looks like, and it is what gets pages blocklisted. The colors above are
            never restricted.
          </p>
        </Section>

        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <button
            type="button"
            onClick={() => void page.removeBrand()}
            className="mono text-[11px] text-[color:var(--muted-2)] transition-colors hover:text-red-400"
          >
            reset to the house look
          </button>
          <Link
            href="/dashboard/links"
            className="text-[12px] text-[color:var(--muted)] underline decoration-dotted underline-offset-2 hover:text-[color:var(--fg)]"
          >
            Mint a link →
          </Link>
        </div>
      </div>
    </div>
  )
}
