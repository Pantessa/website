// @yeetful/guard — the fail-closed guard layer under Pantessa's transaction
// engine, extracted open-core. Every module here was built against a live
// incident, not a hypothetical; provenance is in each file's header.
//
// The shape of the whole package: agents and models PROPOSE, deterministic
// code VERIFIES, and only the user's wallet signs. Nothing here holds a key,
// touches a database, or trusts a string an LLM wrote.

export * from './spend-grant'
export * from './tx-guardrails'
export * from './hl-guardian'
export * from './cross-chain-guard'
export * from './token-identity'
export type { Eip712TypedData } from './eip712'
