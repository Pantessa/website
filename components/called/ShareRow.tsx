'use client'

// The record's share row (squad called-it, lane RECORD): Post on X, Copy
// link, Save image, and the device's own share sheet where the browser has
// one. The post is written on the server (lib/share-posts calledPost or
// myCalledPost) and handed in whole, so this component composes nothing: it
// only sends. The image is the record's own share card, same origin, so
// "Save image" is a plain download link (a browser that will not download
// opens it, and a long press saves it).
import { useEffect, useState } from 'react'
import { postHref, type SharePost } from '@/lib/share-posts'

export interface ShareRowProps {
  post: SharePost
  /** The record's share image (lib/called-it/card-layout calledImageHref). */
  imageHref: string
  /** What a saved image is called. */
  fileName: string
  className?: string
  /** What is being shared: the whole record, or ONE call of it (a call's own address). The journey labels say which. */
  kind?: 'record' | 'call'
}

export default function ShareRow({ post, imageHref, fileName, className, kind = 'record' }: ShareRowProps) {
  const j = kind === 'call' ? 'called_call_share' : 'called_share'
  const [copied, setCopied] = useState(false)
  // The phone's share sheet (Messages, WhatsApp, Telegram…) exists only in some browsers: known after mount.
  const [native, setNative] = useState(false)
  useEffect(() => {
    setNative(typeof navigator !== 'undefined' && typeof navigator.share === 'function')
  }, [])
  return (
    <div className={`xrc-sharerow${className ? ` ${className}` : ''}`} data-share="row" data-share-surface="called" data-share-kind={kind}>
      <a className="xrc-btn xrc-btn--lead" href={postHref(post)} target="_blank" rel="noopener noreferrer" data-journey={`${j}_x`}>
        Post on X
      </a>
      <button
        type="button"
        className="xrc-btn"
        data-journey={`${j}_copy`}
        onClick={async () => {
          try {
            await navigator.clipboard.writeText(post.url)
            setCopied(true)
            setTimeout(() => setCopied(false), 1800)
          } catch {
            /* the address bar has it */
          }
        }}
      >
        {copied ? 'Copied' : 'Copy link'}
      </button>
      <a className="xrc-btn" href={imageHref} download={fileName} data-journey={`${j}_image`}>
        Save image
      </a>
      {native && (
        <button
          type="button"
          className="xrc-btn"
          data-journey={`${j}_sheet`}
          onClick={async () => {
            try {
              await navigator.share({ title: post.title, text: post.text, url: post.url })
            } catch {
              /* dismissed */
            }
          }}
        >
          Share
        </button>
      )}
    </div>
  )
}
