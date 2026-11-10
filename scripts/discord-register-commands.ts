// Owner script (lane DISCORD): register the `/pantessa` slash command.
//   npx tsx scripts/discord-register-commands.ts            dry: prints the JSON
//   npx tsx scripts/discord-register-commands.ts --apply    PUTs it (global commands)
// Needs DISCORD_APP_ID + DISCORD_BOT_TOKEN in the environment for --apply.
// Built from BOT_COMMANDS (lib/community/spec) through lib/discord/interactions.
import { discordCommandSpec } from '../lib/discord/interactions'

async function main() {
  const body = discordCommandSpec()
  const apply = process.argv.includes('--apply')
  console.log(JSON.stringify(body, null, 2))
  if (!apply) {
    console.log('\n(dry run; pass --apply to register)')
    return
  }
  const appId = (process.env.DISCORD_APP_ID ?? '').trim()
  const token = (process.env.DISCORD_BOT_TOKEN ?? '').trim()
  if (!/^\d{17,20}$/.test(appId) || !token) {
    console.error('--apply needs DISCORD_APP_ID and DISCORD_BOT_TOKEN')
    process.exit(2)
  }
  const res = await fetch(`https://discord.com/api/v10/applications/${appId}/commands`, {
    method: 'PUT',
    headers: { 'content-type': 'application/json', authorization: `Bot ${token}` },
    body: JSON.stringify(body),
    redirect: 'error',
  })
  const text = await res.text()
  console.log(`\nPUT → ${res.status}`)
  if (!res.ok) {
    console.error(text.slice(0, 800))
    process.exit(1)
  }
  console.log(`registered ${(JSON.parse(text) as unknown[]).length} command(s)`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
