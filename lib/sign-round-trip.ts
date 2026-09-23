// lib/sign-round-trip.ts — the round trip a signature makes on a phone.
//
// Contract stub committed by the mobile-onboarding squad coordinator
// (2026-09-23). OWNED BY THE SIGN LANE: the pure state machine for a wallet
// request that leaves the page for the wallet app and comes back —
// asked → in-app → returned → settled | still-waiting | stale (re-offer).
export type SignRoundTripState = 'idle' | 'asked' | 'in-app' | 'returned' | 'settled' | 'stale'
