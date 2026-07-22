'use client'

// Progressive enhancement for the docs: gives every heading a stable slug id +
// a hover-revealed "copy link" button so a reader can deep-link to a section
// (e.g. /docs/links#mint-from-chat) without scrolling. The docs pages
// are server components rendered to static HTML, so React holds no client tree
// for them — we enhance the DOM directly in an effect, which never fights
// reconciliation. The copy is still server-rendered + crawlable; ids/buttons
// are pure enhancement. Returns null.

import { useEffect } from 'react'
import { usePathname } from 'next/navigation'

const LINK_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 13a5 5 0 0 0 7.54.54l3-3a5 5 0 0 0-7.07-7.07l-1.72 1.71"/><path d="M14 11a5 5 0 0 0-7.54-.54l-3 3a5 5 0 0 0 7.07 7.07l1.71-1.71"/></svg>'
const CHECK_SVG =
  '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><polyline points="20 6 9 17 4 12"/></svg>'

function slugify(text: string): string {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^\w\s-]/g, '') // drop punctuation/emoji, keep word chars + spaces + hyphens
    .replace(/[\s_]+/g, '-') // whitespace/underscores → hyphens
    .replace(/-+/g, '-') // collapse repeats
    .replace(/^-|-$/g, '') // trim leading/trailing
}

export default function DocsHeadingAnchors() {
  const pathname = usePathname()

  useEffect(() => {
    const main = document.querySelector('.docs__main')
    if (!main) return

    const headings = main.querySelectorAll<HTMLElement>('.docs__h1, .docs__prose h2, .docs__prose h3')
    const used = new Set<string>()

    headings.forEach((h) => {
      // Idempotent: a re-run (route change / fast refresh) must not double-inject.
      if (h.dataset.anchored === 'true') {
        if (h.id) used.add(h.id)
        return
      }

      const base = slugify(h.textContent || '')
      if (!base) return
      let id = base
      let n = 2
      while (used.has(id)) id = `${base}-${n++}`
      used.add(id)
      h.id = id
      h.dataset.anchored = 'true'
      h.classList.add('docs__heading')

      const btn = document.createElement('button')
      btn.type = 'button'
      btn.className = 'docs__anchor'
      btn.setAttribute('aria-label', 'Copy link to this section')
      btn.title = 'Copy link to this section'
      btn.innerHTML = LINK_SVG

      btn.addEventListener('click', (e) => {
        e.preventDefault()
        const url = `${window.location.origin}${window.location.pathname}#${id}`
        // Update the address bar without yanking the scroll position.
        history.replaceState(null, '', `#${id}`)
        const flash = () => {
          btn.innerHTML = CHECK_SVG
          btn.classList.add('is-copied')
          window.setTimeout(() => {
            btn.innerHTML = LINK_SVG
            btn.classList.remove('is-copied')
          }, 1600)
        }
        navigator.clipboard.writeText(url).then(flash).catch(flash)
      })

      h.appendChild(btn)
    })

    // Ids are assigned after hydration, so the browser's native hash jump on
    // first paint missed them — scroll the targeted section into view now.
    if (window.location.hash) {
      const target = document.getElementById(decodeURIComponent(window.location.hash.slice(1)))
      if (target) target.scrollIntoView({ block: 'start' })
    }
  }, [pathname])

  return null
}
