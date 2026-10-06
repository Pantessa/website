// "What's in my wallet?" — a read about the ASKER's own wallet.
//
// With no wallet connected the planner had nothing to read: the wallet MCP's
// `owner` param needs $USER_ADDRESS, the call was skipped, and the house model
// promised "fetching your tokens now — one sec" over a diagnostics block
// (/live ask door, 2026-10-06). The honest answer is the sign-in door, with
// the ask held so it runs the moment an address lands.
//
// Pure, so the harness pins it without a server.

/** A question about the asker's own holdings/positions/balances. An ask that
 *  names someone else's address (0x…, name.eth) reads THAT wallet and needs
 *  no sign-in, so it never matches. */
export function asksAboutOwnWallet(message: string): boolean {
  const m = message.toLowerCase().replace(/[’']/g, "'").replace(/\s+/g, ' ').trim()
  if (!m || m.length > 200) return false
  if (/\b0x[0-9a-f]{6,}|\b[a-z0-9-]+\.eth\b/.test(m)) return false
  // "my wallet", "my portfolio", "my holdings", "my balance(s)", "my bags",
  // "my positions", "my tokens", "my nfts", "my account" (crypto sense).
  if (/\bmy (?:wallet|portfolio|holdings?|balances?|bags?|positions?|tokens?|nfts?|assets|funds|crypto|stocks?)\b/.test(m)) return true
  // "what do I hold / own / have", "how much do I have / hold", "what am I holding".
  if (/\bwhat (?:do|did) i (?:hold|own|have)\b|\bhow much (?:\w+ )?(?:do|did) i (?:hold|own|have)\b|\bwhat am i holding\b/.test(m)) return true
  return false
}

export const OWN_WALLET_SIGN_IN_REPLY =
  '👛 Sign in first — I read your holdings from your own wallet, and none is connected yet. Sign in below (wallet, Google or email) and I’ll answer right after.'
