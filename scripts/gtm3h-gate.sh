#!/usr/bin/env bash
# QA gate — squad gtm-3h ("Your markets, everywhere"), 2026-10-13. ONE command per gate:
#
#   scripts/gtm3h-gate.sh [label]
#
# Gates the HEAD of $WT (the QA worktree: `git merge origin/feat/gtm-3h` into it first).
# Runs, in order, and prints ONE table (also written to $S/gates/<label>/summary.md):
#   build · tsc · (re)start `next start` on $PORT with the harness belt
#   (MK2_AI_MOCK=1 MARKETS_AI_IP_HOURLY_CAP=3 TASTE_GUEST_DAILY=1) · every `pins:*` in
#   package.json + any scripts/*-pins.ts no script names (BASE set, so served halves run) ·
#   audit:asks · audit:funding · the share-card probes (/api/og/live: a real pick, garbage,
#   50 markets, a 10KB t, no view; /live?t=… og:image) · test:api (quiet window on the
#   shared TEST DB, DATABASE_URL in the harness process; every ❌ labelled MAIN-TOO against
#   the control run's log, else OURS) · the crawl at 375 + 1440 (overflow, page errors,
#   stranger 401 polls, broken links) · the signed-in walls (the .env.local burner's real
#   SIWE + a watch-only EIP-6963 wallet → /dashboard/admin, /admin/flows, /failures).
#
# Env (all optional):
#   WT        worktree to gate (default: the QA worktree)
#   PORT      port for next start (default 4046 — QA's; kills ONLY the LISTEN pid on it)
#   S         scratch dir (default: the QA scratchpad)
#   CONTROL   a control test:api log to label reds against (default: $S/control/testapi.log)
#   PLAYWRIGHT_CORE  playwright-core install (default: $S/pw/node_modules/playwright-core)
#   SKIP_BUILD=1 · SKIP_TESTAPI=1 · SKIP_CRAWL=1 · SKIP_WALLS=1 · WARM=1 (re-warm
#   symbol_tradability ×12 before test:api — it rots after 24h)
#   TESTAPI_ONLY=1  start the server and run only test:api (the control run uses this)
set -u
# Run from a private copy: bash reads a script as it executes, so editing the file
# mid-gate (a 20-minute run) would make the running gate execute shifted bytes.
if [ -z "${GTM3H_GATE_COPY:-}" ]; then
  c=$(mktemp -t gtm3h-gate); cp "$0" "$c"
  GTM3H_GATE_COPY=1 exec bash "$c" "$@"
fi
export PATH="$HOME/.nvm/versions/node/v26.10.0/bin:$PATH"
WT=${WT:-/Users/nate/pantessa/website-gtm-3h-qa}
PORT=${PORT:-4046}
S=${S:-/private/tmp/claude-501/-Users-nate-pantessa/32c9f097-840a-4bec-b695-6a3eaf0fce2b/scratchpad}
PW=${PLAYWRIGHT_CORE:-$S/pw/node_modules/playwright-core}
export PLAYWRIGHT_CORE=$PW
CONTROL=${CONTROL:-$S/control/testapi.log}
B=http://localhost:$PORT
cd "$WT" || exit 2
SHA=$(git rev-parse --short=8 HEAD)
LABEL=${1:-$SHA}
D=$S/gates/$LABEL
mkdir -p "$D"
SUM=$D/summary.md
: > "$SUM"
row() { printf '| %s | %s |\n' "$1" "$(printf '%s' "$2" | sed 's/|/\\|/g')" | tee -a "$SUM"; }
echo "# Gate $LABEL — $(git log -1 --format='%h %s' | cut -c1-90)" | tee -a "$SUM"
echo "worktree $WT · branch $(git rev-parse --abbrev-ref HEAD) · DB $(grep -oE '@[^/:?]+' .env.local | grep -v '@host' | head -1) · $(date -u '+%Y-%m-%d %H:%MZ')" | tee -a "$SUM"
echo | tee -a "$SUM"
echo '| Check | Result |' | tee -a "$SUM"
echo '|---|---|' | tee -a "$SUM"

