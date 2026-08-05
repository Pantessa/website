// gen-v2.js — PRODUCTION generator for the Pantessa pangolin (refine-c).
// One geometry source → every SVG the brand needs.
//
// Construction: one cubic spine → tapering tube (body + tail, cosine-eased) →
// chevron grout cuts spaced evenly by ARC LENGTH → neck cut → head disc +
// blunt snout. The eye is punched through the mask so it is a hole on any
// ground. One plate takes the accent: the set tessera.
const fs = require('fs');
const path = require('path');

const ACC   = '#3ECF8E';
const INK   = '#0A0A0B';
const PAPER = '#FAFAF7';
const PALE  = '#EAFFF4';
const OUT = path.join(__dirname, 'dist-v2');
fs.mkdirSync(OUT, { recursive: true });

const nz = v => { const m = Math.hypot(v[0],v[1]) || 1; return [v[0]/m, v[1]/m]; };
const f  = p => `${p[0].toFixed(1)} ${p[1].toFixed(1)}`;
const cubSpine = P => t => { const u=1-t; return [
  u*u*u*P[0][0]+3*u*u*t*P[1][0]+3*u*t*t*P[2][0]+t*t*t*P[3][0],
  u*u*u*P[0][1]+3*u*u*t*P[1][1]+3*u*t*t*P[2][1]+t*t*t*P[3][1]]; };
function prof(tbl, t, smooth) {
  t = Math.max(0, Math.min(1, t));
  for (let i=0;i<tbl.length-1;i++){ const [a,va]=tbl[i],[b,vb]=tbl[i+1];
    if (t>=a && t<=b){ let k=(t-a)/((b-a)||1);
      if (smooth) k = (1-Math.cos(Math.PI*k))/2;
      return va+(vb-va)*k; } }
  return tbl[tbl.length-1][1];
}

/* ── LOCKED GEOMETRY — refine-c (judge panel winner, 2026-08-05) ── */
const G = {
  P:    [[10,86],[30,76],[76,18],[112,60]],
  thUp: [[0,4],[0.06,8],[0.14,16],[0.3,23],[0.48,29],[0.62,28],[0.74,23],[0.84,16],[1,11]],
  thDn: [[0,3.5],[0.06,7],[0.14,14],[0.3,19],[0.48,24],[0.62,23],[0.74,19],[0.84,13],[1,9]],
  nCuts: 3, cutFrom: 0.14, cutTo: 0.70, bodyTo: 0.82,
  grout: 7, neckW: 9, chev: 0.06, accIdx: 1,
  headR: 11, snout: 25, drop: 2, eyeR: 4.6, round: 5,
  snoutW: 0.66, snoutStroke: 8, baseBack: 0.15,
  eyeFwd: 0.22, eyeUp: 0.34,
  smooth: true, arcCuts: true, tailTip: 5,
};

