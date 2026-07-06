// Pure unit tests for the host-wallet bridge transport (lib/host-wallet.ts):
// rpc dispatch, promise-map resolution, error shaping, timeout classification,
// and the 'wallet' announce parser. No window/browser — the transport takes an
// injected post() and configurable timeouts by design.
//
//   npx tsx scripts/test-host-wallet.ts

import {
  DEFAULT_TIMEOUT_MS,
  HostBridgeTransport,
  HostRpcError,
  INTERACTIVE_TIMEOUT_MS,
  isInteractiveMethod,
  parseChainId,
  parseWalletAnnounce,
} from '../lib/host-wallet'

let passed = 0
let failed = 0
const check = (name: string, ok: boolean, detail?: string) => {
  if (ok) {
    passed++
    console.log(`  ✓ ${name}`)
  } else {
    failed++
    console.error(`  ✗ ${name}${detail ? ` — ${detail}` : ''}`)
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

async function main() {
  console.log('host-wallet bridge transport')

  // ── request envelope ──────────────────────────────────────────────────────
  {
    const posted: Record<string, unknown>[] = []
    const t = new HostBridgeTransport((m) => posted.push(m))
    void t.request('eth_chainId').catch(() => {})
    void t.request('eth_call', [{ to: '0x0' }, 'latest']).catch(() => {})
    const [a, b] = posted
    check('rpc envelope carries source/v/type/id/method', a.source === 'yeetful-embed' && a.v === 1 && a.type === 'rpc' && typeof a.id === 'string' && a.method === 'eth_chainId')
    check('params omitted when undefined', !('params' in a))
    check('params passed through', Array.isArray(b.params) && (b.params as unknown[]).length === 2)
    check('ids are unique per request', a.id !== b.id)
  }

  // ── resolution + rejection + interleaving ────────────────────────────────
  {
    const posted: Record<string, unknown>[] = []
    const t = new HostBridgeTransport((m) => posted.push(m))
    const p1 = t.request('eth_accounts')
    const p2 = t.request('eth_blockNumber')
    const [m1, m2] = posted
    // resolve out of order — each id routes to its own promise
    check('rpc:result consumed', t.handleMessage({ source: 'yeetful-embed', v: 1, type: 'rpc:result', id: m2.id, result: '0x10' }))
    check('rpc:error consumed', t.handleMessage({ source: 'yeetful-embed', v: 1, type: 'rpc:error', id: m1.id, error: { code: 4200, message: 'not allowed' } }))
    check('out-of-order result routes by id', (await p2) === '0x10')
    const err = await p1.then(
      () => null,
      (e: unknown) => e,
    )
    check('rpc:error rejects with HostRpcError', err instanceof HostRpcError && err.code === 4200 && err.message === 'not allowed')
  }

  // ── junk / spoof rejection ────────────────────────────────────────────────
  {
    const t = new HostBridgeTransport(() => {})
    const p = t.request('eth_chainId', undefined)
    check('wrong source ignored', !t.handleMessage({ source: 'evil', v: 1, type: 'rpc:result', id: 'x', result: 1 }))
    check('wrong version ignored', !t.handleMessage({ source: 'yeetful-embed', v: 2, type: 'rpc:result', id: 'x', result: 1 }))
    check('unknown id ignored', !t.handleMessage({ source: 'yeetful-embed', v: 1, type: 'rpc:result', id: 'nope', result: 1 }))
    check('non-rpc types ignored', !t.handleMessage({ source: 'yeetful-embed', v: 1, type: 'wallet', accounts: [] }))
    check('null ignored', !t.handleMessage(null))
    p.catch(() => {}) // let its timeout fire silently after the process would exit
  }

  // ── timeouts + classification ────────────────────────────────────────────
  {
    check('interactive set matches contract v1.1', ['eth_requestAccounts', 'personal_sign', 'eth_signTypedData_v4', 'eth_sendTransaction', 'wallet_switchEthereumChain', 'wallet_addEthereumChain'].every(isInteractiveMethod))
    check('read methods are not interactive', !isInteractiveMethod('eth_call') && !isInteractiveMethod('eth_accounts') && !isInteractiveMethod('eth_chainId'))
    check('timeout constants (300s / 30s)', INTERACTIVE_TIMEOUT_MS === 300_000 && DEFAULT_TIMEOUT_MS === 30_000)

    // default-tier method times out on the default budget…
    const t = new HostBridgeTransport(() => {}, { interactive: 500, default: 40 })
    const readErr = await t.request('eth_call').then(
      () => null,
      (e: Error) => e,
    )
    check('non-interactive request times out with the contract message', readErr instanceof Error && readErr.message === 'host wallet request timed out')

    // …while an interactive one on the same transport is still pending then resolves
    const posted: Record<string, unknown>[] = []
    const t2 = new HostBridgeTransport((m) => posted.push(m), { interactive: 500, default: 40 })
    const sign = t2.request('personal_sign', ['0xdead', '0xbeef'])
    await sleep(80) // past the default budget — interactive must survive it
    check('interactive request outlives the default budget', t2.handleMessage({ source: 'yeetful-embed', v: 1, type: 'rpc:result', id: posted[0].id, result: '0xsig' }))
    check('interactive request resolves after the wait', (await sign) === '0xsig')

    // a late reply to a timed-out id is dropped (not consumed)
    check('late reply after timeout is ignored', !t.handleMessage({ source: 'yeetful-embed', v: 1, type: 'rpc:result', id: 'timed-out', result: 1 }))
  }

  // ── error shaping fallbacks ──────────────────────────────────────────────
  {
    const posted: Record<string, unknown>[] = []
    const t = new HostBridgeTransport((m) => posted.push(m))
    const p = t.request('eth_sendTransaction', [{}])
    t.handleMessage({ source: 'yeetful-embed', v: 1, type: 'rpc:error', id: posted[0].id, error: {} })
    const e = await p.then(
      () => null,
      (x: unknown) => x,
    )
    check('malformed error gets -32603 + generic message', e instanceof HostRpcError && e.code === -32603 && e.message === 'host wallet request failed')
  }

  // ── wallet announce parsing ──────────────────────────────────────────────
  {
    const good = parseWalletAnnounce({ accounts: ['0x1111111111111111111111111111111111111111'], chainId: '0x2105' })
    check('announce parses accounts + chainId', !!good && good.available && good.accounts.length === 1 && good.chainId === '0x2105')
    const empty = parseWalletAnnounce({ accounts: [], chainId: null })
    check('empty announce = available, not connected', !!empty && empty.available && empty.accounts.length === 0 && empty.chainId === null)
    const dirty = parseWalletAnnounce({ accounts: ['garbage', '0x2222222222222222222222222222222222222222', 42], chainId: 7 })
    check('non-address entries filtered, non-string chainId nulled', !!dirty && dirty.accounts.length === 1 && dirty.chainId === null)
    check('malformed announce dropped', parseWalletAnnounce({ chainId: '0x1' }) === null && parseWalletAnnounce(null) === null)
    check('checksums applied', !!good && good.accounts[0] === '0x1111111111111111111111111111111111111111')
    check('parseChainId: hex, decimal, junk', parseChainId('0x2105') === 8453 && parseChainId('8453') === 8453 && parseChainId('cow') === null && parseChainId(null) === null)
  }

  console.log(`\n${passed} passed, ${failed} failed`)
  process.exit(failed > 0 ? 1 : 0)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
