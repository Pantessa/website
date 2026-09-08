// See it running — the live host-app example, inside the host section: the
// install above assembles the five lines; this is the same five lines shipped
// as a whole product on its own domain, with the source a click away. One
// record (lib/live-examples.ts) feeds this band + /docs/embed + the harness.

import Link from 'next/link'
import { ROBINHOOD_DESK as D } from '@/lib/live-examples'

export default function LiveExample() {
  return (
    <div className="liveex">
      <div className="liveex__copy">
        <span className="liveex__eyebrow mono">
          SEE IT RUNNING <b aria-hidden>·</b> {D.url.replace('https://', '')}
        </span>
        <h3 className="liveex__h3">A stock desk with the agent as its trading floor.</h3>
        <p className="liveex__sub">
          A standalone app on {D.chain}: it reads holdings and prices from the chain itself, every
          button on the page is an ask into the embedded chat, and the visitor&rsquo;s own wallet
          signs on that page. Open source, keyless, and the whole install is one component &mdash;
          fork it, swap the MCP set, ship yours.
        </p>
        <div className="liveex__ctas">
          <a href={D.url} target="_blank" rel="noopener noreferrer" className="btn btn--solid">
            Open the live desk ↗
          </a>
          <a href={D.source} target="_blank" rel="noopener noreferrer" className="btn btn--ghost">
            Source on GitHub
          </a>
          <Link href="/docs/embed" className="liveex__docs mono">
            EMBED DOCS →
          </Link>
        </div>
      </div>
      <div className="liveex__wire mono" aria-label="how the desk is wired">
        <span className="liveex__k">$ npm i pantessa</span>
        <span className="liveex__line">
          <b>mountPantessaChat</b>({'{'} container, mcps: [{D.mcps.map((m) => `'${m}'`).join(', ')}], wallet: provider {'}'})
        </span>
        <span className="liveex__line">
          chat.<b>sendPrompt</b>(&lsquo;Buy $10 of AAPL on {D.chain}&rsquo;)
        </span>
        <ul className="liveex__proves">
          {D.proves.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      </div>
    </div>
  )
}
