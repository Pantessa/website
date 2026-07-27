// Generated cover art for blog posts that ship without a real cover image.
// Server-rendered inline SVG (no client JS, crawlable, zero CLS): a routing
// network seeded by the post slug — same slug, same art, forever — so every
// post gets a unique-but-on-brand visual instead of a stock photo. The accent
// route "settles" (402 → 200) with CSS animations that x402-design.css gates
// behind prefers-reduced-motion.

interface Node {
  x: number
  y: number
  r: number
}

// Deterministic PRNG (mulberry32) seeded from the slug — Math.random() would
// re-roll the art on every request and break the "one post, one mark" idea.
function seedFrom(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function mulberry32(seed: number): () => number {
  let a = seed
  return () => {
    a |= 0
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const W = 640
const H = 400

// Every well that shows this art uses preserveAspectRatio="slice" at a
// DIFFERENT ratio — 2/1 post hero, 2.4/1 index cards, ~1.45/1 feature panel —
// so each one crops a different pair of edges. Anything that must survive all
// three (text above all) belongs inside this box; only decorative geometry
// should stray outside it.
const SAFE = { x0: 40, x1: 600, y0: 66, y1: 334 }

// Bespoke composition for the orchestration launch post: one intent-arrow
// skipping across the four job steps. Same canvas, same dot grid, same
// blogart__route / blogart__ping animations as the generated art — it reads
// as a sibling, not a different system.
function OrchestrationCover({ tag, className }: { tag?: string; className?: string }) {
  const steps = [
    { x: 130, label: 'BRIDGE' },
    { x: 270, label: 'SWAP' },
    { x: 410, label: 'LONG' },
    { x: 550, label: 'GUARD' },
  ]
  const baseY = 272 // circle centers
  const r = 30
  const touchY = baseY - r // the arrow grazes each circle's top
  // Quadratic bounces with decaying peaks — a stone skipping toward settled.
  const route =
    `M 28 64 Q 70 210 ${steps[0].x} ${touchY}` +
    ` Q ${(steps[0].x + steps[1].x) / 2} 96 ${steps[1].x} ${touchY}` +
    ` Q ${(steps[1].x + steps[2].x) / 2} 138 ${steps[2].x} ${touchY}` +
    ` Q ${(steps[2].x + steps[3].x) / 2} 172 ${steps[3].x} ${touchY}`
  const settle = steps[steps.length - 1]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="dots-orch" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="rgba(255,255,255,0.055)" />
        </pattern>
        <radialGradient id="glow-orch" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3ECF8E" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#3ECF8E" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#dots-orch)" />
      <circle cx={settle.x} cy={baseY} r="120" fill="url(#glow-orch)" />

      {/* faint baseline threading the steps together */}
      <line
        x1={steps[0].x}
        y1={baseY}
        x2={settle.x}
        y2={baseY}
        stroke="rgba(255,255,255,0.09)"
        strokeWidth="1"
      />

      {/* step circles the arrow bounces off */}
      {steps.map((s, i) => (
        <g key={s.label}>
          <circle
            cx={s.x}
            cy={baseY}
            r={r}
            fill="rgba(255,255,255,0.03)"
            stroke={i === steps.length - 1 ? '#3ECF8E' : 'rgba(255,255,255,0.28)'}
            strokeWidth="1.5"
          />
          {/* touch point — where the intent grazes the step */}
          <circle cx={s.x} cy={touchY} r="4.5" fill="#0f0f0f" stroke="#3ECF8E" strokeWidth="1.5" />
          <text
            x={s.x}
            y={baseY + r + 24}
            textAnchor="middle"
            fontFamily="'Geist Mono', ui-monospace, monospace"
            fontSize="11"
            letterSpacing="0.12em"
            fill="rgba(255,255,255,0.45)"
          >
            {s.label}
          </text>
        </g>
      ))}

      {/* the intent — one arrow, four bounces (CSS: blogart-flow) */}
      <path
        d={route}
        fill="none"
        stroke="#3ECF8E"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeDasharray="7 9"
        className="blogart__route"
        opacity="0.9"
      />
      {/* arrowhead at the last touch */}
      <path
        d={`M ${settle.x - 11} ${touchY - 13} L ${settle.x} ${touchY} L ${settle.x - 14} ${touchY - 4}`}
        fill="none"
        stroke="#3ECF8E"
        strokeWidth="1.6"
        strokeLinejoin="round"
        opacity="0.9"
      />

      {/* the settle: expanding ring + solid core on the final step */}
      <circle cx={settle.x} cy={baseY} r="6" fill="#3ECF8E" />
      <circle
        cx={settle.x}
        cy={baseY}
        r="6"
        fill="none"
        stroke="#3ECF8E"
        strokeWidth="1.5"
        className="blogart__ping"
      />

      {/* receipt stamp */}
      <text
        x={SAFE.x0}
        y={SAFE.y0 + 20}
        fontFamily="'Geist Mono', ui-monospace, monospace"
        fontSize="12.5"
        fill="#3ECF8E"
        opacity="0.95"
      >
        1 prompt → 4 receipts
      </text>
      {tag && (
        <text
          x={SAFE.x1}
          y={SAFE.y0 + 20}
          textAnchor="end"
          fontFamily="'Geist Mono', ui-monospace, monospace"
          fontSize="11"
          letterSpacing="0.12em"
          fill="rgba(255,255,255,0.38)"
        >
          {tag.toUpperCase()}
        </text>
      )}
    </svg>
  )
}

// Bespoke composition for the intent-links post: one sentence entering on the
// left, fanning into a batch of links, every one of them landing on the same
// settled receipt. Same canvas, same dot grid, same blogart__route /
// blogart__ping animations as everything else on /blog.
function LinksCover({ tag, className }: { tag?: string; className?: string }) {
  const originX = 74
  const originY = H / 2
  const fanX = 268 // where the batch of links stacks up
  // Pulled in from the right edge so the "signed" label lands inside SAFE.x1
  // on the feature panel, which crops the sides rather than the top.
  const settleX = 500
  const rows = [116, 158, 200, 242, 284]

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      <defs>
        <pattern id="dots-links" width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="rgba(255,255,255,0.055)" />
        </pattern>
        <radialGradient id="glow-links" cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3ECF8E" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#3ECF8E" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill="url(#dots-links)" />
      <circle cx={settleX} cy={originY} r="130" fill="url(#glow-links)" />

      {/* the intent — one sentence, entering */}
      <text
        x={SAFE.x0}
        y={SAFE.y0 + 20}
        fontFamily="'Geist Mono', ui-monospace, monospace"
        fontSize="12.5"
        fill="#3ECF8E"
        opacity="0.95"
      >
        one intent → many links → one receipt
      </text>
      <circle cx={originX} cy={originY} r="7" fill="#3ECF8E" />
      <circle cx={originX} cy={originY} r="7" fill="none" stroke="#3ECF8E" strokeWidth="1.5" className="blogart__ping" />

      {/* the batch: each link its own route, all from the same sentence */}
      {rows.map((y, i) => (
        <g key={y}>
          <path
            d={`M ${originX} ${originY} C ${originX + 90} ${originY}, ${fanX - 74} ${y}, ${fanX} ${y}`}
            fill="none"
            stroke="rgba(255,255,255,0.16)"
            strokeWidth="1"
          />
          {/* the link itself — a small pill, the shape it wears in product */}
          <rect
            x={fanX}
            y={y - 11}
            width={92 + (i % 3) * 22}
            height={22}
            rx={11}
            fill="rgba(255,255,255,0.03)"
            stroke={i === 2 ? '#3ECF8E' : 'rgba(255,255,255,0.28)'}
            strokeWidth="1.2"
          />
          {/* a sentence inside the pill — the link's whole payload, at
              thumbnail scale where real type would be mud */}
          <line
            x1={fanX + 13}
            y1={y}
            x2={fanX + 92 + (i % 3) * 22 - 15}
            y2={y}
            stroke={i === 2 ? 'rgba(62,207,142,0.5)' : 'rgba(255,255,255,0.22)'}
            strokeWidth="2.5"
            strokeLinecap="round"
          />
          <path
            d={`M ${fanX + 92 + (i % 3) * 22} ${y} C ${fanX + 190} ${y}, ${settleX - 110} ${originY}, ${settleX} ${originY}`}
            fill="none"
            stroke="#3ECF8E"
            strokeWidth="1.5"
            strokeDasharray="7 9"
            className="blogart__route"
            opacity={i === 2 ? 0.95 : 0.42}
          />
        </g>
      ))}

      {/* the settle — every link ends at a signature that isn't ours */}
      <circle cx={settleX} cy={originY} r="7" fill="#3ECF8E" />
      <circle
        cx={settleX}
        cy={originY}
        r="7"
        fill="none"
        stroke="#3ECF8E"
        strokeWidth="1.5"
        className="blogart__ping"
      />
      <text
        x={settleX + 20}
        y={originY + 5}
        fontFamily="'Geist Mono', ui-monospace, monospace"
        fontSize="12"
        fill="#3ECF8E"
        opacity="0.95"
      >
        signed
      </text>
      {tag && (
        <text
          x={SAFE.x1}
          y={SAFE.y0 + 20}
          textAnchor="end"
          fontFamily="'Geist Mono', ui-monospace, monospace"
          fontSize="11"
          letterSpacing="0.12em"
          fill="rgba(255,255,255,0.38)"
        >
          {tag.toUpperCase()}
        </text>
      )}
    </svg>
  )
}

export default function BlogCoverArt({
  slug,
  tag,
  className,
}: {
  slug: string
  tag?: string
  className?: string
}) {
  if (slug === 'one-sentence-four-transactions') {
    return <OrchestrationCover tag={tag} className={className} />
  }
  if (slug === 'onboarding-is-a-link-problem') {
    return <LinksCover tag={tag} className={className} />
  }
  const rand = mulberry32(seedFrom(slug))

  // Node field: one node per loose grid cell with jitter, so layouts differ
  // per post but never clump or fall off the canvas.
  const cols = 5
  const rows = 3
  const nodes: Node[] = []
  for (let c = 0; c < cols; c++) {
    for (let r = 0; r < rows; r++) {
      if (rand() < 0.22) continue
      nodes.push({
        x: SAFE.x0 + 36 + (c * (SAFE.x1 - SAFE.x0 - 72)) / (cols - 1) + (rand() - 0.5) * 48,
        y: SAFE.y0 + 24 + (r * (SAFE.y1 - SAFE.y0 - 48)) / (rows - 1) + (rand() - 0.5) * 36,
        r: 2.5 + rand() * 2.5,
      })
    }
  }

  // Faint mesh: connect each node to its nearest neighbor to the right.
  const mesh: Array<[Node, Node]> = []
  for (const n of nodes) {
    const right = nodes
      .filter((m) => m.x > n.x + 20)
      .sort((a, b) => Math.hypot(a.x - n.x, a.y - n.y) - Math.hypot(b.x - n.x, b.y - n.y))[0]
    if (right) mesh.push([n, right])
  }

  // The accent route: 4 hops left → right, ending at the settle node.
  const sorted = [...nodes].sort((a, b) => a.x - b.x)
  const hops: Node[] = []
  const bands = 4
  for (let i = 0; i < bands; i++) {
    const band = sorted.filter(
      (n) => n.x >= (i * W) / bands - 40 && n.x < ((i + 1) * W) / bands + 40,
    )
    if (band.length) hops.push(band[Math.floor(rand() * band.length)])
  }
  const settle = hops[hops.length - 1]
  const route = hops.map((n, i) => `${i === 0 ? 'M' : 'L'}${n.x.toFixed(1)} ${n.y.toFixed(1)}`).join(' ')

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className={className}
      role="img"
      aria-hidden="true"
      preserveAspectRatio="xMidYMid slice"
    >
      {/* dot grid backdrop */}
      <defs>
        <pattern id={`dots-${slug}`} width="28" height="28" patternUnits="userSpaceOnUse">
          <circle cx="1.5" cy="1.5" r="1.1" fill="rgba(255,255,255,0.055)" />
        </pattern>
        <radialGradient id={`glow-${slug}`} cx="50%" cy="50%" r="50%">
          <stop offset="0%" stopColor="#3ECF8E" stopOpacity="0.14" />
          <stop offset="100%" stopColor="#3ECF8E" stopOpacity="0" />
        </radialGradient>
      </defs>
      <rect width={W} height={H} fill={`url(#dots-${slug})`} />
      {settle && <circle cx={settle.x} cy={settle.y} r="120" fill={`url(#glow-${slug})`} />}

      {/* faint mesh */}
      {mesh.map(([a, b], i) => (
        <line
          key={i}
          x1={a.x}
          y1={a.y}
          x2={b.x}
          y2={b.y}
          stroke="rgba(255,255,255,0.09)"
          strokeWidth="1"
        />
      ))}

      {/* the paid route — dashes flow along it (CSS: blogart-flow) */}
      <path
        d={route}
        fill="none"
        stroke="#3ECF8E"
        strokeWidth="1.6"
        strokeLinejoin="round"
        strokeDasharray="7 9"
        className="blogart__route"
        opacity="0.9"
      />

      {/* nodes */}
      {nodes.map((n, i) => (
        <circle key={i} cx={n.x} cy={n.y} r={n.r} fill="rgba(255,255,255,0.4)" />
      ))}
      {hops.map((n, i) => (
        <circle key={`h${i}`} cx={n.x} cy={n.y} r={4.5} fill="#0f0f0f" stroke="#3ECF8E" strokeWidth="1.5" />
      ))}

      {/* the settle: expanding ring + solid core (CSS: blogart-ping) */}
      {settle && (
        <>
          <circle cx={settle.x} cy={settle.y} r="6" fill="#3ECF8E" />
          <circle
            cx={settle.x}
            cy={settle.y}
            r="6"
            fill="none"
            stroke="#3ECF8E"
            strokeWidth="1.5"
            className="blogart__ping"
          />
        </>
      )}

      {/* receipt stamp — mono, the "real product" signal */}
      {settle && (
        <text
          x={Math.min(settle.x + 16, W - 120)}
          // Never ride up into the tag's line: a settle node in the top band
          // put "402 → 200" straight through the tag on the right.
          y={Math.max(settle.y - 14, SAFE.y0 + 44)}
          fontFamily="'Geist Mono', ui-monospace, monospace"
          fontSize="12.5"
          fill="#3ECF8E"
          opacity="0.95"
        >
          402 → 200
        </text>
      )}
      {tag && (
        <text
          x={SAFE.x1}
          y={SAFE.y0 + 20}
          textAnchor="end"
          fontFamily="'Geist Mono', ui-monospace, monospace"
          fontSize="11"
          letterSpacing="0.12em"
          fill="rgba(255,255,255,0.38)"
        >
          {tag.toUpperCase()}
        </text>
      )}
    </svg>
  )
}
