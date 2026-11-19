// generate.js — the ONE source for the Pantessa Cut P asset kit.
// node generate.js → every SVG in this directory (plus app/ + design-system
// icons when run with --install). PNGs are rasterized from the SVGs by
// png-regen.sh.
//
// The geometry MIRRORS lib/gem-geometry.ts — if the letter changes there,
// change it here and re-run. Construction: a square stone is the bowl of a P
// and its open table is the counter. One cut (x + y = X1 + Y0) runs from the
// top-right corner, through the table, to the left edge of the stem; every
// other diagonal is parallel to it. The cut is a gap between two polygons,
// never a painted line, so the mark sits on any ground.
//
// Weight ladder: the letter never changes, only the width of the cut.
//   fine  (2.6) ≥ 96px   — hero, print, banners
//   mark  (3.2) 32–95px  — pages, cards, app icons
//   icon  (6.5) < 32px   — nav, tab bars, favicons
const fs = require('fs');
const path = require('path');

const OUT = __dirname;
fs.mkdirSync(path.join(OUT, 'png'), { recursive: true });

// ── palette ──────────────────────────────────────────────────────────────────
// The mark was emerald until 2026-11-19. The Split palette gave it two neons:
// magenta above the cut, violet below it (mirrors GEM_ACCENT / GEM_SHADE in
// lib/gem-geometry.ts and --gem-5 / --gem-3 in app/x402-design.css).
const DARKBG = '#07080D';            // the ground behind the mark on icons
const INK = '#101512';
const MAGENTA = '#FF48C4';
const VIOLET = '#7B4DFF';
const WHITE = '#FFFFFF';
const BLACK = '#000000';
const TONES = [MAGENTA, VIOLET];            // [lit, shade] on dark grounds
const TONES_PAPER = ['#F230B4', '#6A3DF0']; // [lit, shade] on white/paper

// ── geometry (mirror of lib/gem-geometry.ts) ────────────────────────────────
const X0 = 28, X1 = 100, Y0 = 8, Y1 = 80, C = 16, S = 22, YB = 120, LENS = 0.46;
const CUT = { fine: 2.6, mark: 3.2, icon: 6.5 };
/** The letter's own box inside the 128 grid. */
const BOX = { x: X0, y: Y0, w: X1 - X0, h: YB - Y0 };
const f = (n) => +n.toFixed(2);
const P = (pts) => 'M ' + pts.map((q) => `${f(q[0])} ${f(q[1])}`).join(' L ') + ' Z';

function pieces(weight) {
  const h = CUT[weight] / Math.SQRT2;
  const kx0 = X0 + S, kx1 = X1 - S, ky0 = Y0 + S, ky1 = Y1 - S;
  const l = (kx1 - kx0) * LENS;
  const lit = [
    [X0 + C, Y0], [X1 - h, Y0], [kx1 - h, ky0], [kx0 + l, ky0],
    [kx0, ky0 + l], [kx0, ky1 - h], [X0, Y1 - h], [X0, Y0 + C],
  ];
  const shade = [
    [X1, Y0 + h], [X1, Y1 - C], [X1 - C, Y1], [kx0, Y1], [kx0, YB - S], [X0, YB],
    [X0, Y1 + h], [kx0 + h, ky1], [kx1 - l, ky1], [kx1, ky1 - l], [kx1, ky0 + h],
  ];
  return [P(lit), P(shade)];
}
/** Inner SVG body for one mark on the 128 grid. `fills` is [lit, shade]. */
const markBody = (weight, fills) =>
  pieces(weight).map((d, i) => `<path d="${d}" fill="${fills[i]}"/>`).join('');
const mono = (ink) => [ink, ink];
const svg128 = (inner) => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128">${inner}</svg>\n`;
/** The mark alone, placed by its own box: top-left at (x, y), `height` tall. */
function markAt(x, y, height, weight, fills) {
  const s = height / BOX.h;
  return `<g transform="translate(${f(x - BOX.x * s)} ${f(y - BOX.y * s)}) scale(${f(s)})">${markBody(weight, fills)}</g>`;
}
const markWidth = (height) => (BOX.w / BOX.h) * height;

// ── wordmark ("pantessa", Fraunces 600, outlined — no font dependency) ──────
const WM = JSON.parse(fs.readFileSync(path.join(OUT, 'wordmark.json'), 'utf8'));
function wordmark(color, em) {
  const s = em / WM.upm;
  return `<g transform="scale(${s.toFixed(6)})" fill="${color}">` + WM.paths.map((d) => `<path d="${d}"/>`).join('') + '</g>';
}
const wmWidth = (em) => (WM.width / WM.upm) * em;

