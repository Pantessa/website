// The conversation on a phone, as pure decisions (squad mobile-native,
// 2026-09-24, CHAT lane; Nate: "it needs to feel like a native mobile app when
// accessed from mobile"). The screen where people act reads like Messages: a
// compact top bar (the way to the chat list, the title, the apps, the
// account), a composer that rides the soft keyboard, and no drawer that pops
// by itself. ChatInterface renders these; the harness pins them here without
// a DOM.

import type { PhoneScreen, RailTab } from '@/lib/store'

/** The rail tab a toolbar door names → the phone SCREEN that destination is
 *  below lg (README D2: a tab is a place, never a pop-up). The drawer is the
 *  desktop's; a phone never opens it. */
export const PHONE_SCREEN_FOR_RAIL_TAB: Record<RailTab, PhoneScreen> = {
  mcps: 'apps',
  chats: 'history',
  jobs: 'jobs',
  links: 'links',
  team: 'team',
}

/** What the top bar's apps door says: the working set as a COUNT, in the
 *  word the spine's seat uses ("APPS"). */
export function appsDoorLabel(count: number): string {
  if (count <= 0) return 'No apps'
  return `${count} app${count === 1 ? '' : 's'}`
}

/** The conversation's title on the phone bar: the chat's own (the store
 *  titles a chat from its first ask), else "New chat". */
export function phoneChatTitle(title: string | null | undefined): string {
  const t = (title ?? '').trim()
  return t || 'New chat'
}

/** How far the composer must rise so its bottom sits on the soft keyboard.
 *  `untransformedBottom` is where the composer's bottom edge sits with no lift
 *  (layout px from the top of the layout viewport), `layoutHeight` is
 *  innerHeight, and `inset` is the keyboard's covered pixels
 *  (lib/phone-shell keyboardInset: layout − visual height − visual offsetTop).
 *  The visible bottom is `layoutHeight − inset`; a composer already above it
 *  (a frame that shrank for the keyboard, SHELL's `--kb-inset`) lifts 0, so the
 *  lift never doubles up with the frame's own answer. */
export function keyboardLift(untransformedBottom: number, layoutHeight: number, inset: number): number {
  if (!(inset > 0)) return 0
  const visibleBottom = layoutHeight - inset
  return Math.max(0, Math.round(untransformedBottom - visibleBottom))
}

/** Whether the conversation's thread is THE scroller of the screen
 *  (lib/phone-shell SCROLL_ATTR): only ONE element may carry it. First-party
 *  /chat carries it while its conversation shows (always at lg+, where no
 *  phone screen exists; below lg only in 'chat' — NAV's screens take it when
 *  they show). /i carries it (the runtime is its own frame). The embed (an
 *  iframe on someone else's page) and the /t docked ticket (MARKETS' frame
 *  owns that page's scroller) never do. */
export function threadOwnsAppScroll(o: { embedded: boolean; docked: boolean; simple: boolean; phone: boolean; phoneScreen: PhoneScreen }): boolean {
  if (o.embedded || o.docked) return false
  if (o.simple) return true
  return !o.phone || o.phoneScreen === 'chat'
}
