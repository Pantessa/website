// The calm "coming in this round" card the tab STUBS render. Each stub at
// components/markets/tabs/* is replaced by a one-line re-export at
// integration (squad README, tab contract) — this card is what a visitor
// sees on a preview built from the shell branch alone.

export default function ComingCard({ title, body, lane }: { title: string; body: string; lane: string }) {
  return (
    <section className="mkt-card mkt-card--coming" data-stub={lane}>
      <header className="mkt-card__head">
        <h2 className="mkt-card__title">{title}</h2>
        <span className="mkt-card__eyebrow mono">COMING IN THIS ROUND</span>
      </header>
      <p className="mkt-card__body">{body}</p>
    </section>
  )
}
