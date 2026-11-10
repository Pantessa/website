// THE TOUR · AUTOPILOTS (lane SIDES-B owns this file). Rules: lib/home-tour/types.ts.
//
// Three things, and only three: a stop that acts, an alert that comes back
// with the order attached, a job of several steps.
//
// Where each claim is implemented (checked 2026-11-10):
//   • "a stop is checked once a minute" — vercel.json crons
//     /api/cron/hl-guardian `* * * * *`; app/docs/guardian "A cron sweep
//     watches armed policies every minute".
//   • "by a key that cannot withdraw … can only close the one position you
//     named" — app/docs/guardian "What the delegated key cannot do": cannot
//     withdraw, cannot open or grow positions (reduce-only), one coin and one
//     side, expires.
//   • "an alert comes back with the order attached" and you send it —
//     lib/alerts-exec.ts header: firing "NEVER sends the alert's actionAsk —
//     the signature is the gate".
//   • "alerts are free, with no limit" — app/pricing "Unlimited price alerts";
//     "alerts and every automation are free at every tier, with no limits".
//   • "several steps, in order" — lib/jobs.ts compileJobAsk; app/docs/jobs.
//
// THE ONE SENTENCE. The long-with-a-stop runs for a fresh wallet today
// (scripts/audit-asks.ts, the order ticket's perp + stop: `action`) and
// compiles to two steps, `sign` then `auto`.
//
// NOT OFFERED, on purpose:
//   • a recurring buy — Nate retired it as a suggestion on 2026-09-16 (in
//     confirm mode it only reminds the wallet to sign each period); the
//     harness fences every chip-composing surface, the landing included.
//     The lane's pins keep its words out of these files.
//   • "Protect my ETH on Base with a 10% stop" — the spot guardian arms only
//     for a smart wallet holding the token on Base (lib/watchlists
//     HeldSymbol.guardable). The panel describes a stop in words.
import type { TourSideMeta } from './types'

export const meta: TourSideMeta = {
  id: 'autopilots',
  label: 'Autopilots',
  claim: 'Leave the tab. You keep the pen.',
  line: 'Stops that act, alerts that hand you the order, multi-step jobs.',
  body: 'A stop on a position, an alert that comes back with the order attached, several steps said as one job. A stop can only close the position you named; nothing else moves without your signature.',
  facts: ['A stop is checked once a minute, by a key that cannot withdraw', 'Alerts are free, with no limit', 'One sentence can be a job of several steps'],
  doors: [
    { label: 'See your jobs', href: '/chat?tab=jobs', kind: 'primary' },
    { label: 'How stops work', href: '/docs/guardian', kind: 'quiet' },
    { label: 'How jobs work', href: '/docs/jobs', kind: 'quiet' },
  ],
  asks: [{ ask: '2x Long $25 of UNI on Hyperliquid, then protect my UNI long with a 10% stop', label: 'Long UNI 2x with a stop', via: 'a two-step job' }],
}
