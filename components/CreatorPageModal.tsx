'use client'

// "Name your page" from inside the app — the same CreatorPagePanel the
// dashboard composes (claim/rename + brand scan + swatches + the live OG
// share-card preview), in a modal the chat rail can open. The white-label
// build stops being a dashboard-only detour. Portaled — the rail animates
// width with overflow hidden, which would clip a fixed child.

import { useMemo } from 'react'
import { createPortal } from 'react-dom'
import { motion, AnimatePresence } from 'framer-motion'
import { Sparkles, X } from 'lucide-react'
import { CreatorPagePanel } from '@/components/CreatorPagePanel'

export default function CreatorPageModal({ open, onClose }: { open: boolean; onClose: () => void }) {
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
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, y: 14, scale: 0.98 }}
            animate={{ opacity: 1, y: 0, scale: 1 }}
            exit={{ opacity: 0, y: 8, scale: 0.98 }}
            transition={{ duration: 0.2, ease: 'easeOut' }}
            role="dialog"
            aria-label="Your creator page"
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-[640px] rounded-2xl border border-[var(--line-2)] bg-[var(--bg)] shadow-[0_24px_64px_rgba(0,0,0,0.35)]"
          >
            <div className="flex items-center gap-2.5 px-5 pt-4 pb-3.5 border-b border-[var(--line)]">
              <span className="w-7 h-7 grid place-items-center rounded-lg bg-black/40 border border-[var(--line)] text-[color:var(--accent)]">
                <Sparkles className="w-4 h-4" strokeWidth={2.5} />
              </span>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold text-[color:var(--fg)]">Your creator page</div>
                <div className="mono text-[10px] text-[color:var(--muted-2)]">
                  /l/your-name · every link you mint on one shareable page · brand it with one paste
                </div>
              </div>
              <button
                onClick={onClose}
                aria-label="Close"
                className="w-7 h-7 grid place-items-center rounded-lg text-[color:var(--muted)] hover:text-[color:var(--fg)] hover:bg-white/5 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <div className="max-h-[68vh] overflow-y-auto px-5 py-4">
              <CreatorPagePanel />
            </div>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>,
    body,
  )
}
