'use client'

// A GUIDE SEAT (squad front-door, 2026-10-06): where a surface lets the
// guide speak. GUIDE lane owns this file and the card it renders; a surface
// mounts `<GuideSeat surface="…" />` once and never decides what shows —
// lib/guide does (which hint, given what this browser has already seen and
// done). Renders nothing until the lane lands, and nothing when no hint
// applies.

import type { GuideSurface } from '@/lib/guide'

export default function GuideSeat(_props: { surface: GuideSurface }) {
  return null
}
