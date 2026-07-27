'use client'

// Dashboard · Intent links — mint short links that carry an ask, and watch
// each link's funnel: opens → connects → built → signed → dollars moved.
// The link is the ad; the funnel is the creator's scoreboard. Funnel values
// here are per-link telemetry (client-reported) — the global money-moved
// metric stays guardrail-priced in embed_turns and is NOT fed from this.

import { useCallback, useEffect, useState } from 'react'
import { Check, Copy, Link2, Plus, Sparkles } from 'lucide-react'
import { MINTABLE_MCPS, composeMcps } from '@/lib/intent-links'
import { getProtocolMark } from '@/components/protocol-marks'

/** The vendored brand glyph for a mintable MCP, sized for a picker chip.
 *  Marks render in `currentColor`, so they inherit whatever the chip's text
 *  color is — same hue selected or not, by construction. Landscape marks
 *  (CoW, Aave) center inside the fixed box so labels stay aligned. */
function McpMark({ slug, label, size = 14 }: { slug: string; label: string; size?: number }) {
  const Mark = getProtocolMark(slug, label)
  if (!Mark) return null
  return (
    <span className="inline-flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <Mark size={size} />
    </span>
  )
}

interface LinkRow {
  slug: string
  url: string
  ask: string
  variants: string[]
  agent: string | null
  redirectUrl: string | null
  revoked: boolean
  createdAt: string
  expiresAt: string | null
  maxSigns: number | null
  allowCount: number
  /** Server-truth signed turns (embed_turns) — what the maxSigns cap counts. */
  signsCount: number
  funnel: { open: number; connect: number; built: number; signed: number; valueUsd: number }
  /** Per-phrasing funnels — present only when the link A/B tests its ask. */
  funnelVariants?: Array<{ variant: number; ask: string; open: number; connect: number; built: number; signed: number }>
  /** Server-truth signed notional attributed to this link (embed_turns). */
  signedUsd: number
  /** Creator's accrued half of the fee on fee-bearing conversions. */
  earnedUsd: number
}

interface Earnings {
  totalEarnedUsd: number
  claimedUsd: number
  claimableUsd: number
  minClaimUsd: number
}

interface Brand {
  domain: string | null
  name: string | null
  logo: string | null
  accent: string | null
  bg: string | null
}

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
 *  page then keeps its defaults. */
