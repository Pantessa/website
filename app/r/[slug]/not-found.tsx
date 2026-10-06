import SharedGone from '@/components/SharedGone'

export const metadata = { title: 'Receipt not available · Pantessa', robots: { index: false, follow: false } }

export default function NotFound() {
  return <SharedGone what="receipt" why="Its owner may have taken it down, or the link is missing a character." />
}
