// generate.js — the ONE source for the Pantessa Emerald Cut asset kit.
// node generate.js → every SVG in this directory (plus app/ + design-system
// icons when run with --install). PNGs are rasterized from the SVGs with
// sharp-cli — the exact commands live at the bottom of README.md.
//
// The geometry MIRRORS lib/gem-geometry.ts — if the stone changes there,
// change it here and re-run. Construction: nested octagonal step-facet bands
// (the classic 1.27:1 emerald cut, corner cut scaling with each ring) with
// the eight corner miters cut through a mask, so they are holes on any
// ground. The center is the open table: where a signature lands.
//
// Weight ladder (LOAD-BEARING, from the seal era's fuzzy-header lesson):
//   fine  (5 rings) ≥ 96px   — ceremony, hero, print
//   mark  (3 rings) 32–95px  — pages, cards
//   icon  (2 rings) < 32px   — nav chips, favicons, tab bars
// Never ship a lacy cut below its floor.
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
const PNGDIR = path.join(OUT, 'png');
fs.mkdirSync(PNGDIR, { recursive: true });

// ── palette ──────────────────────────────────────────────────────────────────
const DARKBG = '#06110B';           // tile/ground behind the stone on icons
const PAPER = '#fdfdfc';
const INK = '#101512';
const TONES = {                      // deep → bright, per cut (dark grounds)
  fine: ['#0B6B4A', '#0F8156', '#159B68', '#27B67A', '#3ECF8E'],
  mark: ['#0B6B4A', '#159B68', '#3ECF8E'],
  icon: ['#159B68', '#3ECF8E'],
};
const TONES_PAPER = {                // the ramp for white/paper grounds
  fine: ['#084A33', '#0A5C40', '#0C7A52', '#0D8158', '#0e8f62'],
  mark: ['#0A5C40', '#0C7A52', '#0e8f62'],
  icon: ['#0C7A52', '#0e8f62'],
};

// ── geometry (mirror of lib/gem-geometry.ts) ────────────────────────────────
const W0 = 112, H0 = 88, C0 = 17, CX = 64, CY = 64;
const WEIGHTS = {
  fine: { rings: 5, band: 4.6, gap: 2.4 },
  mark: { rings: 3, band: 8.6, gap: 4.0 },
  icon: { rings: 2, band: 12.5, gap: 5.5 },
};
const MITER_W = 2.6;
const f = (n) => +n.toFixed(2);
const cOf = (w) => C0 * (w / W0);

function octagon(w, h, c) {
  const x0 = CX - w / 2, x1 = CX + w / 2, y0 = CY - h / 2, y1 = CY + h / 2;
  const p = [
    [x0 + c, y0], [x1 - c, y0], [x1, y0 + c], [x1, y1 - c],
    [x1 - c, y1], [x0 + c, y1], [x0, y1 - c], [x0, y0 + c],
  ];
  return 'M ' + p.map((q) => `${f(q[0])} ${f(q[1])}`).join(' L ') + ' Z';
}
function cornerMids(w, h, c) {
  return [
    [CX + w / 2 - c / 2, CY - h / 2 + c / 2],
    [CX + w / 2 - c / 2, CY + h / 2 - c / 2],
    [CX - w / 2 + c / 2, CY + h / 2 - c / 2],
    [CX - w / 2 + c / 2, CY - h / 2 + c / 2],
  ];
}
function geometry(weight) {
  const { rings, band, gap } = WEIGHTS[weight];
  const bands = [];
  let w = W0, h = H0;
  for (let i = 0; i < rings; i++) {
    const outer = octagon(w, h, cOf(w));
    const w2 = w - band * 2, h2 = h - band * 2;
    bands.push({ outer, inner: octagon(w2, h2, Math.max(2.5, cOf(w2))) });
    w = w2 - gap * 2; h = h2 - gap * 2;
  }
  const mo = cornerMids(W0, H0, C0);
  const mi = cornerMids(w + 2, h + 2, Math.max(3, cOf(w)));
  const miters = mo.map((m, k) => ({ x1: f(m[0]), y1: f(m[1]), x2: f(mi[k][0]), y2: f(mi[k][1]) }));
  return { bands, miters };
}

