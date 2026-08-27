// generate.js — PRODUCTION generator for the Pantessa Open Seal.
// One geometry source → every SVG the brand needs. Run: `node generate.js`
// (writes the SVGs next to this file; see README.md for the PNG step).
//
// THE MARK: a guilloché seal — three bands of machine-turned lacework
// (r(θ) = R + A·sin(kθ + φ), phase-shifted families), framed by hairline
// circles, OPEN at the heart: the middle is where the signature goes.
//
// Mirrors lib/seal-geometry.ts — if a constant changes there, change it here.
// Two weights (the currency "ladder"): DEFINED (6 passes, hero → ~48px) and
// BOLD (4 heavier passes, icons/avatars/favicons below 48px). The ceremonial
// files add the microprint ring — screens ≥ 96px and print only.
const fs = require('fs');
const path = require('path');

const GREEN_DARK = '#3ECF8E';  // on ink — mirrors --accent (dark theme)
const GREEN_PAPER = '#0E8F62'; // on paper — mirrors --accent (light theme)
const INK = '#0D1712';
const WHITE = '#FFFFFF';
const CHIP_INK = '#0B0E0D';
const CHIP_PAPER = '#F7FBF8';

const CFG = {
  defined: { wM: 1, aM: 1, nC: 6 },
  bold: { wM: 1.5, aM: 1.1, nC: 4 },
};

function ringPath(R, A, k, phi) {
  const N = 140, pts = [];
  for (let i = 0; i <= N; i++) {
    const t = (i / N) * Math.PI * 2;
    const r = R + A * Math.sin(k * t + phi);
    pts.push((64 + r * Math.cos(t)).toFixed(2) + ',' + (64 + r * Math.sin(t)).toFixed(2));
  }
  return 'M ' + pts.join(' L ') + ' Z';
}

function body(weight, color) {
  const { wM, aM, nC } = CFG[weight];
  let s = '';
  s += `  <circle cx="64" cy="64" r="58" fill="none" stroke="${color}" stroke-width="${(0.9 * wM).toFixed(2)}"/>\n`;
  s += `  <circle cx="64" cy="64" r="55.5" fill="none" stroke="${color}" stroke-width="${(0.55 * wM).toFixed(2)}" opacity="0.65"/>\n`;
  const band = (R, A, k, n, w, op) => {
    for (let j = 0; j < n; j++) {
      s += `  <path d="${ringPath(R, A * aM, k, (j * Math.PI * 2) / n)}" fill="none" stroke="${color}" stroke-width="${(w * wM).toFixed(2)}" opacity="${op}"/>\n`;
    }
  };
  band(49, 4, 16, nC, 1.0, 0.9);
  band(35.5, 6, 9, nC, 1.15, 0.95);
  band(21, 6.5, 6, Math.max(3, nC - 1), 1.25, 1);
  s += `  <circle cx="64" cy="64" r="13" fill="none" stroke="${color}" stroke-width="0.5" opacity="0.55"/>\n`;
  return s;
}

const MICROTEXT = 'PANTESSA · EVERY TILE · YOUR WALLET SIGNS · THE COUNTERSIGN · ';
function microprint(color) {
  return (
    '  <defs><path id="tx" d="M 64,21 A 43,43 0 1 1 63.99,21"/></defs>\n' +
    `  <text font-family="Geist Mono, ui-monospace, monospace" font-size="4.6" letter-spacing="1.35" fill="${color}" opacity="0.9"><textPath href="#tx">${MICROTEXT}</textPath></text>\n`
  );
}

function svg(inner, label) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" role="img" aria-label="${label}">\n${inner}</svg>\n`;
}

/** Mark on transparent ground. */
function mark(weight, color, label) {
  return svg(body(weight, color), label);
}

/** Full-bleed square avatar chip (survives circle crops on social). */
function avatar(bg, color) {
  return svg(
    `  <rect width="128" height="128" fill="${bg}"/>\n` +
      '  <g transform="translate(64 64) scale(0.76) translate(-64 -64)">\n' +
      body('bold', color) +
      '  </g>\n',
    'Pantessa',
  );
}

/** Rounded app-icon chip. */
function appIcon(rx) {
  return svg(
    `  <rect width="128" height="128" rx="${rx}" fill="${CHIP_INK}"/>\n` +
      '  <g transform="translate(64 64) scale(0.76) translate(-64 -64)">\n' +
      body('bold', GREEN_DARK) +
      '  </g>\n',
    'Pantessa',
  );
}

const OUT = __dirname;
const files = {
  // the mark, transparent ground — defined cut (≥48px)
  'pantessa-seal.svg': mark('defined', GREEN_PAPER, 'Pantessa'),
  'pantessa-seal-dark.svg': mark('defined', GREEN_DARK, 'Pantessa'),
  'pantessa-seal-black.svg': mark('defined', INK, 'Pantessa'),
  'pantessa-seal-white.svg': mark('defined', WHITE, 'Pantessa'),
  // the bold cut (icons, tiles, anything under 48px)
  'pantessa-seal-bold.svg': mark('bold', GREEN_PAPER, 'Pantessa'),
  'pantessa-seal-bold-dark.svg': mark('bold', GREEN_DARK, 'Pantessa'),
  'pantessa-seal-bold-black.svg': mark('bold', INK, 'Pantessa'),
  'pantessa-seal-bold-white.svg': mark('bold', WHITE, 'Pantessa'),
  // ceremonial — microprint ring; ≥96px and print ONLY
  'pantessa-seal-microprint.svg': svg(body('defined', GREEN_PAPER) + microprint(GREEN_PAPER), 'Pantessa'),
  'pantessa-seal-microprint-dark.svg': svg(body('defined', GREEN_DARK) + microprint(GREEN_DARK), 'Pantessa'),
  // social avatars — full-bleed squares (crop-safe for circular masks)
  'pantessa-avatar-ink.svg': avatar(CHIP_INK, GREEN_DARK),
  'pantessa-avatar-paper.svg': avatar(CHIP_PAPER, GREEN_PAPER),
  'pantessa-avatar-black-on-white.svg': avatar(WHITE, INK),
  'pantessa-avatar-white-on-black.svg': avatar('#000000', WHITE),
  // app icon (rounded chip) + the favicon source
  'pantessa-app-icon.svg': appIcon(30),
  'pantessa-favicon.svg': appIcon(28),
};

for (const [name, content] of Object.entries(files)) {
  fs.writeFileSync(path.join(OUT, name), content);
}
console.log(`wrote ${Object.keys(files).length} SVGs to ${OUT}`);