function sampleBrandColors(dataUri: string): Promise<{ bg: string | null; accent: string | null }> {
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

export default function DashboardLinksPage() {
  const [links, setLinks] = useState<LinkRow[] | null>(null)
  const [earnings, setEarnings] = useState<Earnings | null>(null)
  const [claimMsg, setClaimMsg] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [ask, setAsk] = useState('')
  const [redirectUrl, setRedirectUrl] = useState('')
  // Partner-promo limits — all optional, validated server-side at mint.
  const [expiresAt, setExpiresAt] = useState('')
  const [maxSigns, setMaxSigns] = useState('')
  const [allowText, setAllowText] = useState('')
  const [minting, setMinting] = useState(false)
  const [copied, setCopied] = useState<string | null>(null)
  // Dapp attachment: the picker is the one surface — chips always visible,
  // creator picks up to 4. "Decide for me" reads the ask and lights up the
  // suggested set (composeMcps — same rules the mint API falls back to when
  // nothing is picked). A chat handoff (?ask= + ?mcps=) arrives with the
  // working set that produced the aha already lit.
  const [pickedMcps, setPickedMcps] = useState<string[]>([])
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

  // Prefill from the chat's "create intent link" handoff — read once.
  useEffect(() => {
    const sp = new URLSearchParams(window.location.search)
    const a = sp.get('ask')
    if (a) setAsk(a.slice(0, 400))
    const m = sp.get('mcps')
    if (m) {
      const known = new Set(MINTABLE_MCPS.map((x) => x.slug))
      const picked = m.split(',').map((s) => s.trim()).filter((s) => known.has(s)).slice(0, 4)
      if (picked.length) setPickedMcps(picked)
    }
  }, [])

  const togglePick = (slug: string) =>
    setPickedMcps((cur) => (cur.includes(slug) ? cur.filter((s) => s !== slug) : cur.length >= 4 ? cur : [...cur, slug]))

  const load = useCallback(() => {
    void fetch('/api/intent-links', { cache: 'no-store' })
      .then(async (r) => {
        if (r.status === 401) {
          setError('Sign in with your wallet to mint and track intent links.')
          return null
        }
        return r.json()
      })
      .then((d: { links: LinkRow[]; earnings?: Earnings } | null) => {
        if (d) {
          setLinks(d.links)
          setEarnings(d.earnings ?? null)
        }
      })
      .catch(() => setError('Could not load your links — try a refresh.'))
  }, [])
  useEffect(() => {
    load()
    void fetch('/api/intent-links/handle', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: { handle: string | null; brand?: Brand | null } | null) => {
        if (d?.handle) setMyHandle(d.handle)
        setBrand(d?.brand ?? null)
      })
      .catch(() => {})
  }, [load])

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

  const mint = async () => {
    if (minting || ask.trim().length < 8) return
    setMinting(true)
    setError(null)
    try {
      const res = await fetch('/api/intent-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ask: ask.trim(),
          redirectUrl: redirectUrl.trim() || undefined,
          mcps: pickedMcps.length ? pickedMcps : undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          maxSigns: maxSigns.trim() ? Number(maxSigns) : undefined,
          allowWallets: allowText.trim()
            ? allowText
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setError(data.error ?? 'Mint failed.')
        return
      }
      setAsk('')
      setRedirectUrl('')
      setExpiresAt('')
      setMaxSigns('')
      setAllowText('')
      load()
    } finally {
      setMinting(false)
    }
  }

  const copy = (slug: string) => {
    void navigator.clipboard.writeText(`${window.location.origin}/i/${slug}`).then(() => {
      setCopied(slug)
      setTimeout(() => setCopied(null), 1500)
    })
  }

  return (
    <div className="max-w-4xl">
      <h1 className="text-xl font-semibold text-[color:var(--fg)] mb-1">Intent links</h1>
      <p className="text-sm text-[color:var(--muted)] mb-6 max-w-2xl">
        A short link that carries an ask. Whoever opens it connects a wallet and the path builds
        itself — swaps, stock buys, funding legs — with their wallet as the only signer. Share the
        link; this table is your funnel.
      </p>

      <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-4 mb-8">
        <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">
          The ask (a plain sentence, amounts included)
        </label>
        <textarea
          value={ask}
          onChange={(e) => setAsk(e.target.value)}
          placeholder='e.g. "Buy $12 of AAPL" · "DCA $25 into ETH weekly" · "Stake 0.05 ETH with Lido"'
          rows={2}
          maxLength={400}
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
        />
        <div className="mt-3 flex items-center gap-2">
          <span className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)]">Dapps</span>
          <button
            type="button"
            onClick={() => setPickedMcps(composeMcps(ask))}
            disabled={ask.trim().length < 8}
            title={ask.trim().length < 8 ? 'Type the ask first — the suggestion reads it' : 'Suggest dapps from the ask'}
            className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-[var(--line)] text-[12px] text-[color:var(--muted)] transition-colors hover:border-[var(--accent)] hover:text-[color:var(--fg)] disabled:opacity-50 disabled:hover:border-[var(--line)] disabled:hover:text-[color:var(--muted)]"
          >
            <Sparkles className="w-3.5 h-3.5" /> Decide for me
          </button>
        </div>
        <div className="mt-2 flex flex-wrap gap-1.5">
          {/* Chip content keeps ONE color whether picked or not — the mark
              renders in currentColor so logo + label always match; selection
              reads from the accent border + tint, never a text-color flip.
              (Tint via color-mix: Tailwind's `/10` on a CSS-var color
              silently paints transparent.) */}
          {MINTABLE_MCPS.map((m) => (
            <button
              key={m.slug}
              type="button"
              onClick={() => togglePick(m.slug)}
              aria-pressed={pickedMcps.includes(m.slug)}
              className={`inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full border text-[12px] text-[color:var(--fg)] transition-colors ${
                pickedMcps.includes(m.slug)
                  ? 'border-[var(--accent)] bg-[color-mix(in_srgb,var(--accent)_12%,transparent)]'
                  : 'border-[var(--line)] hover:border-[var(--line-2)] hover:bg-[color-mix(in_srgb,var(--fg)_6%,transparent)]'
              }`}
            >
              <McpMark slug={m.slug} label={m.label} />
              {m.label}
            </button>
          ))}
          <span className="text-[11px] text-[color:var(--muted-2)] self-center ml-1">up to 4</span>
        </div>
        {pickedMcps.length === 0 && (
          <p className="mt-2 text-[12px] text-[color:var(--muted-2)]">
            None picked — the link decides from the ask at mint. &ldquo;Decide for me&rdquo; previews
            that pick: NFTs pull OpenSea, swaps pull Uniswap, stock tickers pull Robinhood, and
            NEAR Intents rides along for bridging.
          </p>
        )}

        <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-3 block">
          Return URL after signing (optional, https — e.g. your site)
        </label>
        <input
          value={redirectUrl}
          onChange={(e) => setRedirectUrl(e.target.value)}
          placeholder="https://yoursite.com/thanks"
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
        />
        {/* Partner-promo limits: expiry, sign cap, wallet allowlist — the
            knobs a big-partner promo needs ("dies after 1000 signs"). */}
        <div className="mt-3 grid grid-cols-1 sm:grid-cols-2 gap-3">
          <div>
            <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] block">
              Expires (optional)
            </label>
            <input
              type="datetime-local"
              value={expiresAt}
              onChange={(e) => setExpiresAt(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
          <div>
            <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] block">
              Max signs (optional — server-truth count)
            </label>
            <input
              type="number"
              min={1}
              value={maxSigns}
              onChange={(e) => setMaxSigns(e.target.value)}
              placeholder="e.g. 1000"
              className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
            />
          </div>
        </div>
        <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] mt-3 block">
          Wallet allowlist (optional — one 0x address per line; the list never appears on the page)
        </label>
        <textarea
          value={allowText}
          onChange={(e) => setAllowText(e.target.value)}
          placeholder="0x…"
          rows={2}
          className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm mono text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
        />

        <div className="mt-3 flex items-center gap-3">
          <button
            type="button"
            onClick={() => void mint()}
            disabled={minting || ask.trim().length < 8}
            className="btn btn--solid inline-flex items-center gap-1.5 text-[13px] disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> {minting ? 'Minting…' : 'Mint link'}
          </button>
          {error && <span className="text-[13px] text-amber-400">{error}</span>}
        </div>
      </div>

      {/* The storefront, as a guided moment: name it, paste your site, share
          it. Claiming is still the privacy contract — no page exists until
          it's named — and once it exists the preview IS the real /l share
          card (the OG PNG), i.e. exactly what a feed will show. */}
      <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-4 mb-6">
        {!myHandle ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
            {/* min-w keeps the copy readable — at phone widths the claim
                controls wrap BELOW instead of crushing this column */}
            <div className="min-w-[240px] flex-1">
              <p className="text-[14px] font-medium text-white">Name your page</p>
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
                  href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`Links that move money — @${myHandle}`)}&url=${encodeURIComponent(`https://yeetful.com/l/${myHandle}`)}`}
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
                  the page keeps its "Powered by Yeetful" mark. */}
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
                  <span className="text-[11px] text-[color:var(--muted-2)]">— your page wears it, powered by Yeetful</span>
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

      {earnings && earnings.totalEarnedUsd > 0 && (
        <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-4 py-3 mb-6 flex flex-wrap items-center gap-x-6 gap-y-2">
          <span className="text-[13px] text-[color:var(--muted)]">
            Earned <span className="mono text-[color:var(--accent)]">${earnings.totalEarnedUsd.toFixed(2)}</span>
            {' · '}claimed <span className="mono">${earnings.claimedUsd.toFixed(2)}</span>
            {' · '}claimable <span className="mono text-[color:var(--fg)]">${earnings.claimableUsd.toFixed(2)}</span>
          </span>
          <button
            type="button"
            disabled={earnings.claimableUsd < earnings.minClaimUsd}
            onClick={() =>
              void fetch('/api/intent-links/claims', { method: 'POST' })
                .then((r) => r.json())
                .then((d: { error?: string; amountUsd?: number; note?: string }) => {
                  setClaimMsg(d.error ?? `Claim filed for $${d.amountUsd?.toFixed(2)} — ${d.note ?? ''}`)
                  load()
                })
            }
            className="btn btn--solid text-[12px] disabled:opacity-50"
            title={earnings.claimableUsd < earnings.minClaimUsd ? `Claims open at $${earnings.minClaimUsd}` : 'Claim as USDC on Base'}
          >
            Claim USDC
          </button>
          {claimMsg && <span className="text-[12px] text-[color:var(--muted-2)]">{claimMsg}</span>}
          <span className="text-[11px] text-[color:var(--muted-2)] w-full">
            Half of Yeetful&apos;s 0.20% fee on swaps and stock buys your links produced — sales,
            transfers, and bridges are always fee-free. Paid as USDC on Base from ${earnings.minClaimUsd}.
          </span>
        </div>
      )}

      {links && links.length > 0 && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="mono text-[10.5px] uppercase tracking-wider text-[color:var(--muted-2)] text-left">
                <th className="py-2 pr-3 font-medium">Link</th>
                <th className="py-2 pr-3 font-medium text-right">Opens</th>
                <th className="py-2 pr-3 font-medium text-right">Connects</th>
                <th className="py-2 pr-3 font-medium text-right">Built</th>
                <th className="py-2 pr-3 font-medium text-right">Signed</th>
                <th className="py-2 pr-3 font-medium text-right">$ moved</th>
                <th className="py-2 pr-3 font-medium text-right">Earned</th>
                <th className="py-2 font-medium text-right"></th>
              </tr>
            </thead>
            <tbody>
              {links.map((l) => (
                <tr key={l.slug} className="border-t border-[var(--line)]">
                  <td className="py-2.5 pr-3 min-w-0">
                    <div className="flex items-center gap-2">
                      <button
                        type="button"
                        onClick={() => copy(l.slug)}
                        title="Copy the link"
                        className="inline-flex items-center gap-1.5 mono text-[12px] text-[color:var(--accent)] hover:underline flex-shrink-0"
                      >
                        {copied === l.slug ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                        /i/{l.slug}
                      </button>
                      <span className="text-[13px] text-[color:var(--muted)] truncate">{l.ask}</span>
                      {l.redirectUrl && (
                        <span title={`Returns to ${l.redirectUrl}`} className="flex-shrink-0">
                          <Link2 className="w-3 h-3 text-[color:var(--muted-2)]" />
                        </span>
                      )}
                    </div>
                    {(l.expiresAt || l.maxSigns !== null || l.allowCount > 0) && (
                      <div className="mt-0.5 mono text-[11px] text-[color:var(--muted-2)]">
                        {[
                          l.expiresAt ? `expires ${new Date(l.expiresAt).toISOString().slice(0, 10)}` : null,
                          l.maxSigns !== null ? `${l.signsCount}/${l.maxSigns} signs` : null,
                          l.allowCount > 0 ? `${l.allowCount} wallets` : null,
                        ]
                          .filter(Boolean)
                          .join(' · ')}
                      </div>
                    )}
                    {/* A/B: the per-phrasing funnel — which wording converts. */}
                    {l.funnelVariants && (
                      <div className="mt-1 space-y-0.5">
                        {l.funnelVariants.map((v) => (
                          <div key={v.variant} className="mono text-[11px] text-[color:var(--muted-2)] truncate">
                            {String.fromCharCode(65 + v.variant)} · &ldquo;{v.ask}&rdquo; — {v.open} open · {v.connect} connect
                            · {v.built} built ·{' '}
                            <span className={v.signed > 0 ? 'text-[color:var(--accent)]' : undefined}>{v.signed} signed</span>
                          </div>
                        ))}
                      </div>
                    )}
                  </td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.open}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.connect}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.built}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">{l.funnel.signed}</td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px]">
                    {l.signedUsd > 0 ? `$${l.signedUsd.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 pr-3 text-right mono text-[13px] text-[color:var(--accent)]">
                    {l.earnedUsd > 0 ? `$${l.earnedUsd.toFixed(2)}` : '—'}
                  </td>
                  <td className="py-2.5 text-right whitespace-nowrap">
                    {/* never offer sharing a revoked link — it 404s */}
                    {!l.revoked && (
                      <a
                        href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`“${l.ask}” — tap it, connect your wallet, done.`)}&url=${encodeURIComponent(`https://yeetful.com/i/${l.slug}`)}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        title="Tweet this link — the card wears your brand"
                        className="text-[11px] mono text-[color:var(--muted-2)] hover:text-[color:var(--accent)] transition-colors mr-3"
                      >
                        tweet
                      </a>
                    )}
                    <button
                      type="button"
                      title="Revoke — the link stops working; its history and earnings stay"
                      onClick={() => {
                        if (!window.confirm(`Revoke /i/${l.slug}? Anyone holding the link gets a 404. Earnings history stays.`)) return
                        void fetch(`/api/intent-links/${l.slug}`, { method: 'DELETE' }).then(load)
                      }}
                      className="text-[11px] mono text-[color:var(--muted-2)] hover:text-red-400 transition-colors"
                    >
                      revoke
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {links && links.length === 0 && !error && (
        <p className="text-[13px] text-[color:var(--muted-2)]">
          No links yet — mint the first one above. The ask you'd paste in chat is exactly the ask
          that belongs here.
        </p>
      )}
    </div>
  )
}
