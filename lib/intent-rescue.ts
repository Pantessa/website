/**
 * The intent net — the last gate before the planner.
 *
 * Every native layer reads a grammar. When a money ask is worded a way no
 * grammar knows, it used to fall to the planner, whose house model has no
 * builders: it disclaims ("I can't execute trades"), then sends the user to
 * the venue's own site (live 2026-09-21: a $4,300 wallet asked "buy $20 worth
 * of HYPE and long for 2x" and was told to go use Hyperliquid's UI; memory
 * `planner-competitor-referrals` has the rest of the class).
 *
 * This module turns that fall into chips. It reads the ask LOOSELY — verb
 * family, amount, token, leverage, venue, chains — and composes the canonical
 * sentence each connected dapp's grammar reads. It never builds anything and
 * never guesses silently:
 *
 *   • a candidate is kept only if the REAL ladder parses it to an action
 *     (`verify`, injected — the route passes scripts/ask-ladder), so a chip
 *     can't be a second dead end;
 *   • the user taps the reading they meant; the tap re-enters the ladder as
 *     an ordinary ask, where the layer's own funding plan (bridge legs, gas
 *     legs, card door) takes over. The net finds the door; funding is the
 *     layer's job.
 *
 * PURE: no I/O, no env. The harness pins it without a server.
 */
import { normalizeWorth } from '@/lib/chain-lexicon'

export interface RescueChip {
  label: string
  resume: string
  /** Which dapp's grammar the sentence belongs to — the route turns these
   *  into the working-set slugs the chip needs (lib/ask-apps). */
  venue: 'hyperliquid' | 'lido' | 'aave' | 'morpho' | 'swap' | 'bridge'
}

export interface RescueResult {
  chips: RescueChip[]
  /** What the net understood, for the reply line and the trace. */
  read: string
}

interface Slots {
  usd?: number
  units?: number
  token?: string
  leverage?: number
  side?: 'long' | 'short'
  fromChain?: string
  toChain?: string
  onChain?: string
  venues: Set<string>
  verbs: Set<string>
}

