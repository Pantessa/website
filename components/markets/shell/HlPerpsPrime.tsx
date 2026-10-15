'use client'

// The server resolved this page's symbol through the venue's live perp
// universe (lib/charts resolveChartPair) and every client component under
// it — the chart, the tiles, the rail's chart buttons, the order ticket —
// calls the SYNC chartPairFor. A browser's table is cold until a universe
// lands, so the server hands the listed names down and this wrapper primes
// the table DURING RENDER, as the parent of everything that reads it: React
// renders a parent before its children, so no descendant (the side column
// included — it renders before SymbolPage in tree order) ever resolves the
// page's perp to null and hydrates a different text than the server drew
// (React #418, found in the pane on /t/ZK and /t/AZTEC, 2026-10-13).
// Idempotent; a payload too small to be the venue is ignored
// (lib/hl-universe primeHlUniverse). Rendered only for a live-only perp page
// (hlPerps null elsewhere — a static-table page carries no list).

import type { ReactNode } from 'react'
import { primeHlPerps } from '@/lib/charts'

export default function HlPerpsPrime({ hlPerps, children }: { hlPerps: { main: string[]; xyz: string[] } | null; children: ReactNode }) {
  if (hlPerps) primeHlPerps(hlPerps)
  return <>{children}</>
}
