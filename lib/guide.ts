// THE GUIDE — how the app teaches itself as a visitor moves (squad
// front-door, 2026-10-06, Nate: "educate the user about links, the AI
// driven bits as they move through the app … pull the user to see jobs,
// links, wallet as they go"). GUIDE lane owns this file: the hints, where
// each may show, what has to have happened first, the storage record and
// the journey events. Pure: no DOM at import time, so the harness pins it.
//
// Contract committed with the stubs so every lane compiles against the same
// names; GUIDE replaces the body.

/** The surfaces a hint can sit on. */
export type GuideSurface = 'home' | 'symbol' | 'live' | 'chat' | 'wallet'

/** Per-browser memory of what the guide has shown (localStorage). */
export const GUIDE_STORAGE_KEY = 'pantessa.guide.v1'
