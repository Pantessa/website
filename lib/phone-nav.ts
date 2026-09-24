// A TAB IS A PLACE, NEVER A POP-UP (squad mobile-native, 2026-09-24, Nate:
// "when you click a bottom nav the drawer pops out automatically but does
// not feel like the right flow… by default should be closed with easy way to
// access the info").
//
// Below lg the spine is a bottom tab bar (lib/phone-shell PHONE_MQ), and this
// module decides what a tap on one of its seats DOES, in every state, the way
// a native tab bar does: a seat takes you to its destination, the lit seat
// says where you are, tapping the lit seat pops its stack to the root, and at
// the root it scrolls to the top. No seat opens a drawer over the page.
//
// The seats keep their composition and order (MARKETS · APPS · JOBS · LINKS ·
// WALLET · TEAM · CHATS · DOCS · SETTINGS, with TEAM/DOCS/SETTINGS behind
// MORE below sm). MARKETS, WALLET, DOCS and SETTINGS are pages; APPS, JOBS,
// LINKS and TEAM are the /chat main area given the whole screen
// (store.phoneScreen); CHATS is the conversation's own seat, and tapping it
// there shows the chat list.
//
// Pure: no DOM, no store — AppSpine executes the action it is handed, and the
// harness pins every seat × every state.

import type { PhoneScreen, RailTab } from '@/lib/store'
import { parseTabParam, tabUrl } from '@/lib/app-tab-url'

/** Every seat the phone bar can carry (MORE holds the folded three). */
export type PhoneSeat = 'markets' | 'mcps' | 'jobs' | 'links' | 'wallet' | 'team' | 'chats' | 'docs' | 'settings' | 'more'

/** The surfaces that mount the spine. */
export type PhoneSurface = 'chat' | 'markets' | 'wallet' | 'dashboard'

export type PhoneNavAction =
  /** Show this screen in /chat's main area (already on /chat). */
  | { kind: 'screen'; screen: PhoneScreen }
  /** The lit seat at its root: scroll the current screen to the top. */
  | { kind: 'top' }
  /** Navigate. `screen` is what /chat shows on arrival (null = the
   *  conversation; irrelevant for a page outside /chat). */
  | { kind: 'navigate'; href: string; screen: PhoneScreen | null }
  /** Open the MORE sheet. */
  | { kind: 'sheet'; sheet: 'more' }

/** The drawer destinations, i.e. the seats whose place is a /chat screen. */
export const SCREEN_TABS: readonly RailTab[] = ['mcps', 'jobs', 'links', 'team', 'chats']

/** Seats the phone bar folds behind MORE below sm. */
export const MORE_SEATS: readonly PhoneSeat[] = ['team', 'docs', 'settings']

/** The /chat screen a drawer tab means on a phone. The tab ids are the
 *  ?tab= grammar every deep link in the product carries (lib/app-tab-url),
 *  so they stay; only the phone's screen names differ where the words do. */
export function screenForTab(tab: RailTab): PhoneScreen {
  switch (tab) {
    case 'mcps':
      return 'apps'
    case 'chats':
      return 'history'
    default:
      return tab
  }
}

/** The ?tab= a screen writes to the URL. The conversation writes none: a bare
 *  /chat IS the conversation, so shared chat links stay clean. */
export function tabForScreen(screen: PhoneScreen): RailTab | null {
  switch (screen) {
    case 'chat':
      return null
    case 'history':
      return 'chats'
    case 'apps':
      return 'mcps'
    default:
      return screen
  }
}

/** The screen a /chat URL names. Absent or unknown → the conversation. */
export function phoneScreenFromSearch(search: string): PhoneScreen {
  const tab = parseTabParam(search)
  return tab ? screenForTab(tab) : 'chat'
}

/** The URL for a screen on whatever chat route you are on. Unlike the
 *  desktop drawer (where /chat and /chat?tab=mcps are the same open drawer),
 *  APPS is a distinct place on a phone, so its tab is written explicitly —
 *  a reload on the APPS screen must come back to APPS. */
