// Run an additive DDL file statement by statement against DATABASE_URL.
//   DATABASE_URL=… npx tsx scripts/run-ddl.ts prisma/ddl/<file>.sql
// Refuses anything that is not ADD / CREATE … IF NOT EXISTS (the standing
// rule: additive schema changes only), and prints the host it is about to
// write to before it writes. PROD is an owner step — this script will run
// there only with --host-ok=<the exact host printed>.
import { readFileSync } from 'node:fs'
import { PrismaClient } from '@prisma/client'

/** Why a statement is NOT additive, or null when it is. Exported for the pin.
 *  (QA-SECURITY S11: the first fence only read how a statement STARTED, so
 *  `ADD COLUMN IF NOT EXISTS x text, DROP COLUMN title` passed.) */
export function additiveRefusal(statement: string): string | null {
  const st = statement.trim().replace(/\s+/g, ' ')
  // Nothing destructive, nothing that copies or rewrites data, no sub-statement.
  if (/\b(DROP|RENAME|TRUNCATE|DELETE|UPDATE|INSERT|GRANT|REVOKE|EXECUTE|COPY|DO)\b|ALTER COLUMN|\bAS (SELECT|WITH|TABLE)\b|\bSELECT\b/i.test(st)) return 'a destructive or data-moving word'
  // A DEFAULT is a literal: a number, a quoted string, a boolean, '{}' or CURRENT_TIMESTAMP — never a call.
  for (const m of st.matchAll(/\bDEFAULT\s+([^,)]+)/gi)) {
    if (!/^(-?\d+(\.\d+)?|'[^']*'|true|false|CURRENT_TIMESTAMP)\s*$/i.test(m[1].trim())) return 'a DEFAULT that is not a plain literal'
  }
  const alter = /^ALTER TABLE [a-z_][a-z0-9_]* (.+)$/i.exec(st)
  if (alter) {
    // Postgres runs comma-separated ALTER actions as ONE statement: every one must be an ADD COLUMN IF NOT EXISTS.
    const clauses = alter[1].split(',').map((c) => c.trim())
    return clauses.every((c) => /^ADD COLUMN IF NOT EXISTS [a-z_][a-z0-9_]* [a-z0-9_() \[\]']+( NOT NULL)?( DEFAULT .+)?$/i.test(c)) ? null : 'an ALTER clause that is not ADD COLUMN IF NOT EXISTS'
  }
  if (/^CREATE TABLE IF NOT EXISTS [a-z_][a-z0-9_]* \(/i.test(st)) return null
  if (/^CREATE (UNIQUE )?INDEX IF NOT EXISTS [a-z_][a-z0-9_]* ON [a-z_][a-z0-9_]* \(/i.test(st)) return null
  return 'not ADD COLUMN / CREATE TABLE / CREATE INDEX … IF NOT EXISTS'
}

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
    const refusal = additiveRefusal(st)
    if (refusal) throw new Error(`refused (${refusal}): ${st.slice(0, 90)}`)
  }
  const prisma = new PrismaClient({ datasources: { db: { url: url.replace(/^"|"$/g, '') } } })
  for (const st of statements) {
    await prisma.$executeRawUnsafe(st)
    console.log(`ok  ${st.split('\n')[0].slice(0, 100)}`)
  }
  await prisma.$disconnect()
  console.log(`\n${statements.length} statements applied`)
}

if (process.argv[1]?.endsWith('run-ddl.ts')) main().catch((e) => {
  console.error(e instanceof Error ? e.message : e)
  process.exit(1)
})
