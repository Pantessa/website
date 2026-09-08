'use client'
// One flag for "is this a post-hydration render": false on the server AND
// during React's hydration render (getServerSnapshot), true right after —
// React re-renders with the client snapshot in the same task, before paint.
// Any client-only decision that would change the tree (wagmi's boot status,
// storage reads) gates on it, so server HTML and the hydration render match.
import { useSyncExternalStore } from 'react'

const subscribe = () => () => {}
const client = () => true
const server = () => false

export function useHydrated(): boolean {
  return useSyncExternalStore(subscribe, client, server)
}