let uid = 0;
/** Inner SVG body for one stone: mask (miter holes) + banded fills. */
function gemBody(weight, fills) {
  const { bands, miters } = geometry(weight);
  const id = `g${uid++}`;
  const cuts = miters
    .map((m) => `<line x1="${m.x1}" y1="${m.y1}" x2="${m.x2}" y2="${m.y2}" stroke="#000" stroke-width="${MITER_W}"/>`)
    .join('');
  const stone = bands
    .map((b, i) => `<path d="${b.outer} ${b.inner}" fill-rule="evenodd" fill="${fills[i]}"/>`)
    .join('');
  return `<mask id="${id}"><rect width="128" height="128" fill="#fff"/>${cuts}</mask><g mask="url(#${id})">${stone}</g>`;
}
const svg128 = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${inner}</svg>\n`;
const mono = (weight, ink) => gemBody(weight, WEIGHTS[weight] ? Array(WEIGHTS[weight].rings).fill(ink) : [ink]);

// ── wordmark ("pantessa", Fraunces 600, outlined — no font dependency) ──────
const WM = JSON.parse(fs.readFileSync(path.join(OUT, 'wordmark.json'), 'utf8'));
function wordmark(color, em) {
  const s = em / WM.upm;
  return `<g transform="scale(${s.toFixed(6)})" fill="${color}">` + WM.paths.map((d) => `<path d="${d}"/>`).join('') + '</g>';
}
const wmWidth = (em) => (WM.width / WM.upm) * em;

// ── files ────────────────────────────────────────────────────────────────────
const write = (name, content) => {
  fs.writeFileSync(path.join(OUT, name), content);
  console.log('  ', name);
};

// bare stones, every cut × dark/paper + monos
for (const wgt of ['fine', 'mark', 'icon']) {
  write(`pantessa-gem-${wgt}.svg`, svg128(gemBody(wgt, TONES[wgt])));
  write(`pantessa-gem-${wgt}-paper.svg`, svg128(gemBody(wgt, TONES_PAPER[wgt])));
}
write('pantessa-gem.svg', svg128(gemBody('mark', TONES.mark)));
write('pantessa-gem-mono-white.svg', svg128(mono('mark', '#FFFFFF')));
write('pantessa-gem-mono-ink.svg', svg128(mono('mark', INK)));

// app icon (full-bleed rounded tile; iOS masks its own corners, rx here is
// for everywhere else), favicon tile (icon cut, tighter), avatar (square).
const tile = (rx, inner) =>
  svg128(`<rect width="128" height="128" rx="${rx}" fill="${DARKBG}"/>${inner}`);
const centered = (weight, fills, s) =>
  `<g transform="translate(${f(64 - 64 * s)} ${f(64 - 64 * s)}) scale(${s})">${gemBody(weight, fills)}</g>`;
write('pantessa-app-icon.svg', tile(29.6, centered('mark', TONES.mark, 0.8)));
write('pantessa-apple-touch.svg', tile(0, centered('mark', TONES.mark, 0.78)));
write('pantessa-favicon.svg', tile(24, centered('icon', TONES.icon, 0.92)));
write('pantessa-avatar.svg', tile(0, centered('mark', TONES.mark, 0.74)));

// lockups: mark + wordmark on a shared baseline
function lockup(fills, wordInk, file, { markSize = 64, gap = 22 } = {}) {
  const em = markSize * 0.86;
  const w = wmWidth(em);
  const H = markSize * 1.3;
  const totalW = markSize + gap + w + em * 0.16;
  const baseline = H / 2 + em * 0.26;
  const g =
    `<g transform="translate(0 ${f((H - markSize) / 2)}) scale(${f(markSize / 128)})">${gemBody('mark', fills)}</g>` +
    `<g transform="translate(${markSize + gap} ${f(baseline)})">${wordmark(wordInk, em)}</g>`;
  write(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(totalW)} ${f(H)}">${g}</svg>\n`);
}
lockup(TONES.mark, '#FFFFFF', 'pantessa-lockup.svg');
lockup(TONES_PAPER.mark, INK, 'pantessa-lockup-ink.svg');
lockup(Array(3).fill('#FFFFFF'), '#FFFFFF', 'pantessa-lockup-mono-white.svg');

