// Standing intent — the machine that runs between your turns. The strategic
// claim of the page: money that moves WITHOUT anyone watching. Left: the
// doctrine. Right: a stylized still of the overnight receipt log (pure CSS,
// no live data — same treatment as TxPipeline/FundAnything's visuals): a DCA
// buy fired, a Guardian stop-loss closed a position, a fund→wait→act job
// finished — all receipted while the wallet's owner slept. Below: four tiles
// (DCA · Guardian · Jobs · NFTs), each a real ask prefilled into /chat
// (?prompt= never auto-sends; ?mcps= preselects the set where it helps).

import Link from 'next/link'

const POINTS: { t: string; d: string }[] = [
  {
    t: 'Say it once',
    d: '“Every week,” “if it drops 8%,” “once the bridge settles” — the sentence becomes standing intent, not a reminder to come back and type it again.',
  },
  {
    t: 'Guard-checked at fire time',
    d: 'Nothing runs on stale math. Every step is rebuilt and re-checked the moment it’s due — dead calldata never reaches a wallet.',
  },
  {
    t: 'Your keys, your receipts',
    d: 'You sign, or a delegated key you can revoke does. Either way the tx hash lands in your ledger before you wake up.',
  },
]

const TILES: { label: string; t: string; d: string; ask: string; href: string }[] = [
  {
    label: 'RECURRING BUYS',
    t: 'DCA in one sentence',
    d: 'A sentence makes the schedule. Each buy compiles fresh on its day and waits for your signature — no bot to host, no hot key to leak.',
    ask: 'Buy $10 of AAPL every week',
    href: `/chat?mcps=robinhood-free&prompt=${encodeURIComponent('Buy $10 of AAPL every week')}`,
  },
  {
    label: 'GUARDIAN',
    t: 'Stop-losses that don’t sleep',
    d: 'Autonomous protection on Hyperliquid via a delegated agent key — it watches every minute and closes the position for you. Revoke any time; never custody.',
    ask: 'Set a stop-loss on my ETH position at −8%',
    href: `/chat?mcps=hyperliquid-free&prompt=${encodeURIComponent('Set a stop-loss on my ETH position at -8%')}`,
  },
  {
    label: 'JOBS',
    t: 'Fund → wait → act',
    d: 'Multi-step work compiles as one job: bridge, wait for settlement, then swap, stake, send, or buy. Every step is guard-checked when it’s your turn to sign.',
    ask: 'Swap 1 USDC from Base to Arbitrum, then send it to nate.eth',
    href: `/chat?prompt=${encodeURIComponent('Swap 1 USDC from Base to Arbitrum, then send the 1 USDC on Arbitrum to nate.eth')}`,
  },
  {
    label: 'NFTS',
    t: 'Sell it in a sentence',
    d: 'Guarded Seaport listings: ownership verified on-chain, fees pulled from the collection’s live schedule, and the relay re-checks everything before submit.',
    ask: 'Sell my NFT #4172 for 0.8 ETH',
    href: `/chat?mcps=opensea-free&prompt=${encodeURIComponent('Sell my NFT #4172 for 0.8 ETH')}`,
  },
]

export default function StandingIntent() {
  return (
    <section className="standx" id="standing">
      <div className="standx__grid">
        <div className="standx__copy">
          <span className="standx__eyebrow mono">WHILE YOU WERE ASLEEP</span>
          <h2 className="standx__h2">
            The money moved. <span className="x-grad">Nobody was at the keyboard.</span>
          </h2>
          <p className="standx__sub">
            Recurring buys, stop-loss protections, and multi-step jobs keep working between your
            turns. Yeetful is the non-custodial back office for autonomous money: it builds,
            guard-checks, and receipts every move — and holds nothing.
          </p>
          <ul className="standx__points">
            {POINTS.map((p) => (
              <li className="standx__point" key={p.t}>
                <strong>{p.t}</strong> <span>{p.d}</span>
              </li>
            ))}
          </ul>
        </div>

        {/* the overnight log — a stylized still, receipts stamped 2am–3am */}
        <div className="standx__visualwrap">
          <div className="standx__visual" aria-hidden="true">
            <div className="standx__vhead">
              <span className="standx__vbrand mono">
                <i /> Yeetful · overnight
              </span>
              <span className="standx__vwallet mono">0x5E…55a0 · asleep</span>
            </div>
            <ol className="standx__vlog mono">
              <li className="standx__vrow">
                <span className="standx__vtime">02:00</span>
                <span className="standx__vbody">
                  <b className="standx__vkind">DCA</b> weekly buy fired · $10 → 0.0311 AAPL{' '}
                  <em>tx 0x3e91…c04a ↗</em>
                </span>
                <span className="standx__vok">✓</span>
              </li>
              <li className="standx__vrow">
                <span className="standx__vtime">02:47</span>
                <span className="standx__vbody">
                  <b className="standx__vkind">GUARDIAN</b> ETH stop fired at $3,208 · position
                  closed <em>delegated key · revocable</em>
                </span>
                <span className="standx__vok">✓</span>
              </li>
              <li className="standx__vrow">
                <span className="standx__vtime">03:12</span>
                <span className="standx__vbody">
                  <b className="standx__vkind">JOB 3/3</b> bridge settled → bought $25 of NVDA{' '}
                  <em>tx 0x8c1d…9a2f ↗</em>
                </span>
                <span className="standx__vok">✓</span>
              </li>
            </ol>
            <div className="standx__vfoot mono">
              Three receipts before breakfast. Zero keys held.
            </div>
          </div>
          <p className="standx__vcaption mono">
            The best screenshot is the one where nobody was at the keyboard.
          </p>
        </div>
      </div>

      {/* the four standing surfaces — each tile lands its ask in /chat,
          prefilled, never auto-sent */}
      <div className="standx__tiles">
        {TILES.map((x) => (
          <Link href={x.href} className="standx__tile" key={x.label}>
            <span className="standx__tlabel mono">{x.label}</span>
            <h3 className="standx__tt">{x.t}</h3>
            <p className="standx__td">{x.d}</p>
            <span className="standx__task mono">&ldquo;{x.ask}&rdquo; →</span>
          </Link>
        ))}
      </div>
    </section>
  )
}
