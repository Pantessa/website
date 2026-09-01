// ManagerMark — the manager avatar for storefront rows and the hire moment
// (FIRST HIRE sprint, visuals lane). Two species, one silhouette:
//
//   house    — the pangolin (PantessaMark) on a soft accent tile: the house
//              Rebalancer wears the house mark, unmistakably ours.
//   external — a hash-derived tessera identicon: the agent's 16-hex PUBLIC
//              handle (sha256(agent_key)[:16] — never a raw key) becomes a
//              col-mirrored 4×4 tile grid. Deterministic, so the same agent
//              looks the same everywhere; token-inked, so both themes are
//              free; pure SVG, no client JS, nothing to reduce for
//              reduced-motion.
//
// identiconCells is exported pure for the harness pin.

import { PantessaMark } from '@/components/Logo'

export type IdenticonCell = { x: number; y: number; strong: boolean }

/** The 4×4 col-mirrored tessera grid for a 16-hex handle. Cols 0–1 come from
 *  the first 8 nibbles (on when nibble ≥ 6 — ~62% fill), cols 3–2 mirror
 *  them; the second 8 nibbles pick strong vs faint ink. A handle that would
 *  render empty gets its center tiles lit — every manager has a face. */
export function identiconCells(handle: string): IdenticonCell[] {
  const hex = /^[0-9a-f]{16}$/.test(handle) ? handle : '0000000000000000'
  const nib = (i: number) => parseInt(hex[i], 16)
  const cells: IdenticonCell[] = []
  for (let y = 0; y < 4; y++) {
    for (let half = 0; half < 2; half++) {
      const i = y * 2 + half
      if (nib(i) >= 6) {
        const strong = nib(8 + i) >= 8
        cells.push({ x: half, y, strong })
        cells.push({ x: 3 - half, y, strong })
      }
    }
  }
  if (cells.length === 0) {
    cells.push({ x: 1, y: 1, strong: true }, { x: 2, y: 1, strong: true }, { x: 1, y: 2, strong: false }, { x: 2, y: 2, strong: false })
  }
  return cells
}

export default function ManagerMark({
  handle,
  house = false,
  size = 40,
}: {
  /** The agent's public 16-hex handle (ignored for the house mark). */
  handle?: string | null
  /** The house manager wears the pangolin. */
  house?: boolean
  size?: number
}) {
  if (house) {
    return (
      <span
        aria-hidden
        className="inline-flex flex-none items-center justify-center rounded-xl border"
        style={{
          width: size,
          height: size,
          borderColor: 'color-mix(in oklab, var(--accent) 40%, var(--line))',
          background: 'color-mix(in oklab, var(--accent) 12%, var(--surf-1))',
          color: 'var(--fg)',
        }}
      >
        <PantessaMark size={Math.round(size * 0.66)} />
      </span>
    )
  }

  const cells = identiconCells((handle ?? '').toLowerCase())
  const pad = 3
  const grid = 16 // 4 tiles × 4 units
  const tile = 3.4 // tile size inside its 4-unit cell (grout between)
  return (
    <span
      aria-hidden
      className="inline-flex flex-none items-center justify-center rounded-xl border border-[var(--line)]"
      style={{ width: size, height: size, background: 'var(--surf-1)' }}
    >
      <svg
        width={Math.round(size * 0.62)}
        height={Math.round(size * 0.62)}
        viewBox={`0 0 ${grid + pad * 2} ${grid + pad * 2}`}
      >
        {cells.map((c) => (
          <rect
            key={`${c.x}-${c.y}`}
            x={pad + c.x * 4 + (4 - tile) / 2}
            y={pad + c.y * 4 + (4 - tile) / 2}
            width={tile}
            height={tile}
            rx={0.9}
            fill="var(--accent)"
            opacity={c.strong ? 0.95 : 0.45}
          />
        ))}
      </svg>
    </span>
  )
}
