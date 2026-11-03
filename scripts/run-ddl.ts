// scripts/run-ddl.ts — run ONE additive DDL file statement by statement against
// DATABASE_URL (prisma reads .env, not .env.local — pass the URL inline).
//   DATABASE_URL=postgres://… npx tsx scripts/run-ddl.ts prisma/ddl/<file>.sql
// Every statement in prisma/ddl/*.sql is IF NOT EXISTS / ADD COLUMN IF NOT
// EXISTS, so re-running is safe. Never `prisma db push` (it wants to DROP the
// drifted harness_results table).
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('usage: run-ddl.ts <file.sql>')
  const url = process.env.DATABASE_URL ?? ''
  const host = url.match(/@([^/:]+)/)?.[1] ?? '(no DATABASE_URL)'
  console.log(`run-ddl: ${file} → ${host}`)
  const sql = readFileSync(file, 'utf8')
  const statements = sql
    .split(/;\s*\n/)
    .map((s) => s.replace(/^\s*--.*$/gm, '').trim())
    .filter((s) => s.length > 0)
  const prisma = new PrismaClient()
  let n = 0
  try {
    for (const stmt of statements) {
      await prisma.$executeRawUnsafe(stmt)
      n++
    }
  } finally {
    await prisma.$disconnect()
  }
  console.log(`run-ddl: ${n} statements ok`)
}
main().catch((e) => {
  console.error(e)
  process.exit(1)
})
