// Pins for squad community, lane TELEGRAM (2026-11-09). The lane owns this
// file and fills it; the harness (scripts/test-api.ts) already calls both
// exports, so a lane never edits test-api.ts or package.json.
//   npx tsx scripts/community-telegram-pins.ts            (npm run pins:community-telegram)
//   BASE=http://localhost:PORT npx tsx scripts/community-telegram-pins.ts --served

type Check = (name: string, ok: boolean, extra?: string) => void

/** Pure pins: no server, no network, no DB. */
export function communityTelegramPins(_check: Check): void {}

/** Served pins: against a running `next start` (BASE) on the standard harness belt + the TEST DB.
 *  Every row written carries the internal-run header and is cleaned up. */
export async function communityTelegramPinsServed(_check: Check, _base: string): Promise<void> {}

if (process.argv[1]?.endsWith('community-telegram-pins.ts')) {
  let failed = 0
  const check: Check = (name, ok, extra) => {
    console.log(`${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    if (!ok) failed++
  }
  const served = process.argv.includes('--served')
  Promise.resolve()
    .then(() => communityTelegramPins(check))
    .then(() => (served ? communityTelegramPinsServed(check, process.env.BASE ?? 'http://localhost:3000') : undefined))
    .then(() => {
      console.log(failed ? `\n${failed} failed` : '\nall green')
      process.exit(failed ? 1 : 0)
    })
    .catch((e) => {
      console.error(e)
      process.exit(1)
    })
}
