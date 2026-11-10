// THE HOME'S TWO POSTURES (squad landing, 2026-11-10; lane HERO owns this
// file after the contract). `/` is the app AND the landing. A stranger gets
// the landing: the full hero and the whole tour. Someone who uses the app
// gets the app: the one-line claim and the tour as a slim strip of doors.
//
// The posture is `data-home="new" | "return"` on <html>, set BEFORE FIRST
// PAINT by an inline script (HOME_MODE_BOOTSTRAP, mounted by app/page.tsx)
// so the page never jumps: the server always renders the stranger's page
// (`/` is ISR — one HTML for everyone) and CSS folds it for a returning
// visitor before a pixel is drawn. The same rule runs again after mount
// (components/home/HomeModeSync) for a soft navigation, where an inline
// script does not execute.
//
// THE RULE (homeModeFrom, pure, pinned):
//   1. the visitor's own choice wins — they closed the tour ('closed') or
//      asked for it back ('open');
//   2. a browser that has connected a wallet here is a user → return;
//   3. a third day on the home is a user → return;
//   4. otherwise new.
// One visit does not make a returning user: a stranger who bounced and came
// back the next day still needs to be told what this is.
//
// CSS reads it as `:root[data-home='return'] …`. Server HTML and a browser
// with no storage are 'new'.

export type HomeMode = 'new' | 'return'

/** The attribute on <html>. */
export const HOME_MODE_ATTR = 'data-home'
/** 'open' | 'closed' — the visitor's own choice about the tour. */
export const HOME_TOUR_PREF_KEY = 'pantessa.home.tour.v1'
/** JSON `{ n: number, day: 'YYYY-MM-DD' }` — distinct days this browser opened the home. */
export const HOME_VISITS_KEY = 'pantessa.home.visits.v1'
/** A visitor is a user from this many distinct days on. */
export const HOME_RETURN_DAYS = 3

export function homeModeFrom(i: { pref: string | null; visitDays: number; walletRemembered: boolean }): HomeMode {
  if (i.pref === 'open') return 'new'
  if (i.pref === 'closed') return 'return'
  if (i.walletRemembered) return 'return'
  return i.visitDays >= HOME_RETURN_DAYS ? 'return' : 'new'
}

/** Parse the visits record; anything unreadable is a first visit. */
export function parseVisits(raw: string | null): { n: number; day: string } {
  try {
    const v = JSON.parse(raw ?? 'null') as { n?: unknown; day?: unknown } | null
    if (v && typeof v.n === 'number' && Number.isFinite(v.n) && v.n >= 0 && typeof v.day === 'string') return { n: Math.min(Math.floor(v.n), 9999), day: v.day.slice(0, 10) }
  } catch {
    /* fall through */
  }
  return { n: 0, day: '' }
}

/** Count today once: the record after this visit. `today` is 'YYYY-MM-DD' (UTC). */
export function noteVisit(prev: { n: number; day: string }, today: string): { n: number; day: string } {
  return prev.day === today ? prev : { n: prev.n + 1, day: today }
}

/** The inline script. It mirrors homeModeFrom + noteVisit + lib/app-entry
 *  walletRemembered by hand (it runs before any module) — the pins compare
 *  the two on a table of cases. Never throws; storage that refuses leaves
 *  the page 'new'. */
export const HOME_MODE_BOOTSTRAP = `(function(){try{
var d=document.documentElement,L=localStorage,m='new';
var p=L.getItem('${HOME_TOUR_PREF_KEY}');
var v={n:0,day:''};try{var r=JSON.parse(L.getItem('${HOME_VISITS_KEY}')||'null');if(r&&typeof r.n==='number'&&isFinite(r.n)&&r.n>=0&&typeof r.day==='string')v={n:Math.min(Math.floor(r.n),9999),day:r.day.slice(0,10)}}catch(e){}
var t=new Date().toISOString().slice(0,10);
if(v.day!==t){v={n:v.n+1,day:t};try{L.setItem('${HOME_VISITS_KEY}',JSON.stringify(v))}catch(e){}}
var w=false;try{var c=JSON.parse(L.getItem('wagmi.recentConnectorId')||'null');w=typeof c==='string'&&!!c&&L.getItem('wagmi.'+c+'.disconnected')!=='true'}catch(e){}
if(p==='open')m='new';else if(p==='closed')m='return';else if(w)m='return';else if(v.n>=${HOME_RETURN_DAYS})m='return';
d.setAttribute('${HOME_MODE_ATTR}',m);
}catch(e){}})()`
