// scripts/probe-phantom-lane.ts — does the Phantom lane bind to Phantom?
//
//   npx tsx scripts/probe-phantom-lane.ts
//
// The measurement behind lib/phantom-lane: build a wallet lane's connector
// under a FAKE window and ask it for its provider. It runs out-of-process (it
// installs a `window` global, which no other harness check should ever see),
// so test:api pins the pure half in-process and this script proves the wiring
// against the real RainbowKit + wagmi packages.
//
// Two worlds, three claims:
//   1. MetaMask installed, no Phantom → RainbowKit's own phantomWallet hands
//      back MetaMask's provider. That is the bug, and asserting it here means
//      a future RainbowKit that fixes it upstream tells us (this row flips).
//   2. Same world, OUR lane → no provider at all. Nobody else's wallet is
//      ever adopted under Phantom's name.
//   3. Phantom installed → our lane is Phantom's own provider, exactly.

type Provider = { __tag: string }

const MM: Provider = { __tag: 'METAMASK', ...eip1193() }
const PH: Provider = { __tag: 'PHANTOM', ...eip1193() }

function eip1193() {
  return { request: async () => [], on() {}, removeListener() {} }
}

/** A window with the named wallets injected, the way each extension does it. */
function fakeWindow(opts: { metaMask?: boolean; phantom?: boolean }) {
  return {
    ...(opts.metaMask ? { ethereum: Object.assign(MM, { isMetaMask: true }) } : {}),
    ...(opts.phantom ? { phantom: { ethereum: PH } } : {}),
    addEventListener() {},
    removeEventListener() {},
    dispatchEvent() {},
    navigator: { userAgent: 'probe' },
  }
}

/** Build a RainbowKit wallet's connector and ask it for its provider. */
async function providerOf(wallet: { createConnector: (d: unknown) => unknown }): Promise<string> {
  const config = {
    chains: [{ id: 8453 }],
    emitter: { emit() {}, on() {}, off() {} },
    storage: null,
  }
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const connector: any = (wallet.createConnector as any)({ rkDetails: { id: 'phantom', name: 'Phantom' } })(config)
  const provider = await connector.getProvider().catch(() => undefined)
  return provider ? ((provider as Provider).__tag ?? 'UNKNOWN') : 'none'
}

async function main() {
  const rows: { claim: string; got: string; want: string }[] = []

  // World 1: MetaMask only.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const g = globalThis as any
  g.window = fakeWindow({ metaMask: true })
  g.document = { addEventListener() {} }

  const { phantomWallet } = await import('@rainbow-me/rainbowkit/wallets')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const raw = (phantomWallet as any)({})
  rows.push({
    claim: "RainbowKit's phantomWallet, MetaMask only → falls back to window.ethereum",
    got: await providerOf(raw),
    want: 'METAMASK',
  })
  rows.push({ claim: "RainbowKit says Phantom is not installed", got: String(raw.installed), want: 'false' })

  const { phantomTarget } = await import('../lib/phantom-lane')
  const { injected } = await import('wagmi/connectors')
  const { createConnector } = await import('wagmi')
  const ourLane = (win: unknown) => ({
    createConnector: (walletDetails: unknown) =>
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      createConnector((config: any) => ({
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(injected({ target: () => phantomTarget(win) } as any) as any)(config),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
        ...(walletDetails as any),
      })),
  })
  rows.push({
    claim: 'OUR lane, MetaMask only → no provider (the lane cannot connect anyone)',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    got: await providerOf(ourLane(fakeWindow({ metaMask: true })) as any),
    want: 'none',
  })

  // World 2: both installed.
  rows.push({
    claim: 'OUR lane, Phantom installed beside MetaMask → Phantom',
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    got: await providerOf(ourLane(fakeWindow({ metaMask: true, phantom: true })) as any),
    want: 'PHANTOM',
  })

  let red = 0
  for (const r of rows) {
    const ok = r.got === r.want
    if (!ok) red += 1
    console.log(`${ok ? '✅' : '❌'} ${r.claim}\n     got ${r.got}${ok ? '' : ` · want ${r.want}`}`)
  }
  console.log(`\n${rows.length - red} passed / ${red} failed`)
  if (red) process.exit(1)
}

void main()
