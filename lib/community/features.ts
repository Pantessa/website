// ─────────────────────────────────────────────────────────────────────────
//  COMMUNITY FEATURE SWITCHES — one place to turn a room surface on or off.
//
//  DISCORD_ROOMS (off since 2026-11-20): rooms launch with Telegram only.
//  Off hides every owner-facing way to START a Discord link (the checklist
//  step, the "Linked chats" Discord seat, the Discord lines in room copy and
//  /docs/community). Everything behind it stays: the DiscordPanel, the
//  /api/communities/<slug>/discord routes, delivery, the slash commands and
//  Discord sign-in. A room that already has a Discord channel linked still
//  shows it and keeps its panel, so an owner can unlink it.
//
//  To turn Discord back on: set this to true. Nothing else changes.
// ─────────────────────────────────────────────────────────────────────────

export const DISCORD_ROOMS = false
