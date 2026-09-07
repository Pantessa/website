// The ONE record for the live host-app example — the landing band, the embed
// docs, and the harness all read it, so the URL can't drift between surfaces.
// It is our own interface on our own domain (no third-party marks — rule 7),
// deployed from agent-examples/agents/robinhood-desk.

export const ROBINHOOD_DESK = {
  name: 'Stock Desk',
  url: 'https://robinhood.pantessa.com',
  source: 'https://github.com/Pantessa/agent-examples/tree/main/agents/robinhood-desk',
  chain: 'Robinhood Chain',
  /** The MCP set the desk scopes the embed to. */
  mcps: ['robinhood-free', 'uniswap-free', 'yeetful-tool-wallet'],
  /** What the page proves, in the order a host would care. */
  proves: [
    'reads holdings + prices from the chain itself — keyless',
    'every button on the page is one sendPrompt() into the embed',
    'the visitor’s own wallet signs on that page through the bridge',
  ],
} as const
