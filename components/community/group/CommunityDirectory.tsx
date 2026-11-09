'use client'
// Lane GROUP owns this file. Props are the squad contract: the list of rooms
// (/community mounts it beside the feed; the symbol page may mount it with a
// symbol to show the rooms that follow it).
export interface CommunityDirectoryProps {
  symbol?: string
  limit?: number
  /** A tight rail (the feed's side column) or the full list. */
  variant?: 'rail' | 'full'
}

export default function CommunityDirectory(_props: CommunityDirectoryProps) {
  return <div data-community-directory />
}
