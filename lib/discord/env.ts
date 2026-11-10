// Discord env (lane DISCORD). All optional: absent = that feature says so by name.
export const discordPublicKey = () => (process.env.DISCORD_PUBLIC_KEY ?? '').trim() || null
export const discordAppId = () => {
  const v = (process.env.DISCORD_APP_ID ?? '').trim()
  return /^\d{17,20}$/.test(v) ? v : null
}
export const discordBotToken = () => (process.env.DISCORD_BOT_TOKEN ?? '').trim() || null
/** View Channel (1024) + Send Messages (2048) + Embed Links (16384). Nothing that can read history or manage anything. */
export const DISCORD_BOT_PERMISSIONS = '19456'
export function botInviteUrl(appId: string): string {
  return `https://discord.com/oauth2/authorize?client_id=${appId}&scope=bot%20applications.commands&permissions=${DISCORD_BOT_PERMISSIONS}`
}
