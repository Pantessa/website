// The `next` a Verify with X button links with (review NOTE; squad called-it,
// lane FIX). The production link is built as PROD_ORIGIN + next, so a `next`
// of `@evil.example/` would make https://www.pantessa.com@evil.example/. A
// next must be a path: it starts with exactly one `/`, no backslash, printable
// ASCII; anything else becomes `/x`. The server's safeNext still checks it.
// Pure, no imports: the client component uses it.
export function safeNextProp(next: string | undefined | null): string {
  if (typeof next !== 'string') return '/x'
  if (!/^\/(?![\/\\])/.test(next) || next.includes('\\') || !/^[\x20-\x7e]+$/.test(next) || next.length > 300) return '/x'
  return next
}
