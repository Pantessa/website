'use client'

// The mint stage — writing the link IS the form. Instead of labeled inputs,
// the creator types their sentence straight into a live replica of the share
// card their link will wear in a feed (same dark palette, serif ask, promise
// line, and contract pills as app/i/[slug]/opengraph-image.tsx), and the
// dapps the ask needs light up on the card as they write — composeMcps runs
// live, so the "decide for me" moment happens continuously and shows its
// work. The partner-promo limits (return URL / expiry / sign cap /
// allowlist) fold behind one "Fine print" disclosure; they're the form-iest
// part and most creators never need them.
//
// Contracts preserved from the extracted form (#599): same props, same
// POST /api/intent-links body, same query-prefill (?ask= + ?mcps=) read, so
// the dashboard page, the rail's MintLinkModal, and every chat handoff
// compose it unchanged. New, opt-in: `guestDoor` lets a PUBLIC surface
// (/links) render the stage signed-out — the mint press becomes the unified
// sign-in door (rule 6: CreateAccountButton / connectAndSignIn, never raw
// RainbowKit) with redirectTo carrying the typed ask + picks back into
// the links studio, where the query prefill re-lights everything.

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { Check, ChevronDown, Copy, FlaskConical, Plus, Settings2 } from 'lucide-react'
import { STARTER_ASKS, useTypedAsk } from '@/components/typed-asks'
import { MINTABLE_MCPS, composeMcps } from '@/lib/intent-links'
import { getProtocolMark } from '@/components/protocol-marks'
import { PantessaMark } from '@/components/Logo'
import { useSession } from '@/lib/session'
import { cdpEnabled } from '@/lib/cdp-embedded'
import CreateAccountButton from '@/components/CreateAccountButton'
import { absoluteUrl } from '@/lib/site-url'
import { LINKS_STUDIO_HREF, linksStudioHref } from '@/lib/links-href'

/** The vendored brand glyph for a mintable MCP, sized for a card pill.
 *  Marks render in `currentColor`, so they inherit the pill's ink. */
function McpMark({ slug, label, size = 13 }: { slug: string; label: string; size?: number }) {
  const Mark = getProtocolMark(slug, label)
  if (!Mark) return null
  return (
    <span className="inline-flex items-center justify-center flex-shrink-0" style={{ width: size, height: size }}>
      <Mark size={size} />
    </span>
  )
}

/** Keep only mintable slugs, capped at the picker's 4 — same rule the
 *  query-prefill path applies. */
function sanitizePicks(slugs: string[]): string[] {
  const known = new Set(MINTABLE_MCPS.map((x) => x.slug))
  return slugs.map((s) => s.trim()).filter((s) => known.has(s)).slice(0, 4)
}

interface Minted {
  slug: string
  url: string
  ask: string
  /** U3 — set when the link was ADDRESSED: it's already in this wallet's inbox. */
  recipient?: string
}

