// On-chain verification of a self-reported earn receipt — P0 of the routing-
// engine thesis: make the earn numbers honest. A receipt (POST /api/mcp/receipts)
// is self-reported telemetry; this confirms it against the chain. Given a
// receipt's settlement `txHash`, read the tx and check that a USDC transfer to
// the MCP's on-chain `payTo` backing at least the claimed amount actually
// happened. Fire-and-forget: never throws; updates the row's `verified` flag.
//
//   verified = null  → nothing to check (no txHash) or chain unreachable (retryable)
//   verified = true  → a USDC transfer to the payTo ≥ ~95% of the claim was found
//   verified = false → a txHash was given but the chain contradicts it (red flag)

import { createPublicClient, http, getAddress, decodeEventLog, parseAbi, type Address, type Hash } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import prisma from '@/lib/db'
import { USDC_BY_CHAIN } from '@/lib/x402'

const USDC_DECIMALS = 6
const ERC20_TRANSFER = parseAbi(['event Transfer(address indexed from, address indexed to, uint256 value)'])

/** Which Base chain a reported `network` string refers to (defaults to mainnet,
 *  where x402 chat settles). Accepts "base", "eip155:8453", "84532", etc. */
function chainForNetwork(network: string | null | undefined) {
  const n = (network ?? '').toLowerCase()
  if (n === 'eip155:84532' || n === '84532' || n.includes('sepolia')) return baseSepolia
  return base
}

/** Prefer an env RPC (LAUNCH_RPC_URL covers the launch chain); else viem's
 *  default public RPC for the chain (works, just rate-limited). */
function rpcUrlFor(chain: typeof base | typeof baseSepolia): string | undefined {
  const launchChainId = (process.env.LAUNCH_CHAIN === 'base' ? base : baseSepolia).id
  if (chain.id === launchChainId && process.env.LAUNCH_RPC_URL) return process.env.LAUNCH_RPC_URL
  if (chain.id === base.id) return process.env.BASE_RPC_URL
  if (chain.id === baseSepolia.id) return process.env.BASE_SEPOLIA_RPC_URL
  return undefined
}

/** The address the MCP's revenue is paid to (the on-chain `payTo`): the stored
 *  receiver if we've read it, else the claimant iff they proved control of it. */
async function expectedRecipient(mcpSlug: string): Promise<Address | null> {
  const server = await prisma.mcpServer.findUnique({ where: { slug: mcpSlug }, select: { receiver: true } })
  if (server?.receiver) return getAddress(server.receiver)
  const owner = await prisma.mcpOwner.findUnique({
    where: { mcpSlug },
    select: { ownerAddress: true, verifiedVia: true },
  })
  if (owner?.verifiedVia === 'receiver' && owner.ownerAddress) return getAddress(owner.ownerAddress)
  return null
}

/**
 * Verify one receipt against the chain. Safe to call fire-and-forget
 * (`void verifyReceipt(id)`) and safe to re-run (idempotent).
 */
export async function verifyReceipt(receiptId: string): Promise<void> {
  try {
    const r = await prisma.mcpReceipt.findUnique({ where: { id: receiptId } })
    if (!r || !r.txHash) return // nothing to verify — leave verified=null

    const expected = await expectedRecipient(r.mcpSlug)
    if (!expected) return // can't determine where the money should have gone

    const chain = chainForNetwork(r.network)
    const usdc = USDC_BY_CHAIN[chain.id]?.address
    if (!usdc) return
    const usdcAddr = getAddress(usdc)

    const pub = createPublicClient({ chain, transport: http(rpcUrlFor(chain)) })
    let rcpt
    try {
      rcpt = await pub.getTransactionReceipt({ hash: r.txHash as Hash })
    } catch {
      return // tx not indexed yet / RPC hiccup — retryable, keep verified=null
    }

    // Largest USDC transfer to the expected payTo in this tx.
    let toExpected = BigInt(0)
    for (const log of rcpt.logs) {
      if (getAddress(log.address) !== usdcAddr) continue
      try {
        const ev = decodeEventLog({ abi: ERC20_TRANSFER, data: log.data, topics: log.topics })
        if (ev.eventName === 'Transfer' && getAddress(ev.args.to as Address) === expected) {
          const v = ev.args.value as bigint
          if (v > toExpected) toExpected = v
        }
      } catch {
        /* not a Transfer log */
      }
    }

    const claimedAtomic = BigInt(Math.round((r.amountUsd ?? 0) * 10 ** USDC_DECIMALS))
    // Backed if the tx succeeded and ≥95% of the claimed amount actually reached
    // the payTo (5% tolerates rounding / fee splits; catches inflated reports).
    const ok = rcpt.status === 'success' && toExpected > BigInt(0) && toExpected * BigInt(100) >= claimedAtomic * BigInt(95)

    await prisma.mcpReceipt.update({ where: { id: receiptId }, data: { verified: ok, verifiedAt: new Date() } })
  } catch (e) {
    console.warn('[receipt-verify] failed', receiptId, e instanceof Error ? e.message : e)
  }
}
