'use client'
// Lane FEED owns this file. Props are the squad contract: one share surface
// for a post or a room — X, Telegram, copy for Discord, the phone's own share.
export interface ShareSheetProps {
  /** Absolute or in-app URL of the thing shared (the sheet makes it absolute). */
  url: string
  /** One plain-ASCII line that reads on its own in a chat. */
  text: string
  /** What is being shared, for the journey label. */
  what: 'post' | 'room' | 'invite'
  /** Button label; default "Share". */
  label?: string
}

export default function ShareSheet({ label = 'Share' }: ShareSheetProps) {
  return <button type="button">{label}</button>
}
