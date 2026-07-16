// Curated "what can I do?" example asks for the router — shown on the chat
// empty state (and reusable on the landing). `slug` is the callable MCP the ask
// maps to; the UI toggles it on if present in the live catalog, otherwise it
// just prefills the prompt and lets Auto Router pick. Keep these mapped to
// services that are actually callable today.

export interface ExamplePrompt {
  /** Short chip label. */
  label: string
  /** The full message dropped into the chat input. */
  prompt: string
  /** Callable MCP slug to toggle on, when available. */
  slug?: string
}

export const EXAMPLE_PROMPTS: ExamplePrompt[] = [
  {
    // The auto-trader: arms a recurring buy (lib/dca) — native layer, no MCP
    // toggle needed; the chip mainly teaches that "every week" is a thing
    // you can SAY here.
    label: 'DCA $10 into AAPL weekly',
    prompt: 'Buy $10 of AAPL every week on Robinhood Chain',
    slug: 'robinhood-free',
  },
  {
    label: 'Crypto market data',
    prompt: 'What is the current price and 24h change for ETH?',
    slug: 'yeetful-nansen',
  },
  {
    label: 'DAO proposals',
    prompt: 'List the recent active proposals in the aave.eth Snapshot space.',
    slug: 'yeetful-snapshot',
  },
  {
    label: 'Solve with Wolfram',
    prompt: 'Wolfram: integrate x^2 * sin(x) dx',
    slug: 'wolfram-alpha',
  },
]
