'use client'

// The trade buttons beside a call (squad called-gtm, lane TRADE owns this
// file). STUB from the contract commit: it renders nothing until the lane
// builds it. A bull call offers the buy, a bear call the sell or the short
// (lib/called-it/gtm actSideFor); every sentence is one the app already
// builds, gated by what the venue can run, and sent through connect-to-act.

export interface CallActsProps {
  symbol: string
  stance: 'bull' | 'bear'
  /** Whose call this is, for the journey label only. */
  handle?: string
  postId?: string
  /** `row` = chips in a line (a card's foot); `stack` = full-width buttons (a phone sheet, a hero). */
  variant?: 'row' | 'stack'
  className?: string
}

export default function CallActs(_props: CallActsProps) {
  return null
}
