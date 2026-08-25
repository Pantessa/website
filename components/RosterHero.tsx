// RosterHero — the Roster front-door concept (HANDOFF-roster R6, visual
// half): "Your wallet gets a staff. You keep the only pen." The staff is four
// mandate cards; a proposal card animates off the roster and LANDS in a money
// inbox mock, where the only live control is the sign pill — the whole pitch
// in one loop. ChatLoader discipline: pure CSS (no client JS — paints before
// hydration), theme tokens only (both themes free), prefers-reduced-motion
// renders the static landed composition. Standalone: mounted on the gated
// /roster preview page — NOT on the live landing until Nate flips it.

const STAFF: { name: string; mandate: string; proposing?: boolean }[] = [
  { name: 'Rebalancer', mandate: '“keep me 60/40 ETH/USDC”', proposing: true },
  { name: 'DCA', mandate: '“$25 into ETH weekly”' },
  { name: 'Protector', mandate: '“protect my bags, 10% floor”' },
  { name: 'Yield', mandate: '“stable yield, boring only”' },
]

export default function RosterHero() {
  return (
    <section className="rhero" aria-label="Your wallet gets a staff. You keep the only pen.">
      <div className="rhero__copy">
        <p className="rhero__eyebrow mono">
          <span className="rhero__dot" aria-hidden />
          THE ROSTER
        </p>
        <h1 className="rhero__title">
          Your wallet gets a staff.
          <br />
          <em>You keep the only pen.</em>
        </h1>
        <p className="rhero__sub">
          Hire AI agents into mandate slots — rebalance, DCA, protection, yield. They compete on
          public track records and they can only <strong>propose</strong>: every move lands in your
          inbox as a guarded, signable card. Hiring is a signature. Firing is instant, and there is
          nothing to withdraw.
        </p>
        <div className="rhero__chips" aria-hidden>
          {['Non-custodial', 'Guarded builds', 'Fire in one tap'].map((c) => (
            <span key={c} className="rhero__chip mono">
              <span className="rhero__dot" />
              {c}
            </span>
          ))}
        </div>
      </div>

      <div className="rhero__stage" aria-hidden>
        {/* the staff — four hired mandate slots */}
        <div className="rhero__staff">
          {STAFF.map((s) => (
            <div key={s.name} className={`rhero__slot${s.proposing ? ' rhero__slot--live' : ''}`}>
              <div className="rhero__slotHead">
                <span className="rhero__slotName">{s.name}</span>
                <span className={`rhero__status${s.proposing ? ' rhero__status--live' : ''}`} />
              </div>
              <div className="rhero__slotMandate mono">{s.mandate}</div>
            </div>
          ))}
        </div>

        {/* the money inbox — where proposals land */}
        <div className="rhero__inbox">
          <div className="rhero__inboxHead mono">YOUR MONEY INBOX</div>
          {/* the landing slot the animated proposal settles into */}
          <div className="rhero__slotTarget">
            <div className="rhero__proposal">
              <div className="rhero__propTop">
                <span className="rhero__propFrom mono">REBALANCER · SLOT 1</span>
                <span className="rhero__propVal mono">$41</span>
              </div>
              <div className="rhero__propBody">You drifted to 68/32 — here’s the two-leg fix.</div>
              <div className="rhero__propFoot">
                <span className="rhero__propMeta mono">2 legs · guard-checked</span>
                <span className="rhero__sign">Sign</span>
              </div>
            </div>
          </div>
          {/* older, already-answered rows */}
          <div className="rhero__row">
            <span className="rhero__rowText">
              <span className="rhero__rowFrom mono">DCA</span> Weekly $25 into ETH — filled.
            </span>
            <span className="rhero__rowState rhero__rowState--done mono">SIGNED</span>
          </div>
          <div className="rhero__row">
            <span className="rhero__rowText">
              <span className="rhero__rowFrom mono">YIELD</span> Park idle USDC at 4.1%.
            </span>
            <span className="rhero__rowState mono">DECLINED</span>
          </div>
          <div className="rhero__pen">Only your signature moves money.</div>
        </div>
      </div>

      <style>{`
        .rhero {
          display: grid;
          grid-template-columns: 1fr;
          gap: 40px;
          align-items: center;
          padding: 24px 0;
        }
        @media (min-width: 880px) {
          .rhero { grid-template-columns: minmax(0, 1.1fr) minmax(0, 1fr); gap: 56px; }
        }
        .rhero__eyebrow {
          display: flex; align-items: center; gap: 8px;
          font-size: 11px; letter-spacing: 0.25em; color: var(--muted);
        }
        .rhero__dot {
          width: 8px; height: 8px; border-radius: 999px; background: var(--accent);
          display: inline-block; flex: none;
        }
        .rhero__title {
          margin-top: 16px;
          font-family: var(--font-chat-display);
          font-weight: 560;
          font-size: clamp(34px, 5vw, 54px);
          line-height: 1.06;
          letter-spacing: -0.02em;
          color: var(--fg);
        }
        .rhero__title em { font-style: italic; color: var(--accent); }
        .rhero__sub {
          margin-top: 18px;
          max-width: 34em;
          font-family: var(--font-chat-body);
          font-size: 15px; line-height: 1.65; color: var(--muted);
        }
        .rhero__sub strong { color: var(--fg); font-weight: 600; }
        .rhero__chips { display: flex; flex-wrap: wrap; gap: 10px; margin-top: 22px; }
        .rhero__chip {
          display: inline-flex; align-items: center; gap: 8px;
          border: 1px solid var(--line); border-radius: 999px;
          padding: 7px 14px; font-size: 11px; letter-spacing: 0.08em;
          color: var(--fg); text-transform: uppercase;
        }

        /* ── the stage ─────────────────────────────────────────────── */
        .rhero__stage {
          display: flex; flex-direction: column; gap: 14px;
          max-width: 420px; width: 100%; margin: 0 auto;
        }
        .rhero__staff {
          display: grid; grid-template-columns: 1fr 1fr; gap: 10px;
        }
        .rhero__slot {
          border: 1px solid var(--line); border-radius: 14px;
          background: var(--surf-1); padding: 10px 12px;
        }
        .rhero__slot--live { border-color: color-mix(in oklab, var(--accent) 45%, var(--line)); }
        .rhero__slotHead { display: flex; align-items: center; justify-content: space-between; }
        .rhero__slotName { font-size: 13px; font-weight: 600; color: var(--fg); }
        .rhero__status {
          width: 7px; height: 7px; border-radius: 999px; background: var(--line-2);
        }
        .rhero__status--live {
          background: var(--accent);
          animation: rhero-pulse 2s ease-in-out infinite;
        }
        .rhero__slotMandate {
          margin-top: 5px; font-size: 10.5px; color: var(--muted);
          white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
        }

        .rhero__inbox {
          border: 1px solid var(--line); border-radius: 18px;
          background: var(--surf-1); padding: 14px;
          display: flex; flex-direction: column; gap: 10px;
        }
        .rhero__inboxHead { font-size: 10px; letter-spacing: 0.22em; color: var(--muted); }

        .rhero__slotTarget {
          border: 1px dashed var(--line-2); border-radius: 14px;
          min-height: 108px; position: relative;
        }
        .rhero__proposal {
          position: absolute; inset: 0;
          border: 1px solid color-mix(in oklab, var(--accent) 40%, var(--line));
          border-radius: 14px; background: var(--bg);
          padding: 11px 13px;
          display: flex; flex-direction: column; gap: 7px;
          /* base state = LANDED (what reduced-motion shows); animation replays the arrival */
          transform: translateY(0) scale(1); opacity: 1;
          animation: rhero-land 7s cubic-bezier(0.22, 1, 0.36, 1) infinite;
        }
        .rhero__propTop { display: flex; align-items: center; justify-content: space-between; }
        .rhero__propFrom { font-size: 9.5px; letter-spacing: 0.14em; color: var(--accent); }
        .rhero__propVal { font-size: 13px; font-weight: 600; color: var(--fg); }
        .rhero__propBody { font-size: 13.5px; line-height: 1.45; color: var(--fg); }
        .rhero__propFoot { display: flex; align-items: center; justify-content: space-between; }
        .rhero__propMeta { font-size: 10px; color: var(--muted); }
        .rhero__sign {
          border-radius: 999px; background: var(--accent); color: var(--bg);
          font-size: 12px; font-weight: 700; padding: 4px 16px;
        }

        .rhero__row {
          display: flex; align-items: center; justify-content: space-between; gap: 10px;
          border: 1px solid var(--line); border-radius: 12px;
          padding: 9px 12px; background: var(--bg);
        }
        .rhero__rowText { font-size: 12.5px; color: var(--muted); min-width: 0; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
        .rhero__rowFrom { font-size: 9.5px; letter-spacing: 0.12em; color: var(--fg); margin-right: 6px; }
        .rhero__rowState { font-size: 9.5px; letter-spacing: 0.14em; color: var(--muted); flex: none; }
        .rhero__rowState--done { color: var(--accent); }
        .rhero__pen { font-size: 11.5px; color: var(--muted); text-align: center; margin-top: 2px; }

        /* Arrival: drop in from the staff (above), overshoot, settle, hold, fade, repeat. */
        @keyframes rhero-land {
          0%   { opacity: 0; transform: translateY(-124px) scale(0.92); }
          6%   { opacity: 1; transform: translateY(-124px) scale(1); }
          26%  { opacity: 1; transform: translateY(6px) scale(1); }
          32%  { transform: translateY(-3px) scale(1); }
          38%  { transform: translateY(0) scale(1); }
          88%  { opacity: 1; transform: translateY(0) scale(1); }
          94%  { opacity: 0; transform: translateY(0) scale(0.98); }
          100% { opacity: 0; transform: translateY(-124px) scale(0.92); }
        }
        @keyframes rhero-pulse {
          0%, 100% { box-shadow: 0 0 0 0 color-mix(in oklab, var(--accent) 45%, transparent); }
          50% { box-shadow: 0 0 0 5px color-mix(in oklab, var(--accent) 0%, transparent); }
        }
        @media (prefers-reduced-motion: reduce) {
          .rhero__proposal, .rhero__status--live { animation: none; }
        }
      `}</style>
    </section>
  )
}
