'use client'

// Share this chart — the dialog behind the chart's Share button.
//
// Two things leave from here:
//   · THE PICTURE  the chart with its drawings, a header (symbol, frame,
//     price, the UTC minute) and the Pantessa watermark (lib/chart-share).
//     Copy it, save it, or hand it to the phone's share sheet.
//   · THE CALL     for a signed-in wallet, the drawings publish as a post and
//     get a public page (/c/<id>) that stamps the time and the tape's price
//     and shows the author's verified fills. X cannot take an image from a
//     link, so the post on X carries the call's page and X draws its card.
//
// "Post on X" from a signed-in wallet IS the publish: one press posts the
// lines, then opens X on the post's own page, so the card X draws shows the
// lines and the link lands where people can reply. The tab is opened inside
// the click and pointed at X once the post exists (a window opened after an
// await is a blocked popup in Safari). The picture is put on the clipboard on
// the same press, for anyone who wants the full-size image in the post too.

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Link2, Share2, X } from 'lucide-react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'
import Link from 'next/link'
import { CHART_TFS, chartPairFor, type ChartTf } from '@/lib/charts'
import { execAsks } from '@/lib/trade-asks'
import { linksStudioHref } from '@/lib/links-href'
import type { ChartLine, ChartState } from '@/lib/chart-state'
import { canvasToBlob, shareFileName } from '@/lib/chart-share'
import { autoCallTitle, callTweetHref, callUrl, chartTweetHref, fmtCallTime } from '@/lib/chart-calls'
import { useShareVia } from '@/components/ShareActions'
import { withVia } from '@/lib/share-posts'
import { absoluteUrl } from '@/lib/site-url'

export interface ChartShareProps {
  symbol: string
  tf: ChartTf
  lines: ChartLine[]
  /** Compose the picture from the chart as it stands (null = not ready). */
  capture: () => Promise<HTMLCanvasElement | null>
  onClose: () => void
}

function XMark() {
  return (
    <svg viewBox="0 0 24 24" width="12" height="12" fill="currentColor" aria-hidden>
      <path d="M18.244 2.25h3.308l-7.227 8.26 8.502 11.24h-6.66l-5.214-6.817L4.99 21.75H1.68l7.73-8.835L1.254 2.25H8.08l4.713 6.231zm-1.161 17.52h1.833L7.084 4.126H5.117z" />
    </svg>
  )
}

