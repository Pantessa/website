// Server-rendered diagrams for blog posts. Same contract as BlogChart: the
// blog renders markdown with raw HTML escaped (the XSS line), so a post can't
// embed SVG directly. Instead a fenced ```figure block carries a tiny JSON
// spec naming one of the compositions below, and this renders it as inline
// SVG — no client JS, crawlable, zero CLS, and safe (the spec is parsed and
// dispatched, never injected).
//
// Spec: { "name": "link-batch", "title": "…", "caption": "…" }
//
// Ink comes from classes (blogfig__*) wired to the theme tokens in
// x402-design.css, so every figure reads correctly in light AND dark without
// per-figure overrides. Motion reuses the cover-art keyframes (blogart__route
// / blogart__ping), which x402-design.css already gates behind
// prefers-reduced-motion.

interface FigureSpec {
  name: string
  title?: string
  caption?: string
}

const W = 680

function parse(raw: string): FigureSpec | null {
  try {
    const spec = JSON.parse(raw) as FigureSpec
    return spec && typeof spec.name === 'string' ? spec : null
  } catch {
    return null
  }
}

const MONO = "'Geist Mono', ui-monospace, monospace"
const SANS = "'Archivo', sans-serif"

/** Rounded "chip" holding an ask — the shape a link wears everywhere in the
 *  product (house-link chips, storefront rows, host buttons). */
function AskChip({
  x,
  y,
  w,
  h = 34,
  label,
  accent = false,
}: {
  x: number
  y: number
  w: number
  h?: number
  label: string
  accent?: boolean
}) {
  return (
    <g>
      <rect
        x={x}
        y={y}
        width={w}
        height={h}
        rx={h / 2}
        className={accent ? 'blogfig__chip blogfig__chip--accent' : 'blogfig__chip'}
      />
      <text
        x={x + 16}
        y={y + h / 2 + 4}
        fontFamily={SANS}
        fontSize="12.5"
        className={accent ? 'blogfig__t-accent' : 'blogfig__t'}
      >
        {label}
      </text>
    </g>
  )
}

// ── 1. The wall ────────────────────────────────────────────────────────────
// The onboarding funnel everyone actually ships (top) against the one an
// intent link ships (bottom). The point of the drawing is the gap count.
function OnboardingWall() {
  const H = 300
  const usual = ['Click', 'Install wallet', 'Seed phrase', 'Fund it', 'Bridge', 'Gas', 'Slippage', 'Act']
  const ours = ['Tap the link', 'Connect', 'Sign']
  const topY = 96
  const botY = 232
  const startX = 34
  const spanX = W - 68

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="blogfig__svg" aria-label="Eight-step onboarding funnel versus a three-step intent link">
      <text x={startX} y={34} fontFamily={MONO} fontSize="11" letterSpacing="0.14em" className="blogfig__t-dim">
        THE USUAL PATH — EIGHT DECISIONS BEFORE ANY VALUE
      </text>
      <line x1={startX} y1={topY} x2={W - startX} y2={topY} className="blogfig__rule" />
      {usual.map((label, i) => {
        const x = startX + (spanX * i) / (usual.length - 1)
        // Attrition made literal: each node is dimmer and smaller than the last.
        const fade = Math.max(0.16, 1 - i * 0.13)
        return (
          <g key={label}>
            <circle cx={x} cy={topY} r={Math.max(2.6, 6 - i * 0.42)} className="blogfig__f" opacity={fade} />
            <text
              x={x}
              y={topY - 16}
              textAnchor={i === 0 ? 'start' : i === usual.length - 1 ? 'end' : 'middle'}
              fontFamily={SANS}
              fontSize="11"
              className="blogfig__t-dim"
              opacity={Math.max(0.3, fade)}
            >
              {label}
            </text>
          </g>
        )
      })}
      {/* the wall — where the measured drop-off happens. Sits BETWEEN nodes
          2 and 3 so it never cuts through a label. */}
      <line
        x1={startX + spanX * 0.215}
        y1={topY - 40}
        x2={startX + spanX * 0.215}
        y2={topY + 30}
        className="blogfig__wall"
      />
      <text
        x={startX + spanX * 0.215 + 10}
        y={topY + 28}
        fontFamily={MONO}
        fontSize="11"
        className="blogfig__t-warn"
      >
        68% stop here
      </text>

      <text x={startX} y={botY - 62} fontFamily={MONO} fontSize="11" letterSpacing="0.14em" className="blogfig__t-accent">
        AN INTENT LINK — ONE DECISION, MADE ONCE
      </text>
      <line x1={startX} y1={botY} x2={W - startX} y2={botY} className="blogfig__rule-accent" />
      {ours.map((label, i) => {
        const x = startX + (spanX * i) / (ours.length - 1)
        return (
          <g key={label}>
            <circle cx={x} cy={botY} r="6" className="blogfig__f-accent" />
            <text
              x={x}
              y={botY - 18}
              textAnchor={i === 0 ? 'start' : i === ours.length - 1 ? 'end' : 'middle'}
              fontFamily={SANS}
              fontSize="12.5"
              className="blogfig__t"
            >
              {label}
            </text>
          </g>
        )
      })}
      {/* the packet that actually completes the trip */}
      <line
        x1={startX}
        y1={botY}
        x2={W - startX}
        y2={botY}
        className="blogfig__route blogart__route"
        strokeDasharray="7 9"
      />
      <circle cx={W - startX} cy={botY} r="6" className="blogfig__f-accent" />
      <circle cx={W - startX} cy={botY} r="6" className="blogfig__ping blogart__ping" />
      <text x={W - startX} y={botY + 30} textAnchor="end" fontFamily={MONO} fontSize="11" className="blogfig__t-dim">
        everything between is ours to do
      </text>
    </svg>
  )
}

