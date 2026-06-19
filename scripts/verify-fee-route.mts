// Verify M4b — the launchpad fee route — end to end on Base Sepolia.
//
//   npx tsx scripts/verify-fee-route.mts                       # read-only probe
//   npx tsx scripts/verify-fee-route.mts --live "<name>" 0.005 # route a real cut + verify
//
// The probe reports config sanity (does LAUNCH_FEE_ROUTER's factory match the
// factory the launched vaults live in?), the house settlement wallet's gas+USDC,
// and each launched MCP's vault/treasury balances. --live calls the REAL
// production path (`routeSettledFee` from lib/launch-fees.ts) for one settled
// call and asserts the on-chain USDC delta equals the configured cut — landing in
// the vault if it has stakers, else escrowing to the vault's treasury.
import { createPublicClient, http, parseAbi, getAddress, formatUnits, zeroAddress, type Address } from 'viem'
import { base, baseSepolia } from 'viem/chains'
import { privateKeyToAccount } from 'viem/accounts'
import { PrismaClient } from '@prisma/client'
import * as launchFeesNs from '@/lib/launch-fees'
const launchFees: typeof launchFeesNs = (launchFeesNs as any).default ?? launchFeesNs
const { routeSettledFee, launchFeesEnabled } = launchFees

const prisma = new PrismaClient()
const chain = (process.env.LAUNCH_CHAIN ?? 'baseSepolia') === 'base' ? base : baseSepolia
const pub = createPublicClient({ chain, transport: http(process.env.LAUNCH_RPC_URL) })
const USDC = getAddress(process.env.LAUNCH_USDC ?? '0x036CbD53842c5426634e7929541eC2318f3dCF7e')
const ROUTER = getAddress(process.env.LAUNCH_FEE_ROUTER ?? zeroAddress)
const FACTORY = getAddress(process.env.NEXT_PUBLIC_LAUNCH_FACTORY ?? '0x6bFeAD6c2Bc71a06226b8b0eB9D9422086c3fc95')
const BPS = Number(process.env.LAUNCH_FEE_SHARE_BPS ?? '0')

const ERC20 = parseAbi(['function balanceOf(address) view returns (uint256)'])
const ROUTER_ABI = parseAbi(['function factory() view returns (address)'])
const FACTORY_ABI = parseAbi(['function mcpById(string) view returns (address token, address staking, address creator)'])
const STAKING = parseAbi(['function totalStaked() view returns (uint256)', 'function treasury() view returns (address)'])
const usdcBal = async (a: Address) => pub.readContract({ address: USDC, abi: ERC20, functionName: 'balanceOf', args: [a] })

async function probe() {
  console.log(`\n# config`)
  console.log(`  enabled=${launchFeesEnabled()} chain=${chain.name} bps=${BPS} (${BPS / 100}%)`)
  console.log(`  router=${ROUTER} usdc=${USDC} factory=${FACTORY}`)
  if (ROUTER !== zeroAddress) {
    const rf = await pub.readContract({ address: ROUTER, abi: ROUTER_ABI, functionName: 'factory' }).catch(() => zeroAddress)
    const ok = getAddress(rf) === FACTORY
    console.log(`  router.factory=${rf} ${ok ? '✓ matches launch factory' : '✗ MISMATCH — routeForMcp will revert NotLaunched'}`)
  }
  if (process.env.PRIVATE_KEY) {
    const pk = process.env.PRIVATE_KEY.startsWith('0x') ? process.env.PRIVATE_KEY : `0x${process.env.PRIVATE_KEY}`
    const acct = privateKeyToAccount(pk as `0x${string}`)
    const [eth, usdc] = [await pub.getBalance({ address: acct.address }), await usdcBal(acct.address)]
    console.log(`\n# house settlement wallet ${acct.address}`)
    console.log(`  ETH=${formatUnits(eth, 18)} USDC=${formatUnits(usdc, 6)}` + (eth === 0n || usdc === 0n ? '  ⚠ needs Base Sepolia ETH (gas) + test USDC before a live route can settle' : '  ✓ funded'))
  }
  const launched = await prisma.mcpServer.findMany({ where: { tokenAddress: { not: null } }, select: { slug: true, name: true, tokenAddress: true, stakingAddress: true } })
  console.log(`\n# launched MCPs: ${launched.length}`)
  for (const m of launched) {
    const reg = await pub.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: 'mcpById', args: [m.slug] }).catch(() => null)
    const vault = reg && reg[1] !== zeroAddress ? reg[1] : null
    if (!vault) { console.log(`  ${m.slug} (${m.name}) — NOT in factory registry ✗`); continue }
    const [staked, treasury, vbal] = [await pub.readContract({ address: vault, abi: STAKING, functionName: 'totalStaked' }), await pub.readContract({ address: vault, abi: STAKING, functionName: 'treasury' }), await usdcBal(vault)]
    console.log(`  ${m.slug} (${m.name}) vault=${vault}\n    totalStaked=${formatUnits(staked, 18)} vaultUSDC=${formatUnits(vbal, 6)} treasury=${treasury} -> fee ${staked === 0n ? 'escrows to treasury' : 'splits across stakers'}`)
  }
}

async function live(name: string, amountUsd: number) {
  const server = await prisma.mcpServer.findFirst({ where: { name }, select: { slug: true, tokenAddress: true } })
  if (!server?.tokenAddress) throw new Error(`"${name}" has no launched token`)
  const reg = await pub.readContract({ address: FACTORY, abi: FACTORY_ABI, functionName: 'mcpById', args: [server.slug] })
  const vault = reg[1]
  const staked = await pub.readContract({ address: vault, abi: STAKING, functionName: 'totalStaked' })
  const sink = staked === 0n ? await pub.readContract({ address: vault, abi: STAKING, functionName: 'treasury' }) : vault
  const cutUnits = BigInt(Math.floor(((amountUsd * BPS) / 10_000) * 1e6))
  const before = await usdcBal(sink)
  console.log(`\n# live route: ${name} settled $${amountUsd} → cut ${formatUnits(cutUnits, 6)} USDC → ${staked === 0n ? 'treasury' : 'vault'} ${sink}`)
  console.log(`  sink USDC before = ${formatUnits(before, 6)}`)
  await routeSettledFee(name, amountUsd) // the real production path (fire-and-forget; swallows its own errors)
  // poll for the on-chain delta (route + possible approve are async)
  let after = before
  for (let i = 0; i < 15 && after === before; i++) { await new Promise(r => setTimeout(r, 2000)); after = await usdcBal(sink) }
  const delta = after - before
  console.log(`  sink USDC after  = ${formatUnits(after, 6)}  (Δ ${formatUnits(delta, 6)})`)
  console.log(delta === cutUnits ? `  ✓ VERIFIED — real x402 fee routed on-chain to the MCP's stakers` : `  ✗ no/unexpected delta — check house-wallet funding + router.factory match above`)
}

const args = process.argv.slice(2)
if (args[0] === '--live') await live(args[1], Number(args[2]))
else await probe()
await prisma.$disconnect()