export function MintLinkForm({
  readQueryPrefill,
  initialAsk,
  initialMcps,
  externalError,
  onMinted,
  guestDoor,
  className,
}: {
  /** Read the chat handoff (?ask= + ?mcps=) from the URL once on mount —
   *  the dashboard page's contract with ~10 prefill call sites. */
  readQueryPrefill?: boolean
  /** Direct prefill for non-URL surfaces (the rail's mint modal). */
  initialAsk?: string
  initialMcps?: string[]
  /** A load-level error (the 401 sign-in line) shown in the mint card's
   *  error slot when the form itself hasn't errored. */
  externalError?: string | null
  /** Fires after a successful mint with the new link — surfaces that want a
   *  "here's your link" moment (the rail's mint modal) read it; the
   *  dashboard just reloads its table and ignores the payload. */
  onMinted?: (link: { slug: string; url: string; ask: string }) => void
  /** Public surfaces only (/links): a settled guest's mint press opens the
   *  unified sign-in door with the typed ask carried in redirectTo instead
   *  of firing a 401 mint. Auth surfaces (dashboard, rail modal) omit it. */
  guestDoor?: boolean
  className?: string
}) {
  const [ask, setAsk] = useState(() => (initialAsk ?? '').slice(0, 400))
  const [redirectUrl, setRedirectUrl] = useState('')
  // Partner-promo limits — all optional, validated server-side at mint.
  const [expiresAt, setExpiresAt] = useState('')
  const [maxSigns, setMaxSigns] = useState('')
  const [allowText, setAllowText] = useState('')
  const [sendTo, setSendTo] = useState('')
  const [finePrintOpen, setFinePrintOpen] = useState(false)
  const [minting, setMinting] = useState(false)
  const [mintError, setMintError] = useState<string | null>(null)
  // The share moment, inline: surfaces that keep the form mounted (the
  // dashboard, /links) get the minted link right where the card was. The
  // rail modal swaps to its own takeover on onMinted, so this never shows.
  const [minted, setMinted] = useState<Minted | null>(null)
  const [copied, setCopied] = useState(false)
  // Dapp attachment. AUTO by default: the card's "runs on" row mirrors
  // composeMcps(ask) live — the same rules the mint API applies when nothing
  // is picked, so what lights up is exactly what mints. Any hand-edit flips
  // to manual (null = auto); "read the ask" returns. A prefill that arrives
  // WITH mcps (chat handoff carrying the set that produced the aha) starts
  // manual so the handed-off set is honored verbatim.
  const [manualMcps, setManualMcps] = useState<string[] | null>(() => {
    const picked = sanitizePicks(initialMcps ?? [])
    return picked.length ? picked : null
  })
  const [pickerOpen, setPickerOpen] = useState(false)
  const askRef = useRef<HTMLTextAreaElement>(null)
  const { status, connectAndSignIn } = useSession()

  // Prefill from the chat's "create intent link" handoff — read once.
  useEffect(() => {
    if (!readQueryPrefill) return
    const sp = new URLSearchParams(window.location.search)
    const a = sp.get('ask')
    if (a) setAsk(a.slice(0, 400))
    const m = sp.get('mcps')
    if (m) {
      const picked = sanitizePicks(m.split(','))
      if (picked.length) setManualMcps(picked)
    }
  }, [readQueryPrefill])

  const askReady = ask.trim().length >= 8
  // What the card wears: hand-picked set, or the live compose of the ask.
  // Under 8 chars there's no sentence to read yet — the row shows its hint.
  const picks = useMemo(
    () => manualMcps ?? (askReady ? composeMcps(ask) : []),
    [manualMcps, ask, askReady],
  )

  const ghost = useTypedAsk(ask === '' && !minted)

  // The ask grows like a sentence, not a box — height follows content.
  useEffect(() => {
    const el = askRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = `${el.scrollHeight}px`
  }, [ask, minted])

  const togglePick = (slug: string) =>
    setManualMcps((cur) => {
      const base = cur ?? picks
      return base.includes(slug) ? base.filter((s) => s !== slug) : base.length >= 4 ? base : [...base, slug]
    })

  const mint = async () => {
    if (minting || !askReady) return
    setMinting(true)
    setMintError(null)
    try {
      const res = await fetch('/api/intent-links', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
          ask: ask.trim(),
          redirectUrl: redirectUrl.trim() || undefined,
          mcps: picks.length ? picks : undefined,
          expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined,
          maxSigns: maxSigns.trim() ? Number(maxSigns) : undefined,
          allowWallets: allowText.trim()
            ? allowText
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)
            : undefined,
          recipient: sendTo.trim() || undefined,
        }),
      })
      const data = await res.json()
      if (!res.ok) {
        setMintError(data.error ?? 'Mint failed.')
        return
      }
      const link = {
        slug: String(data.slug),
        url: String(data.url),
        ask: ask.trim(),
        ...(data.recipient ? { recipient: String(data.recipient) } : {}),
      }
      setAsk('')
      setRedirectUrl('')
      setExpiresAt('')
      setMaxSigns('')
      setAllowText('')
      setSendTo('')
      setManualMcps(null)
      setPickerOpen(false)
      setFinePrintOpen(false)
      setMinted(link)
      onMinted?.(link)
    } finally {
      setMinting(false)
    }
  }

  const copyUrl = (m: Minted) => {
    void navigator.clipboard.writeText(`${window.location.origin}${m.url}`).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const error = mintError ?? externalError ?? null

  // Where a guest's sign-in lands: the links studio with everything they
  // just wrote re-lit through the existing query-prefill contract.
  // "Test it out": the ask + the EXACT dapp set the link will carry, opened
  // as a normal chat. Same ?prompt= + ?mcps= handoff the landing's examples
  // use, so the rehearsal runs the same working set a visitor's /i page
  // composes. Prefill only — a URL never fires a turn (#586) — and it opens
  // in a new tab so the stage you just composed is still here when you come
  // back to press Mint.
  const testHref = `/chat?prompt=${encodeURIComponent(ask.trim())}${picks.length ? `&mcps=${encodeURIComponent(picks.join(','))}` : ''}`
  const handoffHref = linksStudioHref({ ask, mcps: picks })

  // ── The share moment (inline) ──────────────────────────────────────────────
  if (minted) {
    return (
      <div className={className}>
        <div className="mintstage">
          <div className="mintstage__glow" aria-hidden="true" />
          <div className="mintstage__head">
            <span className="mintstage__lockup">
              <PantessaMark size={18} className="mintstage__mark" />
              pantessa
            </span>
            <span className="mintstage__eyebrow mono">
              <i className="mintstage__dot" /> LIVE · SHARE IT
            </span>
          </div>
          <p className="mintstage__ask mintstage__ask--set">&ldquo;{minted.ask}&rdquo;</p>
          <button
            type="button"
            onClick={() => copyUrl(minted)}
            title="Copy the link"
            className="mintstage__url mono"
          >
            {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
            {minted.url}
          </button>
          <p className="mintstage__promise">
            {minted.recipient
              ? `Delivered — it's already in ${minted.recipient.slice(0, 6)}…${minted.recipient.slice(-4)}'s Pantessa inbox. They tap, the path builds, only they can sign.`
              : 'Anyone who opens it connects a wallet and the path builds itself.'}
          </p>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-2">
          <a
            href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`“${minted.ask}” — tap it, connect your wallet, done.`)}&url=${encodeURIComponent(absoluteUrl(minted.url))}`}
            target="_blank"
            rel="noopener noreferrer"
            className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline"
          >
            tweet it
          </a>
          <Link
            href={LINKS_STUDIO_HREF}
            className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline"
          >
            watch the funnel
          </Link>
          <button
            type="button"
            onClick={() => {
              setMinted(null)
              setCopied(false)
            }}
            className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline"
          >
            mint another
          </button>
        </div>
      </div>
    )
  }

  // ── The stage ──────────────────────────────────────────────────────────────
  return (
    <div className={className}>
      {/* The card is deliberately dark in BOTH site themes — it's a replica
          of the share card that lands in a feed (the /i OG art), not a form
          surface, so it keeps the artifact's own palette. */}
      <div className="mintstage" onClick={() => askRef.current?.focus()}>
        <div className="mintstage__glow" aria-hidden="true" />
        <div className="mintstage__head">
          <span className="mintstage__lockup">
            <PantessaMark size={18} className="mintstage__mark" />
            pantessa
          </span>
          <span className="mintstage__eyebrow mono">
            {/* mirrors the /i OG eyebrow (Visuals r2): the model, not a
                "tap to run" hint — nothing runs without the wallet's signature */}
            <i className="mintstage__dot" /> INTENT LINK · YOUR WALLET SIGNS
          </span>
        </div>

        <div className="mintstage__askwrap">
          <span className={`mintstage__quote${ask ? ' mintstage__quote--lit' : ''}`} aria-hidden="true">
            &ldquo;
          </span>
          <span className="mintstage__askbox">
            {ask === '' && <span className="mintstage__ghost" aria-hidden="true">{ghost}<i className="mintstage__caret" /></span>}
            <textarea
              ref={askRef}
              value={ask}
              onChange={(e) => setAsk(e.target.value)}
              rows={1}
              maxLength={400}
              spellCheck={false}
              aria-label="The ask — one plain sentence, amounts included"
              className="mintstage__input"
            />
          </span>
          <span className={`mintstage__quote${ask ? ' mintstage__quote--lit' : ''}`} aria-hidden="true">
            &rdquo;
          </span>
        </div>

        <p className="mintstage__promise">Connect a wallet and the path builds itself.</p>

        {/* runs on — the dapps the sentence needs, lighting up as it's written */}
        <div className="mintstage__runson" onClick={(e) => e.stopPropagation()}>
          <span className="mono mintstage__runslabel">RUNS ON</span>
          {picks.length === 0 ? (
            <span className="mintstage__runshint">the right dapps light up as you write</span>
          ) : (
            picks.map((slug) => {
              const m = MINTABLE_MCPS.find((x) => x.slug === slug)
              if (!m) return null
              return (
                <span key={slug} className="mintstage__pill">
                  <McpMark slug={m.slug} label={m.label} />
                  {m.label}
                </span>
              )
            })
          )}
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            aria-expanded={pickerOpen}
            className="mintstage__edit mono"
            title="Choose the dapps yourself"
          >
            <Settings2 className="w-3 h-3" /> {pickerOpen ? 'done' : 'choose'}
          </button>
        </div>

        {pickerOpen && (
          <div className="mintstage__picker" onClick={(e) => e.stopPropagation()}>
            {MINTABLE_MCPS.map((m) => (
              <button
                key={m.slug}
                type="button"
                onClick={() => togglePick(m.slug)}
                aria-pressed={picks.includes(m.slug)}
                className={`mintstage__chip${picks.includes(m.slug) ? ' mintstage__chip--on' : ''}`}
              >
                <McpMark slug={m.slug} label={m.label} />
                {m.label}
              </button>
            ))}
            {manualMcps !== null && (
              <button type="button" onClick={() => setManualMcps(null)} className="mintstage__chip mintstage__chip--auto mono">
                ✦ read the ask
              </button>
            )}
            <span className="mintstage__cap mono">up to 4</span>
          </div>
        )}

        <div className="mintstage__foot">
          {['Guarded build', 'Your wallet signs', 'Receipted'].map((label) => (
            <span key={label} className="mintstage__contract mono">
              <i className="mintstage__dot" /> {label}
            </span>
          ))}
          <span className="mintstage__site mono">pantessa.com</span>
        </div>
      </div>

      {/* starters — gone the moment the creator writes their own sentence */}
      {ask.trim() === '' && (
        <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
          <span className="text-[11px] text-[color:var(--muted-2)] mr-0.5">or start from</span>
          {STARTER_ASKS.map((s) => (
            <button
              key={s}
              type="button"
              onClick={() => {
                setAsk(s)
                setManualMcps(null)
                askRef.current?.focus()
              }}
              className="px-2.5 py-1 rounded-full border border-[var(--line)] text-[12px] text-[color:var(--muted)] hover:border-[var(--accent)] hover:text-[color:var(--fg)] transition-colors"
            >
              {s}
            </button>
          ))}
        </div>
      )}

      <div className="mt-3.5 flex flex-wrap items-center gap-x-4 gap-y-2">
        {guestDoor && status === 'guest' && askReady ? (
          cdpEnabled ? (
            <CreateAccountButton
              label="Sign in & mint it"
              redirectTo={handoffHref}
              className="btn btn--solid inline-flex items-center gap-1.5 text-[13px]"
            />
          ) : (
            <button
              type="button"
              onClick={() => connectAndSignIn(handoffHref)}
              className="btn btn--solid inline-flex items-center gap-1.5 text-[13px]"
            >
              Sign in &amp; mint it
            </button>
          )
        ) : (
          <button
            type="button"
            onClick={() => void mint()}
            disabled={minting || !askReady}
            className="btn btn--solid inline-flex items-center gap-1.5 text-[13px] disabled:opacity-50"
          >
            <Plus className="w-4 h-4" /> {minting ? 'Minting…' : 'Mint this link'}
          </button>
        )}
        {/* Run it before you commit to it. Nothing mints, nothing is
            shared — it is the same ask, on the same dapps, in a chat. */}
        {askReady && (
          <a
            href={testHref}
            target="_blank"
            rel="noopener noreferrer"
            title="Open this ask in a chat (new tab) — see it run before you mint it"
            className="btn btn--ghost inline-flex items-center gap-1.5 text-[13px]"
          >
            <FlaskConical className="w-4 h-4" /> Test it out
          </a>
        )}
        <span className="text-[12px] text-[color:var(--muted-2)]">
          Half of Pantessa&apos;s 0.20% fee on every conversion is yours.
        </span>
        {error && <span className="text-[13px] text-amber-400 basis-full">{error}</span>}
      </div>

      {/* U3 — human send: address the link TO someone instead of (or as well
          as) sharing it. It lands in their /inbox with your handle/address as
          the sender; the allowlist targets them, their signature stays the
          only gate. First-class, not fine print — sending IS the product. */}
      <div className="mt-4">
        <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] block">
          Send it to someone (optional — lands in their Pantessa inbox)
        </label>
        <input
          value={sendTo}
          onChange={(e) => setSendTo(e.target.value)}
          placeholder="0x… or @handle"
          spellCheck={false}
          className="mt-1.5 w-full max-w-md rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
        />
      </div>

      {/* Fine print — the partner-promo knobs (return URL / expiry / sign
          cap / allowlist), folded: same fields, same POST body as before. */}
      <button
        type="button"
        onClick={() => setFinePrintOpen((o) => !o)}
        aria-expanded={finePrintOpen}
        className="mt-4 inline-flex items-center gap-1.5 mono text-[11px] uppercase tracking-wider text-left text-[color:var(--muted-2)] hover:text-[color:var(--fg)] transition-colors"
      >
        <ChevronDown className={`w-3.5 h-3.5 flex-shrink-0 transition-transform${finePrintOpen ? ' rotate-180' : ''}`} />
        Fine print — return URL · expiry · sign cap · allowlist
      </button>
      {finePrintOpen && (
        <div className="mt-3 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] p-4">
          <label className="mono text-[11px] uppercase tracking-wider text-[color:var(--muted-2)] block">
            Return URL after signing (optional, https — e.g. your site)
          </label>
          <input
            value={redirectUrl}
            onChange={(e) => setRedirectUrl(e.target.value)}
            placeholder="https://yoursite.com/thanks"
            className="mt-1.5 w-full rounded-lg border border-[var(--line)] bg-[var(--bg)] px-3 py-2 text-sm text-[color:var(--fg)] focus:outline-none focus:border-[var(--accent)]"
          />
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
        </div>
      )}
    </div>
  )
}
