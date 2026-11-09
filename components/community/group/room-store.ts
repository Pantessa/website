'use client'

// WHO IS HERE, AND WHICH ROOMS THEY SIT IN — one read for every Join button
// on a page (squad community, lane GROUP).
//
// GET /api/me/identity answers for the whole page: the proven identity (a
// wallet session, or a Telegram / Discord identity the provider signed) and
// the rooms it sits in. Ten Join buttons in the directory share that one
// request. A room page adds what only it knows (the caller's role and invite
// link, from GET /api/communities/<slug>), and a join or a leave writes its
// answer here so every button for that room agrees at once.
//
// The identity cookie is httpOnly, so the browser cannot see it: the server
// says who is acting. A wallet session alone also counts as proven (the join
// route reads it), which keeps the button working if the identity read fails.

import { useEffect } from 'react'
import { create } from 'zustand'
import type { MyMembership, PublicCommunity } from '@/lib/community/spec'
import { useSession } from '@/lib/session'

export interface Identity {
  wallet: string | null
  provider: { p: 'tg' | 'dc'; name: string | null; username: string | null } | null
  key: string | null
  communities: PublicCommunity[]
}

const STRANGER: Identity = { wallet: null, provider: null, key: null, communities: [] }

interface RoomStore {
  identity: Identity | null
  /** The session address the last identity read was made for ('' = none). */
  readFor: string | undefined
  /** The caller's seat per room, once a room page or a join has said so.
   *  null = known not to be a member. */
  seats: Record<string, MyMembership | null>
  /** The session address those seats were read under: a seat read for one
   *  wallet is never shown to the next one. */
  seatsFor: string
  loadIdentity: (sessionAddress: string, force?: boolean) => Promise<Identity>
  setSeat: (slug: string, me: MyMembership | null, sessionAddress: string) => void
}

let inFlight: { for: string; p: Promise<Identity> } | null = null

export const useRoomStore = create<RoomStore>((set, get) => ({
  identity: null,
  readFor: undefined,
  seats: {},
  seatsFor: '',
  loadIdentity: (sessionAddress, force = false) => {
    const s = get()
    if (!force && s.identity && s.readFor === sessionAddress) return Promise.resolve(s.identity)
    if (!force && inFlight && inFlight.for === sessionAddress) return inFlight.p
    const p = fetch('/api/me/identity', { cache: 'no-store' })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Partial<Identity> | null): Identity => {
        if (!d || typeof d !== 'object') return STRANGER
        return {
          wallet: typeof d.wallet === 'string' ? d.wallet : null,
          provider: d.provider && (d.provider.p === 'tg' || d.provider.p === 'dc') ? d.provider : null,
          key: typeof d.key === 'string' ? d.key : null,
          communities: Array.isArray(d.communities) ? d.communities : [],
        }
      })
      .catch(() => STRANGER)
      .then((identity) => {
        if (inFlight?.p === p) inFlight = null
        set({ identity, readFor: sessionAddress })
        return identity
      })
    inFlight = { for: sessionAddress, p }
    return p
  },
  setSeat: (slug, me, sessionAddress) =>
    set((s) => {
      // The identity's room list follows a leave, so a directory row agrees.
      const identity = !me && s.identity ? { ...s.identity, communities: s.identity.communities.filter((c) => c.slug !== slug) } : s.identity
      const kept = s.seatsFor === sessionAddress ? s.seats : {}
      return { seats: { ...kept, [slug]: me }, seatsFor: sessionAddress, identity }
    }),
}))

export interface Standing {
  /** The identity read (or the session) has answered. */
  ready: boolean
  /** A proven identity is acting: a join is one tap. */
  proven: boolean
  member: boolean
  me: MyMembership | null
  /** The connected wallet has no session yet: one sign-in away. */
  walletWaiting: string | null
}

/** Where the visitor stands with one room. Reads the identity once a page,
 *  and again whenever the session changes hands. */
export function useStanding(slug: string): Standing {
  const { status, address, walletAddress } = useSession()
  const identity = useRoomStore((s) => s.identity)
  const readFor = useRoomStore((s) => s.readFor)
  const seatsFor = useRoomStore((s) => s.seatsFor)
  const storedSeat = useRoomStore((s) => s.seats[slug])
  const loadIdentity = useRoomStore((s) => s.loadIdentity)

  const sessionAddress = status === 'authed' && address ? address : ''
  useEffect(() => {
    if (status === 'loading') return
    void loadIdentity(sessionAddress)
  }, [status, sessionAddress, loadIdentity])

  const seat = seatsFor === sessionAddress ? storedSeat : undefined
  const fresh = identity !== null && readFor === sessionAddress
  const proven = !!sessionAddress || (fresh && !!identity?.key)
  const listed = fresh && !!identity?.communities.some((c) => c.slug === slug)
  const member = seat !== undefined ? seat !== null : listed
  return {
    ready: status !== 'loading' && (fresh || !!sessionAddress),
    proven,
    member: proven && member,
    me: proven ? (seat ?? null) : null,
    walletWaiting: !proven && walletAddress ? walletAddress : null,
  }
}
