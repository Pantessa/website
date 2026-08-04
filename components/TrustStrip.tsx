// THE TRUST LAYER — "Why hosts embed it. Why users sign." The old strip was
// four undifferentiated tiles under a headline that asks two distinct
// questions of two distinct people. It answers both now, in two lanes, with
// the party named at the top of each: a host is deciding whether to mount
// this on their page; a visitor is deciding whether to put their signature on
// something a machine built. Those are not the same worry.
//
// Every row carries a single-stroke glyph that animates its own claim (the
// gate deflects, the receipt lands, the route freezes, the proven node rises,
// the widget installs, the pen signs, the key gets cut). Pure SVG + CSS
// keyframes; the global reduced-motion guard stills them.

import Link from 'next/link'

type Glyph = 'gate' | 'receipt' | 'pause' | 'rise' | 'plug' | 'chart' | 'pen' | 'revoke'

interface Row {
  g: Glyph
  t: string
  d: string
  href: string
}

const HOSTS: Row[] = [
  {
    g: 'plug',
    t: 'Five lines, and it signs with your page’s wallet',
    d: 'No key custody to negotiate, no checkout to build. wallet: ‘auto’ uses the wallet your visitor already connected.',
    href: '/docs/embed',
  },
  {
    g: 'chart',
    t: 'You see the asks you couldn’t answer',
    d: 'Every turn on your site lands in your dashboard — funnels, dead ends, money moved, and which tool would have closed each gap.',
    href: '/dashboard',
  },
  {
    g: 'pause',
    t: 'Kill switch and org caps',
    d: 'Pause an agent or freeze an account server-side, instantly and reversibly. Orgs get a daily cap above per-key budgets.',
    href: '/docs/spend-policy',
  },
  {
    g: 'rise',
    t: 'Built on routes that earned it',
    d: 'MCPs score on reliability, liveness, speed and settled history — so the set behind your chat isn’t a guess.',
    href: '/leaderboard',
  },
]

const USERS: Row[] = [
  {
    g: 'pen',
    t: 'Nothing moves without your signature',
    d: 'Pantessa holds no keys and never has. The wallet that pops is yours, and the transaction it shows is the one that gets sent.',
    href: '/docs',
  },
  {
    g: 'gate',
    t: 'Guardrails, re-fired per step',
    d: 'Recipient, amount, selector, price and caps re-checked before every step, on fresh state, at your turn. Over-cap gets dropped, not built.',
    href: '/docs/spend-policy',
  },
  {
    g: 'receipt',
    t: 'Receipts, in the open',
    d: 'Every settled move carries a tx hash and lands in a public activity feed. There’s no dashboard you have to take our word for.',
    href: '/activity',
  },
  {
    g: 'revoke',
    t: 'Standing work stays revocable',
    d: 'A schedule, a Spend Permission, a Guardian key — each scoped to one job, each cancellable from the chat or the dashboard.',
    href: '/dashboard/guardian',
  },
]

/** One-stroke marks on a 40×40 field. Each animates the claim it stands for
 *  rather than decorating it — the gate DEFLECTS, the pen SIGNS. */
