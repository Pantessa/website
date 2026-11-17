// ─────────────────────────────────────────────────────────────────────────
//  IS AUTOMATIC SELLING SWITCHED ON HERE? — one answer for every surface.
//
//  The Spot Guardian (a stop-loss on a token in your wallet) and the DCA
//  autopilot both spend through a Coinbase spend permission on Base mainnet.
//  Their builders refuse unless CDP is configured AND CDP_SPEND_NETWORK is
//  'base' (lib/spot-guard-exec, lib/dca-auto-exec). Until then every chip
//  that offered them ("Protect spot ETH", "Make it autonomous", "Stop under
//  this") opened a "that part isn't switched on" answer: an offer the app
//  could not keep.
//
//  next.config stamps NEXT_PUBLIC_SPOT_AUTOSELL at BUILD time from the same
//  three CDP keys + network the builders read, so the browser and the server
//  agree. Setting CDP_SPEND_NETWORK=base on Vercel needs a redeploy to bring
//  the offers back — the same deploy that turns the builders on.
// ─────────────────────────────────────────────────────────────────────────

/** True when a spot stop or a DCA autopilot can actually be armed. */
export function autoSellLive(): boolean {
  return process.env.NEXT_PUBLIC_SPOT_AUTOSELL === '1'
}

/** What next.config stamps: the builders' own condition (lib/cdp
 *  isCdpConfigured + spendNetwork() === 'base'). */
export function autoSellStamp(env: Record<string, string | undefined>): '1' | '' {
  const cdp = Boolean(env.CDP_API_KEY_ID && env.CDP_API_KEY_SECRET && env.CDP_WALLET_SECRET)
  return cdp && env.CDP_SPEND_NETWORK === 'base' ? '1' : ''
}

/** "make my ETH dca autonomous" / "arm my ETH dca" — the autopilot ARM
 *  (turning one OFF always works and is never gated). */
const DCA_AUTO_ARM_RE = /\b(?:make|turn)\b[^.]*\bdca\b[^.]*\bautonomous\b|\barm\b[^.]*\bdca\b|\bdca\b[^.]*\bautopilot\s+on\b|\bturn\s+on\b[^.]*\bautopilot\b/i

export function isDcaAutopilotArm(ask: string): boolean {
  if (/\b(?:off|disarm|stop)\b/i.test(ask)) return false
  return DCA_AUTO_ARM_RE.test(ask)
}
