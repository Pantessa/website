// Formatting for /policy-pool — pure, shared by the server page and the live
// client. Text never wears the data color: the kind's color rides a dot.

import type { PolicyPoolEventKind } from '@/lib/policy-pool/spec'

export type KindTone = 'go' | 'stop' | 'dune'

export const KIND_META: Record<PolicyPoolEventKind, { label: string; tone: KindTone }> = {
  guard_allowed: { label: 'Guard passed', tone: 'go' },
  guard_refused: { label: 'Guard refused', tone: 'stop' },
  attested: { label: 'Attested', tone: 'go' },
  handed_off: { label: 'Handed off', tone: 'go' },
  signed: { label: 'Signed', tone: 'go' },
  mined: { label: 'Mined', tone: 'go' },
  fill: { label: 'Fill', tone: 'go' },
  onchain_revert: { label: 'Reverted on-chain', tone: 'stop' },
  dune_seen: { label: 'Seen in Dune', tone: 'dune' },
}

export const explorerFor = (chainId: number): string => (chainId === 8453 ? 'https://basescan.org' : 'https://sepolia.basescan.org')
export const chainName = (chainId: number): string => (chainId === 8453 ? 'Base' : chainId === 84532 ? 'Base Sepolia' : `Chain ${chainId}`)

export function elide(s: string | null | undefined, head = 6, tail = 4): string {
  if (!s) return '—'
  return s.length <= head + tail + 1 ? s : `${s.slice(0, head)}…${s.slice(-tail)}`
}

/** A desk intent id is short already; an on-chain bytes32 is not. */
export const shortIntent = (id: string | null): string => (!id ? '—' : id.startsWith('0x') && id.length > 20 ? elide(id, 8, 4) : id.length > 14 ? elide(id, 8, 4) : id)

/** `dune:<queryId>` → the query page; anything else → null. */
export function duneQueryUrl(origin: string | null): string | null {
  const m = origin?.match(/^dune:(\d{1,12})$/)
  return m ? `https://dune.com/queries/${m[1]}` : null
}

export function fmtUsd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  if (n >= 1_000_000) return `$${(n / 1_000_000).toFixed(2)}M`
  if (n >= 10_000) return `$${(n / 1_000).toFixed(1)}K`
  return `$${n.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
}

export const fmtCount = (n: number): string => (n >= 10_000 ? `${(n / 1000).toFixed(1)}K` : n.toLocaleString('en-US'))

const ZERO = '0x0000000000000000000000000000000000000000'
const USDC = new Set(['0x833589fcd6edb6e08f4c7c32d4f71b54bda02913', '0x036cbd53842c5426634e7929541ec2318f3dcf7e'])

/** Atoms → "0.0104 ETH" / "25.00 USDC" when the currency is known; raw atoms otherwise. */
export function fmtAtoms(atoms: string | null, currency: unknown): string {
  if (!atoms) return '—'
  const c = typeof currency === 'string' ? currency.toLowerCase() : null
  const dec = c === ZERO || c === 'eth' ? 18 : c && (USDC.has(c) || c === 'usdc') ? 6 : null
  const sym = c === ZERO || c === 'eth' ? 'ETH' : c && (USDC.has(c) || c === 'usdc') ? 'USDC' : null
  if (dec === null || !/^\d+$/.test(atoms)) return atoms.length > 14 ? `${atoms.slice(0, 12)}…` : atoms
  const v = Number(atoms) / 10 ** dec
  const places = v >= 100 ? 2 : v >= 1 ? 4 : 6
  return `${v.toLocaleString('en-US', { maximumFractionDigits: places })} ${sym}`
}

export function relTime(iso: string | null, now: number): string {
  if (!iso) return '—'
  const s = Math.max(0, Math.round((now - Date.parse(iso)) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.round(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.round(m / 60)
  if (h < 48) return `${h}h ago`
  return `${Math.round(h / 24)}d ago`
}

export function gap(ms: number): string {
  const s = Math.round(ms / 1000)
  if (s < 1) return '<1s'
  if (s < 60) return `+${s}s`
  const m = Math.floor(s / 60)
  if (m < 60) return `+${m}m ${s % 60}s`
  const h = Math.floor(m / 60)
  return `+${h}h ${m % 60}m`
}

export const clockTime = (iso: string): string =>
  new Date(iso).toLocaleString('en-US', { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
