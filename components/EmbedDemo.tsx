'use client'

// The docs-landing embed demo — a mock host site where the chat bubble pops
// open into the embedded panel on a CSS keyframe loop (bubble pulse → panel
// springs up → ask → reply with a $0 receipt → close, repeat). "Try it live"
// swaps the mock panel for the REAL /embed iframe, same trick the homepage
// hero uses. Pure CSS animation (no rAF/framer) so it keeps moving in
// screenshots and degrades to the open, static panel under
// prefers-reduced-motion. Styles live in x402-design.css under `.edemo`.

import { useEffect, useRef, useState } from 'react'
import { MessageCircle, Play } from 'lucide-react'
import { cn } from '@/lib/utils'
import { DEFAULT_EMBED_MCPS } from '@/lib/embed-snippets'

const EMBED_SRC = `/embed?mcps=${DEFAULT_EMBED_MCPS.join(',')}&theme=dark`

export default function EmbedDemo() {
  const [live, setLive] = useState(false)
  // Hold the CSS loop paused until the demo scrolls into view — the animation
  // starts from its bubble-closed first frame the moment the user reaches it,
  // instead of already mid-cycle on page load.
  const [seen, setSeen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const el = rootRef.current
    if (!el || seen) return
    if (typeof IntersectionObserver === 'undefined') { setSeen(true); return }
    const io = new IntersectionObserver(
      (entries) => {
        if (entries.some((e) => e.isIntersecting)) {
          setSeen(true)
          io.disconnect()
        }
      },
      { threshold: 0.35 },
    )
    io.observe(el)
    return () => io.disconnect()
  }, [seen])

  return (
    <div ref={rootRef} className={cn('edemo', live && 'edemo--live', seen && 'edemo--seen')} aria-label="Embedded chat demo">
      {/* mock browser chrome */}
      <div className="edemo__bar">
        <span className="edemo__dots" aria-hidden>
          <i /><i /><i />
        </span>
        <span className="edemo__url mono">your-app.com</span>
        {!live && (
          <button className="edemo__live mono" onClick={() => setLive(true)}>
            <Play width={10} height={10} /> TRY IT LIVE
          </button>
        )}
        {live && <span className="edemo__livetag mono">LIVE — THE REAL /embed</span>}
      </div>

      {/* the host page: a skeleton dapp the chat drops onto */}
      <div className="edemo__page" aria-hidden={live ? undefined : true}>
        <div className="edemo__skel edemo__skel--head" />
        <div className="edemo__skelrow">
          <div className="edemo__skel edemo__skel--card" />
          <div className="edemo__skel edemo__skel--card" />
        </div>
        <div className="edemo__skel edemo__skel--wide" />
        <div className="edemo__skel edemo__skel--wide edemo__skel--short" />

        {/* the launcher bubble the SDK mounts */}
        <div className="edemo__bubble" aria-hidden>
          <MessageCircle width={19} height={19} />
        </div>

        {/* the panel that pops out of it */}
        <div className="edemo__panel">
          {live ? (
            <iframe
              src={EMBED_SRC}
              title="Pantessa embedded chat — live"
              className="edemo__iframe"
              allow="clipboard-write"
            />
          ) : (
            <div className="edemo__chat" aria-hidden>
              <div className="edemo__chathead">
                <span className="edemo__chatdot" />
                <span className="mono">PANTESSA · {DEFAULT_EMBED_MCPS.length} MCPS READY</span>
              </div>
              <div className="edemo__msgs">
                <div className="edemo__msg edemo__msg--user">swap 20 USDC for WETH</div>
                <div className="edemo__typing">
                  <i /><i /><i />
                </div>
                <div className="edemo__msg edemo__msg--agent">
                  <span className="edemo__line" />
                  <span className="edemo__line edemo__line--short" />
                  <span className="edemo__receipt mono">uniswap-free · $0 receipt · ready to sign</span>
                </div>
              </div>
              <div className="edemo__input">
                <span>Ask anything…</span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
