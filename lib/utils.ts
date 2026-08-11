import { type ClassValue, clsx } from 'clsx'
import { twMerge } from 'tailwind-merge'

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs))
}

/** Display name for an MCP server row/strip: the seeded names carry
 *  suffixes — "(Free)", "· Pantessa" attribution, a trailing "MCP" — that
 *  read as noise in surfaces already scoped to the fleet, and at rail
 *  widths they're what push the ACTUAL name into truncation
 *  ("Hyperliquid (Fr…", "NEAR Intents MCP · Yeet…"). Strip them for
 *  display only; keep the full name in tooltips and anywhere identity
 *  matters.
 *
 *  The word "Yeetful" renders as "Pantessa" (2026-08-05 rename): the
 *  catalog rows are Neon-seeded and rename on the owner's clock
 *  (scripts/rebrand-neon-content.ts), and the `Yeetful · Claude` family
 *  can NEVER rename in data — those names sit in code IN-lists
 *  (app/api/route/proof) — so display-time is the one safe layer. Every
 *  Yeetful-worded name is ours; slugs/hosts/keys never pass through here. */
export function cleanServerName(name: string): string {
  return name
    .replace(/\s*\(free\)\s*$/i, '')
    .replace(/\s*[·|—-]\s*(yeetful|pantessa)\s*$/i, '')
    .replace(/\s+MCP\s*$/i, '')
    .replace(/\byeetful\b/gi, 'Pantessa')
}
