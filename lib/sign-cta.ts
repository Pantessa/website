// The ONE class for "the thing to press" on a built card — the current
// step's sign/send button. Accent pill, both themes (`.text-black` is
// remapped to var(--bg) in light by x402-design.css). Every other control on
// the card stays quiet (ghost/mono chips) so the eye lands here first
// (Visuals' H1 storyboard: "Sign & send approve" was the least prominent
// element on the page). Shared by SendTxButton (→ SendTxChain),
// SignOrderButton, SignHlActionButton.
export const SIGN_CTA_CLASS =
  'inline-flex items-center gap-1.5 text-[13px] font-semibold px-4 py-2 max-lg:min-h-10 rounded-full bg-[var(--accent)] text-black hover:opacity-90 disabled:opacity-60 transition-opacity'
