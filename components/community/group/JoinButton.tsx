'use client'
// Lane GROUP owns this file. Props are the squad contract: the one-tap join.
// A proven identity joins on the tap; a stranger gets the unified sign-in
// door and the join is HELD and runs when they land back (rule 6).
export interface JoinButtonProps {
  slug: string
  name: string
  /** The invite code the page was opened with. */
  via?: string | null
  /** Called with the new state after a join or a leave. */
  onChange?: (member: boolean) => void
  size?: 'sm' | 'md'
}

export default function JoinButton({ name }: JoinButtonProps) {
  return <button type="button">Join {name}</button>
}
