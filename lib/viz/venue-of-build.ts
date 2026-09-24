// Which venue a build path / builder names, and its stable series entity —
// pure (no DB), so the client can paint a just-signed fill with the same ink
// the server's fills reader will use a minute later (lib/viz/fills re-exports
// it; components/markets/ai/AskChart's order ticket reads it here).

/** Which venue a build path / builder names, and its stable series entity. */
export function venueOfBuild(build: string | null | undefined): { venue: string; venueId: string } {
  const b = (build ?? '').toLowerCase()
  if (b.includes('uniswap-v4') || b.includes('v4')) return { venue: 'Uniswap v4', venueId: 'uniswap' }
  if (b.includes('uniswap')) return { venue: 'Uniswap v3', venueId: 'uniswap' }
  if (b.includes('lifi')) return { venue: 'LiFi', venueId: 'lifi' }
  if (b.includes('cow')) return { venue: 'CoW', venueId: 'cow' }
  if (b.includes('hl') || b.includes('hyperliquid')) return { venue: 'Hyperliquid', venueId: 'hyperliquid' }
  if (b.includes('cross-chain') || b.includes('near')) return { venue: 'NEAR Intents', venueId: 'near' }
  if (b.includes('aave')) return { venue: 'Aave', venueId: 'aave' }
  if (b.includes('lido')) return { venue: 'Lido', venueId: 'lido' }
  if (b.includes('morpho')) return { venue: 'Morpho', venueId: 'morpho' }
  if (b.includes('transfer') || b.includes('send')) return { venue: 'Transfer', venueId: 'wallet' }
  return { venue: 'Pantessa', venueId: 'wallet' }
}