function geometry(g = G) {
  const S = cubSpine(g.P);
  const D = t => { const h=0.0015, A=S(Math.max(0,t-h)), B=S(Math.min(1,t+h)); return [B[0]-A[0], B[1]-A[1]]; };
  const N = t => { const d = nz(D(t)); return [-d[1], d[0]]; };
  const up = t => { const s=S(t),n=N(t),h=prof(g.thUp,t,g.smooth); return [s[0]+n[0]*h, s[1]+n[1]*h]; };
  const dn = t => { const s=S(t),n=N(t),h=prof(g.thDn,t,g.smooth); return [s[0]-n[0]*h, s[1]-n[1]*h]; };

  // arc-length table so plate cuts are evenly spaced along the curve
  const AS=400; const cum=[0]; let prev=S(0);
  for (let i=1;i<=AS;i++){ const q=S(i/AS); cum.push(cum[i-1]+Math.hypot(q[0]-prev[0],q[1]-prev[1])); prev=q; }
  const sOf = t => cum[Math.round(Math.max(0,Math.min(1,t))*AS)];
  const tAt = s => { let lo=0,hi=AS; while(lo<hi){ const m=(lo+hi)>>1; if(cum[m]<s) lo=m+1; else hi=m; } return lo/AS; };

  const ST=64, pts=[];
  let body='M '+f(up(0)); pts.push(up(0));
  for (let i=1;i<=ST;i++){ const q=up(g.bodyTo*i/ST); body+=' L '+f(q); pts.push(q); }
  for (let i=ST;i>=0;i--){ const q=dn(g.bodyTo*i/ST); body+=' L '+f(q); pts.push(q); }
  if (g.tailTip>0){ const d0=nz(D(0)); const tp=[S(0)[0]-d0[0]*g.tailTip, S(0)[1]-d0[1]*g.tailTip];
    body+=' L '+f(tp); pts.push(tp); }
  body+=' Z';

  let cutTs=[];
  if (g.arcCuts){ const sA=sOf(g.cutFrom), sB=sOf(g.cutTo);
    for (let i=0;i<g.nCuts;i++) cutTs.push(tAt(sA+(sB-sA)*i/(g.nCuts-1)));
  } else for (let i=0;i<g.nCuts;i++) cutTs.push(g.cutFrom+(g.cutTo-g.cutFrom)*(i/(g.nCuts-1)));

  const cutP = t => `M ${f(up(t))} L ${f(S(Math.max(0,t-g.chev)))} L ${f(dn(t))}`;
  const cuts = cutTs.map(t => ({ d: cutP(t), w: g.grout }));
  cuts.push({ d: cutP(g.bodyTo), w: g.neckW });

  const gT=(g.grout/2)/95;
  const plate=(ta,tb)=>{ const n=9; let d='M '+f(up(ta+gT));
    for (let i=1;i<=n;i++) d+=' L '+f(up(ta+gT+((tb-gT)-(ta+gT))*i/n));
    d+=' L '+f(S(Math.max(0,tb-gT-g.chev)));
    d+=' L '+f(dn(tb-gT));
    for (let i=n-1;i>=0;i--) d+=' L '+f(dn(ta+gT+((tb-gT)-(ta+gT))*i/n));
    d+=' L '+f(S(Math.max(0,ta+gT-g.chev)));
    return d+' Z'; };
  const ta=cutTs[g.accIdx], tb=(g.accIdx+1<cutTs.length)?cutTs[g.accIdx+1]:g.bodyTo;
  const accent=plate(ta,tb);

  const hAt=0.90, c=S(hAt), d=nz(D(hAt)), n=N(hAt);
  const tip=[c[0]+d[0]*g.snout - n[0]*g.drop, c[1]+d[1]*g.snout - n[1]*g.drop];
  const w=g.headR*g.snoutW;
  const base=[c[0]-d[0]*g.headR*g.baseBack, c[1]-d[1]*g.headR*g.baseBack];
  const snoutA=[base[0]+n[0]*w, base[1]+n[1]*w], snoutB=[base[0]-n[0]*w, base[1]-n[1]*w];
  const snoutPath=`M ${f(snoutA)} L ${f(tip)} L ${f(snoutB)} Z`;
  const eye=[c[0]+n[0]*g.headR*g.eyeUp + d[0]*g.headR*g.eyeFwd,
             c[1]+n[1]*g.headR*g.eyeUp + d[1]*g.headR*g.eyeFwd];

  const bleed=g.round/2 + g.snoutStroke/2;
  const all=pts.concat([snoutA,snoutB,tip,[c[0]-g.headR,c[1]-g.headR],[c[0]+g.headR,c[1]+g.headR]]);
  const bbox=[Math.min(...all.map(q=>q[0]))-bleed, Math.min(...all.map(q=>q[1]))-bleed,
              Math.max(...all.map(q=>q[0]))+bleed, Math.max(...all.map(q=>q[1]))+bleed];

  return { body, cuts, accent, head:c, headR:g.headR, snoutPath, snoutStroke:g.snoutStroke,
           eye, eyeR:g.eyeR, round:g.round, bbox };
}

const P = geometry();
const BW = P.bbox[2]-P.bbox[0], BH = P.bbox[3]-P.bbox[1];

/** Art body (mask + fills). `id` must be unique per document. */
function artG({ tile='currentColor', acc=ACC, id='pg' }) {
  const [x0,y0]=P.bbox;
  return `    <mask id="${id}">
      <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${BW.toFixed(1)}" height="${BH.toFixed(1)}" fill="#000"/>
      <path d="${P.body}" fill="#fff" stroke="#fff" stroke-width="${P.round}" stroke-linejoin="round"/>
      <circle cx="${P.head[0].toFixed(1)}" cy="${P.head[1].toFixed(1)}" r="${P.headR}" fill="#fff"/>
      <path d="${P.snoutPath}" fill="#fff" stroke="#fff" stroke-width="${P.snoutStroke}" stroke-linejoin="round"/>
      <g fill="none" stroke="#000" stroke-linejoin="round" stroke-linecap="round">
${P.cuts.map(c=>`        <path d="${c.d}" stroke-width="${c.w}"/>`).join('\n')}
      </g>
      <circle cx="${P.eye[0].toFixed(1)}" cy="${P.eye[1].toFixed(1)}" r="${P.eyeR}" fill="#000"/>
    </mask>
    <rect x="${x0.toFixed(1)}" y="${y0.toFixed(1)}" width="${BW.toFixed(1)}" height="${BH.toFixed(1)}" fill="${tile}" mask="url(#${id})"/>
${acc ? `    <path d="${P.accent}" fill="${acc}" stroke="${acc}" stroke-width="2.5" stroke-linejoin="round"/>` : ''}`;
}

