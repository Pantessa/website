// Pins for squad landing, lane SIDES-A (2026-11-10): the Charts, Ask, Links and Earn panels.
// THE LANE OWNS THIS FILE. It is already wired into scripts/test-api.ts and
// package.json by the contract commit — fill the two functions, never edit
// the harness. Pure checks (rules, tables, source) go in the first; checks
// against a running server go in the second.
//   npx tsx scripts/landing-sides-a-pins.ts            (npm run pins:landing-sides-a)
//   BASE=http://localhost:PORT npx tsx scripts/landing-sides-a-pins.ts --served

type Check = (name: string, ok: boolean, extra?: string) => void

export function landingSidesAPins(_check: Check): void {
  // The lane's pure pins.
}

export async function landingSidesAPinsServed(_check: Check, _base: string): Promise<void> {
  // The lane's served pins.
}

if (process.argv[1]?.endsWith('landing-sides-a-pins.ts')) {
  let failed = 0
  let n = 0
  const check: Check = (name, ok, extra) => {
    n++
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => landingSidesAPins(check))
    .then(() => (served ? landingSidesAPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : `\nall green (${n})`)
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
