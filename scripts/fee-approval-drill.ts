// One-shot drill (not part of the harness): does the venue accept a
// builder-fee cap approval while the builder (our treasury) is UNFUNDED?
// Signs with the .env.local house burner, submits through the LOCAL relay so
// the whole guarded path is exercised. $0 moves; a cap approval is reversible.
//   npx tsx scripts/fee-approval-drill.ts http://localhost:3493
import { config } from 'dotenv'
config({ path: '.env.local' })
import { privateKeyToAccount } from 'viem/accounts'
import { approveBuilderFeeArtifacts } from '../lib/hyperliquid-exec'

async function main() {
  const base = process.argv[2] ?? 'http://localhost:3493'
  const pk = process.env.PRIVATE_KEY
  if (!pk) throw new Error('PRIVATE_KEY missing from .env.local')
  const account = privateKeyToAccount(pk as `0x${string}`)
  console.log('burner:', account.address)
  const { action, typedData } = approveBuilderFeeArtifacts({ nonce: Date.now(), signatureChainId: 8453, isTestnet: false })
  const signature = await account.signTypedData({
    domain: typedData.domain,
    types: typedData.types,
    primaryType: typedData.primaryType,
    message: { ...typedData.message, nonce: BigInt(action.nonce) },
  } as Parameters<typeof account.signTypedData>[0])
  const res = await fetch(`${base}/api/hl/submit`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action, nonce: action.nonce, signature, from: account.address }),
  })
  console.log('relay status:', res.status)
  console.log('relay body:', await res.text())
  // Read back what the venue now reports as the approved cap.
  const check = await fetch('https://api.hyperliquid.xyz/info', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ type: 'maxBuilderFee', user: account.address, builder: action.builder }),
  })
  console.log('venue maxBuilderFee readback:', await check.text())
}

void main()
