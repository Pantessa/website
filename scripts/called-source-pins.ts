// Pins for squad called-it, lane SOURCE (2026-11-11). This lane owns this file:
// the pure half runs anywhere, the served half against a built server.
// Wired into test-api by the contract commit; the lane only adds checks here.
//   npx tsx scripts/called-source-pins.ts                    (npm run pins:called-source)
//   BASE=http://localhost:PORT npx tsx scripts/called-source-pins.ts
type Check = (name: string, ok: boolean, extra?: string) => void

export function calledSourcePins(_check: Check): void {}

export async function calledSourcePinsServed(_check: Check, _BASE: string): Promise<void> {}

if (process.argv[1]?.endsWith('called-source-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledSourcePins(check)
    if (process.env.BASE) await calledSourcePinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-it source pins failed` : `\nall ${n} called-it source pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
