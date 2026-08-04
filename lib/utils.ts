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
 *  matters. Brand-LEADING names ("Pantessa Wallet") are untouched — only
 *  trailing separators/suffixes go. */
export function cleanServerName(name: string): string {
  return name
    .replace(/\s*\(free\)\s*$/i, '')
    .replace(/\s*[·|—-]\s*(yeetful|pantessa)\s*$/i, '')
    .replace(/\s+MCP\s*$/i, '')
}
