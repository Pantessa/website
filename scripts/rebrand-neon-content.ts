#!/usr/bin/env npx tsx
/**
 * Rebrand the Yeetful → Pantessa strings that live in NEON, not in the repo.
 *
 * The #625 string sweep and the #632 domain sweep both only reach source
 * files. Published blog posts and the MCP catalog are rows, so they still say
 * "Yeetful" on the live site — most visibly "Yeetful Wallet", which sits in
 * the default 4-set every single visitor sees in the drawer.
 *
 *   npx tsx scripts/rebrand-neon-content.ts            # DRY RUN — prints a diff
 *   npx tsx scripts/rebrand-neon-content.ts --apply    # writes
 *
 * Dry run by default because this is live public content. Every change is
 * printed with surrounding context so it can be read before it ships.
 *
 * DELIBERATELY OUT OF SCOPE — do not add these here:
 *   - `Yeetful · Claude` / `· House` / `· Snapshot` / `· Nansen` catalog names.
 *     Those are coupled to ~18 code sites AND a hardcoded name IN-list in
 *     app/api/route/proof/route.ts — renaming the rows alone makes that query
 *     silently return nothing. They get their own change.
 *   - Any `slug` column. Slugs are identifiers: they appear in URLs, in
 *     wallet_working_sets, and in stored spend-grant allowlists.
 *   - `*.yeetful.com` endpoints. Those hosts still serve.
 */
import { PrismaClient } from '@prisma/client'

const prisma = new PrismaClient()
const APPLY = process.argv.includes('--apply')