const write = (name, content) => {
  fs.writeFileSync(path.join(OUT, name), content);
  console.log('  ', name);
};

// ── the mark alone: every cut, both grounds, and the single inks ────────────
for (const wgt of ['fine', 'mark', 'icon']) {
  write(`pantessa-mark-${wgt}.svg`, svg128(markBody(wgt, TONES)));
  write(`pantessa-mark-${wgt}-paper.svg`, svg128(markBody(wgt, TONES_PAPER)));
}
write('pantessa-mark.svg', svg128(markBody('mark', TONES)));
write('pantessa-mark-paper.svg', svg128(markBody('mark', TONES_PAPER)));
write('pantessa-mark-mono-white.svg', svg128(markBody('mark', mono(WHITE))));
write('pantessa-mark-mono-black.svg', svg128(markBody('mark', mono(BLACK))));
write('pantessa-mark-mono-ink.svg', svg128(markBody('mark', mono(INK))));
write('pantessa-mark-mono-magenta.svg', svg128(markBody('mark', mono(MAGENTA))));

// ── icons and avatars (128 grid, mark centered) ─────────────────────────────
const tile = (rx, ground, inner) => svg128(`<rect width="128" height="128" rx="${rx}" fill="${ground}"/>${inner}`);
const centered = (weight, fills, s) =>
  `<g transform="translate(${f(64 - 64 * s)} ${f(64 - 64 * s)}) scale(${s})">${markBody(weight, fills)}</g>`;
write('pantessa-app-icon.svg', tile(29.6, DARKBG, centered('mark', TONES, 0.72)));
// Maskable: full-bleed, the letter inside Android's 80% safe circle.
write('pantessa-app-icon-maskable.svg', tile(0, DARKBG, centered('mark', TONES, 0.56)));
write('pantessa-apple-touch.svg', tile(0, DARKBG, centered('mark', TONES, 0.7)));
write('pantessa-favicon.svg', tile(24, DARKBG, centered('icon', TONES, 0.82)));
// Avatars are square and get cropped to a circle (X, Telegram, GitHub).
write('pantessa-avatar.svg', tile(0, DARKBG, centered('mark', TONES, 0.64)));
write('pantessa-avatar-magenta.svg', tile(0, MAGENTA, centered('mark', mono(DARKBG), 0.64)));
write('pantessa-avatar-black.svg', tile(0, BLACK, centered('mark', mono(WHITE), 0.64)));
write('pantessa-avatar-white.svg', tile(0, WHITE, centered('mark', mono(BLACK), 0.64)));

// ── lockups: the mark beside the wordmark ───────────────────────────────────
function lockup(fills, wordInk, file, { markH = 66, gap = 20 } = {}) {
  const em = markH * 0.8;
  const mw = markWidth(markH), w = wmWidth(em);
  const H = markH * 1.24;
  const totalW = mw + gap + w + em * 0.1;
  const g =
    markAt(0, (H - markH) / 2, markH, 'mark', fills) +
    `<g transform="translate(${f(mw + gap)} ${f(H / 2 + em * 0.26)})">${wordmark(wordInk, em)}</g>`;
  write(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(totalW)} ${f(H)}">${g}</svg>\n`);
}
lockup(TONES, WHITE, 'pantessa-lockup.svg');
lockup(TONES_PAPER, INK, 'pantessa-lockup-ink.svg');
lockup(mono(WHITE), WHITE, 'pantessa-lockup-mono-white.svg');
lockup(mono(BLACK), BLACK, 'pantessa-lockup-mono-black.svg');

