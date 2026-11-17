// SUGGESTIONS on the home (2026-11-17, Nate: "anyone can make suggestions …
// anyone can add an issue to github … show open and closed suggestions … this
// is a community built project"). The rules and the addresses are lib/suggestions;
// the read is lib/suggestions-server (page.tsx hands the snapshot down).
//
// A server component, no script: two lists side by side (one under the other
// on a phone), each a few of GitHub's issues on the repo, and the two doors —
// make a suggestion (GitHub's issue form) and read the code. A stranger's
// title is drawn as text, never HTML. GitHub down → the doors alone, and the
// lists say where to look.
import { REPO_URL, NEW_SUGGESTION_URL, OPEN_ISSUES_URL, CLOSED_ISSUES_URL, agoWords, outcomeWord, type Suggestion, type SuggestionsSnapshot } from '@/lib/suggestions'
import './suggestions.css'

function Row({ s, now }: { s: Suggestion; now: number }) {
  const ago = agoWords(s.at, now)
  return (
    <li className="sgb__row">
      <a className="sgb__link" href={s.url} target="_blank" rel="noopener noreferrer" data-journey="home_suggest_row">
        <span className={`sgb__pill sgb__pill--${s.outcome}`}>{outcomeWord(s.outcome)}</span>
        <span className="sgb__title">{s.title}</span>
        <span className="sgb__meta mono">
          #{s.number} · @{s.by}
          {ago ? ` · ${ago}` : ''}
          {s.votes > 0 ? ` · ${s.votes} 👍` : ''}
          {s.comments > 0 ? ` · ${s.comments} ${s.comments === 1 ? 'reply' : 'replies'}` : ''}
        </span>
      </a>
    </li>
  )
}

function List({ id, title, count, rows, empty, all, ok, now }: { id: string; title: string; count: number; rows: Suggestion[]; empty: string; all: string; ok: boolean; now: number }) {
  return (
    <div className="sgb__col" aria-labelledby={id}>
      <h3 id={id} className="sgb__coltitle">
        {title}
        {ok && <span className="sgb__count mono">{count}</span>}
      </h3>
      {!ok ? (
        <p className="sgb__empty">GitHub didn’t answer just now. The list is on GitHub.</p>
      ) : rows.length ? (
        <ul className="sgb__list">
          {rows.map((s) => (
            <Row key={s.number} s={s} now={now} />
          ))}
        </ul>
      ) : (
        <p className="sgb__empty">{empty}</p>
      )}
      <a className="sgb__all" href={all} target="_blank" rel="noopener noreferrer" data-journey="home_suggest_all">
        {ok && count > rows.length ? `All ${count} on GitHub` : 'See them on GitHub'}
        <span aria-hidden="true">→</span>
      </a>
    </div>
  )
}

export default function SuggestionsBoard({ data }: { data: SuggestionsSnapshot }) {
  const now = Date.now()
  return (
    <section className="sgb" aria-labelledby="sgb-title" data-suggestions={data.ok ? 'ok' : 'off'}>
      <header className="sgb__head">
        <p className="sgb__eyebrow">Built in the open</p>
        <h2 id="sgb-title" className="sgb__heading">
          Tell us what to build next
        </h2>
        <p className="sgb__lede">
          Pantessa’s code is public on GitHub, and anyone can shape it. Open an issue with an idea, a market you want, or something that broke. We read every one, and you can see what is open and what got done right here.
        </p>
        <div className="sgb__doors">
          <a className="sgb__door sgb__door--main" href={NEW_SUGGESTION_URL} target="_blank" rel="noopener noreferrer" data-journey="home_suggest_new">
            Make a suggestion
          </a>
          <a className="sgb__door" href={REPO_URL} target="_blank" rel="noopener noreferrer" data-journey="home_suggest_code">
            Read the code
          </a>
        </div>
        <p className="sgb__note">A suggestion is a GitHub issue, so it needs a free GitHub account.</p>
      </header>
      <div className="sgb__cols">
        <List id="sgb-open" title="Open" count={data.openCount} rows={data.open} empty="Nothing open right now. Yours could be the first." all={OPEN_ISSUES_URL} ok={data.ok} now={now} />
        <List id="sgb-closed" title="Closed" count={data.closedCount} rows={data.closed} empty="Nothing closed yet." all={CLOSED_ISSUES_URL} ok={data.ok} now={now} />
      </div>
    </section>
  )
}
