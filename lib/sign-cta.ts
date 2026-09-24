// The ONE class for "the thing to press" on a built card — the current
// step's sign/send button. Accent pill, both themes (`.text-black` is
// remapped to var(--bg) in light by x402-design.css). Every other control on
// the card stays quiet (ghost/mono chips) so the eye lands here first
// (Visuals' H1 storyboard: "Sign & send approve" was the least prominent
// element on the page). Shared by SendTxButton (→ SendTxChain),
// SignOrderButton, SignHlActionButton.
//
// On a phone (squad mobile-native, 2026-09-24): below sm it is the row's
// full width, 48px tall with a rounded-rect shape (the native primary
// button), and a long step label ("Sign step 1 of 2 — Approve USDC") wraps
// centered instead of pushing the card wider; sm→lg keeps the pill at 44px.
// Layout only: what a tap does is the sign card's own business.
export const SIGN_CTA_CLASS =
  'inline-flex items-center justify-center gap-1.5 text-[13px] font-semibold px-4 py-2 max-lg:min-h-11 max-sm:w-full max-sm:min-h-12 max-sm:rounded-xl max-sm:leading-tight max-sm:text-center rounded-full bg-[var(--accent)] text-black hover:opacity-90 disabled:opacity-60 transition-opacity'
