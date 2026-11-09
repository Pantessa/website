// COMMUNITY STORE — the server functions every lane calls (lane CORE owns the
// bodies; the SIGNATURES are the squad contract — add, never change one
// without a note in the blackboard). The bot lanes call these directly; the
// pages go through the HTTP routes built on them. Server-only.
//
// Rules that hold in every body (pinned by CORE):
//   · a member is a PROVEN key (lib/community/identity) — never a typed one
//   · public lists and counts fence is_internal:false; a by-slug read is the
//     one unfenced read (the /i/<slug> rule)
//   · a secret (a Discord webhook URL) never leaves this module's write path
//   · join is idempotent; member_count moves only on a real insert/delete

import type { ChannelPlatform, CommunityRole, FeedPost, FeedSort, FeedWindow, MemberKey, MemberSource, MyMembership, PublicCommunity, PublicMember, Actor } from './spec'

const TODO = (fn: string): never => {
  throw new Error(`lib/community/store ${fn}: lane CORE lands this`)
}

export type StoreRefusal = { ok: false; status: number; reason: string }

export interface CommunityDraft {
  slug: string
  name: string
  about?: string
  symbols?: string[]
}

export async function createCommunity(_owner: string, _draft: CommunityDraft, _isInternal: boolean): Promise<{ ok: true; community: PublicCommunity } | StoreRefusal> {
  return TODO('createCommunity')
}

/** By slug — the one unfenced read. null = no such room. */
export async function getCommunity(_slug: string): Promise<PublicCommunity | null> {
  return TODO('getCommunity')
}

export async function listCommunities(_opts?: { sort?: 'members' | 'new' | 'active'; limit?: number; symbol?: string }): Promise<PublicCommunity[]> {
  return TODO('listCommunities')
}

export interface JoinInput {
  /** The invite code the join carried (?via= / a deep-link payload). Unknown codes are ignored, never an error. */
  via?: string | null
  source?: MemberSource
  /** Provider-reported name for a wallet-less member (rendered as text). */
  displayName?: string | null
  isInternal?: boolean
}

/** Idempotent. `joined` is true only when this call created the seat. */
export async function joinCommunity(_slug: string, _actor: Actor, _input?: JoinInput): Promise<{ ok: true; joined: boolean; community: PublicCommunity; me: MyMembership } | StoreRefusal> {
  return TODO('joinCommunity')
}

/** The owner cannot leave (they hand the room over or keep it). */
export async function leaveCommunity(_slug: string, _key: MemberKey): Promise<{ ok: true; left: boolean } | StoreRefusal> {
  return TODO('leaveCommunity')
}

export async function membershipOf(_slug: string, _key: MemberKey): Promise<MyMembership | null> {
  return TODO('membershipOf')
}

export async function roleOf(_slug: string, _key: MemberKey): Promise<CommunityRole | null> {
  return TODO('roleOf')
}

/** The rooms an identity sits in, newest first. */
export async function communitiesOf(_key: MemberKey): Promise<PublicCommunity[]> {
  return TODO('communitiesOf')
}

export async function listMembers(_slug: string, _opts?: { sort?: 'invites' | 'trades' | 'new'; limit?: number }): Promise<PublicMember[]> {
  return TODO('listMembers')
}

/** When a provider identity is linked to a wallet, its seats move to the wallet key (one seat per person). */
export async function mergeSeats(_from: MemberKey, _toWallet: string): Promise<number> {
  return TODO('mergeSeats')
}

export interface FeedQuery {
  community?: string | null
  symbol?: string | null
  sort?: FeedSort
  window?: FeedWindow
  kind?: FeedPost['kind'] | null
  author?: string | null
  limit?: number
  /** Opaque cursor from the previous page. */
  cursor?: string | null
  /** The caller, for `myVote`. */
  viewer?: MemberKey | null
  includeInternal?: boolean
}

export async function listFeed(_q: FeedQuery): Promise<{ posts: FeedPost[]; next: string | null }> {
  return TODO('listFeed')
}

export async function getFeedPost(_id: string, _viewer?: MemberKey | null): Promise<FeedPost | null> {
  return TODO('getFeedPost')
}

/** value 0 clears the vote. Returns the post's new score. */
export async function castVote(_postId: string, _voter: MemberKey, _value: 1 | 0 | -1): Promise<{ ok: true; score: number; myVote: 1 | 0 | -1 } | StoreRefusal> {
  return TODO('castVote')
}

// ── linked chats ─────────────────────────────────────────────────────────

/** Owner / mod only. Single use, 15 minutes (spec LINK_CODE_TTL_MS). */
export async function mintLinkCode(_slug: string, _by: MemberKey, _platform: ChannelPlatform): Promise<{ ok: true; code: string; expiresAt: number } | StoreRefusal> {
  return TODO('mintLinkCode')
}

/** Spend a link code from inside the chat. The CALLER has already proved the sender administers that chat. */
export async function redeemLinkCode(_code: string, _platform: ChannelPlatform, _chat: { externalId: string; title?: string | null; secret?: string | null }): Promise<{ ok: true; community: PublicCommunity } | StoreRefusal> {
  return TODO('redeemLinkCode')
}

/** Link directly (the owner pasted a Discord webhook URL on the room page). */
export async function linkChannel(_slug: string, _by: MemberKey, _platform: ChannelPlatform, _chat: { externalId: string; title?: string | null; secret?: string | null }): Promise<{ ok: true } | StoreRefusal> {
  return TODO('linkChannel')
}

export async function unlinkChannel(_platform: ChannelPlatform, _externalId: string, _by?: MemberKey): Promise<boolean> {
  return TODO('unlinkChannel')
}

/** The room a chat is linked to (the bots' first read on every command). */
export async function communityOfChannel(_platform: ChannelPlatform, _externalId: string): Promise<PublicCommunity | null> {
  return TODO('communityOfChannel')
}

/** Server-only rows for delivery: ids and secrets included. Never serialize. */
export interface DeliveryChannel {
  id: string
  platform: ChannelPlatform
  externalId: string
  secret: string | null
}
/** The channels that should hear a post now (announce on, under ANNOUNCE_HOURLY_CAP); stamps last_post_at. */
export async function channelsToAnnounce(_slug: string): Promise<DeliveryChannel[]> {
  return TODO('channelsToAnnounce')
}
