#!/usr/bin/env tsx
/**
 * Self-heal step 3 — close the loop after the agent runs.
 *
 *   tsx scripts/self-heal-resolve.ts --id=<incidentId> --pr=<url|empty>
 *
 * If a PR was opened → mark the incident `pr_open` + store the URL (so it's
 * never dispatched again while the fix is in review). If the agent produced no
 * PR → release the lock back to `open` so a later run can retry.
 *
 * Reads DATABASE_URL from the env (CI secret) or .env.local.
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'

function loadEnv() {
  for (const file of ['.env.local', '.env']) {
    try {
      for (const line of readFileSync(join(process.cwd(), file), 'utf8').split('\n')) {
        const m = line.match(/^\s*([\w.]+)\s*=\s*(.*)\s*$/)
        if (m && !line.trimStart().startsWith('#') && !(m[1] in process.env)) {
          process.env[m[1]] = m[2].replace(/^["']|["']$/g, '')
        }
      }
    } catch {
      /* no env file */
    }
  }
}

const arg = (n: string) => {
  const a = process.argv.find((x) => x.startsWith(`--${n}=`))
  return a ? a.split('=').slice(1).join('=') : ''
}

async function main() {
  loadEnv()
  const id = arg('id')
  const pr = arg('pr').trim()
  if (!id) {
    console.error('--id is required')
    process.exit(1)
  }
  const prisma = new PrismaClient()
  try {
    if (pr) {
      await prisma.routeIncident.update({ where: { id }, data: { status: 'pr_open', prUrl: pr } })
      console.log(`Incident ${id} → pr_open (${pr})`)
    } else {
      // No PR produced — release the lock so it can be retried, but only if it's
      // still 'dispatched' (don't clobber a status changed elsewhere).
      const inc = await prisma.routeIncident.findUnique({ where: { id } })
      if (inc?.status === 'dispatched') {
        await prisma.routeIncident.update({ where: { id }, data: { status: 'open' } })
        console.log(`Incident ${id} → open (no PR produced; released for retry)`)
      } else {
        console.log(`Incident ${id} status is ${inc?.status ?? 'missing'} — left as-is.`)
      }
    }
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
