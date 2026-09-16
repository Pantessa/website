'use client'

// The movers tape under the nav — VIZ's MoversTape slot (the real ribbon at
// integration). A row opens the symbol page: /t/* is public, so a plain
// push is the rule-6-correct thing.

import { useRouter } from 'next/navigation'
import '@/components/markets/look.css'
import MoversTape from '@/components/markets/viz/MoversTape'

export default function MoversStrip() {
  const router = useRouter()
  return (
    <div className="lmv" data-movers-strip>
      <div className="lmv__in">
        <MoversTape onOpen={(symbol) => router.push(`/t/${encodeURIComponent(symbol)}`)} />
      </div>
    </div>
  )
}
