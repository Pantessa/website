import ChatLoader from '@/components/ChatLoader'

// Route-level suspense fallback: paints instantly while the heavy chat bundle
// (wagmi/RainbowKit/workspace) loads — no more blank screen on navigation.
export default function Loading() {
  return <ChatLoader />
}