function Mark({ g }: { g: Glyph }) {
  return (
    <span className={`tl__glyph tl__glyph--${g}`} aria-hidden>
      <svg viewBox="0 0 40 40">
        {g === 'gate' && (
          <>
            <path className="tl-route" d="M3 30 L16 25" />
            <line className="tl-bar" x1="22" y1="7" x2="22" y2="33" />
            <path className="tl-deflect" d="M16 25 L20 32 L15 37" />
            <circle className="tl-hot" cx="16" cy="25" r="2.6" />
          </>
        )}
        {g === 'receipt' && (
          <>
            <path className="tl-route" d="M3 32 L16 28 L27 12" />
            <circle className="tl-halo" cx="27" cy="12" r="8" />
            <circle className="tl-node" cx="27" cy="12" r="3.4" />
          </>
        )}
        {g === 'pause' && (
          <>
            <path className="tl-route" d="M3 28 L12 24" />
            <circle className="tl-ring" cx="21" cy="21" r="7.5" />
            <line className="tl-pip" x1="19" y1="18" x2="19" y2="24" />
            <line className="tl-pip" x1="23" y1="18" x2="23" y2="24" />
            <path className="tl-after" d="M31 19 L37 17" />
          </>
        )}
        {g === 'rise' && (
          <>
            <path className="tl-route" d="M3 35 L13 31 L23 24 L33 9" />
            <circle className="tl-halo" cx="33" cy="9" r="8" />
            <circle className="tl-node" cx="33" cy="9" r="3.4" />
            <circle className="tl-riser" cx="23" cy="24" r="1.9" />
            <circle className="tl-riser" cx="13" cy="31" r="1.9" />
          </>
        )}
        {g === 'plug' && (
          <>
            <rect className="tl-frame" x="5" y="7" width="30" height="26" rx="4" />
            <line className="tl-scan" x1="5" y1="14" x2="35" y2="14" />
            <circle className="tl-node" cx="29" cy="27" r="4" />
          </>
        )}
        {g === 'chart' && (
          <>
            <line className="tl-axis" x1="6" y1="33" x2="35" y2="33" />
            <rect className="tl-bar1" x="9" y="22" width="5" height="11" rx="1.5" />
            <rect className="tl-bar2" x="18" y="15" width="5" height="18" rx="1.5" />
            <rect className="tl-bar3" x="27" y="26" width="5" height="7" rx="1.5" />
          </>
        )}
        {g === 'pen' && (
          <>
            <path className="tl-sig" d="M5 27 C11 13, 15 33, 21 22 S30 12, 35 20" />
            <line className="tl-baseline" x1="5" y1="32" x2="35" y2="32" />
          </>
        )}
        {g === 'revoke' && (
          <>
            <circle className="tl-ring" cx="16" cy="20" r="7" />
            <line className="tl-shaft" x1="22" y1="20" x2="36" y2="20" />
            <line className="tl-cut" x1="9" y1="31" x2="31" y2="9" />
          </>
        )}
      </svg>
    </span>
  )
}

function Lane({ who, lead, rows }: { who: string; lead: string; rows: Row[] }) {
  return (
    <div className="tl__lane">
      <div className="tl__lanehead">
        <span className="tl__who mono">{who}</span>
        <p className="tl__lead">{lead}</p>
      </div>
      <ul className="tl__rows">
        {rows.map((r) => (
          <li key={r.t}>
            <Link href={r.href} className="tl__row">
              <Mark g={r.g} />
              <span className="tl__body">
                <strong>{r.t}</strong>
                <span>{r.d}</span>
              </span>
              <span className="tl__go" aria-hidden>
                →
              </span>
            </Link>
          </li>
        ))}
      </ul>
    </div>
  )
}

export default function TrustStrip() {
  return (
    <section className="trust">
      <div className="trust__head">
        <span className="trust__eyebrow mono">THE TRUST LAYER</span>
        <h2 className="trust__h2">
          Why hosts embed it. Why users <span className="x-grad">sign.</span>
        </h2>
        <p className="trust__sub">
          Two different people, two different worries. A host is deciding whether to put this on
          their page; a visitor is deciding whether to sign something a machine built. Both
          answers are the same architecture, read from opposite ends.
        </p>
      </div>

      <div className="tl">
        <Lane
          who="IF YOU RUN THE SITE"
          lead="An agent that moves money for your users, without you ever touching a key."
          rows={HOSTS}
        />
        <Lane
          who="IF YOU’RE THE ONE SIGNING"
          lead="A machine that has to prove every step to you before you approve it."
          rows={USERS}
        />
      </div>

      <p className="tl__foot mono">
        Non-custodial by construction · your wallet signs · every move receipted
      </p>
    </section>
  )
}
