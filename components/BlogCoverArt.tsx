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

export default function BlogCoverArt({
  slug,
  tag,
  className,
}: {
  slug: string
  tag?: string
  className?: string
}) {
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
        x: 60 + (c * (W - 120)) / (cols - 1) + (rand() - 0.5) * 56,
        y: 70 + (r * (H - 150)) / (rows - 1) + (rand() - 0.5) * 44,
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
          y={settle.y - 14}
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
          x="24"
          y={H - 22}
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
