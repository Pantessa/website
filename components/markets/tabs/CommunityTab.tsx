// STUB — the COMM lane builds the real one at components/markets/community/CommunityTab.tsx
// (annotated-chart posts with executable lines, forks, signature-verified
// records). QA replaces this file with a one-line re-export at integration.

import type { ChartPair } from '@/lib/charts'
import ComingCard from '@/components/markets/shell/ComingCard'

export default function CommunityTab({ symbol }: { symbol: string; pair: ChartPair }) {
  return (
    <ComingCard
      lane="COMM"
      title={`${symbol} community`}
      body={`Posts are annotated charts, not screenshots: lines, levels and zones pinned to time and price, each carrying an ask the reader signs in one tap. Fork a chart onto your own wallet's view.`}
    />
  )
}