// stacked (square-ish social), wordmark alone, X header, OG banner
{
  const em = 40, w = wmWidth(em);
  const W = Math.max(w, 128) + 24, H = 210;
  const g =
    `<g transform="translate(${f((W - 128 * 0.9) / 2)} 8) scale(0.9)">${gemBody('mark', TONES.mark)}</g>` +
    `<g transform="translate(${f((W - w) / 2)} ${f(H - 28)})">${wordmark('#FFFFFF', em)}</g>`;
  write('pantessa-stacked.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${H}">${g}</svg>\n`);
}
{
  const em = 100, w = wmWidth(em);
  write(
    'pantessa-wordmark.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-em * 0.78} ${f(w)} ${em * 1.06}"><g fill="currentColor">${WM.paths
      .map((d) => `<path transform="scale(${(em / WM.upm).toFixed(6)})" d="${d}"/>`)
      .join('')}</g></svg>\n`,
  );
}
{
  // X / Twitter header 1500×500: lockup left-of-center on black
  const markSize = 150, em = markSize * 0.86, w = wmWidth(em);
  const total = markSize + 48 + w;
  const x0 = (1500 - total) / 2, y0 = (500 - markSize) / 2;
  const g =
    `<rect width="1500" height="500" fill="#000000"/>` +
    `<g transform="translate(${f(x0)} ${f(y0)}) scale(${f(markSize / 128)})">${gemBody('fine', TONES.fine)}</g>` +
    `<g transform="translate(${f(x0 + markSize + 48)} ${f(250 + em * 0.26)})">${wordmark('#FFFFFF', em)}</g>`;
  write('pantessa-x-header.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1500 500">${g}</svg>\n`);
}
{
  // OG banner 1200×630: stacked, centered
  const g =
    `<rect width="1200" height="630" fill="#000000"/>` +
    `<g transform="translate(${f(600 - 128 * 1.35)} 118) scale(2.7)">${gemBody('fine', TONES.fine)}</g>` +
    `<g transform="translate(${f(600 - wmWidth(64) / 2)} 528)">${wordmark('#FFFFFF', 64)}</g>`;
  write('pantessa-og-banner.svg', `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1200 630">${g}</svg>\n`);
}

// ── --install: the app + design-system copies ───────────────────────────────
if (process.argv.includes('--install')) {
  const repo = path.join(__dirname, '..', '..', '..');
  fs.copyFileSync(path.join(OUT, 'pantessa-favicon.svg'), path.join(repo, 'app', 'icon.svg'));
  const ds = path.join(repo, 'public', 'design-system', 'assets');
  fs.copyFileSync(path.join(OUT, 'pantessa-favicon.svg'), path.join(ds, 'icon.svg'));
  fs.copyFileSync(path.join(OUT, 'pantessa-gem.svg'), path.join(ds, 'yeetful-mark.svg'));
  fs.copyFileSync(path.join(OUT, 'pantessa-gem-mono-ink.svg'), path.join(ds, 'yeetful-mark-black.svg'));
  fs.copyFileSync(path.join(OUT, 'pantessa-gem-mono-white.svg'), path.join(ds, 'yeetful-mark-white.svg'));
  console.log('   installed → app/icon.svg + design-system assets');
}
console.log('done.');
