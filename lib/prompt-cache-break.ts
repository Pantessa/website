// The planner prompt's cache boundary — its own import-free module so the
// pure prompt builder (lib/endpoint-planner, imported by eval scripts and the
// API harness without a server) never pulls in the model caller.

/** A section header between a prompt's stable half (rules + endpoint menu)
 *  and this turn's half. Ordinary text to any engine; to the house caller
 *  (lib/house-model) it is where the cached prefix ends. */
export const PROMPT_CACHE_BREAK = '\n\n=== THIS TURN ===\n'