export default function ChartShare({ symbol, tf, lines, capture, onClose }: ChartShareProps) {
  const session = useSession()
  const tfLabel = CHART_TFS.find((t) => t.key === tf)?.label ?? tf
  const [blob, setBlob] = useState<Blob | null>(null)
  const [preview, setPreview] = useState<string | null>(null)
  const [failed, setFailed] = useState(false)
  const [note, setNote] = useState<string | null>(null)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [call, setCall] = useState<{ id: string; createdAt: number; title: string } | null>(null)
  const shotAt = useRef(new Date())
  const hasAction = useMemo(() => lines.some((l) => (l.kind === 'h' || l.kind === 'zone') && l.action), [lines])

  // One picture per opening: the chart as it stood when Share was pressed.
  useEffect(() => {
    let alive = true
    let url: string | null = null
    void (async () => {
      try {
        const canvas = await capture()
        const b = canvas ? await canvasToBlob(canvas) : null
        if (!alive) return
        if (!b) {
          setFailed(true)
          return
        }
        url = URL.createObjectURL(b)
        setBlob(b)
        setPreview(url)
      } catch {
        if (alive) setFailed(true)
      }
    })()
    return () => {
      alive = false
      if (url) URL.revokeObjectURL(url)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const fileName = shareFileName(symbol, tfLabel, shotAt.current)
  const file = useMemo(() => (blob ? new File([blob], fileName, { type: 'image/png' }) : null), [blob, fileName])
  const canNativeShare = useMemo(() => {
    try {
      return !!file && typeof navigator !== 'undefined' && typeof navigator.canShare === 'function' && navigator.canShare({ files: [file] })
    } catch {
      return false
    }
  }, [file])

  const copyImage = useCallback(async () => {
    if (!blob) return
    try {
      await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })])
      setNote('Image copied — paste it into your post.')
    } catch {
      setNote('This browser would not copy an image — use Save instead.')
    }
  }, [blob])

  const save = useCallback(() => {
    if (!preview) return
    const a = document.createElement('a')
    a.href = preview
    a.download = fileName
    a.click()
    setNote('Saved.')
  }, [preview, fileName])

  // The plain chart's own address: the frame rides along, and the sharer's id
  // when a wallet is connected (a one-way hash, never the address).
  const via = useShareVia()
  const chartUrl = withVia(absoluteUrl(`/t/${symbol}${tf === '1d' ? '' : `?tf=${tf}`}`), via)
  // A browser with a share sheet that cannot take a file (desktop Safari,
  // Firefox on Android) still shares the link.
  const [canShareLink, setCanShareLink] = useState(false)
  useEffect(() => {
    setCanShareLink(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])

  const nativeShare = useCallback(async () => {
    const link = call ? callUrl(call.id) : chartUrl
    const words = call ? `$${symbol} — ${call.title}` : `$${symbol} · ${tfLabel} on Pantessa`
    try {
      // With a picture the link goes in the text (most targets drop `url`
      // when files are attached); without one it is the share itself.
      if (file && canNativeShare) await navigator.share({ files: [file], title: `${symbol} · ${tfLabel}`, text: `${words} ${link}` })
      else await navigator.share({ title: `${symbol} · ${tfLabel}`, text: words, url: link })
    } catch {
      /* dismissed */
    }
  }, [file, canNativeShare, symbol, tfLabel, call, chartUrl])

  const copyLink = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setNote('Link copied.')
    } catch {
      setNote(url)
    }
  }, [])

  const publish = async (as: string): Promise<{ id: string; createdAt: number; title: string } | null> => {
    setBusy(true)
    setErr(null)
    try {
      const chartState: ChartState = { v: 1, symbol, tf, lines }
      const r = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol, kind: 'idea', title: as, body: '', chartState, mint: hasAction }),
      })
      const d = (await r.json()) as { error?: string; post?: { id: string; createdAt: number; title: string } }
      if (!r.ok || !d.post) throw new Error(d.error ?? `Could not publish (${r.status}).`)
      const made = { id: d.post.id, createdAt: d.post.createdAt, title: d.post.title }
      setCall(made)
      return made
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not publish.')
      return null
    } finally {
      setBusy(false)
    }
  }

  /** One press: post the lines, then X opens on the post's own page. */
  const postOnX = async () => {
    const tab = window.open('', '_blank')
    if (blob) {
      try {
        void navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]).catch(() => {})
      } catch {
        /* no image clipboard here — the card carries the lines */
      }
    }
    const made = await publish(title.trim().length >= 3 ? title.trim() : autoCallTitle(symbol, tfLabel, lines))
    if (!made) {
      tab?.close()
      return
    }
    const href = callTweetHref({ id: made.id, symbol, title: made.title })
    if (tab) {
      tab.opener = null
      tab.location.href = href
      setNote('Posted. The picture is on your clipboard too, if you want it in the post.')
    } else {
      setNote('Posted. Your browser blocked the new tab: use "Post the call on X" below.')
    }
  }

  const canPublish = lines.length > 0
  const earnAsk = useMemo(() => {
    const pair = chartPairFor(symbol)
    return pair ? (execAsks(pair, { usd: 25 }).find((a) => a.tone === 'buy')?.ask ?? null) : null
  }, [symbol])
  const earnHref = earnAsk ? linksStudioHref({ ask: earnAsk }) : null

  return (
    <div className="mkt-share" role="dialog" aria-modal="true" aria-label={`Share the ${symbol} chart`} onPointerDown={(e) => e.target === e.currentTarget && onClose()}>
      <div className="mkt-share__card">
        <div className="mkt-share__head">
          <span className="mono mkt-share__eyebrow">
            <Share2 className="h-3 w-3" aria-hidden /> Share {symbol} · {tfLabel}
          </span>
          <button type="button" className="mkt-pop__x" aria-label="Close" onClick={onClose}>
            <X className="h-3.5 w-3.5" />
          </button>
        </div>

        <div className="mkt-share__shot">
          {preview ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={preview} alt={`${symbol} ${tfLabel} chart with your drawings and the Pantessa watermark`} />
          ) : (
            <span className="mono">{failed ? 'Could not draw the picture — the chart is still loading.' : 'Drawing the picture…'}</span>
          )}
        </div>

        <div className="mkt-share__row">
          <button type="button" className="mkt-share__btn" onClick={() => void copyImage()} disabled={!blob}>
            <Copy className="h-3.5 w-3.5" aria-hidden /> Copy image
          </button>
          <button type="button" className="mkt-share__btn" onClick={save} disabled={!preview}>
            <Download className="h-3.5 w-3.5" aria-hidden /> Save PNG
          </button>
          {(canNativeShare || canShareLink) && (
            <button type="button" className="mkt-share__btn" onClick={() => void nativeShare()}>
              <Share2 className="h-3.5 w-3.5" aria-hidden /> Share…
            </button>
          )}
          {!call &&
            (canPublish && session.address ? (
              <button type="button" className="mkt-share__btn mkt-share__btn--go" onClick={() => void postOnX()} disabled={busy} title="Posts these lines, then opens X on the post's page: the card shows your lines and people can reply there">
                <XMark /> {busy ? 'Posting…' : 'Post on X'}
              </button>
            ) : (
              <a className="mkt-share__btn" href={chartTweetHref(symbol, tfLabel, chartUrl)} target="_blank" rel="noopener noreferrer" title="Opens X with a link to this chart">
                <XMark /> Post on X
              </a>
            ))}
          {!call && (
            <button type="button" className="mkt-share__btn" onClick={() => void copyLink(chartUrl)} title="The link to this chart, on this timeframe">
              <Link2 className="h-3.5 w-3.5" aria-hidden /> Copy link
            </button>
          )}
        </div>
        {!call && canPublish && !session.address && (
          <p className="mkt-share__note">Signed out, the post on X links the plain {symbol} chart. Sign in below and it links your lines instead: the card on X shows them, and people can reply on the page.</p>
        )}
        {note && <p className="mkt-share__note">{note}</p>}
        {/* The share that pays: a plain chart link earns its sharer nothing; an
            intent link pays its creator half the fee on every trade it brings
            (first touch, for life). One tap to the mint, with this symbol's
            own lead ask ready (the header strip's grammar, never a template). */}
        {earnHref && (
          <p className="mkt-share__note" data-share-earn>
            Want to earn on it?{' '}
            <Link href={earnHref} className="underline decoration-dotted underline-offset-2">
              Make &ldquo;{earnAsk}&rdquo; a link
            </Link>
            : you get half the fee on every trade it brings.
          </p>
        )}

        {/* the call: time + price stamped, position verified */}
        <div className="mkt-share__call">
          {call ? (
            <>
              <span className="mono mkt-share__eyebrow mkt-share__eyebrow--done">
                <Check className="h-3 w-3" aria-hidden /> Call stamped · {fmtCallTime(call.createdAt)}
              </span>
              <p className="mkt-share__lede">
                It has its own page now: the time, the tape&apos;s price at that minute, and any trade your wallet made on {symbol} that the chain confirms.
              </p>
              <div className="mkt-share__row">
                <a className="mkt-share__btn mkt-share__btn--go" href={callTweetHref({ id: call.id, symbol, title: call.title })} target="_blank" rel="noopener noreferrer">
                  <XMark /> Post the call on X
                </a>
                <button type="button" className="mkt-share__btn" onClick={() => void copyLink(callUrl(call.id))}>
                  <Copy className="h-3.5 w-3.5" aria-hidden /> Copy link
                </button>
                <a className="mkt-share__btn" href={`/c/${call.id}`} target="_blank" rel="noopener noreferrer">
                  <ExternalLink className="h-3.5 w-3.5" aria-hidden /> Open the call
                </a>
              </div>
            </>
          ) : (
            <>
              <span className="mono mkt-share__eyebrow">Say what it is (optional)</span>
              <p className="mkt-share__lede">
                Posting gives these lines a public page: the time and the price are stamped, the trades your wallet made on {symbol} that the chain confirms are shown, and anyone can reply. It cannot be edited afterwards. Leave the line blank and Post on X names it from your first label.
              </p>
              {!canPublish ? (
                <p className="mkt-share__note">Draw a level, a zone or a trend line first — a call is the lines.</p>
              ) : session.address ? (
                <form
                  className="mkt-share__form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!busy && title.trim().length >= 3) void publish(title.trim())
                  }}
                >
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={`Your call on ${symbol} — one line`} aria-label="Your call, one line" />
                  <button type="submit" className="mkt-share__btn mkt-share__btn--go" disabled={busy || title.trim().length < 3}>
                    {busy ? 'Posting…' : 'Post without X'}
                  </button>
                </form>
              ) : (
                // Rule 6: the unified door, and no redirect — the chart stays put.
                <CreateAccountButton className="mkt-share__btn mkt-share__btn--go" label="Sign in to post your lines" />
              )}
              {hasAction && canPublish && session.address && <p className="mkt-share__note">The first order on your lines is minted as a link: readers can take the trade, and the creator share is yours.</p>}
              {err && <p className="mkt-share__note mkt-share__note--err">{err}</p>}
            </>
          )}
        </div>
      </div>
    </div>
  )
}
