// Shared builders for the embed install surfaces — the dashboard EmbedsPanel
// and the chat toolbar's "Embed this chat" popover. The key is OPTIONAL:
// keyless embeds work fine, they just don't attribute usage to an account
// (no /dashboard/embeds analytics). `mcps` are directory slugs — the /embed
// page caps the set at 4 (EmbedChat MAX_MCPS).

export const DEFAULT_EMBED_MCPS = ['uniswap-free', 'snapshot-free']

export const MAX_EMBED_MCPS = 4

/** ['a','b'] → "['a', 'b']" — the literal pasted into the JS snippet. */
function mcpsLiteral(mcps: string[]): string {
  const list = (mcps.length > 0 ? mcps : DEFAULT_EMBED_MCPS).slice(0, MAX_EMBED_MCPS)
  return `[${list.map((s) => `'${s}'`).join(', ')}]`
}

export function embedSnippet(key: string | null, mcps: string[] = DEFAULT_EMBED_MCPS): string {
  return `import { mountYeetfulChat } from 'yeetful/embed'

mountYeetfulChat({
  mode: 'bubble',
${key ? `  key: '${key}',\n` : ''}  mcps: ${mcpsLiteral(mcps)},
  wallet: 'auto', // the host page's wallet signs
})`
}

/** The copy-paste "Install with Claude" prompt — hand it to Claude Code (or
 * any coding agent) inside the host app's repo and it does the whole
 * integration. Self-contained on purpose: key (when there is one), CSP note,
 * verify step. */
export function embedClaudePrompt(key: string | null, mcps: string[] = DEFAULT_EMBED_MCPS): string {
  const list = mcpsLiteral(mcps)
  return `Install the Pantessa embeddable chat (an agent that composes MCPs — swaps, DAO votes, live data — and signs with the user's own wallet) into this app.

1. Install the SDK: \`npm i yeetful\` (needs yeetful >= 0.10).
2. Mount it once wherever the app initializes client-side:

   import { mountYeetfulChat } from 'yeetful/embed'

   mountYeetfulChat({
     mode: 'bubble',            // or 'inline' with { container }
${key ? `     key: '${key}',  // public embed key — attributes usage to our account\n` : ''}     mcps: ${list},  // swap for slugs from https://www.yeetful.com/servers
     wallet: 'auto',            // bridges the page's connected wallet; signatures pop in the user's own wallet
   })

   No bundler? Use a module script instead:
   <script type="module">
     import { mountYeetfulChat } from 'https://esm.sh/yeetful@^0.10/embed'
     mountYeetfulChat({ mode: 'bubble', ${key ? `key: '${key}', ` : ''}mcps: ${list}, wallet: 'auto' })
   </script>

3. If the app ships a Content-Security-Policy, add https://www.yeetful.com to frame-src (the chat runs in an iframe on that origin).
${
  key
    ? '4. Do not move the key to an env secret — it is a publishable identifier, safe in page source.'
    : '4. Optional: mint a public embed key at https://www.yeetful.com/dashboard (Embed Pantessa card) and add key: \'yfe_…\' to the mount — it attributes usage to your account and unlocks embed analytics.'
}
5. Verify: run the app, open the chat bubble, and ask "what is WETH trading at?" — the answer should include a $0 receipt line. Docs: https://www.yeetful.com/docs/embed`
}
