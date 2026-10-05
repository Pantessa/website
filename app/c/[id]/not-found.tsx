import SharedGone from '@/components/SharedGone'

export const metadata = { title: 'Chart call not available · Pantessa', robots: { index: false, follow: false } }

export default function NotFound() {
  return <SharedGone what="chart call" why="The link may be missing a character, or the call was never published." />
}
