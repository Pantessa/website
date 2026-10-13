'use client'

// ALERTS ON YOUR PICK (GTM squad 2026-10-13, lane ALERTS fills this file).
// One tap arms a price alert on this market through the EXISTING alerts
// (POST /api/alerts, lib alert grammar); a guest gets the door. Mounted
// (one line each, the coordinator's seats) in the battle scoreboard's recruit
// row and the deck's chip row. Renders nothing until ALERTS lands.

export interface ArmAlertProps {
  market: string
  /** Where the control sits; the copy differs. */
  seat: 'scoreboard' | 'deck' | 'strip'
}

export default function ArmAlert(_props: ArmAlertProps) {
  return null
}
