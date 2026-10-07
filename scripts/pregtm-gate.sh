#!/usr/bin/env bash
# QA gate — squad pre-gtm, 2026-10-06 overnight (adapted from squad-front-door's gate.sh). ONE command per gate:
#
#   ./gate.sh [label]
#
# Gates the HEAD of the QA worktree (merge origin/feat/front-door into it first,
# or check the integration SHA out detached there). Runs, in order:
#   build · tsc · every scripts/*-pins.ts (no --live) · audit:asks · audit:funding ·
#   (re)starts `next start` on $PORT · the replay runner (scripts/front-door-replay.ts,
#   if present) · /markets redirect + social-card probes · the crawl (375 + 1440)
#   with the crawl's own route list plus /story, /live, /live?view=front ·
#   a summary table and a diff against the previous gate's crawl ·
#   THE DEAD-END CRAWL (scripts/pregtm-deadend-crawl.ts: every visible control on the public set ×
#   signed-out / connected-empty × 1440 / 375, clicked and classified) + its diff vs DEADPREV.
#   Env adds: SKIP_DEAD=1 · DEADPREV=<deadend.json> (default: the main CONTROL crawl) · DEADJOBS (6)
#
# Env (all optional):
#   WT          worktree to gate          (default: the QA worktree)
#   PORT        port for next start       (default: 3994 — QA's; kills ONLY a LISTEN pid on it)
#   S           scratch dir for logs      (default: the QA scratchpad)
#   PLAYWRIGHT_CORE  playwright-core install (default: $S/node_modules/playwright-core)
#   SKIP_BUILD=1  reuse the current .next  ·  SKIP_CRAWL=1  skip the browser crawl
#   PREV        a previous gate dir or crawl.json to diff against (default: the newest
#               other gate dir under $S/gates)
#
# No database on this machine: test:api cannot run; the replay runner is its stand-in
# for the checks the front-door flip touches. Never run against prod (GETs-only prod
# control is a separate step: BASE=https://www.pantessa.com npx tsx scripts/gtm-crawl.ts --only …).
set -u
export PATH="$HOME/.nvm/versions/node/v26.10.0/bin:$PATH"
WT=${WT:-/Users/nate/pantessa/website-pregtm-qa}
PORT=${PORT:-3994}
S=${S:-/private/tmp/claude-501/-Users-nate-pantessa/e2a0e840-a299-4b29-9091-a4b4f50f6267/scratchpad}
PW=${PLAYWRIGHT_CORE:-$S/pw/node_modules/playwright-core}
export PLAYWRIGHT_CORE=$PW
B=http://localhost:$PORT
cd "$WT" || exit 2
SHA=$(git rev-parse --short=8 HEAD)
LABEL=${1:-$SHA}
D=$S/gates/$LABEL
mkdir -p "$D"
SUM=$D/summary.md
: > "$SUM"
row() { printf '| %s | %s |\n' "$1" "$2" | tee -a "$SUM"; }
echo "# Gate $LABEL — $(git log -1 --format='%h %s' | cut -c1-90)" | tee -a "$SUM"
echo "worktree $WT · branch $(git rev-parse --abbrev-ref HEAD) · $(date -u '+%Y-%m-%d %H:%MZ')" | tee -a "$SUM"
echo | tee -a "$SUM"
echo '| Check | Result |' | tee -a "$SUM"
echo '|---|---|' | tee -a "$SUM"

# 1. build
if [ "${SKIP_BUILD:-}" = 1 ]; then row 'npm run build' 'skipped (SKIP_BUILD=1)'
else
  t0=$(date +%s)
  if npm run build > "$D/build.log" 2>&1; then row 'npm run build' "PASS ($(( $(date +%s) - t0 ))s)"
  else row 'npm run build' "**FAIL** — $(grep -m1 -iE 'error|failed' "$D/build.log" | cut -c1-140)"; fi
fi

# 2. tsc
if npx tsc --noEmit > "$D/tsc.log" 2>&1; then row 'npx tsc --noEmit' 'PASS'
else row 'npx tsc --noEmit' "**FAIL** $(grep -c 'error TS' "$D/tsc.log") errors — $(grep -m1 'error TS' "$D/tsc.log" | cut -c1-140)"; fi