export function phoneTabUrl(screen: PhoneScreen, pathname: string, search: string): string {
  return tabUrl(tabForScreen(screen), pathname, search, { explicit: true })
}

/** The seat a /chat screen lights: the conversation and the chat list are
 *  both the CHATS seat's stack. */
export function seatForScreen(screen: PhoneScreen): PhoneSeat {
  if (screen === 'chat' || screen === 'history') return 'chats'
  return tabForScreen(screen) as PhoneSeat
}

/** Which seat wears the "you are here" mark on a surface. */
export function litSeat(surface: PhoneSurface, screen: PhoneScreen): PhoneSeat {
  switch (surface) {
    case 'chat':
      return seatForScreen(screen)
    case 'markets':
      return 'markets'
    case 'wallet':
      return 'wallet'
    case 'dashboard':
      return 'settings'
  }
}

/** MORE is lit when the lit seat is folded behind it (TEAM, SETTINGS; DOCS
 *  never lights — /docs has no spine). */
export function moreLit(surface: PhoneSurface, screen: PhoneScreen): boolean {
  const lit = litSeat(surface, screen)
  return lit === 'team' || lit === 'settings'
}

const trimSlash = (p: string) => (p.length > 1 ? p.replace(/\/+$/, '') : p)

/**
 * What a tap on `seat` does, given where you are.
 *
 * - MARKETS / WALLET / DOCS / SETTINGS are pages: elsewhere they navigate;
 *   on their own page at the root they scroll to the top; deeper in their
 *   stack (/t/<sym> for MARKETS, /dashboard/<x> for SETTINGS) they pop to the
 *   root page.
 * - APPS / JOBS / LINKS / TEAM on /chat show their screen; tapped again on
 *   their own screen they scroll to the top. Off /chat they navigate into
 *   /chat with that screen showing (the URL names it too).
 * - CHATS is the conversation's seat: in the conversation it shows the chat
 *   list; on the list it pops back to the conversation; from any other
 *   screen it returns to the conversation you were in. Off /chat it opens the
 *   chat list.
 * - MORE opens the sheet.
 */
export function phoneTap(input: { surface: PhoneSurface; screen: PhoneScreen; seat: PhoneSeat; pathname: string }): PhoneNavAction {
  const { surface, screen, seat } = input
  const pathname = trimSlash(input.pathname || '/')
  switch (seat) {
    case 'more':
      return { kind: 'sheet', sheet: 'more' }
    case 'markets':
      if (surface === 'markets' && pathname === '/markets') return { kind: 'top' }
      return { kind: 'navigate', href: '/markets', screen: null }
    case 'wallet':
      if (surface === 'wallet') return { kind: 'top' }
      return { kind: 'navigate', href: '/wallet', screen: null }
    case 'docs':
      return { kind: 'navigate', href: '/docs', screen: null }
    case 'settings':
      if (surface === 'dashboard' && pathname === '/dashboard') return { kind: 'top' }
      return { kind: 'navigate', href: '/dashboard', screen: null }
    case 'chats': {
      if (surface !== 'chat') return { kind: 'navigate', href: phoneTabUrl('history', '/chat', ''), screen: 'history' }
      if (screen === 'chat') return { kind: 'screen', screen: 'history' }
      return { kind: 'screen', screen: 'chat' }
    }
    case 'mcps':
    case 'jobs':
    case 'links':
    case 'team': {
      const target = screenForTab(seat)
      if (surface !== 'chat') return { kind: 'navigate', href: phoneTabUrl(target, '/chat', ''), screen: target }
      if (screen === target) return { kind: 'top' }
      return { kind: 'screen', screen: target }
    }
  }
}

/** The screen /chat should show after a navigation that named none: the
 *  conversation. Every off-chat seat that wants a screen names it in the URL
 *  (phoneTabUrl), so a bare arrival — the brand seat, a shared link, "New
 *  chat" — never inherits the screen a previous visit left open. */
export const ARRIVAL_SCREEN: PhoneScreen = 'chat'
