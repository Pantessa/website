// Pins for squad called-it, lane JUDGE (2026-11-11). This lane owns this file:
// the pure half runs anywhere, the served half against a built server.
// Wired into test-api by the contract commit; the lane only adds checks here.
//   npx tsx scripts/called-judge-pins.ts                    (npm run pins:called-judge)
//   BASE=http://localhost:PORT npx tsx scripts/called-judge-pins.ts
type Check = (name: string, ok: boolean, extra?: string) => void

export function calledJudgePins(_check: Check): void {}

export async function calledJudgePinsServed(_check: Check, _BASE: string): Promise<void> {}

if (process.argv[1]?.endsWith('called-judge-pins.ts')) {
  ;(async () => {
    let failed = 0
    let n = 0
    const check: Check = (name, ok, extra) => {
      n++
      console.log(`${ok ? '✅' : '❌'} ${name}${extra && !ok ? ` — ${extra}` : ''}`)
      if (!ok) failed++
    }
    calledJudgePins(check)
    if (process.env.BASE) await calledJudgePinsServed(check, process.env.BASE)
    console.log(failed ? `\n${failed} of ${n} called-it judge pins failed` : `\nall ${n} called-it judge pins green${process.env.BASE ? '' : ' (pure half only)'}`)
    process.exit(failed ? 1 : 0)
  })()
}
