import type { Metadata } from 'next'
import './embed.css'

// Minimal shell for the embeddable chat: the site nav renders in the ROOT
// layout, so it suppresses itself on /embed (see components/Navigation.tsx);
// no footer here by construction. This layout only carries the embed-scoped
// CSS (full-height + light-theme variable overrides) and keeps the iframe
// out of search indexes.
export const metadata: Metadata = {
  title: 'Pantessa chat',
  robots: { index: false, follow: false },
}

export default function EmbedLayout({ children }: { children: React.ReactNode }) {
  return children
}