# 3. pin scripts (every scripts/*-pins.ts that exists; action-gate offline — no --live)
for f in scripts/*-pins.ts; do
  n=$(basename "$f" .ts)
  npx tsx "$f" > "$D/$n.log" 2>&1; ec=$?
  tail_line=$(grep -E 'passed|failed|green|red' "$D/$n.log" | tail -1 | cut -c1-80)
  if [ $ec = 0 ]; then row "$n" "PASS — $tail_line"
  else row "$n" "**FAIL** (exit $ec) — $tail_line · $(grep -E '❌|✗|FAIL' "$D/$n.log" | head -3 | sed 's/|/\\|/g' | cut -c1-160 | tr '\n' ' ')"; fi
done

# 4. audit:asks
if npm run audit:asks > "$D/audit-asks.log" 2>&1; then row 'audit:asks' "PASS — $(grep -m1 -E 'surfaced asks' "$D/audit-asks.log" | cut -c1-90)"
else row 'audit:asks' "**FAIL** — $(grep -m2 -iE 'dead|finding' "$D/audit-asks.log" | tr '\n' ' ' | cut -c1-160)"; fi

# 4b. audit:funding
if npm run audit:funding > "$D/audit-funding.log" 2>&1; then row 'audit:funding' "PASS — $(grep -iE 'scenario|rows|cells|pass' "$D/audit-funding.log" | tail -1 | cut -c1-110)"
else row 'audit:funding' "**FAIL** — $(grep -m2 -iE 'fail|finding|❌' "$D/audit-funding.log" | tr '\n' ' ' | cut -c1-160)"; fi

# 5. (re)start next start on $PORT — our own port only
pid=$(lsof -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null)
[ -n "$pid" ] && kill $pid && sleep 2
nohup npx next start -p $PORT > "$D/server.log" 2>&1 &
for i in $(seq 1 60); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' $B/robots.txt)" = 200 ] && break
  sleep 1
done
row "next start :$PORT" "$(curl -s -o /dev/null -w '%{http_code}' $B/) on /"

# 6. the replay runner (test:api's front-door checks, no DB)
if [ -f scripts/front-door-replay.ts ]; then
  BASE=$B npx tsx scripts/front-door-replay.ts --json "$D/replay.json" > "$D/replay.log" 2>&1
  row 'front-door-replay' "$(grep -E '^replay:|LISTED|SWEEP' "$D/replay.log" | tail -2 | tr '\n' ' ' | cut -c1-200)"
else row 'front-door-replay' 'n/a (not on this tree)'; fi

# 7. the redirect + social cards (curl, no browser)
r1=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'x-yf-internal-run: 1' $B/markets)
r2=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'x-yf-internal-run: 1' "$B/markets?tab=crypto")
r3=$(curl -s -o /dev/null -w '%{http_code} %{redirect_url}' -H 'x-yf-internal-run: 1' "$B/markets/")
case "$r1" in "308 $B/") ok=PASS;; *) ok=**FAIL**;; esac
row '/markets → /' "$ok — /markets: $r1 · ?tab=crypto: $r2 · /markets/: $r3"
og=''
for r in / /story /live /t/AAPL; do
  h=$(curl -s -H 'x-yf-internal-run: 1' "$B$r")
  oi=$(printf '%s' "$h" | grep -oE '<meta property="og:image" content="[^"]+"' | head -1 | sed -E 's/.*content="([^"]+)"/\1/')
  ti=$(printf '%s' "$h" | grep -oE '<meta name="twitter:image" content="[^"]+"' | head -1 | sed -E 's/.*content="([^"]+)"/\1/')
  og="$og $r og:$([ -n "$oi" ] && echo yes || echo **NONE**)/tw:$([ -n "$ti" ] && echo yes || echo **NONE**) ·"
done
row 'og:image / twitter:image' "$og"

# 8. the crawl
if [ "${SKIP_CRAWL:-}" = 1 ]; then row 'crawl' 'skipped (SKIP_CRAWL=1)'
else
  sed 's/^main().catch.*$/console.log(JSON.stringify({ROUTES}))/' scripts/gtm-crawl.ts > "$D/.routes-probe.ts"
  LIST=$(PLAYWRIGHT_CORE=$PW npx tsx "$D/.routes-probe.ts" 2>/dev/null | node -e '
    let s="";process.stdin.on("data",d=>s+=d).on("end",()=>{const r=JSON.parse(s).ROUTES
    for (const x of ["/story","/live","/live?view=front","/live?view=siege","/live?view=map","/wallet"]) if (!r.includes(x)) r.push(x)
    console.log(r.join(","))})')
  rm -f "$D/.routes-probe.ts"
  # warm the server first: the first hit of a fresh `next start` renders cold (a 45s
  # load timeout on `/` at gate 0 was this, not the product — measured 0.7s warm)
  for r in / /story /live /t/AAPL /t/ETH /pricing; do curl -s -o /dev/null -H 'x-yf-internal-run: 1' "$B$r"; done
  PLAYWRIGHT_CORE=$PW BASE=$B npx tsx scripts/gtm-crawl.ts --out "$D/crawl.json" --only "$LIST" > "$D/crawl.log" 2>&1
  if [ -z "${PREV:-}" ]; then PREV=$(ls -dt "$S"/gates/*/ 2>/dev/null | grep -v "/$LABEL/\$" | while read d; do [ -f "$d/crawl.json" ] && echo "$d" && break; done); fi
  [ -d "${PREV:-/nonexistent}" ] && PREV="$PREV/crawl.json"
  node - "$D/crawl.json" "${PREV:-}" <<'NODE' | tee -a "$SUM"
