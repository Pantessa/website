'use client'

// The explainer as a FACADE: the poster and a play control are plain markup;
// the YouTube player is fetched only when someone presses play. A YouTube
// iframe is ~1MB of script plus a cookie jar, and this sits two screens down
// a landing page — most visitors never start it, so the page shouldn't pay
// for it on load. When they do press, it's the privacy-enhanced player
// (youtube-nocookie) with autoplay riding the click's own user activation.
//
// Progressive: the poster is a real link to the watch page, so a page
// without JS still gets the video (on YouTube). The poster is YouTube's own,
// served through next/image — first-party bytes, right-sized, lazy.

import { useCallback, useEffect, useRef, useState } from 'react'
import Image from 'next/image'
import {
  EXPLAINER_VIDEO,
  clock,
  explainerEmbedUrl,
  explainerPosterUrl,
  explainerWatchUrl,
} from '@/lib/explainer-video'

/** Hosts the player pulls from the moment it mounts. Warmed on the first
 *  hover/focus of the poster so press-to-playing is one round-trip shorter;
 *  never on load. */
const WARM_HOSTS = ['https://www.youtube-nocookie.com', 'https://www.google.com']

export default function ExplainerVideo() {
  const [playing, setPlaying] = useState(false)
  const warmed = useRef(false)
  const player = useRef<HTMLIFrameElement>(null)

  const warm = useCallback(() => {
    if (warmed.current) return
    warmed.current = true
    for (const href of WARM_HOSTS) {
      const link = document.createElement('link')
      link.rel = 'preconnect'
      link.href = href
      document.head.appendChild(link)
    }
  }, [])

  // The play control unmounts under the keyboard user's focus; hand it to
  // the player so their next Tab starts inside it, not at the top of the page.
  useEffect(() => {
    if (playing) player.current?.focus()
  }, [playing])

  const length = clock(EXPLAINER_VIDEO.seconds)

  return (
    <figure className="spread__film film" data-video={EXPLAINER_VIDEO.id}>
      <div className="film__frame">
        {playing ? (
          <iframe
            ref={player}
            className="film__player"
            src={`${explainerEmbedUrl}?autoplay=1&rel=0&playsinline=1`}
            title={EXPLAINER_VIDEO.title}
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share"
            referrerPolicy="strict-origin-when-cross-origin"
            allowFullScreen
          />
        ) : (
          <a
            className="film__poster"
            href={explainerWatchUrl}
            onClick={(e) => {
              e.preventDefault()
              warm()
              setPlaying(true)
            }}
            onPointerEnter={warm}
            onFocus={warm}
            aria-label={`Play — ${EXPLAINER_VIDEO.title} (${length})`}
          >
            <Image
              src={explainerPosterUrl}
              alt=""
              fill
              sizes="(max-width: 1023px) 100vw, 980px"
              className="film__img"
            />
            <span className="film__scrim" aria-hidden />
            <span className="film__meta" aria-hidden>
              <span className="film__kicker mono">{`EXPLAINER · ${length}`}</span>
              <span className="film__title">{EXPLAINER_VIDEO.title}</span>
            </span>
            <span className="film__play" aria-hidden>
              <svg viewBox="0 0 24 24" width="26" height="26">
                <path d="M8 5.5v13l11-6.5z" fill="currentColor" />
              </svg>
            </span>
          </a>
        )}
      </div>
      <figcaption className="film__cap mono">
        <span>{EXPLAINER_VIDEO.blurb}</span>
        <a href={explainerWatchUrl} target="_blank" rel="noopener noreferrer">
          Watch on YouTube ↗
        </a>
      </figcaption>
    </figure>
  )
}