# ── 1. build ────────────────────────────────────────────────────────────────
if [ "${SKIP_BUILD:-}" = 1 ]; then row 'npm run build' 'skipped (SKIP_BUILD=1)'
else
  t0=$(date +%s)
  if npm run build > "$D/build.log" 2>&1; then row 'npm run build' "PASS ($(( $(date +%s) - t0 ))s)"
  else row 'npm run build' "**FAIL** — $(grep -m1 -iE 'error|failed' "$D/build.log" | cut -c1-160)"; fi
fi

# ── 2. tsc (after the build: `prisma generate` runs there) ──────────────────
if [ "${TESTAPI_ONLY:-}" != 1 ]; then
  if npx tsc --noEmit > "$D/tsc.log" 2>&1; then row 'npx tsc --noEmit' 'PASS (0 errors)'
  else row 'npx tsc --noEmit' "**FAIL** $(grep -c 'error TS' "$D/tsc.log") errors — $(grep -m1 'error TS' "$D/tsc.log" | cut -c1-160)"; fi
fi

# ── 3. next start on $PORT — our own port only ──────────────────────────────
pid=$(lsof -iTCP:$PORT -sTCP:LISTEN -t 2>/dev/null)
[ -n "$pid" ] && kill $pid && sleep 2
MK2_AI_MOCK=1 MARKETS_AI_IP_HOURLY_CAP=3 TASTE_GUEST_DAILY=1 nohup npx next start -p $PORT > "$D/server.log" 2>&1 &
for i in $(seq 1 90); do
  [ "$(curl -s -o /dev/null -w '%{http_code}' $B/robots.txt)" = 200 ] && break
  sleep 1
done
row "next start :$PORT" "/ → $(curl -s -o /dev/null -w '%{http_code}' -H 'x-yf-internal-run: 1' $B/)"
# warm the cold paths once (a fresh server renders cold; the crawl's 45s load timeout is not a product signal)
for r in / /live /live?view=front /t/ETH /t/AAPL /chat /story; do curl -s -o /dev/null -m 60 -H 'x-yf-internal-run: 1' "$B$r"; done

if [ "${WARM:-}" = 1 ]; then
  ( set -a; . ./.env.local; set +a
    for i in $(seq 1 12); do curl -s -m 120 -H "Authorization: Bearer $CRON_SECRET" $B/api/cron/tradability; echo; done ) > "$D/warm.log" 2>&1
  row 'symbol_tradability warm' "$(grep -c '"read"' "$D/warm.log") sweeps · last: $(tail -1 "$D/warm.log" | cut -c1-90)"
fi

