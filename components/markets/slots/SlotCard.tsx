// The compact "coming in this round" card every MK2 slot stub renders.
// `data-slot` is what the harness pins (a slot is MOUNTED when its card, or
// the real component that replaces it, appears in the SSR HTML).

export default function SlotCard({ slot, lane, title, body }: { slot: string; lane: string; title: string; body: string }) {
  return (
    <section className="mk-slot" data-slot={slot} data-stub={lane}>
      <header className="mk-slot__head">
        <span className="mk-slot__title">{title}</span>
        <span className="mk-slot__eyebrow mono">{lane} · COMING IN THIS ROUND</span>
      </header>
      <p className="mk-slot__body">{body}</p>
    </section>
  )
}
