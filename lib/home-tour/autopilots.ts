// THE TOUR · AUTOPILOTS (lane SIDES-B owns this file). Rules: lib/home-tour/types.ts.
//
// Where each claim is implemented (checked 2026-11-10):
//   • "returns each period for your signature" — lib/dca.ts header ("CONFIRM-
//     MODE by design: a schedule never signs anything"), lib/dca-exec.ts
//     (the armed reply: "NOTHING buys without your signature; skip a period
//     and it simply lapses"), app/docs/jobs "a schedule, not an authorization".
//   • "a stop is checked every minute" — vercel.json crons /api/cron/hl-guardian
//     `* * * * *`; app/docs/guardian "A cron sweep watches armed policies
//     every minute".
//   • "its key cannot withdraw" — app/docs/guardian "What the delegated key
//     cannot do": cannot withdraw, cannot open or grow positions (reduce-only),
//     one coin and one side, expires.
//   • "alerts are free, with no limit" — app/pricing "Unlimited price alerts";
//     "alerts and every automation are free at every tier, with no limits".
//   • "several steps, in order" — lib/jobs.ts compileJobAsk; app/docs/jobs.
//
// THE SENTENCES. Both run for a fresh wallet today (scripts/audit-asks.ts:
// the weekly buy and the order ticket's perp + stop are `action` rows):
//   • the weekly buy creates a confirm-mode schedule and offers this week's
//     buy at once (lib/dca-exec "The first period is due NOW");
//   • the long-with-a-stop compiles to two steps, `sign` then `auto`.
// The contract's third draft, "Protect my ETH on Base with a 10% stop", is
// NOT here: the spot guardian arms only for a smart wallet holding the token
// on Base (lib/watchlists HeldSymbol.guardable), so the panel describes a
// stop in words and offers no chip for it.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'autopilots',
  label: 'Autopilots',
  claim: 'Leave the tab. You keep the pen.',
  line: 'Recurring buys, stops that act, alerts that hand you the order.',
  body: 'Set a weekly buy, a stop on a position, or an alert that comes back with the order attached. Nothing is custodial: a recurring buy returns each period for your signature, and a stop can only close the one position you named.',
  facts: ['One sentence can be a whole job: several steps, in order', 'A stop is checked every minute, by a key that cannot withdraw', 'Alerts are free, with no limit'],
  doors: [
    { label: 'See your jobs', href: '/chat?tab=jobs', kind: 'primary' },
    { label: 'How a stop is guarded', href: '/docs/guardian', kind: 'quiet' },
    { label: 'How jobs work', href: '/docs/jobs', kind: 'quiet' },
  ],
  asks: [
    { ask: 'Buy $10 of AAPL every week on Robinhood Chain', label: 'Buy $10 of AAPL weekly', via: 'a recurring buy' },
    { ask: '2x Long $25 of UNI on Hyperliquid, then protect my UNI long with a 10% stop', label: 'Long UNI 2x with a stop', via: 'a two-step job' },
  ],
}