// A question is a READ — the planner (with its data tools) owns those. A
// polite imperative ("can you buy…", "could you stake…") is still an ask.
const QUESTION_RE = /^(?:what|whats|what's|how|why|when|which|who|where|should|is|are|does|do|did|will|would it|explain|tell me|show|list|compare)\b/i
const POLITE_RE = /^(?:can|could|would|will)\s+you\b|^(?:please|pls|hey|hi|yo|ok|okay)\b[\s,]*/i

const CHAIN_WORDS: Record<string, string> = {
  base: 'base', ethereum: 'ethereum', mainnet: 'ethereum', eth: 'ethereum', arbitrum: 'arbitrum', arb: 'arbitrum',
  optimism: 'optimism', op: 'optimism', robinhood: 'robinhood chain', arc: 'arc',
}
const VERB_FAMILIES: [string, RegExp][] = [
  ['perp', /\b(?:long|short|perps?|perpetuals?|leverag(?:e|ed)|margin|futures)\b/],
  ['stake', /\b(?:stak(?:e|ing)|steth|wsteth)\b/],
  ['borrow', /\bborrow\b/],
  ['repay', /\b(?:repay|pay\s+(?:back|off))\b/],
  ['withdraw', /\b(?:withdraw|pull\s+out|take\s+out|unlend)\b/],
  ['earn', /\b(?:earn|yield|apy|apr|interest|lend|lending|supply|deposit|save|savings|put\b.*\b(?:to\s+work|into|in))\b/],
  ['bridge', /\b(?:bridge|move|send|transfer|get)\b.*\b(?:to|onto|over\s+to)\b/],
  ['sell', /\b(?:sell|dump|offload|cash\s+out|exit)\b/],
  ['buy', /\b(?:buy|purchase|get|grab|acquire|ape|pick\s+up|invest|want|need)\b/],
  ['swap', /\b(?:swap|convert|trade|exchange|turn)\b/],
]
const STOP = new Set([
  'i', 'id', 'im', 'me', 'my', 'we', 'you', 'the', 'a', 'an', 'and', 'or', 'but', 'so', 'to', 'of', 'in', 'on', 'at', 'for', 'with', 'into', 'onto', 'from', 'by', 'as', 'it',
  'is', 'be', 'this', 'that', 'some', 'all', 'more', 'please', 'pls', 'now', 'then', 'want', 'wanna', 'would', 'like', 'need', 'lets', 'can', 'could', 'will', 'get', 'go',
  'buy', 'purchase', 'sell', 'swap', 'convert', 'trade', 'exchange', 'long', 'short', 'open', 'close', 'position', 'perp', 'perps', 'perpetual', 'perpetuals', 'leverage',
  'leveraged', 'margin', 'stake', 'staking', 'earn', 'yield', 'apy', 'apr', 'interest', 'lend', 'lending', 'supply', 'deposit', 'borrow', 'repay', 'withdraw', 'bridge',
  'move', 'send', 'transfer', 'put', 'work', 'worth', 'dollars', 'dollar', 'usd', 'bucks', 'stock', 'stocks', 'share', 'shares', 'token', 'tokens', 'coin', 'coins',
  'crypto', 'money', 'funds', 'wallet', 'best', 'rate', 'idle', 'using', 'use', 'via', 'through', 'times', 'x', 'up', 'out', 'over', 'back', 'off', 'pay', 'grab', 'acquire',
  'invest', 'pick', 'turn', 'save', 'savings', 'hyperliquid', 'hl', 'aave', 'morpho', 'lido', 'uniswap', 'cow', 'cowswap', 'near', 'intents', 'chain', 'robinhood', 'base',
  'ethereum', 'mainnet', 'arbitrum', 'arb', 'optimism', 'arc', 'futures', 'dump', 'offload', 'cash', 'exit', 'ape', 'some', 'little', 'bit', 'there', 'here', 'just',
])

function readSlots(raw: string): Slots {
  const m = normalizeWorth(raw).toLowerCase().replace(/\s+/g, ' ').trim()
  const s: Slots = { venues: new Set(), verbs: new Set() }
  for (const [name, re] of VERB_FAMILIES) if (re.test(m)) s.verbs.add(name)
  for (const v of ['hyperliquid', 'aave', 'morpho', 'lido', 'uniswap', 'robinhood']) if (new RegExp(String.raw`\b${v}\b`).test(m)) s.venues.add(v)
  if (/\bhl\b/.test(m)) s.venues.add('hyperliquid')

  const usd = [...m.matchAll(/\$\s?(\d[\d,]*(?:\.\d+)?)/g)].map((d) => Number(d[1].replace(/,/g, '')))
  if (new Set(usd).size === 1 && usd[0] > 0) s.usd = usd[0]

  const lev = m.match(/(?<![\w$.])(\d{1,3})\s?x\b/) ?? m.match(/\bx\s?(\d{1,3})\b/) ?? m.match(/\b(\d{1,3})\s+times\b/)
  if (lev && s.verbs.has('perp')) s.leverage = Number(lev[1])
  if (/\blong\b/.test(m) !== /\bshort\b/.test(m)) s.side = /\blong\b/.test(m) ? 'long' : 'short'

  const from = m.match(/\bfrom\s+(?:my\s+)?([a-z]+)\b/)
  const to = m.match(/\b(?:to|onto)\s+([a-z]+)\b(?!\s+work)/)
  const on = m.match(/\bon\s+([a-z]+)\b/)
  if (from && CHAIN_WORDS[from[1]]) s.fromChain = CHAIN_WORDS[from[1]]
  if (to && CHAIN_WORDS[to[1]] && to[1] !== 'eth') s.toChain = CHAIN_WORDS[to[1]]
  if (on && CHAIN_WORDS[on[1]] && on[1] !== 'eth') s.onChain = CHAIN_WORDS[on[1]]
  // "my optimism usdc" — a chain worn as an adjective is the origin.
  const adj = m.match(/\bmy\s+(base|arbitrum|optimism|ethereum|mainnet)\s+[a-z]{2,6}\b/)
  if (adj && !s.fromChain) s.fromChain = CHAIN_WORDS[adj[1]]

  // Token: "of X" first, then "<n> X", then the one word nothing else explains.
  const ok = (w?: string): w is string => !!w && /^[a-z][a-z0-9.]{1,11}$/.test(w) && !STOP.has(w)
  const ofTok = m.match(/\b(?:of|worth)\s+\$?([a-z][a-z0-9.]{1,11})\b/)
  const usdTok = m.match(/\$\s?\d[\d,]*(?:\.\d+)?\s+(?:worth\s+)?(?:of\s+)?([a-z][a-z0-9.]{1,11})\b/)
  if (!ok(ofTok?.[1]) && ok(usdTok?.[1])) s.token = usdTok![1]
  const unitTok = m.match(/(?<![\w$.])(\d+(?:\.\d+)?)\s+([a-z][a-z0-9.]{1,11})\b/)
  if (ok(ofTok?.[1])) s.token = ofTok![1]
  if (unitTok && ok(unitTok[2]) && !/^(?:x|times)$/.test(unitTok[2])) {
    s.token ??= unitTok[2]
    if (s.token === unitTok[2] && s.usd === undefined) s.units = Number(unitTok[1])
  }
  if (!s.token) {
    const rest = [...new Set((m.match(/\b[a-z][a-z0-9.]{1,11}\b/g) ?? []).filter(ok))]
    if (rest.length === 1) s.token = rest[0]
  }
  return s
}

const up = (t: string) => t.toUpperCase()
const amt = (s: Slots, tok: string) => (s.usd !== undefined ? `$${s.usd} of ${up(tok)}` : s.units !== undefined ? `${s.units} ${up(tok)}` : null)

/** Every canonical sentence the slots could mean, best reading first. */
function compose(s: Slots): RescueChip[] {
  const out: RescueChip[] = []
  const add = (venue: RescueChip['venue'], resume: string, label = resume) => out.push({ venue, resume, label })
  const tok = s.token
  const stable = !!tok && /^usd[ctg]?$|^dai$|^usdc\.e$/.test(tok)
  const ethLike = !!tok && /^(?:w?eth|ether|ethereum)$/.test(tok)

  // Perps — side + coin, sized or not (the HL layer asks the size with chips).
  if (s.verbs.has('perp') && s.side && tok && !stable) {
    const lev = s.leverage ? `${s.leverage}x ` : ''
    const size = s.usd !== undefined ? `$${s.usd} of ${up(tok)}` : s.units !== undefined ? `${s.units} ${up(tok)}` : up(tok)
    add('hyperliquid', `${lev}${s.side} ${size} on hyperliquid`, `${lev}${s.side[0].toUpperCase()}${s.side.slice(1)} ${size} on Hyperliquid`)
  }
  // Staking — Lido is the fleet's one ETH staking venue.
  const lidoNamed = s.venues.has('lido')
  if ((s.verbs.has('stake') || lidoNamed) && (ethLike || !tok)) {
    if (s.units !== undefined) add('lido', `Stake ${s.units} ETH on Lido`)
    else add('lido', 'Help me stake ETH on Lido', 'Stake ETH on Lido — size it from my balance')
  }
  // Lending — the named venue first; with none named, both.
  if (tok && (s.verbs.has('earn') || s.verbs.has('borrow') || s.verbs.has('repay') || s.verbs.has('withdraw')) && !s.verbs.has('stake') && !lidoNamed && !s.venues.has('hyperliquid')) {
    const a = amt(s, tok)
    // Borrow / repay / withdraw grammars read token amounts only; a dollar
    // figure of a stable IS the unit figure. Anything else can't be sized here.
    const opAmt = s.units !== undefined ? `${s.units} ${up(tok)}` : s.usd !== undefined && stable ? `${s.usd} ${up(tok)}` : null
    const chain = s.onChain && s.onChain !== 'robinhood chain' ? ` on ${s.onChain}` : ''
    const venues = s.venues.has('morpho') ? ['morpho'] : s.venues.has('aave') ? ['aave'] : ['aave', 'morpho']
    for (const v of venues) {
      const V = v === 'aave' ? 'Aave' : 'Morpho'
      if (s.verbs.has('borrow')) { if (opAmt) add(v as 'aave', `Borrow ${opAmt} ${v === 'aave' ? 'from' : 'on'} ${V}${chain}`) }
      else if (s.verbs.has('repay')) { if (opAmt) add(v as 'aave', `Repay ${opAmt} on ${V}${chain}`) }
      else if (s.verbs.has('withdraw')) { if (opAmt) add(v as 'aave', `Withdraw ${opAmt} from ${V}${chain}`) }
      else if (s.verbs.has('earn') && a) add(v as 'aave', v === 'aave' ? `Supply ${a} to Aave${chain}` : `Lend ${a} on Morpho${chain}`)
    }
    // Unsized "earn yield on my usdc": the rebalance/briefing layer sizes it.
    if (s.verbs.has('earn') && !a && stable) add('aave', `Supply $25 of ${up(tok)} to Aave`, `Supply $25 of ${up(tok)} to Aave (pick any size)`)
  }
  // Moves between chains — NEAR Intents' grammar.
  if (tok && s.toChain && (s.verbs.has('bridge') || s.fromChain) && s.toChain !== 'robinhood chain') {
    const a = s.units !== undefined ? `${s.units} ${up(tok)}` : s.usd !== undefined && stable ? `${s.usd} ${up(tok)}` : null
    if (a) for (const from of s.fromChain ? [s.fromChain] : ['base', 'ethereum', 'arbitrum', 'optimism'].filter((c) => c !== s.toChain)) add('bridge', `Swap ${a} from ${from} to ${s.toChain}`, `Move ${a} from ${from} to ${s.toChain}`)
  }
  // Spot — buy / sell by dollars or units. The swap layer finds the chain,
  // the venue and (for a short wallet) the funding plan.
  if (tok && !s.side && !s.verbs.has('stake') && !lidoNamed) {
    const chain = s.onChain ? ` on ${s.onChain}` : ''
    if (s.verbs.has('sell') && amt(s, tok)) add('swap', `Sell ${amt(s, tok)}${chain}`)
    else if (s.verbs.has('buy') && s.usd !== undefined && !stable) add('swap', `Buy $${s.usd} of ${up(tok)}${chain}`)
  }
  return out
}

/**
 * The net. `verify` answers "does the real ladder build this sentence?" —
 * the route passes `(a) => simulateLadder(a).kind !== 'planner'`. Returns
 * null when the ask isn't a money imperative or nothing verifiable reads out
 * of it (the planner keeps those, as before).
 */
export function rescueIntent(message: string, verify: (ask: string) => boolean, max = 4): RescueResult | null {
  const text = message.trim()
  if (!text || text.length > 280 || /\n/.test(text)) return null
  if (/0x[0-9a-f]{8,}|\.eth\b|https?:\/\//i.test(text)) return null // addresses + links: never re-worded
  const stripped = text.replace(POLITE_RE, '')
  if (QUESTION_RE.test(stripped)) return null
  const slots = readSlots(stripped)
  if (slots.verbs.size === 0) return null
  const seen = new Set<string>()
  const chips: RescueChip[] = []
  for (const c of compose(slots)) {
    const key = c.resume.toLowerCase()
    if (seen.has(key) || key === text.toLowerCase()) continue
    seen.add(key)
    if (verify(c.resume)) chips.push(c)
    if (chips.length >= max) break
  }
  if (!chips.length) return null
  const bits = [
    slots.side ? `${slots.leverage ? `${slots.leverage}x ` : ''}${slots.side}` : [...slots.verbs][0],
    slots.usd !== undefined ? `$${slots.usd}` : slots.units !== undefined ? String(slots.units) : null,
    slots.token ? up(slots.token) : null,
  ].filter(Boolean)
  return { chips, read: bits.join(' · ') }
}
