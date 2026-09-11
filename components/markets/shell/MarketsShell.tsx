import AppSpine from '@/components/AppSpine'

// The markets shell (2026-09-11, Nate: "add the sidebar we have in the app
// on the left in market and asset view and remove the header nav") — the
// app's spine stands beside the /markets frame the way it stands beside the
// chat and the dashboard, and IS the navigation here: the brochure nav
// returns null on every markets path (Navigation → isMarketsPath), and the
// nav's Ask button + account control dock in the frame's side column
// (MarketsTopStrip). Same shape as .dashshell: a flex row, the spine sticky
// and viewport-tall, the frame taking the rest. Below lg the spine is the
// fixed bottom tab bar and the shell reserves its height.
export default function MarketsShell({ sym = false, children }: { sym?: boolean; children: React.ReactNode }) {
  return (
    <div className="mkt-shell">
      <AppSpine surface="markets" />
      <div className={sym ? 'mkt-frame mkt-frame--sym' : 'mkt-frame'}>{children}</div>
    </div>
  )
}
