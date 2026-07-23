// Landing lane: intent links. ONE message (landing-message-lanes): a link
// that carries an ask is a distribution channel — share it, put it on a
// site, earn on conversions. The chips are the HOUSE links (deterministic
// slugs, seeded) so the section demos real, tappable product — every chip
// opens /i/<slug> where the visitor still faces the explicit Connect &
// build consent step. Sits after EmbedAnywhere: embed is distribution for
// hosts, links are distribution for everyone.

import Link from 'next/link'
import HouseLinkChip from '@/components/HouseLinkChip'
import { HOUSE_LINKS } from '@/lib/house-links'

export default function LinkLane() {
  return (
    <section className="max-w-5xl mx-auto px-4 py-20" id="links">
      <div className="max-w-2xl">
        <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
          Intent links
        </span>
        <h2 className="mt-3 text-3xl font-semibold text-[color:var(--fg)]">
          A link that moves money.
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-[color:var(--muted)]">
          Mint a short link that carries an ask. Whoever opens it connects their own wallet and the
          path builds itself — guarded, signed only by them, receipted — then they&rsquo;re handed
          back to wherever the link lives. Creators earn half of Yeetful&rsquo;s 0.20% fee on the
          conversions their links produce.
        </p>
      </div>

      {/* Each chip wears the marks of the apps its ask runs through
          (HouseLinkChip) — the visitor sees WHICH protocols a link calls
          before opening it. */}
      <div className="mt-8 flex flex-wrap gap-2.5">
        {HOUSE_LINKS.map((h) => (
          <HouseLinkChip key={h.slug} link={h} />
        ))}
      </div>

      <div className="mt-8 flex items-center gap-3 flex-wrap">
        <Link href="/dashboard/links" className="btn btn--solid text-[13px]">
          Mint yours
        </Link>
        <Link href="/links" className="btn btn--ghost text-[13px]">
          The leaderboard
        </Link>
        <span className="mono text-[11px] text-[color:var(--muted-2)]">
          Every link opens with an explicit Connect &amp; build step — nothing auto-runs.
        </span>
      </div>
    </section>
  )
}
