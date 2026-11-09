// Run an additive DDL file statement by statement against DATABASE_URL.
//   DATABASE_URL=… npx tsx scripts/run-ddl.ts prisma/ddl/<file>.sql
// Refuses anything that is not ADD / CREATE … IF NOT EXISTS (the standing
// rule: additive schema changes only), and prints the host it is about to
// write to before it writes. PROD is an owner step — this script will run
// there only with --host-ok=<the exact host printed>.
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

async function main() {
  const file = process.argv[2]
  if (!file) throw new Error('usage: tsx scripts/run-ddl.ts <file.sql> [--host-ok=<host>]')
  const url = process.env.DATABASE_URL ?? ''
  const host = (() => {
    try {
      return new URL(url.replace(/^"|"$/g, '')).host
    } catch {
      return ''
    }
  })()
  if (!host) throw new Error('DATABASE_URL is not set (pass it inline; prisma reads .env, not .env.local)')
  const hostOk = process.argv.find((a) => a.startsWith('--host-ok='))?.slice('--host-ok='.length)
  const isTest = /^ep-tiny-butterfly/.test(host)
  console.log(`host: ${host}${isTest ? ' (TEST)' : ''}`)
  if (!isTest && hostOk !== host) throw new Error(`not the TEST host. Re-run with --host-ok=${host} if this write is meant.`)
  const sql = readFileSync(file, 'utf8')
    .split('\n')
    .filter((l) => !l.trim().startsWith('--'))
    .join('\n')
  const statements = sql.split(';').map((s) => s.trim()).filter(Boolean)
  for (const st of statements) {
    if (!/^(ALTER TABLE \S+ ADD COLUMN IF NOT EXISTS|CREATE TABLE IF NOT EXISTS|CREATE (UNIQUE )?INDEX IF NOT EXISTS)\b/i.test(st)) {
      throw new Error(`refused (not additive): ${st.slice(0, 90)}`)
    }
  }
  const prisma = new PrismaClient({ datasources: { db: { url: url.replace(/^"|"$/g, '') } } })
  for (const st of statements) {
    await prisma.$executeRawUnsafe(st)
    console.log(`ok  ${st.split('\n')[0].slice(0, 100)}`)
  }
  await prisma.$disconnect()
  console.log(`\n${statements.length} statements applied`)
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
