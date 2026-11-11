#!/usr/bin/env node
// Puts TradingView's Advanced Charts where the app serves it from:
// public/charting_library/ (gitignored). Runs before `next build`.
//
// WHY A SCRIPT. The library is licensed, not open source. Its terms: "The
// library is not redistributable" and "It is prohibited to use any part of
// the library in public repositories". This repository is public, so the
// files are fetched at build time and never committed. tv-library.json
// names the release; nothing of the library lives in git.
//
// Where it looks, in order:
//   1. TV_LIBRARY_DIR            a checkout of the library on this machine
//   2. ../.vendor or ../../.vendor/tradingview/charting_library
//                                the same, at the place this project keeps it
//   3. TV_LIBRARY_TOKEN          a GitHub token that can read TV_LIBRARY_REPO
//                                (default: the repo in tv-library.json, a
//                                PRIVATE mirror of TradingView's repository
//                                with the same commits): the pinned commit is
//                                downloaded and unpacked. This is how a
//                                Vercel build gets it. The token needs
//                                read-only access to that one repository.
//   4. nothing                   says so in one line and exits 0. The build
//                                ships no library and every chart is the
//                                built-in one (lib/tv/config).
//
// TV_LIBRARY=off skips all of it and removes an installed copy: the build is
// the built-in chart only.
//
// A failure to fetch is never a failed build: the site without the Advanced
// chart is the site as it was. `--strict` turns a miss into exit 1 (a CI
// check that the deploy really has it); `--check` only reports.

import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, resolve } from 'node:path'
import { execFileSync } from 'node:child_process'
import { fileURLToPath } from 'node:url'

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const dest = join(root, 'public', 'charting_library')
const stamp = join(dest, '.pantessa-ref')
const pin = JSON.parse(readFileSync(join(root, 'tv-library.json'), 'utf8'))
const args = new Set(process.argv.slice(2))
const strict = args.has('--strict')
const say = (msg) => console.log(`[tv-library] ${msg}`)

/** The version a library folder says it is ("CL v33.1.0 (…)" → 33.1.0), or null. */
function versionOf(dir) {
  try {
    const desc = JSON.parse(readFileSync(join(dir, 'package.json'), 'utf8')).description ?? ''
    return /v(\d+\.\d+(?:\.\d+)?)/.exec(desc)?.[1] ?? null
  } catch {
    return null
  }
}
const installed = () => existsSync(join(dest, 'charting_library.standalone.js'))
const installedRef = () => {
  try {
    return readFileSync(stamp, 'utf8').trim()
  } catch {
    return null
  }
}

function finish(ok, how) {
  if (ok) {
    say(`ready: v${versionOf(dest) ?? '?'} in public/charting_library (${how})`)
    process.exit(0)
  }
  say(`not installed (${how}). Charts use the built-in engine.`)
  process.exit(strict ? 1 : 0)
}

/** Copy the inner `charting_library/` folder of a checkout into public/. */
function installFrom(checkout, ref, how) {
  const inner = join(checkout, 'charting_library')
  if (!existsSync(join(inner, 'charting_library.standalone.js'))) return false
  rmSync(dest, { recursive: true, force: true })
  mkdirSync(dirname(dest), { recursive: true })
  cpSync(inner, dest, { recursive: true })
  writeFileSync(stamp, `${ref}\n`)
  say(`copied from ${how}`)
  return true
}

// TV_LIBRARY=off: build the site with the built-in chart only, whatever is on
// this machine (a harness run that must see the built-in engine, a comparison).
if (process.env.TV_LIBRARY === 'off') {
  rmSync(dest, { recursive: true, force: true })
  say('TV_LIBRARY=off: removed any installed copy. Charts use the built-in engine.')
  process.exit(0)
}

if (args.has('--check')) finish(installed(), installed() ? `ref ${installedRef() ?? 'unknown'}` : 'no files')

// Already there at the pinned release: nothing to do (a rebuild, a second worktree build).
if (installed() && installedRef() === pin.ref && !args.has('--force')) finish(true, 'already at the pinned release')

// 1 + 2: a checkout on this machine. TV_LIBRARY_LOCAL=off skips it (to
// exercise the download a Vercel build does).
const local = process.env.TV_LIBRARY_LOCAL === 'off' ? [] : [process.env.TV_LIBRARY_DIR, join(root, '..', '.vendor', 'tradingview', 'charting_library'), join(root, '..', '..', '.vendor', 'tradingview', 'charting_library')].filter(Boolean)
for (const dir of local) {
  if (!existsSync(dir)) continue
  let head = pin.ref
  try {
    head = execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    /* not a git checkout: trust the pin */
  }
  if (head !== pin.ref) say(`note: the local checkout is at ${head.slice(0, 7)}, tv-library.json pins ${pin.ref.slice(0, 7)}`)
  if (installFrom(dir, head, dir)) finish(true, 'local checkout')
}

// 3: download the pinned commit with a token.
const token = process.env.TV_LIBRARY_TOKEN
if (!token) finish(installed(), installed() ? `kept what is there (ref ${installedRef() ?? 'unknown'}); no local checkout and no TV_LIBRARY_TOKEN to refresh it` : 'no local checkout and no TV_LIBRARY_TOKEN')

const repo = process.env.TV_LIBRARY_REPO || pin.repo
if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repo) || !/^[0-9a-f]{7,40}$/.test(pin.ref)) finish(false, 'tv-library.json or TV_LIBRARY_REPO is malformed')

const work = mkdtempSync(join(tmpdir(), 'tv-library-'))
let outcome = [false, 'download failed']
try {
  const res = await fetch(`https://api.github.com/repos/${repo}/tarball/${pin.ref}`, {
    headers: { authorization: `Bearer ${token}`, accept: 'application/vnd.github+json', 'user-agent': 'tv-library-install' },
    redirect: 'follow',
    signal: AbortSignal.timeout(120_000),
  })
  if (!res.ok) {
    outcome = [false, `GitHub answered ${res.status} for ${repo}@${pin.ref} (does the token read that repository?)`]
  } else {
    const tarball = join(work, 'library.tgz')
    writeFileSync(tarball, Buffer.from(await res.arrayBuffer()))
    const out = join(work, 'out')
    mkdirSync(out)
    execFileSync('tar', ['-xzf', tarball, '-C', out])
    const top = readdirSync(out).map((d) => join(out, d)).find((d) => existsSync(join(d, 'charting_library', 'charting_library.standalone.js')))
    outcome = top && installFrom(top, pin.ref, `${repo}@${pin.ref}`) ? [true, 'downloaded'] : [false, 'the download did not contain the library folder']
  }
} catch (err) {
  outcome = [false, `download failed: ${err instanceof Error ? err.message : String(err)}`]
} finally {
  rmSync(work, { recursive: true, force: true })
}
finish(outcome[0], outcome[1])
