// scripts/spot-home-pins.ts — pure pins for the home-chain inference and the
// chain card's come-back plan (2026-10-06). Runs inside test:api (the tail
// calls spotHomePins(check)) and alone: `npx tsx scripts/spot-home-pins.ts`.
//
// What they hold:
//   · lib/token-home EVM_SPOT_CHAINS is the ONE table — the symbol page's
//     venue map and funding destination read it (fundDestChainFor agrees for
//     every symbol), and the chat route builds where it says.
//   · inferSpotChain: pinned flagships never move; a buy goes home, else to
//     the only chain that lists it, else to the measured deepest pool; a sell
//     goes where the wallet holds the token.
//   · spotInferenceToken: the token whose market decides (never a stable, ETH
//     or a raw address).
//   · chainResumePlan: a finished chain paints finished (from the message's
//     record or the sign store), a settled prefix resumes after it and never
//     auto-fires, nothing settled is fresh.
//   · Source fences: the route runs the inference between the stock mirror
//     and the venue pick with nothing named/picked, keeps the spend retarget
//     for an inferred chain, and opens the reply with the 🏠 line unless the
//     retarget moved the build; SendTxChain takes `completed`, reconciles on
//     mount, never auto-fires a resumed step; ChatInterface passes the
//     record; the wallet view warms every chain's list and prices unpriced
//     coin rows; lib/alchemy follows pageKey.

import { readFileSync } from 'node:fs'
import { EVM_SPOT_CHAINS, inferSpotChain, spotChainLine, spotChainsFor, spotHomeChainId } from '../lib/token-home'
import { fundDestChainFor } from '../lib/symbol-venues'
import { spotInferenceToken, SPOT_INFER_CHAIN_IDS } from '../lib/spot-chain-infer'
import { CHAIN_RESUMED_LINE, CHAIN_SETTLED_LINE, chainResumePlan } from '../lib/sign-round-trip'
import { APP_CHAINS } from '../lib/chains'

type Check = (name: string, ok: boolean, extra?: string) => void

const H = (c: string) => `0x${c.repeat(64)}`

