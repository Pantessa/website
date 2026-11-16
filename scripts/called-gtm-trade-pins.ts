// Pins for squad called-gtm, lane TRADE (2026-11-16). The lane owns this file:
// pure checks in calledGtmTradePins, checks against a running server in
// calledGtmTradePinsServed. Already wired into test-api and package.json by
// the contract commit, so no lane edits the harness.
//   npx tsx scripts/called-gtm-trade-pins.ts            (npm run pins:called-gtm-trade)
//   BASE=http://localhost:PORT npx tsx scripts/called-gtm-trade-pins.ts

type Check = (name: string, ok: boolean, extra?: string) => void

export function calledGtmTradePins(_check: Check): void {
  // The lane's pure pins go here.
}

export async function calledGtmTradePinsServed(_check: Check, _base: string): Promise<void> {
  // The lane's served pins go here. Wrap the body in try/catch and report a failed fetch as one red check.
}

if (process.argv[1]?.endsWith('called-gtm-trade-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledGtmTradePins(check)
    if (process.env.BASE) await calledGtmTradePinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-gtm trade pins failed` : `\nall ${n} called-gtm trade pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
