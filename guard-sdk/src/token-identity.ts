// Token identity binding — adapted excerpt of lib/morpho-exec.ts
// (assertTokenIdentity, with the chain reader INJECTED so the check runs
// against any client — viem, ethers, a test fake).
//
// The find this module is named for (2026-07-29, website#597 audit): a
// guard bound calldata to an on-chain market tuple but never asked the
// chain what the market's asset IS. A hostile or compromised agent in the
// user's set could answer `{loan: 'USDC', marketId: <a REAL market whose
// loanToken is WETH>}` and every downstream check still passed — the tuple
// resolves honestly from that id, the calldata matches the resolved tuple,
// and the user signs an approve + supply of WETH for an ask that said USDC.
// A consistent liar passes every consistency check. The chain is the only
// authority on what a token IS, so we ask it.

export const ERC20_IDENTITY_ABI = [
  { type: 'function', name: 'symbol', stateMutability: 'view', inputs: [], outputs: [{ type: 'string' }] },
  { type: 'function', name: 'decimals', stateMutability: 'view', inputs: [], outputs: [{ type: 'uint8' }] },
] as const

/** Wrapped-native pairs read as the same asset for identity purposes. */
export const SYMBOL_ALIASES: Record<string, string[]> = { ETH: ['ETH', 'WETH'] }

/** The one read this check needs — the shape of viem's readContract. */
export interface ContractReader {
  readContract(args: { address: `0x${string}`; abi: typeof ERC20_IDENTITY_ABI; functionName: 'symbol' | 'decimals' }): Promise<unknown>
}

/**
 * Refuse to build against a token whose ON-CHAIN identity disagrees with
 * what an agent claimed. Throws with an honest, user-facing reason; a failed
 * read also throws — an unverifiable token is never built against.
 */
export async function assertTokenIdentity(
  reader: ContractReader,
  address: string,
  expectedSymbol: string,
  expectedDecimals: number,
): Promise<void> {
  let onChain: { symbol: string; decimals: number }
  try {
    const [symbol, decimals] = await Promise.all([
      reader.readContract({ address: address as `0x${string}`, abi: ERC20_IDENTITY_ABI, functionName: 'symbol' }) as Promise<string>,
      reader.readContract({ address: address as `0x${string}`, abi: ERC20_IDENTITY_ABI, functionName: 'decimals' }) as Promise<number>,
    ])
    onChain = { symbol, decimals: Number(decimals) }
  } catch {
    throw new Error(`Couldn't verify on-chain what token ${address.slice(0, 10)}… is — refusing to build against it.`)
  }
  const want = expectedSymbol.toUpperCase()
  const accepted = SYMBOL_ALIASES[want] ?? [want]
  if (!accepted.includes(onChain.symbol.toUpperCase())) {
    throw new Error(
      `That market's asset is ${onChain.symbol} on-chain, not ${want} — the agent's answer disagrees with the chain, so I won't build it.`,
    )
  }
  if (onChain.decimals !== expectedDecimals) {
    throw new Error(
      `${onChain.symbol} has ${onChain.decimals} decimals on-chain but the agent reported ${expectedDecimals} — refusing to size an amount against a wrong scale.`,
    )
  }
}
