'use client'

// "Mint a link" from inside the app — the same MintLinkForm the dashboard
// composes, in a modal the chat rail can open. After a successful mint the
// modal becomes the share moment: the /i URL with copy + tweet, and the door
// to the full funnel — which is the LINKS main screen one flip away, not a
// page on the dashboard. Rendered through a portal — the rail animates
// width with overflow hidden, which would clip a fixed child.

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Check, Copy, Link2, X } from 'lucide-react'
import { MintLinkForm } from '@/components/MintLinkForm'
import { useYeetfulStore } from '@/lib/store'
import { absoluteUrl } from '@/lib/site-url'

interface Minted {
  slug: string
  url: string
  ask: string
}

export default function MintLinkModal({
  open,
  onClose,
  onMinted,
  initialAsk,
  initialMcps,
}: {
  open: boolean
  onClose: () => void
  /** Lets the opener (the rail tab) refresh its list behind the modal. */
  onMinted?: () => void
  initialAsk?: string
  initialMcps?: string[]
}) {
  const [minted, setMinted] = useState<Minted | null>(null)
  const [copied, setCopied] = useState(false)
  const { setMainView, setRailTab } = useYeetfulStore()

  const close = () => {
    setMinted(null)
    setCopied(false)
    onClose()
  }

  const copyUrl = (m: Minted) => {
    void navigator.clipboard.writeText(`${window.location.origin}${m.url}`).then(() => {
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    })
  }

  const body = useMemo(() => {
    if (typeof document === 'undefined') return null
    return document.body
  }, [])
  if (!body) return null

  return createPortal(
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          className="fixed inset-0 z-[70] flex items-start justify-center overflow-y-auto bg-black/60 backdrop-blur-sm p-4 pt-[8vh]"
          onClick={close}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-label="Mint an intent link"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[560px] rounded-2xl border border-[var(--line-2)] bg-[var(--bg)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
          >
            {/* Header */}
            <div className="flex items-center gap-2.5 px-5 pt-4 pb-3.5 border-b border-[var(--line)]">
              <span className="w-7 h-7 grid place-items-center rounded-lg bg-black/40 border border-[var(--line)] text-[color:var(--accent)]">
                <Link2 className="w-4 h-4" strokeWidth={2.5} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[color:var(--fg)]">Mint an intent link</div>
                <div className="mono text-[10px] text-[color:var(--muted-2)]">one sentence · anyone who opens it can act on it</div>
              </div>
              <button
                onClick={close}
                aria-label="Close"
                className="w-7 h-7 grid place-items-center rounded-lg text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
              {minted ? (
                // The share moment — the link exists; make sharing it one tap.
                <div className="space-y-3">
                  <p className="text-[13px] text-[color:var(--muted)]">
                    Minted. Anyone who opens it connects a wallet and the path builds itself:
                  </p>
                  <div className="rounded-xl border border-[var(--line)] bg-[var(--surf-1)] px-3.5 py-3">
                    <button
                      type="button"
                      onClick={() => copyUrl(minted)}
                      title="Copy the link"
                      className="inline-flex items-center gap-1.5 mono text-[13px] text-[color:var(--accent)] hover:underline"
                    >
                      {copied ? <Check className="w-3.5 h-3.5" /> : <Copy className="w-3.5 h-3.5" />}
                      {minted.url}
                    </button>
                    <p className="mt-1 text-[12px] text-[color:var(--muted)] truncate">&ldquo;{minted.ask}&rdquo;</p>
                  </div>
                  <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
                    <a
                      href={`https://twitter.com/intent/tweet?text=${encodeURIComponent(`“${minted.ask}” — tap it, connect your wallet, done.`)}&url=${encodeURIComponent(absoluteUrl(minted.url))}`}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline"
                    >
                      tweet it
                    </a>
                    <button
                      type="button"
                      onClick={() => {
                        // The board is AND-ed with the rail tab (linksMode),
                        // so both have to move — opened from a chat bubble
                        // the rail sits on MCPs, and mainView alone left this
                        // button doing nothing.
                        setRailTab('links')
                        setMainView('links')
                        close()
                      }}
                      className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline"
                    >
                      watch the funnel
                    </button>
                    <button
                      type="button"
                      onClick={() => setMinted(null)}
                      className="mono text-[12px] text-[color:var(--muted)] hover:text-[color:var(--fg)] underline"
                    >
                      mint another
                    </button>
                  </div>
                </div>
              ) : (
                <MintLinkForm
                  initialAsk={initialAsk}
                  initialMcps={initialMcps}
                  onMinted={(link) => {
                    setMinted(link)
                    onMinted?.()
                  }}
                />
              )}
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    body,
  )
}
