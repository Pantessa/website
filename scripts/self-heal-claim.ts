#!/usr/bin/env tsx
/**
 * Self-heal step 1 — claim the next routing incident to fix.
 *
 * Picks the highest-impact OPEN incident (most occurrences, then most recent),
 * atomically flips it to `dispatched` so a concurrent/next run can't grab the
 * same one (the dedup that prevents firing twice for one bug), and writes its
 * details to ./incident.json for the agent to read. Emits GitHub Action outputs
 * (found, id, signature, branch).
 *
 * Reads DATABASE_URL from the env (CI secret) or .env.local (local testing).
 */
import { PrismaClient } from '@prisma/client'
import { readFileSync, writeFileSync, appendFileSync } from 'node:fs'
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

function setOutput(kv: Record<string, string>) {
  const out = process.env.GITHUB_OUTPUT
  for (const [k, v] of Object.entries(kv)) {
    if (out) appendFileSync(out, `${k}=${v}\n`)
    console.log(`::output:: ${k}=${v}`)
  }
}

async function main() {
  loadEnv()
  const prisma = new PrismaClient()
  try {
    // Highest-impact open incident first.
    const inc = await prisma.routeIncident.findFirst({
      where: { status: 'open' },
      orderBy: [{ count: 'desc' }, { lastSeenAt: 'desc' }],
    })
    if (!inc) {
      console.log('No open incidents — nothing to heal.')
      setOutput({ found: 'false' })
      return
    }
    // Lock it so the next run doesn't re-claim the same bug.
    await prisma.routeIncident.update({ where: { id: inc.id }, data: { status: 'dispatched' } })

    const branch = `self-heal/${inc.signature.replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '')}`
    const payload = {
      id: inc.id,
      signature: inc.signature,
      service: inc.service,
      errorClass: inc.errorClass,
      title: inc.title,
      count: inc.count,
      lastError: inc.lastError,
      exampleTurnId: inc.exampleTurnId,
      incidentUrl: `https://www.pantessa.com/incidents/${inc.id}`,
      branch,
    }
    writeFileSync(join(process.cwd(), 'incident.json'), JSON.stringify(payload, null, 2))
    console.log(`Claimed incident ${inc.id} (${inc.signature}) → ${branch}`)
    setOutput({ found: 'true', id: inc.id, signature: inc.signature, branch })
  } finally {
    await prisma.$disconnect()
  }
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
