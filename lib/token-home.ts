// ─────────────────────────────────────────────────────────────────────────
//  Where a coin actually LIVES. Base's permissionless token list carries a
//  "SOL", a "DOGE", a "DOT" — bridged copies and outright squats — so "Buy
//  $50 of SOL" (the chart overlay's own chip on a SOL chart) used to book a
//  USDC → squat swap on Base, and "DCA $10 into SOL weekly" a STANDING
//  schedule buying it. Same class as the AAPL-on-Base squat (2026-07-30):
//  a curated fact beats the dynamic list. Pure + client-safe: the route's
//  refusal, the DCA layer, the chart overlay's chips and the audit ladder
//  all read this one table. The honest next step for these coins is the
//  Hyperliquid perp (the venue validates the coin live — nothing here
//  promises a listing), never a squat swap and never a cross-chain leg
//  Pantessa can't deliver (an EVM wallet has no Solana address).
// ─────────────────────────────────────────────────────────────────────────

/** Symbol → the chain the real coin lives on. BTC is deliberately absent —
 *  cbBTC/WBTC on Base and Ethereum are the real thing, not squats. */
const HOMES: Record<string, string> = {
  SOL: 'Solana',
  JUP: 'Solana',
  JTO: 'Solana',
  AVAX: 'Avalanche',
  POL: 'Polygon',
  MATIC: 'Polygon',
  BNB: 'BNB Chain',
  NEAR: 'NEAR',
  TON: 'TON',
  TRX: 'Tron',
  SUI: 'Sui',
  XRP: 'the XRP Ledger',
  ADA: 'Cardano',
  DOGE: 'Dogecoin',
  DOT: 'Polkadot',
  ATOM: 'Cosmos',
  APT: 'Aptos',
  TIA: 'Celestia',
  INJ: 'Injective',
  FIL: 'Filecoin',
  LTC: 'Litecoin',
  XLM: 'Stellar',
  HBAR: 'Hedera',
  ALGO: 'Algorand',
  XMR: 'Monero',
  BCH: 'Bitcoin Cash',
  KAS: 'Kaspa',
}

/** The coin's home chain name when it is NOT an EVM-native asset on
 *  Pantessa's chains, else null. */
export function tokenHome(symbol: string | undefined | null): string | null {
  if (!symbol) return null
  const sym = symbol.toUpperCase().replace(/[^A-Z0-9]/g, '')
  return HOMES[sym] ?? null
}
