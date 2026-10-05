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
// Publishing is a write, so it is its own press; "Post on X" is then a plain
// link (a window opened after an await is a blocked popup in Safari).

import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { Check, Copy, Download, ExternalLink, Share2, X } from 'lucide-react'
import CreateAccountButton from '@/components/CreateAccountButton'
import { useSession } from '@/lib/session'
import { CHART_TFS, type ChartTf } from '@/lib/charts'
import type { ChartLine, ChartState } from '@/lib/chart-state'
import { canvasToBlob, shareFileName } from '@/lib/chart-share'
import { callTweetHref, callUrl, chartTweetHref, fmtCallTime } from '@/lib/chart-calls'

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

  const nativeShare = useCallback(async () => {
    if (!file) return
    try {
      await navigator.share({ files: [file], title: `${symbol} · ${tfLabel}`, text: call ? `$${symbol} — ${call.title} ${callUrl(call.id)}` : `$${symbol} · ${tfLabel} on Pantessa` })
    } catch {
      /* dismissed */
    }
  }, [file, symbol, tfLabel, call])

  const copyLink = useCallback(async (url: string) => {
    try {
      await navigator.clipboard.writeText(url)
      setNote('Link copied.')
    } catch {
      setNote(url)
    }
  }, [])

  const publish = async () => {
    setBusy(true)
    setErr(null)
    try {
      const chartState: ChartState = { v: 1, symbol, tf, lines }
      const r = await fetch('/api/posts', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ symbol, kind: 'idea', title: title.trim(), body: '', chartState, mint: hasAction }),
      })
      const d = (await r.json()) as { error?: string; post?: { id: string; createdAt: number; title: string } }
      if (!r.ok || !d.post) throw new Error(d.error ?? `Could not publish (${r.status}).`)
      setCall({ id: d.post.id, createdAt: d.post.createdAt, title: d.post.title })
    } catch (e) {
      setErr(e instanceof Error ? e.message : 'Could not publish.')
    } finally {
      setBusy(false)
    }
  }

  const canPublish = lines.length > 0

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
          {canNativeShare && (
            <button type="button" className="mkt-share__btn" onClick={() => void nativeShare()}>
              <Share2 className="h-3.5 w-3.5" aria-hidden /> Share…
            </button>
          )}
          {!call && (
            <a className="mkt-share__btn" href={chartTweetHref(symbol, tfLabel)} target="_blank" rel="noopener noreferrer" title="Opens X with a link to this chart — paste the copied image in">
              <XMark /> Post on X
            </a>
          )}
        </div>
        {note && <p className="mkt-share__note">{note}</p>}

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
              <span className="mono mkt-share__eyebrow">Make it a call</span>
              <p className="mkt-share__lede">
                Publish these lines and the call gets a public page that stamps the time and the price, and shows the trades your wallet made on {symbol} that the chain confirms. It cannot be edited afterwards.
              </p>
              {!canPublish ? (
                <p className="mkt-share__note">Draw a level, a zone or a trend line first — a call is the lines.</p>
              ) : session.address ? (
                <form
                  className="mkt-share__form"
                  onSubmit={(e) => {
                    e.preventDefault()
                    if (!busy && title.trim().length >= 3) void publish()
                  }}
                >
                  <input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={120} placeholder={`Your call on ${symbol} — one line`} aria-label="Your call, one line" />
                  <button type="submit" className="mkt-share__btn mkt-share__btn--go" disabled={busy || title.trim().length < 3}>
                    {busy ? 'Stamping…' : 'Stamp the call'}
                  </button>
                </form>
              ) : (
                // Rule 6: the unified door, and no redirect — the chart stays put.
                <CreateAccountButton className="mkt-share__btn mkt-share__btn--go" label="Sign in to stamp a call" />
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
