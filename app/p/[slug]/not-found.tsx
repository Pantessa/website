import SharedGone from '@/components/SharedGone'

export const metadata = { title: 'Shared chat not available · Pantessa', robots: { index: false, follow: false } }

export default function NotFound() {
  return <SharedGone what="shared chat" why="Its owner may have turned sharing off, or the link is missing a character." />
}