if [ "${TESTAPI_ONLY:-}" != 1 ]; then
# ── 4. every pins:* script + any unnamed scripts/*-pins.ts ──────────────────
PINS=$(node -e 'const s=require("./package.json").scripts;const fs=require("fs");const named=new Set();const out=[];
for (const [k,v] of Object.entries(s)) if (/^pins:/.test(k)) { const m=v.match(/scripts\/[\w-]+\.ts/); if (m) named.add(m[0]); out.push(k) }
for (const f of fs.readdirSync("scripts")) if (/-pins\.ts$/.test(f) && !named.has("scripts/"+f)) out.push("file:scripts/"+f)
console.log(out.join(" "))')
npass=0; nfail=0; failed=''
for p in $PINS; do
  n=${p#pins:}; n=${n#file:scripts/}; n=${n%.ts}
  if [ "${p#file:}" != "$p" ]; then BASE=$B npx tsx "${p#file:}" > "$D/pins-$n.log" 2>&1; ec=$?
  else BASE=$B npm run -s "$p" > "$D/pins-$n.log" 2>&1; ec=$?; fi
  t=$(grep -cE '✅|✓' "$D/pins-$n.log"); f=$(grep -cE '❌|✗' "$D/pins-$n.log")
  if [ $ec = 0 ]; then npass=$((npass+1)); else nfail=$((nfail+1)); failed="$failed $p(exit $ec, ✅$t ❌$f: $(grep -m1 -E '❌|✗|Error' "$D/pins-$n.log" | sed 's/^ *//' | cut -c1-110))"; fi
  printf '%s exit=%s ✅%s ❌%s\n' "$p" "$ec" "$t" "$f" >> "$D/pins.txt"
done
if [ $nfail = 0 ]; then row "pins (${npass} suites)" "PASS — $(tr '\n' ' ' < "$D/pins.txt" | sed 's/exit=0 //g' | cut -c1-400)"
else row "pins ($npass green / $nfail red)" "**FAIL** —$failed"; fi

# ── 5. audit:asks · audit:funding ───────────────────────────────────────────
if npm run -s audit:asks > "$D/audit-asks.log" 2>&1; then row 'audit:asks' "PASS — $(grep -m1 -iE 'surfaced asks|asks' "$D/audit-asks.log" | cut -c1-110)"
else row 'audit:asks' "**FAIL** — $(grep -m2 -iE 'dead|finding|❌' "$D/audit-asks.log" | tr '\n' ' ' | cut -c1-200)"; fi
if npm run -s audit:funding > "$D/audit-funding.log" 2>&1; then row 'audit:funding' "PASS — $(grep -iE 'scenario|rows|cells|pass' "$D/audit-funding.log" | tail -1 | cut -c1-110)"
else row 'audit:funding' "**FAIL** — $(grep -m2 -iE 'fail|finding|❌' "$D/audit-funding.log" | tr '\n' ' ' | cut -c1-200)"; fi

# ── 6. the share card (CARD lane): /api/og/live + /live?t=… metadata ────────
probe() { curl -s -o "$D/og-$1.bin" -m 40 -w '%{http_code} %{content_type} %{size_download}B %{time_total}s' -H 'x-yf-internal-run: 1' "$2"; }
c0=$(curl -s -o /dev/null -m 30 -w '%{http_code}' -H 'x-yf-internal-run: 1' "$B/api/og/live?t=HYPE,ETH&view=front")
if [ "$c0" = 404 ]; then row 'share card /api/og/live' 'n/a (route not on this tree)'
else
  LONG=$(node -e 'console.log("A".repeat(10240))')
  FIFTY=$(node -e 'console.log(Array.from({length:50},(_,i)=>"M"+i).join(","))')
  o1=$(probe real "$B/api/og/live?t=HYPE,ETH,BTC&view=front")
  o2=$(probe garbage "$B/api/og/live?t=%3Cscript%3Ealert(1)%3C%2Fscript%3E,%00,../../etc,%F0%9F%92%A9&view=%22onload")
  o3=$(probe fifty "$B/api/og/live?t=$FIFTY&view=siege")
  o4=$(probe long "$B/api/og/live?t=$LONG&view=map")
  o5=$(probe noview "$B/api/og/live?t=HYPE")
  o6=$(probe empty "$B/api/og/live")
  bad=$(printf '%s\n' "$o1" "$o2" "$o3" "$o4" "$o5" "$o6" | grep -vcE '^200 image/png')
  row 'share card /api/og/live' "$([ "$bad" = 0 ] && echo PASS || echo "**FAIL** ($bad not 200 PNG)") — real: $o1 · garbage: $o2 · 50 markets: $o3 · 10KB t: $o4 · no view: $o5 · bare: $o6"
fi
h=$(curl -s -m 40 -H 'x-yf-internal-run: 1' "$B/live?view=front&t=HYPE,ETH,BTC")
oi=$(printf '%s' "$h" | grep -oE '<meta property="og:image" content="[^"]+"' | head -1 | sed -E 's/.*content="([^"]+)"/\1/')
h2=$(curl -s -m 40 -H 'x-yf-internal-run: 1' "$B/live")
oi2=$(printf '%s' "$h2" | grep -oE '<meta property="og:image" content="[^"]+"' | head -1 | sed -E 's/.*content="([^"]+)"/\1/')
row 'og:image /live?view=front&t=HYPE,ETH,BTC vs /live' "picked: ${oi:-**NONE**} · bare: ${oi2:-**NONE**}"
# a hostile `t` / `view` must come back escaped (never a live tag in the HTML) and never 500
x=$(curl -s -m 40 -o "$D/xss.html" -w '%{http_code}' -H 'x-yf-internal-run: 1' "$B/live?view=%22%3E%3Csvg%2Fonload%3Dalert(1)%3E&t=%3Cimg%20src%3Dx%20onerror%3Dalert(1)%3E,%22%3E%3Cscript%3Ealert(2)%3C%2Fscript%3E")
raw=$(grep -oiE '<svg/onload=alert\(1\)>|<img src=x onerror=alert\(1\)>|"><script>alert\(2\)' "$D/xss.html" | head -3 | tr '\n' ' ')
row 'hostile ?t= / ?view= on /live' "$([ "$x" = 200 ] && [ -z "$raw" ] && echo PASS || echo **FAIL**) — status $x$([ -n "$raw" ] && echo " · RAW TAG IN HTML: $raw")"

fi # TESTAPI_ONLY

# ── 7. test:api (quiet window on the shared TEST DB) ────────────────────────
if [ "${SKIP_TESTAPI:-}" = 1 ]; then row 'test:api' 'skipped (SKIP_TESTAPI=1)'
else
  waited=0; quiet=0
  while [ $waited -lt 1200 ]; do
    if pgrep -f "[t]sx.*scripts/test-api" > /dev/null; then quiet=0; else quiet=$((quiet+5)); fi
    [ $quiet -ge 30 ] && break
    sleep 5; waited=$((waited+5))
  done
  sleep $(( RANDOM % 7 ))
  others=$(pgrep -f "[t]sx.*scripts/test-api" | wc -l | tr -d ' ')
  t0=$(date +%s)
  ( set -a; . ./.env.local; set +a; BASE=$B npx tsx scripts/test-api.ts ) > "$D/testapi.log" 2>&1
  ec=$?
  P=$(grep -cE '^ *✅' "$D/testapi.log"); F=$(grep -cE '^ *❌' "$D/testapi.log")
  tail_line=$(grep -E '^[0-9]+ passed, [0-9]+ failed' "$D/testapi.log" | tail -1)
  grep -E '^ *❌' "$D/testapi.log" | sed 's/^ *❌ //' > "$D/testapi-reds.txt"
  lab=''
  if [ -f "$CONTROL" ]; then
    grep -E '^ *❌' "$CONTROL" | sed 's/^ *❌ //' > "$D/control-reds.txt"
    while IFS= read -r l; do
      k=$(printf '%s' "$l" | cut -c1-70)
      if grep -qF -- "$k" "$D/control-reds.txt"; then lab="$lab
  MAIN-TOO: $(printf '%s' "$l" | cut -c1-170)"
      # Known environment flakes on the shared TEST DB (named, never silently dropped):
      # taste (HTTP) draws 1 of 250 fake IPs and TASTE_GUEST_DAILY=1 spends each for the UTC day.
      elif printf '%s' "$l" | grep -qE '^taste \(HTTP\): a wallet-less stranger.*served=0'; then lab="$lab
  ENV: $(printf '%s' "$l" | cut -c1-170) [the guest's daily taste on a reused fake IP]"; else lab="$lab
  **OURS**: $(printf '%s' "$l" | cut -c1-170)"; fi
    done < "$D/testapi-reds.txt"
  fi
  ours=$(printf '%s' "$lab" | grep -c 'OURS')
  crashed=''; [ -z "$tail_line" ] && crashed=" · **CRASHED/INCOMPLETE** (exit $ec): $(grep -E 'Error|error' "$D/testapi.log" | tail -1 | cut -c1-140)"
  row 'test:api' "${tail_line:-✅$P ❌$F}$crashed · $(( $(date +%s) - t0 ))s · concurrent harnesses at start: $others · reds labelled vs control: ${ours} ours${lab:+ (list below)}"
  [ -n "$lab" ] && printf '%s\n' "$lab" | sed '/^$/d' > "$D/testapi-labelled.txt"
fi

if [ "${TESTAPI_ONLY:-}" != 1 ]; then
# ── 8. the crawl (375 + 1440) ───────────────────────────────────────────────
if [ "${SKIP_CRAWL:-}" = 1 ]; then row 'crawl' 'skipped (SKIP_CRAWL=1)'
else
  LIST='/,/live,/live?view=front,/live?view=siege,/live?view=map,/t/ETH,/t/AAPL,/chat,/story,/live?view=front&t=HYPE%2CETH%2CBTC,/live?t=HYPE%2CSOL'
  PLAYWRIGHT_CORE=$PW BASE=$B npx tsx scripts/gtm-crawl.ts --out "$D/crawl.json" --only "$LIST" > "$D/crawl.log" 2>&1
  node - "$D/crawl.json" <<'NODE' | tee -a "$SUM"
const fs = require('fs')
const j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8'))
const rows = j.rows
const key = (r) => `${r.route}@${r.width}`
const RES = /^Failed to load resource/
const ov = rows.filter((r) => r.overflow > 0).map((r) => `${key(r)} +${r.overflow}px`)
const nonOk = rows.filter((r) => r.status !== 200).map((r) => `${key(r)} ${r.status}`)
const pe = rows.filter((r) => r.pageErrors.length).map((r) => `${key(r)}: ${r.pageErrors[0].slice(0, 90)}`)
const realCe = (r) => r.consoleErrors.filter((c) => !RES.test(c))
const ceRows = rows.filter((r) => realCe(r).length).map((r) => `${key(r)}: ${realCe(r)[0].slice(0, 80)}`)
const polls = rows.flatMap((r) => r.failedRequests.filter((f) => /^401 /.test(f)).map((f) => `${key(r)} ${f.slice(4, 70)}`))
const req = rows.flatMap((r) => r.failedRequests.filter((f) => !/^401 /.test(f)).map((f) => `${key(r)} ${f.slice(0, 90)}`))
const img = rows.flatMap((r) => r.badImages.map((b) => `${key(r)} ${b}`))
const broken = j.broken.map((b) => `${b.href} ${b.status}`)
const rawBad = j.raw.filter((r) => r.status !== 200 || !/image\/png|xml|text\/plain/.test(r.type)).map((r) => `${r.route} ${r.status}`)
const cell = (a, n = 8) => (a.length ? `**${a.length}** — ${a.slice(0, n).join(' · ')}${a.length > n ? ' …' : ''}` : '0')
const out = [
  ['crawl: rendered', `${new Set(rows.map((r) => r.route)).size} routes × ${new Set(rows.map((r) => r.width)).size} widths (${rows.length} rows)`],
  ['crawl: non-200', cell(nonOk)],
  ['crawl: overflow', cell(ov)],
  ['crawl: page errors', cell(pe, 6)],
  ['crawl: console errors (excl. resource-load lines)', cell(ceRows, 6)],
  ['crawl: stranger 401 polls (must be 0)', cell(polls)],
  ['crawl: failed requests (non-401)', cell(req, 6)],
  ['crawl: bad images', cell(img)],
  ['crawl: broken internal links', cell(broken)],
  ['crawl: raw (sitemap/robots/OG)', rawBad.length ? `**${rawBad.join(' · ')}**` : `all ${j.raw.length} 200`],
]
for (const [k, v] of out) console.log(`| ${k} | ${String(v).replace(/\|/g, '\\|')} |`)
NODE
fi

# ── 8b. lane drives (scripts/*-drive.mjs: PICK's CDP drive, …) ─────────────
for f in scripts/*-drive.mjs; do
  [ -f "$f" ] || continue
  n=$(basename "$f" .mjs)
  BASE=$B node "$f" > "$D/$n.log" 2>&1; ec=$?
  t=$(grep -cE '✅|✓|PASS' "$D/$n.log"); f2=$(grep -cE '❌|✗|FAIL' "$D/$n.log")
  row "$n" "$([ $ec = 0 ] && echo PASS || echo "**FAIL** (exit $ec)") — ✅$t ❌$f2 · $(grep -E 'passed|failed|❌|✗' "$D/$n.log" | tail -3 | tr '\n' ' ' | cut -c1-260)"
done

# ── 9. the signed-in walls (the burner's real SIWE + a watch-only wallet) ───
if [ "${SKIP_WALLS:-}" = 1 ]; then row 'signed-in walls' 'skipped (SKIP_WALLS=1)'
else
  cat > "$D/walls.cjs" <<'WALLS'
const { join } = require('node:path')
const { createRequire } = require('node:module')
const fs = require('node:fs')
const WT = process.env.WT, BASE = process.env.BASE, OUT = process.env.OUT
const req = createRequire(join(WT, 'anchor.js'))
const { privateKeyToAccount } = req('viem/accounts')
const { createSiweMessage } = req('viem/siwe')
const { chromium } = require(process.env.PLAYWRIGHT_CORE)
const env = fs.readFileSync(join(WT, '.env.local'), 'utf8')
const pk = (env.match(/^PRIVATE_KEY=(.*)$/m)?.[1] ?? '').trim().replace(/^"|"$/g, '')
;(async () => {
  const account = privateKeyToAccount(pk.startsWith('0x') ? pk : `0x${pk}`)
  const n = await fetch(`${BASE}/api/auth/nonce`, { headers: { 'x-yf-internal-run': '1' } })
  const nc = (n.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_siwe_nonce=([^;]+)/)?.[0]).find(Boolean)
  const { nonce } = await n.json()
  const message = createSiweMessage({ address: account.address, chainId: 8453, domain: new URL(BASE).host, nonce, uri: BASE, version: '1' })
  const signature = await account.signMessage({ message })
  const v = await fetch(`${BASE}/api/auth/verify`, { method: 'POST', headers: { 'content-type': 'application/json', 'x-yf-internal-run': '1', ...(nc ? { cookie: nc } : {}) }, body: JSON.stringify({ message, signature }) })
  const session = (v.headers.getSetCookie?.() ?? []).map((c) => c.match(/^yf_session=([^;]+)/)?.[1]).find(Boolean)
  if (!session) { console.log(JSON.stringify({ error: `SIWE failed ${v.status}` })); return }
  const mock = `(() => { const ADDR='${account.address}'; const provider={request:async({method})=>{ if(method==='eth_accounts'||method==='eth_requestAccounts')return[ADDR]; if(method==='eth_chainId')return'0x2105'; if(method==='wallet_switchEthereumChain')return null; throw new Error('unsupported: '+method)}, on:()=>{}, removeListener:()=>{} };
    const detail=Object.freeze({info:{uuid:'mock-0001-0000-0000-000000000001',name:'Mock Wallet',icon:'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',rdns:'dev.mock.wallet'},provider});
    const announce=()=>window.dispatchEvent(new CustomEvent('eip6963:announceProvider',{detail})); window.addEventListener('eip6963:requestProvider',announce); announce();
    try{localStorage.setItem('wagmi.recentConnectorId','"dev.mock.wallet"')}catch{} })()`
  const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true })
  const res = []
  for (const vp of [{ width: 1440, height: 900 }, { width: 375, height: 812 }]) {
    const ctx = await browser.newContext({ viewport: vp, isMobile: vp.width < 768 })
    await ctx.addCookies([{ name: 'yf_session', value: session, domain: 'localhost', path: '/' }])
    await ctx.addInitScript(mock)
    await ctx.route((u) => u.origin === new URL(BASE).origin, (r) => r.continue({ headers: { ...r.request().headers(), 'x-yf-internal-run': '1' } }))
    for (const path of ['/dashboard/admin', '/dashboard/admin/flows', '/dashboard/failures']) {
      const page = await ctx.newPage()
      const errs = [], fails = []
      page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)))
      page.on('response', (r) => { if (r.status() >= 400 && r.url().startsWith(BASE) && !/_vercel/.test(r.url())) fails.push(`${r.status()} ${r.url().replace(BASE, '').slice(0, 80)}`) })
      let status = null
      try { status = (await page.goto(BASE + path, { waitUntil: 'load', timeout: 60000 }))?.status() ?? null } catch (e) { errs.push('NAV ' + String(e.message).slice(0, 100)) }
      await page.waitForTimeout(9000)
      const m = await page.evaluate(() => ({ url: location.pathname, h: Array.from(document.querySelectorAll('h1,h2')).map((x) => x.textContent.trim()).filter(Boolean).slice(0, 3), len: (document.querySelector('main')?.innerText ?? document.body.innerText).length, overflow: document.documentElement.scrollWidth - document.documentElement.clientWidth, door: /Sign in to see|Connect a wallet to/i.test(document.body.innerText) })).catch((e) => ({ error: String(e) }))
      const shot = `${OUT}/wall-${path.replace(/\//g, '_')}-${vp.width}.png`
      await page.screenshot({ path: shot }).catch(() => {})
      res.push({ path, width: vp.width, status, ...m, pageErrors: errs, failed: fails })
      await page.close()
    }
    // signed-in on the live surfaces: count the per-surface reads (one hook instance per surface)
    for (const path of vp.width === 1440 ? ['/', '/live', '/live?view=front'] : []) {
      const page = await ctx.newPage()
      const errs = [], reqs = {}
      page.on('pageerror', (e) => errs.push(String(e.message).slice(0, 140)))
      page.on('request', (r) => { const u = new URL(r.url()); if (u.origin === new URL(BASE).origin && u.pathname.startsWith('/api/')) { const k = `${r.method()} ${u.pathname}`; reqs[k] = (reqs[k] || 0) + 1 } })
      let status = null
      try { status = (await page.goto(BASE + path, { waitUntil: 'load', timeout: 60000 }))?.status() ?? null } catch (e) { errs.push('NAV ' + String(e.message).slice(0, 100)) }
      await page.waitForTimeout(10000)
      res.push({ path, width: vp.width, status, url: await page.evaluate(() => location.pathname + location.search).catch(() => ''), live: true, reqs, pageErrors: errs, failed: [] })
      await page.close()
    }
    await ctx.close()
  }
  await browser.close()
  console.log(JSON.stringify(res))
})().catch((e) => console.log(JSON.stringify({ error: String(e) })))
WALLS
  WT=$WT BASE=$B OUT=$D PLAYWRIGHT_CORE=$PW node "$D/walls.cjs" > "$D/walls.json" 2> "$D/walls.err"
  node - "$D/walls.json" <<'NODE' | tee -a "$SUM"
const fs = require('fs')
let j; try { j = JSON.parse(fs.readFileSync(process.argv[2], 'utf8')) } catch (e) { j = { error: 'no output: ' + e } }
if (!Array.isArray(j)) { console.log(`| signed-in walls | **FAIL** — ${String(j.error).slice(0, 200)} |`); process.exit(0) }
const live = j.filter((r) => r.live)
j = j.filter((r) => !r.live)
const bad = j.filter((r) => r.status !== 200 || r.url !== r.path || r.pageErrors.length || r.len < 200 || r.overflow > 0)
const liveBad = live.filter((r) => r.status !== 200 || r.pageErrors.length)
const n = (r, k) => r.reqs[k] || 0
console.log(`| signed-in live surfaces (1440, 10s) | ${liveBad.length ? '**FAIL** ' : ''}${live.map((r) => `${r.path} ${r.status}${r.pageErrors.length ? ' pe:' + r.pageErrors[0] : ''} · GET /api/watchlists ×${n(r, 'GET /api/watchlists')} · GET /api/alerts ×${n(r, 'GET /api/alerts')} · api total ${Object.values(r.reqs).reduce((a, b) => a + b, 0)}`).join(' — ').replace(/\|/g, '\\|')} |`)
const desc = j.map((r) => `${r.path}@${r.width} ${r.status}${r.url !== r.path ? ' →' + r.url : ''} h:"${(r.h || [])[0] ?? ''}" ${r.len}ch${r.overflow ? ' ov+' + r.overflow : ''}${r.pageErrors.length ? ' pe:' + r.pageErrors[0] : ''}${r.failed.length ? ' fail:' + r.failed.slice(0, 2).join(',') : ''}`)
console.log(`| signed-in walls (burner SIWE, admin) | ${bad.length ? '**FAIL** ' + bad.length + ' — ' : 'PASS — '}${desc.join(' · ').replace(/\|/g, '\\|')} |`)
NODE
fi
fi # TESTAPI_ONLY

echo | tee -a "$SUM"
[ -f "$D/testapi-labelled.txt" ] && { echo '### test:api reds, labelled against the control' | tee -a "$SUM"; sed 's/^/- /' "$D/testapi-labelled.txt" | tee -a "$SUM"; echo | tee -a "$SUM"; }
echo "logs: $D (server left running on :$PORT)" | tee -a "$SUM"