// ── 2. Anatomy ─────────────────────────────────────────────────────────────
// What is actually inside a link (a sentence) versus what the runtime rebuilds
// on the other side. The "never in the link" column is the security claim.
function LinkAnatomy() {
  const H = 330
  const steps = [
    'Scan their wallet — every chain',
    'Plan the funding if they are short',
    'Build the calldata, deterministically',
    'Guard it — fail closed, refuse before signing',
    'Their wallet signs. Receipt.',
  ]
  const never = ['calldata', 'addresses', 'artifacts', 'keys']

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="blogfig__svg" aria-label="An intent link carries a sentence; the runtime rebuilds the transaction">
      {/* the URL bar */}
      <rect x={30} y={26} width={W - 60} height={46} rx={10} className="blogfig__panel" />
      <text x={48} y={54} fontFamily={MONO} fontSize="14" className="blogfig__t-dim">
        pantessa.com/i/
        <tspan className="blogfig__t-accent">buy-aapl</tspan>
      </text>
      <text x={W - 48} y={54} textAnchor="end" fontFamily={MONO} fontSize="11" className="blogfig__t-dim">
        THE WHOLE PAYLOAD ↓
      </text>

      {/* the sentence it carries */}
      <AskChip x={30} y={92} w={250} label="&ldquo;Buy $10 of AAPL&rdquo;" accent />
      <text x={296} y={114} fontFamily={SANS} fontSize="12.5" className="blogfig__t-dim">
        A sentence. That is the entire link.
      </text>

      {/* never-in-the-link column */}
      {never.map((n, i) => (
        <g key={n}>
          <text x={296} y={140 + i * 19} fontFamily={MONO} fontSize="11.5" className="blogfig__t-strike">
            {n}
          </text>
          <line
            x1={292}
            y1={136 + i * 19}
            x2={296 + n.length * 6.6}
            y2={136 + i * 19}
            className="blogfig__strike"
          />
        </g>
      ))}
      <text x={296} y={140 + never.length * 19 + 4} fontFamily={MONO} fontSize="10.5" letterSpacing="0.1em" className="blogfig__t-dim">
        NEVER IN THE LINK
      </text>

      {/* the rebuild ladder */}
      <line x1={44} y1={150} x2={44} y2={150 + (steps.length - 1) * 32} className="blogfig__rule-accent" />
      {steps.map((s, i) => {
        const y = 150 + i * 32
        const last = i === steps.length - 1
        return (
          <g key={s}>
            <circle cx={44} cy={y} r={last ? 6 : 4} className={last ? 'blogfig__f-accent' : 'blogfig__f'} />
            {last && <circle cx={44} cy={y} r="6" className="blogfig__ping blogart__ping" />}
            <text x={62} y={y + 4} fontFamily={SANS} fontSize="12.5" className={last ? 'blogfig__t' : 'blogfig__t-dim'}>
              {s}
            </text>
          </g>
        )
      })}
    </svg>
  )
}

