'use client'

// "Called it on <SYM>" — the scanned X accounts for this market, on the symbol
// page's Community tab (squad called-gtm, lane COMMUNITY owns this file).
// STUB from the contract commit: it renders nothing until the lane builds it.
// Data: GET /api/x/board?sym=<SYM> → { entries: BoardEntry[] } (lib/called-it/gtm).

export interface CalledBoardProps {
  symbol: string
}

export default function CalledBoard(_props: CalledBoardProps) {
  return null
}
