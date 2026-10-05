import SharedGone from '@/components/SharedGone'

export const metadata = { title: 'Watchlist not available · Pantessa', robots: { index: false, follow: false } }

export default function NotFound() {
  return <SharedGone what="watchlist" why="Its owner may have made it private again, or the link is missing a character." />
}