function fitT(margin) {
  const s = Math.min((128-margin*2)/BW, (128-margin*2)/BH);
  return `translate(${((128-BW*s)/2 - P.bbox[0]*s).toFixed(2)} ${((128-BH*s)/2 - P.bbox[1]*s).toFixed(2)}) scale(${s.toFixed(4)})`;
}

function svg({ px=128, tile='currentColor', acc=ACC, chip=null, margin=6, id='pg', defs='', label='Pantessa' }) {
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 128 128" width="${px}" height="${px}" role="img" aria-label="${label}">
${defs}${chip?`  <rect width="128" height="128" rx="${chip.rx}" fill="${chip.fill}"/>\n`:''}  <g transform="${fitT(margin)}">
${artG({ tile, acc, id })}
  </g>
</svg>
`;
}

const GRAD = (id='pgGrad') => `  <defs>
    <linearGradient id="${id}" x1="0" y1="1" x2="1" y2="0">
      <stop offset="0" stop-color="#0B4F35"/><stop offset="1" stop-color="#2FBF80"/>
    </linearGradient>
  </defs>
`;

if (require.main === module) {
  const files = {
    // ── core marks (transparent, for layout) ──
    'pantessa-pangolin.svg':            svg({ id:'pp',   tile:'currentColor', acc:ACC }),
    'pantessa-pangolin-white.svg':      svg({ id:'ppw',  tile:'#ffffff',      acc:ACC }),
    'pantessa-pangolin-ink.svg':        svg({ id:'ppk',  tile:INK,            acc:ACC }),
    'pantessa-pangolin-paper.svg':      svg({ id:'ppp',  tile:PAPER,          acc:ACC }),
    // ── single-ink (no accent) — stamps, embossing, one-color print ──
    'pantessa-pangolin-mono.svg':       svg({ id:'ppm',  tile:'currentColor', acc:null }),
    'pantessa-pangolin-mono-white.svg': svg({ id:'ppmw', tile:'#ffffff',      acc:null }),
    'pantessa-pangolin-mono-ink.svg':   svg({ id:'ppmk', tile:INK,            acc:null }),
    'pantessa-pangolin-accent.svg':     svg({ id:'ppa',  tile:ACC,            acc:null }),
    // ── chips / icons (self-contained backgrounds) ──
    'pantessa-favicon.svg':      svg({ id:'ppf', tile:'#ffffff', acc:ACC,  chip:{fill:INK,  rx:28}, margin:14 }),
    'pantessa-icon-ink.svg':     svg({ id:'ppi', tile:'#ffffff', acc:ACC,  chip:{fill:INK,  rx:28}, margin:16, px:512 }),
    'pantessa-icon-accent.svg':  svg({ id:'ppc', tile:INK,       acc:null, chip:{fill:ACC,  rx:28}, margin:16, px:512 }),
    'pantessa-icon-paper.svg':   svg({ id:'ppr', tile:INK,       acc:ACC,  chip:{fill:PAPER,rx:28}, margin:16, px:512 }),
    'pantessa-app-icon.svg':     svg({ id:'ppg', tile:'url(#pgGrad)', acc:PALE, chip:{fill:INK, rx:30}, margin:18, defs:GRAD(), px:512 }),
    'pantessa-apple-touch.svg':  svg({ id:'ppt', tile:'url(#pgGrad)', acc:PALE, chip:{fill:INK, rx:0},  margin:26, defs:GRAD(), px:180 }),
    'pantessa-avatar.svg':       svg({ id:'ppv', tile:'url(#pgGrad)', acc:PALE, chip:{fill:INK, rx:0},  margin:30, defs:GRAD(), px:512 }),
  };
  for (const [n,b] of Object.entries(files)) fs.writeFileSync(path.join(OUT, n), b);
  console.log('wrote', Object.keys(files).length, 'svgs');
  console.log('ink bbox', P.bbox.map(v=>v.toFixed(1)).join(', '), '→', BW.toFixed(1)+'×'+BH.toFixed(1));
}

module.exports = { P, BW, BH, artG, fitT, svg, GRAD, geometry, G, ACC, INK, PAPER, PALE, OUT };
