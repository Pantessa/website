// THE TOUR · AUTOPILOTS (lane SIDES-B owns this file). First-draft words from
// the contract; the lane refines them. Rules: lib/home-tour/types.ts.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'autopilots',
  label: 'Autopilots',
  claim: 'Leave the tab. You keep the pen.',
  line: 'Recurring buys, stops that act, alerts that hand you the order.',
  body: 'Set a weekly buy, a stop on a position, or an alert that comes back with the order ready. Nothing is custodial: what runs without you can only do the one thing you signed for.',
  facts: ['One sentence can be a whole job: several steps, in order', 'A stop is watched every minute', 'Alerts are free and unlimited'],
  doors: [
    { label: 'See your jobs', href: '/chat?tab=jobs', kind: 'primary' },
    { label: 'How a stop is guarded', href: '/docs/guardian', kind: 'quiet' },
    { label: 'How jobs work', href: '/docs/jobs', kind: 'quiet' },
  ],
  asks: [
    { ask: 'Buy $10 of AAPL every week on Robinhood Chain', label: 'Buy $10 of AAPL weekly', via: 'a recurring buy' },
    { ask: '2x Long $25 of UNI on Hyperliquid, then protect my UNI long with a 10% stop', label: 'Long UNI 2x with a stop', via: 'a two-step job' },
    { ask: 'Protect my ETH on Base with a 10% stop', label: 'Stop on my ETH', via: 'the spot guardian' },
  ],
}