// ── 3. The batch ───────────────────────────────────────────────────────────
// Many links, one engine. A creator page (or a site's buttons, or a campaign)
// is just a batch of asks — each one its own funnel, all of them rebuilt by
// the same guarded layer.
function LinkBatch() {
  const H = 340
  const asks = [
    'Buy $10 of AAPL',
    'DCA $25 into ETH weekly',
    'Stake 0.05 ETH with Lido',
    'Swap 5 USDC to Arbitrum',
    'Show my NFTs',
  ]
  const cardX = 26
  const cardW = 286
  const rowH = 40
  const top = 74
  const hubX = 470
  const hubY = top + (asks.length * rowH) / 2 - rowH / 2

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="blogfig__svg" aria-label="A batch of intent links on one page, all rebuilt by the same guarded layer">
      <text x={cardX} y={32} fontFamily={MONO} fontSize="11" letterSpacing="0.14em" className="blogfig__t-dim">
        ONE PAGE · ONE PASTE · ONE CAMPAIGN
      </text>

      {/* the batch, as a page of links */}
      <rect x={cardX} y={top - 22} width={cardW} height={asks.length * rowH + 22} rx={14} className="blogfig__panel" />
      {asks.map((ask, i) => {
        const y = top + i * rowH
        return (
          <g key={ask}>
            {i > 0 && <line x1={cardX + 14} y1={y - 12} x2={cardX + cardW - 14} y2={y - 12} className="blogfig__rule" />}
            <text x={cardX + 18} y={y + 8} fontFamily={SANS} fontSize="12.5" className="blogfig__t">
              &ldquo;{ask}&rdquo;
            </text>
            {/* every link carries its own funnel */}
            <text x={cardX + cardW - 18} y={y + 8} textAnchor="end" fontFamily={MONO} fontSize="10.5" className="blogfig__t-dim">
              /i/…
            </text>
            {/* fan-in to the shared engine */}
            <path
              d={`M ${cardX + cardW} ${y + 3} C ${cardX + cardW + 70} ${y + 3}, ${hubX - 80} ${hubY}, ${hubX - 34} ${hubY}`}
              className="blogfig__route blogart__route"
              strokeDasharray="7 9"
              fill="none"
            />
          </g>
        )
      })}

      {/* the shared guarded engine */}
      <circle cx={hubX} cy={hubY} r={34} className="blogfig__hub" />
      <text x={hubX} y={hubY - 2} textAnchor="middle" fontFamily={MONO} fontSize="10.5" className="blogfig__t-accent">
        ONE
      </text>
      <text x={hubX} y={hubY + 12} textAnchor="middle" fontFamily={MONO} fontSize="10.5" className="blogfig__t-accent">
        ENGINE
      </text>

      {/* out the other side. The ping rides the outgoing packet, not the hub —
          a ring centred on the hub expands straight through its label. */}
      <line x1={hubX + 34} y1={hubY} x2={W - 158} y2={hubY} className="blogfig__rule-accent" />
      <circle cx={hubX + 52} cy={hubY} r={4.5} className="blogfig__f-accent" />
      <circle cx={hubX + 52} cy={hubY} r={4.5} className="blogfig__ping blogart__ping" />
      <AskChip x={W - 158} y={hubY - 17} w={140} label="Their wallet signs" accent />
      <text x={W - 158} y={hubY + 40} fontFamily={MONO} fontSize="10.5" className="blogfig__t-dim">
        never yours
      </text>

      <text x={cardX} y={H - 16} fontFamily={MONO} fontSize="10.5" className="blogfig__t-dim">
        Five asks. Five funnels. Zero integrations — the batch is just sentences.
      </text>
    </svg>
  )
}

// ── 4. The funnel ──────────────────────────────────────────────────────────
// What a creator sees per link. Open → connect → build → signed, server-truth.
function LinkFunnel() {
  const H = 272
  const stages = [
    { label: 'OPENED', v: '1,000', w: 1 },
    { label: 'CONNECTED', v: '520', w: 0.52 },
    { label: 'BUILT', v: '410', w: 0.41 },
    { label: 'SIGNED', v: '316', w: 0.316 },
  ]
  const x0 = 34
  const maxW = W - 190
  const top = 60
  const barH = 30
  const gap = 16

  return (
    <svg viewBox={`0 0 ${W} ${H}`} width="100%" role="img" className="blogfig__svg" aria-label="Per-link funnel: opened, connected, built, signed">
      <text x={x0} y={32} fontFamily={MONO} fontSize="11" letterSpacing="0.14em" className="blogfig__t-dim">
        WHAT EVERY LINK REPORTS BACK — SERVER TRUTH, PER LINK
      </text>
      {stages.map((s, i) => {
        const y = top + i * (barH + gap)
        const last = i === stages.length - 1
        return (
          <g key={s.label}>
            <rect
              x={x0}
              y={y}
              width={maxW * s.w}
              height={barH}
              rx={8}
              className={last ? 'blogfig__bar blogfig__bar--accent' : 'blogfig__bar'}
            />
            <text x={x0 + 14} y={y + barH / 2 + 4} fontFamily={MONO} fontSize="11" letterSpacing="0.1em" className={last ? 'blogfig__t-accent' : 'blogfig__t'}>
              {s.label}
            </text>
            <text x={x0 + maxW * s.w + 14} y={y + barH / 2 + 4} fontFamily={MONO} fontSize="13" className={last ? 'blogfig__t-accent' : 'blogfig__t-dim'}>
              {s.v}
            </text>
          </g>
        )
      })}
      <text x={x0} y={H - 14} fontFamily={MONO} fontSize="10.5" className="blogfig__t-dim">
        Illustrative shape. Signed is counted from receipts, never from the browser.
      </text>
    </svg>
  )
}

const FIGURES: Record<string, () => React.ReactElement> = {
  'onboarding-wall': OnboardingWall,
  'link-anatomy': LinkAnatomy,
  'link-batch': LinkBatch,
  'link-funnel': LinkFunnel,
}

export default function BlogFigure({ raw }: { raw: string }) {
  const spec = parse(raw)
  if (!spec) return null
  const Composition = FIGURES[spec.name]
  if (!Composition) return null // unknown name renders nothing, never a crash
  return (
    <figure className="blog__figure">
      {spec.title && <figcaption className="blog__figure-title">{spec.title}</figcaption>}
      <Composition />
      {spec.caption && <figcaption className="blog__figure-cap">{spec.caption}</figcaption>}
    </figure>
  )
}