const fs = require('fs')
const [cur, prev] = process.argv.slice(2)
const j = JSON.parse(fs.readFileSync(cur, 'utf8'))
// Known no-DB / flag-off artifacts on this machine (prod 200 — see squad-gtm QA.md).
const ART = /^\/(i|l|c|p|r)\/|^\/servers\/[^/]+$|^\/lists\/|^\/agents|^\/docs\/roster|^\/roster|^\/blog\/|^\/w\//
const ARTREQ = /\/api\/(posts|activity|mosaics|lists|servers|intent-links|blog|links)|POST \/api\/markets\/(brief|ask)/ // no DB; placeholder ANTHROPIC key
const rows = j.rows
const key = (r) => `${r.route}@${r.width}`
const ov = rows.filter((r) => r.overflow > 0).map((r) => `${key(r)} +${r.overflow}px`)
const nonOk = rows.filter((r) => r.status !== 200).map((r) => `${key(r)} ${r.status}`)
const pe = rows.filter((r) => r.pageErrors.length).map((r) => `${key(r)}: ${r.pageErrors[0].slice(0, 70)}`)
// "Failed to load resource: …" carries no URL — it is the failed-request signal again
// (classified by URL below; the 404 on every page is /_vercel/insights, local only).
const RES = /^Failed to load resource/
const realCe = (r) => r.consoleErrors.filter((c) => !RES.test(c))
const ce = rows.reduce((n, r) => n + realCe(r).length, 0)
const resLines = rows.reduce((n, r) => n + r.consoleErrors.filter((c) => RES.test(c)).length, 0)
const ceRoutes = rows.filter((r) => realCe(r).length).map((r) => `${key(r)}: ${realCe(r)[0].slice(0, 60)}`)
const polls = rows.flatMap((r) => r.failedRequests.filter((f) => /^401 /.test(f)).map((f) => `${key(r)} ${f.slice(4, 60)}`))
const reqReal = rows.flatMap((r) => r.failedRequests.filter((f) => !/^401 /.test(f) && !ARTREQ.test(f)).map((f) => `${key(r)} ${f.slice(0, 80)}`))
const reqArt = rows.reduce((n, r) => n + r.failedRequests.filter((f) => ARTREQ.test(f)).length, 0)
const yt = rows.flatMap((r) => r.yeetful.map((y) => `${key(r)} "${y.slice(0, 50)}"`))
const img = rows.flatMap((r) => r.badImages.map((b) => `${key(r)} ${b}`))
const brokenReal = j.broken.filter((b) => !ART.test(b.href)).map((b) => `${b.href} ${b.status}`)
const brokenArt = j.broken.filter((b) => ART.test(b.href)).map((b) => `${b.href} ${b.status}`)
const rawBad = j.raw.filter((r) => r.status !== 200 || !/image\/png|xml|text\/plain/.test(r.type)).map((r) => `${r.route} ${r.status}`)
const cell = (a, n = 8) => (a.length ? `${a.length} — ${a.slice(0, n).join(' · ')}${a.length > n ? ' …' : ''}` : '0')
const out = [
  ['crawl: rendered', `${new Set(rows.map((r) => r.route)).size} routes × ${new Set(rows.map((r) => r.width)).size} widths`],
  ['crawl: non-200 rows', cell(nonOk)],
  ['crawl: overflow (375/1440)', cell(ov)],
  ['crawl: page errors', cell(pe, 6)],
  ['crawl: console errors (excl. resource-load lines)', `${ce} on ${ceRoutes.length} rows${ceRoutes.length ? ' — ' + ceRoutes.slice(0, 8).join(' · ') : ''}`],
  ['crawl: resource-load console lines (= failed requests)', String(resLines)],
  ['crawl: 401 polls (stranger, must be 0)', cell(polls)],
  ['crawl: failed requests (real)', cell(reqReal, 6)],
  ['crawl: failed requests (no-DB artifacts)', String(reqArt)],
  ['crawl: visible "Yeetful"', cell(yt, 4)],
  ['crawl: bad images', cell(img)],
  ['crawl: broken internal links (real)', cell(brokenReal)],
  ['crawl: broken internal links (no-DB/flag artifacts)', cell(brokenArt, 6)],
  ['raw (sitemap/robots/OG)', rawBad.length ? `**${rawBad.join(' · ')}**` : `all ${j.raw.length} 200`],
]
for (const [k, v] of out) console.log(`| ${k} | ${String(v).replace(/\|/g, '\\|')} |`)
if (prev && fs.existsSync(prev)) {
  const p = JSON.parse(fs.readFileSync(prev, 'utf8'))
  const pm = new Map(p.rows.map((r) => [key(r), r]))
  const reg = [], imp = []
  for (const r of rows) {
    const o = pm.get(key(r))
    if (!o) continue
    const d = (name, a, b) => { if (a > b) reg.push(`${key(r)} ${name} ${b}→${a}`); else if (a < b) imp.push(`${key(r)} ${name} ${b}→${a}`) }
    if (r.status !== o.status) (r.status === 200 ? imp : reg).push(`${key(r)} status ${o.status}→${r.status}`)
    d('overflow', r.overflow, o.overflow); d('pageErr', r.pageErrors.length, o.pageErrors.length)
    d('console', realCe(r).length, realCe(o).length)
    d('401', r.failedRequests.filter((f) => /^401 /.test(f)).length, o.failedRequests.filter((f) => /^401 /.test(f)).length)
    d('yeetful', r.yeetful.length, o.yeetful.length)
  }
  const pb = new Set(p.broken.map((b) => b.href)), cb = new Set(j.broken.map((b) => b.href))
  for (const h of cb) if (!pb.has(h)) reg.push(`new broken link ${h}`)
  for (const h of pb) if (!cb.has(h)) imp.push(`fixed link ${h}`)
  console.log(`| diff vs ${prev.replace(/.*gates\//, '')} | regressions ${reg.length}${reg.length ? ': ' + reg.slice(0, 12).join(' · ') : ''} — improvements ${imp.length}${imp.length ? ': ' + imp.slice(0, 8).join(' · ') : ''} |`)
}
NODE
fi