export function spotHomePins(check: Check): void {
  // ── the table ──
  const registry = new Set(APP_CHAINS.map((c) => c.id))
  const bad = Object.entries(EVM_SPOT_CHAINS).filter(([, ids]) => ids.length === 0 || ids.some((id) => !registry.has(id)) || new Set(ids).size !== ids.length)
  check('spot home: every EVM_SPOT_CHAINS row names registry chains only, at least one, none twice', bad.length === 0, bad.map(([s]) => s).join(' '))
  check('spot home: UNI, LINK, AAVE, PEPE, ENS are Ethereum-born; ARB and GMX Arbitrum; OP and VELO Optimism; AERO, DEGEN, BRETT, VIRTUAL Base; ETH and BTC lead with Base (the cheapest deep market)',
    spotHomeChainId('UNI') === 1 && spotHomeChainId('LINK') === 1 && spotHomeChainId('AAVE') === 1 && spotHomeChainId('PEPE') === 1 && spotHomeChainId('ENS') === 1 &&
      spotHomeChainId('ARB') === 42161 && spotHomeChainId('GMX') === 42161 && spotHomeChainId('OP') === 10 && spotHomeChainId('VELO') === 10 &&
      spotHomeChainId('AERO') === 8453 && spotHomeChainId('DEGEN') === 8453 && spotHomeChainId('BRETT') === 8453 && spotHomeChainId('VIRTUAL') === 8453 &&
      spotHomeChainId('ETH') === 8453 && spotHomeChainId('BTC') === 8453 && spotHomeChainId('uni') === 1 && spotHomeChainId('$UNI') === 1 && spotHomeChainId('FOO') === null && spotHomeChainId('') === null && spotHomeChainId(null) === null)
  check('spot home: the pre-existing venue-map rows kept their chain lists byte for byte (ETH/BTC/ARB/OP/AERO/LINK/UNI/AAVE/MORPHO) — the /t pages and the routes API see no new rows for them',
    JSON.stringify(spotChainsFor('ETH')) === '[8453,1,42161,10]' && JSON.stringify(spotChainsFor('BTC')) === '[8453,1,42161]' && JSON.stringify(spotChainsFor('ARB')) === '[42161,1]' &&
      JSON.stringify(spotChainsFor('OP')) === '[10,1]' && JSON.stringify(spotChainsFor('AERO')) === '[8453]' && JSON.stringify(spotChainsFor('LINK')) === '[1,8453,42161]' &&
      JSON.stringify(spotChainsFor('UNI')) === '[1,8453,42161]' && JSON.stringify(spotChainsFor('AAVE')) === '[1,8453]' && JSON.stringify(spotChainsFor('MORPHO')) === '[8453,1]')
  const disagree = Object.keys(EVM_SPOT_CHAINS).filter((s) => fundDestChainFor(s) !== spotHomeChainId(s))
  check('spot home: the symbol page\'s funding destination (lib/symbol-venues fundDestChainFor) IS the table\'s home for every symbol — one table, chip and typed ask agree', disagree.length === 0, disagree.join(' '))
  check('spot home: a symbol the table lacks funds on Ethereum (the venue map\'s default pair, Ethereum first) — unchanged', fundDestChainFor('ZZZNOPE') === 1)

  // ── the pure rule ──
  const buyUni = inferSpotChain({ symbol: 'UNI', side: 'buy', targetChainId: 8453, listedOn: [1, 8453, 42161] })
  check('spot home (rule): "Buy $2 of UNI" with nothing named/picked, Base the default → Ethereum, reason home; the reply line names the chain and how to say otherwise',
    buyUni.chainId === 1 && buyUni.reason === 'home' && /UNI's market is on Ethereum/.test(buyUni.note) && /not Base/.test(buyUni.note) &&
      spotChainLine(buyUni, 'uni') === 'UNI\'s market is on Ethereum, so this builds there — say the chain ("… on Base") to buy it elsewhere.',
    JSON.stringify(buyUni))
  check('spot home (rule): the home chain only counts when the token resolves there (lists warmed and UNI absent from Ethereum\'s → the next rule), and an unwarmed list (null) trusts the table',
    inferSpotChain({ symbol: 'UNI', side: 'buy', targetChainId: 8453, listedOn: [8453] }).chainId === 8453 &&
      inferSpotChain({ symbol: 'UNI', side: 'buy', targetChainId: 8453, listedOn: [8453] }).reason === 'default' &&
      inferSpotChain({ symbol: 'UNI', side: 'buy', targetChainId: 8453, listedOn: null }).chainId === 1)
  check('spot home (rule): a flagship pinned on the target chain never moves (ETH on Base, USDC on Base), whatever the table or the lists say',
    inferSpotChain({ symbol: 'ETH', side: 'buy', targetChainId: 8453, listedOn: [1, 8453, 42161, 10], pinnedOnTarget: true }).reason === 'default' &&
      inferSpotChain({ symbol: 'USDC', side: 'sell', targetChainId: 8453, listedOn: [1, 8453], pinnedOnTarget: true, heldOn: [{ chainId: 1, units: 600 }] }).chainId === 8453)
  check('spot home (rule): the home chain equal to the target is the default by name (buy AERO on Base stays, reason default)',
    inferSpotChain({ symbol: 'AERO', side: 'buy', targetChainId: 8453, listedOn: [8453] }).reason === 'default')
  const only = inferSpotChain({ symbol: 'GRAIL', side: 'buy', targetChainId: 8453, listedOn: [42161] })
  check('spot home (rule): a coin the table lacks that ONE chain of ours lists builds there (GRAIL → Arbitrum, only-listed)', only.chainId === 42161 && only.reason === 'only-listed' && /only chain of ours that lists GRAIL/.test(only.note))
  const deep = inferSpotChain({ symbol: 'ZZZ', side: 'buy', targetChainId: 8453, listedOn: [1, 8453], depth: [{ chainId: 1, outPerUsd: 1, decayBps: 20, trusted: true }, { chainId: 8453, outPerUsd: 1.1, decayBps: 900, trusted: false }] })
  check('spot home (rule): an unlisted coin on two chains goes to the measured DEEPEST pool — a trusted fence beats a thin pool that quotes more per dollar', deep.chainId === 1 && deep.reason === 'deepest')
  check('spot home (rule): both pools thin → the least drained; no depth → the target by default; depth on one chain only is not a comparison',
    inferSpotChain({ symbol: 'ZZZ', side: 'buy', targetChainId: 8453, listedOn: [1, 8453], depth: [{ chainId: 1, outPerUsd: 1, decayBps: 900, trusted: false }, { chainId: 8453, outPerUsd: 1, decayBps: 1200, trusted: false }] }).chainId === 1 &&
      inferSpotChain({ symbol: 'ZZZ', side: 'buy', targetChainId: 8453, listedOn: [1, 8453] }).reason === 'default' &&
      inferSpotChain({ symbol: 'ZZZ', side: 'buy', targetChainId: 8453, listedOn: [1, 8453], depth: [{ chainId: 1, outPerUsd: 1, decayBps: 20, trusted: true }] }).reason === 'default')
  const sellHeld = inferSpotChain({ symbol: 'UNI', side: 'sell', targetChainId: 8453, listedOn: [1, 8453], heldOn: [{ chainId: 8453, units: 0.455 }, { chainId: 1, units: 0.109 }] })
  check('spot home (rule): a SELL goes where the wallet HOLDS the token (0.455 UNI on Base beats 0.109 on Ethereum, the home), reason held; the line says so',
    sellHeld.chainId === 8453 && sellHeld.reason === 'held' && spotChainLine(sellHeld, 'UNI') === 'You hold UNI on Base, so this builds there.')
  check('spot home (rule): a sell of a token the wallet holds nowhere the read covered goes HOME (the refusal names the chain where it trades), and an unread wallet does the same',
    inferSpotChain({ symbol: 'UNI', side: 'sell', targetChainId: 8453, listedOn: [1, 8453], heldOn: [{ chainId: 8453, units: 0 }, { chainId: 1, units: 0 }] }).chainId === 1 &&
      inferSpotChain({ symbol: 'UNI', side: 'sell', targetChainId: 8453, listedOn: [1, 8453], heldOn: null }).reason === 'home')
  check('spot home (rule): a sell whose balance read FAILED on a chain (and found nothing on the ones that answered) stays on the target — no evidence is no reason to move (a rate-limited Base read once sent a Base-held UNI sell to Ethereum)',
    inferSpotChain({ symbol: 'UNI', side: 'sell', targetChainId: 8453, listedOn: [1, 8453], heldOn: [{ chainId: 1, units: 0 }], heldUnread: [8453] }).reason === 'default' &&
      inferSpotChain({ symbol: 'UNI', side: 'sell', targetChainId: 8453, listedOn: [1, 8453], heldOn: [{ chainId: 1, units: 0.1 }], heldUnread: [8453] }).chainId === 1 &&
      inferSpotChain({ symbol: 'UNI', side: 'sell', targetChainId: 8453, listedOn: [1, 8453], heldOn: [{ chainId: 1, units: 0 }], heldUnread: [42161] }).reason === 'home')
  check('spot home (rule): a holding on a chain the lists don\'t carry the token on is never a sell target',
    inferSpotChain({ symbol: 'UNI', side: 'sell', targetChainId: 8453, listedOn: [1], heldOn: [{ chainId: 8453, units: 5 }] }).chainId === 1)

  // ── which token decides ──
  check('spot home (token): the buy token leads; a buy of a stable or ETH hands over to the sell side; stable↔stable, a lone ETH buy and a raw address infer nothing',
    JSON.stringify(spotInferenceToken({ buyToken: 'uni', sellToken: 'USDC' })) === '{"symbol":"UNI","side":"buy"}' &&
      JSON.stringify(spotInferenceToken({ sellToken: 'UNI' })) === '{"symbol":"UNI","side":"sell"}' &&
      JSON.stringify(spotInferenceToken({ buyToken: 'USDC', sellToken: 'uni' })) === '{"symbol":"UNI","side":"sell"}' &&
      JSON.stringify(spotInferenceToken({ buyToken: 'ETH', sellToken: 'UNI' })) === '{"symbol":"UNI","side":"sell"}' &&
      spotInferenceToken({ buyToken: 'ETH' }) === null && spotInferenceToken({ buyToken: 'USDC', sellToken: 'DAI' }) === null &&
      spotInferenceToken({ buyToken: '0x1f9840a85d5aF5bf1D1762F925BDADdC4201F984' }) === null && spotInferenceToken({}) === null)
  check('spot home (token): the stock chain is never a spot candidate; every other registry chain is', !SPOT_INFER_CHAIN_IDS.includes(4663) && SPOT_INFER_CHAIN_IDS.length === APP_CHAINS.length - 1)

  // ── the chain card coming back ──
  const two = (a: string | null, b: string | null) => [{ settledHash: a }, { settledHash: b }]
  check('chain resume: both steps settled in the sign store → done, the hashes kept', JSON.stringify(chainResumePlan({ steps: two('0xa', '0xb'), completed: null })) === '{"kind":"done","hashes":{"0":"0xa","1":"0xb"}}')
  check('chain resume: the approve settled, the swap never asked → resume at step 2 with the approve\'s hash', JSON.stringify(chainResumePlan({ steps: two('0xa', null), completed: null })) === '{"kind":"resume","current":1,"hashes":{"0":"0xa"}}')
  check('chain resume: the chain\'s own completion record (the ORIGINAL last step\'s key, hash-less) with no prefix → done', chainResumePlan({ steps: two(null, ''), completed: null }).kind === 'done')
  check('chain resume: the message\'s record wins — two hashes for two steps → done even in a store that never saw them; FOUR hashes (the chain run twice, the 2026-10-06 double buy) → done with the first run\'s pair',
    JSON.stringify(chainResumePlan({ steps: two(null, null), completed: [{ hash: H('1') }, { hash: H('2') }] })) === `{"kind":"done","hashes":{"0":"${H('1')}","1":"${H('2')}"}}` &&
      JSON.stringify(chainResumePlan({ steps: two(null, null), completed: [{ hash: H('1') }, { hash: H('2') }, { hash: H('3') }, { hash: H('4') }] })) === `{"kind":"done","hashes":{"0":"${H('1')}","1":"${H('2')}"}}`)
  check('chain resume: a one-hash record on a two-step chain is a settled prefix → resume at step 2; a malformed hash in the record counts for nothing',
    JSON.stringify(chainResumePlan({ steps: two(null, null), completed: [{ hash: H('1') }] })) === `{"kind":"resume","current":1,"hashes":{"0":"${H('1')}"}}` &&
      chainResumePlan({ steps: two(null, null), completed: [{ hash: 'nope' }, { hash: 'nope' }] }).kind === 'fresh')
  check('chain resume: nothing settled anywhere → fresh (an empty record, a null record, an empty chain)',
    chainResumePlan({ steps: two(null, null), completed: [] }).kind === 'fresh' && chainResumePlan({ steps: two(null, null), completed: null }).kind === 'fresh' && chainResumePlan({ steps: [], completed: [{ hash: H('1') }] }).kind === 'fresh')
  check('chain resume: the finished card\'s line says it will not sign again and how to buy more; the resumed line says the tap is the visitor\'s',
    /already settled on-chain/.test(CHAIN_SETTLED_LINE) && /won’t sign it again/.test(CHAIN_SETTLED_LINE) && /Ask again/.test(CHAIN_SETTLED_LINE) && /waits for your tap/.test(CHAIN_RESUMED_LINE))

  // ── source fences ──
  const route = readFileSync('app/api/chat/route.ts', 'utf8')
  const inferAt = route.indexOf('const want = spotInferenceToken(swapIntent)')
  const mirrorAt = route.indexOf('stock-chain inference: selling')
  const venueAt = route.indexOf("const uniActive = activeServers.some((s) => s.slug === 'uniswap'")
  check('spot home (route): the inference runs AFTER the stock-chain mirror and BEFORE the venue pick, only with nothing named, nothing picked, no stock inference, a market mode and no parse problem',
    inferAt > mirrorAt && mirrorAt > 0 && venueAt > inferAt &&
      /if \(!namedNative && !pickerChain && buildChain\.id === targetChain\.id && swapIntent\.mode !== 'limit' && !swapIntent\.problem\) \{\s*const want = spotInferenceToken\(swapIntent\)/.test(route) &&
      /inferSpotChainLive\(\{ symbol: want\.symbol, side: want\.side, targetChainId: targetChain\.id, wallet: walletAddress \}\)/.test(route))
  check('spot home (route): a coin the home table knows is never a stock near-miss — the Robinhood pairing ladder skips it (MANA used to be asked as a misspelled ticker), while an exact stock ticker still wins',
    /const knownCoin = spotHomeChainId\(swapIntent\.buyToken\) !== null/.test(route) && /const pairing = !exactStock && !knownCoin && !resolveToken\(swapIntent\.buyToken, targetChain\.id\) \? pairStockToken/.test(route))
  check('spot home (route): an inferred chain pinned nothing — the spend retarget still follows the money — and the inferred line rides to the swap turn',
    /const allowRetarget = !namedNative && !pickerChain && \(buildChain\.id === targetChain\.id \|\| !!inferredSpot\) && swapIntent\.mode !== 'limit'/.test(route) &&
      /\{ allowRetarget, chainNote: inferredSpot\?\.line \}\)/.test(route))
  check('spot home (route): the 🏠 line opens a BUILT reply only, and never over a spend retarget\'s own 🧭 line',
    /if \(opts\.chainNote && built && !body\.spendRetarget && typeof body\.reply === 'string'\) \{\s*body\.reply = `🏠 \$\{opts\.chainNote\}\\n\\n\$\{body\.reply\}`/.test(route) &&
      /const built = !!\(body\.txChain \|\| body\.order \|\| body\.txRequest\)/.test(route))
  const card = readFileSync('components/SendTxChain.tsx', 'utf8')
  check('chain resume (card): SendTxChain takes the message\'s `completed` record, asks chainResumePlan on mount (store + record), paints done or resumes — and a resumed step NEVER auto-fires',
    /completed = null,/.test(card) && /const plan = chainResumePlan\(\{ steps: steps_, completed \}\)/.test(card) && /if \(plan\.kind === 'done'\) \{\s*setPhase\('done'\)\s*setCameBack\('done'\)/.test(card) &&
      /setCurrent\(plan\.current\)\s*setCameBack\(plan\.current\)\s*void refreshStep\(plan\.current\)/.test(card) &&
      /autoFire=\{cameBack !== i && autoFireAllowed\(/.test(card) && /data-chain-settled=""/.test(card) && /data-chain-resumed=""/.test(card))
  const chat = readFileSync('components/ChatInterface.tsx', 'utf8')
  check('chain resume (chat): the live chat hands the chain card the message\'s signed record', /<SendTxChain\s+chain=\{chain\}\s+manualSteps=\{!!externalChain\}[\s\S]{0,400}completed=\{signedTxsOf\(msg\.meta\)\}/.test(chat))
  const wv = readFileSync('lib/wallet-view.ts', 'utf8')
  check('wallet view: every app chain\'s token list is warmed before the index is read (a listed token the index doesn\'t price is kept on ANY chain), and unpriced coin rows are priced from the chain\'s own pools, depth-fenced, never hidden',
    /await Promise\.all\(APP_CHAINS\.map\(\(c\) => ensureTokenList\(c\.id\)\.catch\(\(\) => \{\}\)\)\)/.test(wv) && /await priceUnpricedCoinRows\(chains\)\.catch\(\(\) => \{\}\)/.test(wv) &&
      /export async function priceUnpricedCoinRows/.test(wv) && /\.filter\(\(c\) => c\.id !== STOCK_CHAIN_ID\)/.test(wv) && /usdPerToken\(c\.id, h\.address\)/.test(wv))
  const al = readFileSync('lib/alchemy.ts', 'utf8')
  check('wallet view (alchemy): the portfolio read follows pageKey until the index is exhausted (bounded) — a wallet with more tokens than one page used to lose the rest',
    /pageKey/.test(al) && /PORTFOLIO_MAX_PAGES/.test(al))
}

/* Standalone: `npx tsx scripts/spot-home-pins.ts` */
if (process.argv[1] && /spot-home-pins\.ts$/.test(process.argv[1])) {
  let pass = 0
  let fail = 0
  spotHomePins((name, ok, extra = '') => {
    console.log(`  ${ok ? '✅' : '❌'} ${name}${extra ? ` — ${extra}` : ''}`)
    ok ? pass++ : fail++
  })
  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}