/** Ordered, longest-first so a specific phrase wins over the bare brand word. */
const RULES: Array<[RegExp, string]> = [
  // The GitHub org renamed Yeetful → Pantessa 2026-08-17; github.com/Yeetful
  // itself 404s, and old repo URLs only 301 until the name is reclaimed.
  [/github\.com\/Yeetful\b/g, 'github.com/Pantessa'],
  // The SDK package is published as `pantessa`; `yeetful` is deprecated, so a
  // blog post telling a reader to install it hands them a dead dependency.
  [/npm install yeetful@latest` \(0\.5\)/g, 'npm install pantessa@latest`'],
  [/npm i(nstall)? yeetful/g, 'npm install pantessa'],
  [/yeetful\/(agent|client|server|next|express|embed)/g, 'pantessa/$1'],
  // Site URLs. Bare host to match how the docs and product copy read after
  // the #632 sweep ("pantessa.com/i/<slug>") — these are illustrative prose,
  // not fetch targets, so they don't need the canonical www form.
  [/\byeetful\.com\b/g, 'pantessa.com'],
  // Bare brand word in prose. Possessives handled by the plain replace.
  [/\bYeetful\b/g, 'Pantessa'],
]

/** Guard: never rewrite a line that names infrastructure. */
const KEEP = [/[a-z0-9-]+\.yeetful\.com/i, /yeetful-embed/, /@yeetful\.com/i]

function rewrite(text: string): string {
  return text
    .split('\n')
    .map((line) => {
      if (KEEP.some((re) => re.test(line))) return line
      let out = line
      for (const [re, to] of RULES) out = out.replace(re, to)
      return out
    })
    .join('\n')
}

function preview(before: string, after: string, label: string): number {
  const b = before.split('\n')
  const a = after.split('\n')
  let n = 0
  for (let i = 0; i < b.length; i++) {
    if (b[i] === a[i]) continue
    n++
    console.log(`   ${label}:${i + 1}`)
    console.log(`     - ${b[i].trim().slice(0, 150)}`)
    console.log(`     + ${a[i].trim().slice(0, 150)}`)
  }
  return n
}

async function main() {
  console.log(APPLY ? '⚠️  APPLY — writing to Neon\n' : '🔍 DRY RUN — nothing is written (pass --apply)\n')
  let total = 0

  console.log('── blog_posts ────────────────────────────────────────────')
  for (const post of await prisma.blogPost.findMany({ orderBy: { slug: 'asc' } })) {
    const next = {
      title: rewrite(post.title),
      description: post.description ? rewrite(post.description) : post.description,
      content: rewrite(post.content),
    }
    const changed =
      next.title !== post.title || next.description !== post.description || next.content !== post.content
    if (!changed) continue
    console.log(`\n ${post.slug}${post.published ? '' : '  (draft)'}`)
    let n = 0
    if (next.title !== post.title) n += preview(post.title, next.title, 'title')
    if (next.description !== post.description) n += preview(post.description ?? '', next.description ?? '', 'description')
    n += preview(post.content, next.content, 'content')
    total += n
    if (APPLY) {
      await prisma.blogPost.update({ where: { id: post.id }, data: next })
      console.log(`   ✅ updated (${n} lines)`)
    }
  }

  console.log('\n── mcp_servers descriptions (prose — "By Yeetful." on every fleet card) ──')
  for (const srv of await prisma.mcpServer.findMany({
    where: { description: { contains: 'yeetful', mode: 'insensitive' } },
    select: { slug: true, description: true },
    orderBy: { slug: 'asc' },
  })) {
    const before = srv.description ?? ''
    const next = rewrite(before)
    if (next === before) continue // only host/infra mentions — KEEP-guarded
    // Descriptions are one long line, so the blog-style 150-char preview
    // would hide a tail change ("… By Yeetful.") — window the first diff.
    let at = 0
    while (at < before.length && before[at] === next[at]) at++
    const win = (s: string) => `${at > 60 ? '…' : ''}${s.slice(Math.max(0, at - 60), at + 90)}`
    console.log(`   ${srv.slug}\n     - ${win(before)}\n     + ${win(next)}`)
    total++
    if (APPLY) {
      await prisma.mcpServer.update({ where: { slug: srv.slug }, data: { description: next } })
      console.log('   ✅ updated')
    }
  }

  console.log('\n── mcp_servers website links (seeded pre-rename — they point at the old GitHub org) ──')
  for (const srv of await prisma.mcpServer.findMany({
    where: { websiteUrl: { contains: 'github.com/yeetful', mode: 'insensitive' } },
    select: { slug: true, websiteUrl: true },
    orderBy: { slug: 'asc' },
  })) {
    const before = srv.websiteUrl ?? ''
    const next = before.replace(/github\.com\/Yeetful\b/gi, 'github.com/Pantessa')
    if (next === before) continue
    console.log(`   ${srv.slug}\n     - ${before}\n     + ${next}`)
    total++
    if (APPLY) {
      await prisma.mcpServer.update({ where: { slug: srv.slug }, data: { websiteUrl: next } })
      console.log('   ✅ updated')
    }
  }

  console.log('\n── mcp_servers (display names only — slugs are identifiers) ──')
  const NAMES: Record<string, string> = {
    'yeetful-tool-wallet': 'Pantessa Wallet',
    'yeetful-tool-funding': 'Pantessa Finance',
    'near-intents-mcp-yeetful': 'NEAR Intents MCP · Pantessa',
  }
  for (const [slug, name] of Object.entries(NAMES)) {
    const row = await prisma.mcpServer.findUnique({ where: { slug }, select: { name: true } })
    if (!row) {
      console.log(` ⏭  ${slug} — no such row`)
      continue
    }
    if (row.name === name) {
      console.log(` ✓  ${slug} — already "${name}"`)
      continue
    }
    console.log(` ${slug}\n     - ${row.name}\n     + ${name}`)
    total++
    if (APPLY) {
      await prisma.mcpServer.update({ where: { slug }, data: { name } })
      console.log('   ✅ updated')
    }
  }

  console.log(`\n${APPLY ? 'Applied' : 'Would change'} ${total} line(s).`)
  if (!APPLY && total > 0) console.log('Re-run with --apply once the diff reads right.')
  await prisma.$disconnect()
}

main().catch(async (e) => {
  console.error(e)
  await prisma.$disconnect()
  process.exit(1)
})
