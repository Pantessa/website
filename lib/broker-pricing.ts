// lib/broker-pricing.ts — the desk's pricing config + discovery (M6).
//
// The desk earns two ways: the link-tier bps on signed volume (already in the
// stack, inherited by every brokered signature) and, optionally, x402
// pay-per-call on the value-producing tools. This module is the CONFIG +
// ADVERTISEMENT half: it reads the pay-to config, decides which tools cost,
// and exposes a discovery block so a connecting agent knows the price before
// it calls. It is FAIL-CLOSED TO FREE — unconfigured means the free door
// stays, never a paid path that silently serves for nothing.
//
// ENFORCEMENT (the x402 payment challenge on a /api/broker/paid route) is the
// owner follow-on: it needs a real pay-to address + a CDP facilitator, i.e.
// live payment rails, so it is turned on by config + one deploy step, not
// generated blind. The contract that survives into that step is here:
//   * PAID_TOOLS is the set that costs (the ones that do work / create value);
//     discovery/control stay free (you never pay to read status or walk away).
//   * The x402 PAYER address becomes the agent's desk identity (agent_key in
//     M1) — payment and identity are the same fact, which is what makes the
//     paid door also the abuse fence and the track-record key.

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

/** Tools that cost on the paid door: the value-producing calls. Discovery
 *  (capabilities), control (status, close), and mid-negotiation rewrites
 *  (choose) are always free. */
export const PAID_TOOLS = new Set(['broker_open', 'broker_execute', 'broker_send', 'broker_tile'])

export type DeskPricing =
  | { mode: 'free' }
  | { mode: 'paid'; priceUsd: string; paymentAddress: string; network: string; paidEndpoint: string; paidTools: string[] }

/** Read the desk's pricing config. Paid ONLY when BROKER_PAYMENT_ADDRESS is a
 *  valid 0x address; anything else (unset, malformed) fails closed to free. */
export function deskPricing(): DeskPricing {
  const addr = (process.env.BROKER_PAYMENT_ADDRESS ?? '').trim()
  if (!WALLET_RE.test(addr)) return { mode: 'free' }
  const priceUsd = (process.env.BROKER_X402_PRICE_USD ?? '0.02').trim()
  const network = (process.env.BROKER_X402_NETWORK ?? 'base').trim()
  return {
    mode: 'paid',
    priceUsd,
    paymentAddress: addr.toLowerCase(),
    network,
    paidEndpoint: '/api/broker/paid/mcp',
    paidTools: [...PAID_TOOLS],
  }
}

/** The per-call price for a tool under the current config, or null if free. */
export function priceForTool(tool: string): string | null {
  const p = deskPricing()
  return p.mode === 'paid' && PAID_TOOLS.has(tool) ? p.priceUsd : null
}

/** The discovery block broker_capabilities advertises — an agent reads this to
 *  learn whether (and how) the desk charges before it calls anything. */
export function pricingBlock(): Record<string, unknown> {
  const p = deskPricing()
  if (p.mode === 'free') {
    return {
      model: 'free',
      note: 'This desk is free to call. Pantessa earns the link-tier fee on the signed volume it clears, not on the calls.',
    }
  }
  return {
    model: 'x402-per-call',
    priceUsd: p.priceUsd,
    network: p.network,
    paidEndpoint: p.paidEndpoint,
    paidTools: p.paidTools,
    note:
      `The value tools (${p.paidTools.join(', ')}) are ${p.priceUsd} USDC per call on the paid door ` +
      `(${p.paidEndpoint}); capabilities, status, and close stay free. Your x402 payer address is your desk ` +
      `identity — the same address caps, kill-switches, and earns your track record.`,
  }
}