# 9. the dead-end crawl (the squad's invariant: a stranger never hits a dead end)
if [ "${SKIP_DEAD:-}" = 1 ]; then row 'dead-end crawl' 'skipped (SKIP_DEAD=1)'
else
  DEADPREV=${DEADPREV:-$S/control-main/deadend.json}
  BASE=$B npx tsx scripts/pregtm-deadend-crawl.ts --out "$D/deadend" --jobs "${DEADJOBS:-6}" $( [ -f "$DEADPREV" ] && echo --diff "$DEADPREV" ) > "$D/deadend.log" 2>&1
  row 'dead-end crawl' "$(grep -E '^deadend:' "$D/deadend.log" | tail -1 | sed 's/ → .*//' | cut -c1-160)"
  if [ -f "$D/deadend/deadend.md" ]; then
    reg=$(grep -E '^\*\*Regressions' "$D/deadend/deadend.md" | head -1); imp=$(grep -E '^\*\*Improvements' "$D/deadend/deadend.md" | head -1)
    row 'dead-end diff vs control' "${reg:-n/a} · ${imp:-n/a} (DEADPREV=$(echo "$DEADPREV" | sed 's|.*/scratchpad/||'))"
  fi
fi
echo | tee -a "$SUM"
echo "logs: $D" | tee -a "$SUM"
