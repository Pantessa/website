// lib/siwe-message.ts — the message a wallet is asked to sign to sign in.
//
// THE BUG THIS EXISTS FOR (2026-09-21, Nate, on Phantom): "the sign feature
// seems to not be working when connected to a phantom wallet, it just opens
// the modal then closes it, not wallet signing message and does not turn
// green on the account".
//
// Why. Our SIWE statement carried an EM DASH:
//
//   Sign in to Pantessa. This proves you own this wallet — no funds are moved.
//                                                        ^ U+2014
//
// EIP-4361 defines the statement as `*( reserved / unreserved / " " )` —
// RFC 3986's character classes, which are ASCII. An em dash is not in them,
// so that message is NOT a conforming SIWE message. It still *claims* to be
// one: viem's createSiweMessage always emits the
// "<domain> wants you to sign in with your Ethereum account:" preamble, and
// EIP-4361 tells wallets to treat that preamble plus a non-conforming body
// as suspicious.
//
// Lenient wallets (MetaMask, Coinbase, Rainbow) render it anyway, which is
// why this shipped and why every drive passed. Phantom verifies the fields
// of a sign-in message at signing time (its own docs say so), so it opened
// the request, failed to parse it, and dismissed it — a popup that appears
// and vanishes with nothing to approve. Same family as the MetaMask bug
// "signature request immediately appears and then disappears depending on
// the content of the message" (metamask-extension#18241).
//
// So the statement is ASCII, it lives HERE rather than inline at the call
// site, and the rule that made it wrong is written down next to it and
// pinned by the harness. The house style is full of em dashes; without a
// fence the next copy edit puts one back and silently re-breaks every strict
// wallet.

/**
 * The statement inside the SIWE message. Plain ASCII, on purpose (see above)
 * — say it in two sentences rather than reach for a dash.
 */
export const SIWE_STATEMENT =
  'Sign in to Pantessa. This proves you own this wallet. No funds are moved.'

/**
 * EIP-4361: `statement = *( reserved / unreserved / " " )`.
 * RFC 3986 `unreserved = ALPHA / DIGIT / "-" / "." / "_" / "~"`,
 * `reserved = gen-delims / sub-delims` = `:/?#[]@` and `!$&'()*+,;=`.
 * Everything else — em dashes, curly quotes, ellipses, non-breaking spaces,
 * emoji, newlines — is off-spec.
 */
const SIWE_STATEMENT_CHARS = /^[A-Za-z0-9\-._~:/?#[\]@!$&'()*+,;= ]*$/

/** Every character in `statement` that EIP-4361 does not allow, deduped. */
export function siweStatementOffenders(statement: string): string[] {
  return [...new Set([...statement].filter((c) => !SIWE_STATEMENT_CHARS.test(c)))]
}

/** Pure: is this statement one a strict wallet will parse? */
export function siweStatementConformant(statement: string): boolean {
  return SIWE_STATEMENT_CHARS.test(statement)
}
