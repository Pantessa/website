// The words a browser's speech recognizer does not know. "Morpho" comes back
// as "Mortal", "Aave" as "of", "USDG" as "USD G" — the recognizer's language
// model is general English and Chrome ignores SpeechGrammarList, so the
// only vocabulary we can give it is AFTER the fact (the slot corrector in
// lib/voice-ask.ts) or on a transcriber that takes a prompt (the
// /api/voice/transcribe lane, which passes this list to the model). One
// list, both consumers. Pure + client-safe; no chain/viem imports.

/** Protocols and venues the product names — the "on <venue>" slot. */
export const VOICE_VENUES = [
  'Morpho', 'Aave', 'Lido', 'Uniswap', 'CoW Swap', 'CoW', 'Hyperliquid', 'Snapshot',
  'OpenSea', 'NEAR Intents', 'Robinhood', 'Robinhood Chain', 'Coinbase', 'LiFi', 'Stripe',
  'Pantessa', 'MetaMask', 'Seaport',
] as const

/** Chains — the "on <chain>" slot. */
export const VOICE_CHAINS = ['Base', 'Ethereum', 'mainnet', 'Arbitrum', 'Optimism', 'Robinhood Chain'] as const

/** Tickers people say out loud. */
export const VOICE_TOKENS = [
  'ETH', 'WETH', 'BTC', 'WBTC', 'USDC', 'USDT', 'USDG', 'DAI', 'HYPE', 'SYRUP', 'SOL', 'LINK',
  'UNI', 'AAVE', 'LDO', 'ARB', 'OP', 'stETH', 'wstETH', 'cbBTC', 'AAPL', 'TSLA', 'NVDA', 'SPY',
  'GOOGL', 'AMD', 'MSFT', 'PLTR',
] as const

/** Product nouns + verbs the ladder reads. */
export const VOICE_NOUNS = [
  'position', 'positions', 'portfolio', 'balance', 'balances', 'holdings', 'chart', 'charts',
  'candles', 'stop-loss', 'take-profit', 'guardian', 'limit order', 'DCA', 'stake', 'unstake',
  'supply', 'withdraw', 'borrow', 'repay', 'bridge', 'swap', 'long', 'short', 'leverage', 'mosaic',
  'intent link', 'job', 'jobs', 'schedule', 'wallet', 'NFT', 'NFTs',
] as const

/** The transcriber prompt: a natural sentence of vocabulary works better
 *  than a bare list for Whisper-class models. */
export function voiceVocabularyPrompt(): string {
  return `Pantessa, a crypto wallet assistant. Vocabulary: ${[...VOICE_VENUES, ...VOICE_CHAINS, ...VOICE_TOKENS, ...VOICE_NOUNS].join(', ')}. Amounts like $10, 0.5 ETH, 5%.`
}
