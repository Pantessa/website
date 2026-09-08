import { http, type Chain, type Transport } from 'viem'
import { mainnet, base, baseSepolia, arbitrum, optimism } from 'wagmi/chains'
import { robinhoodChain } from '@/lib/chains'

/**
 * THE chain list every wallet lane can sign on — ONE source for the wagmi
 * config (extension / WalletConnect / Coinbase wallets) AND the CDP embedded
 * wallet ("create an account" with Google / email).
 *
 * Why one list: `switchChainAsync` only knows the chains its connector was
 * configured with. The CDP connector used to carry its own two-chain list
 * (Base + Base Sepolia) while wagmi's grew to six, so an account-holder who
 * funded with a card (Stripe delivers ETH on Ethereum since website#716)
 * hit "Chain not configured" on the very first bridge step and the card
 * told them to "switch the wallet" — a wallet with no network UI to switch
 * (2026-09-08, Nate's own Stripe drill on "Buy $12 of SPY"). Two lists
 * drift; one can't.
 *
 * Base is the primary chain we transact on (x402 payments). Mainnet is
 * included so RainbowKit can resolve ENS names/avatars AND because it is now
 * the default on-ramp landing lane — but its default RPC (eth.merkle.io)
 * rejects browser CORS preflights, which spammed the console with retried
 * ENS lookups, so pin it to a CORS-friendly public endpoint. base.sepolia is
 * included for the launchpad (testnet). Arbitrum, Optimism + Robinhood Chain
 * are here so tx cards can switch the wallet + watch receipts on them
 * (SendTxButton needs a configured transport per tx.chainId; the Switch
 * Networks modal mirrors this list). A chain the funding scanner can SEE but
 * the wallet can't switch to is a chip that walls at signature time.
 */
export const WALLET_CHAINS = [base, baseSepolia, mainnet, arbitrum, optimism, robinhoodChain] as const satisfies readonly [Chain, ...Chain[]]

/**
 * Browser-side transports, one per wallet chain. Fresh object per call so
 * two wagmi-style configs never share a transport instance.
 *
 * NEVER pin publicnode here (standing gotcha, 2026-09-04): its free tier
 * answers any state read older than ~128 blocks with "Archive requests
 * require a personal token", and browser-side receipt/simulation reads walk
 * backwards through history — on a 2s chain that wall is ~4 minutes and the
 * first live Optimism run died on the approve step. Ethereum is the one
 * exception (12s blocks, and its viem default is CORS-hostile); Base,
 * Arbitrum, Optimism + Robinhood Chain keep viem's defaults, which serve
 * full archive depth with CORS `*` (measured 2026-09-04).
 */
export function walletTransports(): Record<(typeof WALLET_CHAINS)[number]['id'], Transport> {
  return {
    [base.id]: http(),
    [baseSepolia.id]: http(),
    [mainnet.id]: http('https://ethereum-rpc.publicnode.com'),
    [arbitrum.id]: http(),
    [optimism.id]: http(),
    [robinhoodChain.id]: http(),
  }
}