function stacked(fills, wordInk, file) {
  const em = 40, w = wmWidth(em), markH = 120;
  const W = w + 32, H = 216;
  const g =
    markAt((W - markWidth(markH)) / 2, 10, markH, 'fine', fills) +
    `<g transform="translate(${f((W - w) / 2)} ${f(H - 26)})">${wordmark(wordInk, em)}</g>`;
  write(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${f(W)} ${H}">${g}</svg>\n`);
}
stacked(TONES, WHITE, 'pantessa-stacked.svg');
stacked(TONES_PAPER, INK, 'pantessa-stacked-ink.svg');
stacked(mono(WHITE), WHITE, 'pantessa-stacked-mono-white.svg');
stacked(mono(BLACK), BLACK, 'pantessa-stacked-mono-black.svg');

{
  const em = 100, w = wmWidth(em);
  write(
    'pantessa-wordmark.svg',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 ${-em * 0.78} ${f(w)} ${em * 1.06}"><g fill="currentColor">${WM.paths
      .map((d) => `<path transform="scale(${(em / WM.upm).toFixed(6)})" d="${d}"/>`)
      .join('')}</g></svg>\n`,
  );
}

// ── social ───────────────────────────────────────────────────────────────────
// A banner is the mark's own idea at full size: a ground, ONE cut on the
// mark's angle with the far side a tone off the ground, and the lockup.
// `g` = [ground, far side], `fills` = the lockup's mark, `word` = its ink.
// `a` is how far in from the right edge the cut starts at the top; it must
// stay clear of the lockup (the cut runs down and to the left at 45 degrees).
function banner(file, W, H, { g, fills, word, markH, a }) {
  const em = markH * 0.8;
  const mw = markWidth(markH), w = wmWidth(em), gap = markH * 0.3;
  const x0 = (W - (mw + gap + w)) / 2;
  const body =
    `<rect width="${W}" height="${H}" fill="${g[0]}"/>` +
    `<path d="${P([[W - a, 0], [W, 0], [W, H], [W - a - H, H]])}" fill="${g[1]}"/>` +
    markAt(x0, (H - markH) / 2, markH, 'fine', fills) +
    `<g transform="translate(${f(x0 + mw + gap)} ${f(H / 2 + em * 0.26)})">${wordmark(word, em)}</g>`;
  write(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}">${body}</svg>\n`);
}
const CUT_DARK = [DARKBG, '#0B2218'];
const CUT_BLACK = [BLACK, '#151515'];
const CUT_WHITE = [WHITE, '#F0F0F0'];
// X / Twitter header 1500×500. The avatar covers the lower-left corner on a
// profile, so the lockup is centered and the cut sits right.
banner('pantessa-x-header.svg', 1500, 500, { g: CUT_DARK, fills: TONES, word: WHITE, markH: 150, a: 60 });
banner('pantessa-x-header-black.svg', 1500, 500, { g: CUT_BLACK, fills: mono(WHITE), word: WHITE, markH: 150, a: 60 });
banner('pantessa-x-header-white.svg', 1500, 500, { g: CUT_WHITE, fills: mono(BLACK), word: BLACK, markH: 150, a: 60 });
// LinkedIn company banner 1584×396 (same build, flatter).
banner('pantessa-linkedin-banner.svg', 1584, 396, { g: CUT_DARK, fills: TONES, word: WHITE, markH: 124, a: 110 });
// OG / link-preview banner 1200×630.
banner('pantessa-og-banner.svg', 1200, 630, { g: CUT_DARK, fills: TONES, word: WHITE, markH: 160, a: -150 });

// Square post 1080×1080: the mark alone, large, on each ground.
function square(file, ground, fills) {
  const H = 560;
  write(file, `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1080 1080"><rect width="1080" height="1080" fill="${ground}"/>${markAt((1080 - markWidth(H)) / 2, (1080 - H) / 2, H, 'fine', fills)}</svg>\n`);
}
square('pantessa-social-square.svg', DARKBG, TONES);
square('pantessa-social-square-magenta.svg', MAGENTA, mono(DARKBG));
square('pantessa-social-square-black.svg', BLACK, mono(WHITE));
square('pantessa-social-square-white.svg', WHITE, mono(BLACK));

// ── --install: the app + design-system copies ───────────────────────────────
if (process.argv.includes('--install')) {
  const repo = path.join(__dirname, '..', '..', '..');
  fs.copyFileSync(path.join(OUT, 'pantessa-favicon.svg'), path.join(repo, 'app', 'icon.svg'));
  const ds = path.join(repo, 'public', 'design-system', 'assets');
  fs.copyFileSync(path.join(OUT, 'pantessa-favicon.svg'), path.join(ds, 'icon.svg'));
  fs.copyFileSync(path.join(OUT, 'pantessa-mark.svg'), path.join(ds, 'yeetful-mark.svg'));
  fs.copyFileSync(path.join(OUT, 'pantessa-mark-mono-black.svg'), path.join(ds, 'yeetful-mark-black.svg'));
  fs.copyFileSync(path.join(OUT, 'pantessa-mark-mono-white.svg'), path.join(ds, 'yeetful-mark-white.svg'));
  console.log('   installed → app/icon.svg + design-system assets');
}
console.log('done.');
