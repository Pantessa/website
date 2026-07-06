// ── Wallet context for ANSWER prompts ────────────────────────────────────────
//
// The user's connected wallet address is wired into the PLANNER via the
// "$USER_ADDRESS" token (RR12, lib/endpoint-planner.ts) — but the prompts that
// WRITE the final reply (synthesis + the conversational no-tools fallback)
// never saw it, so "what is my wallet address?" got "I don't have access".
// This helper is the single line every answer-prompt builder includes when a
// turn has an effective user address (request walletAddress, SIWE session
// fallback). Do NOT add it to the planner prompt — that already has
// $USER_ADDRESS handling.

/** One concise context line for the final-answer prompt, or '' when no
 *  address is known. Pass the FULL address — the model must be able to echo
 *  it exactly, never a shortened or invented one. */
export function walletContextLine(address?: string | null): string {
  if (!address) return ''
  return `The user's connected wallet address is ${address} — this is what they mean by "my address" / "my wallet". Never invent a different address.`
}
