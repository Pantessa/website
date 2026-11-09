import SharedGone from '@/components/SharedGone'

export const metadata = { title: 'Room not available · Pantessa', robots: { index: false, follow: false } }

export default function NotFound() {
  return <SharedGone what="room" why="The link may be missing a character, or the room was never started." />
}
