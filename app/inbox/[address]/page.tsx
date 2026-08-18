import type { Metadata } from 'next'
import Link from 'next/link'
import { notFound } from 'next/navigation'
import { isAddress } from 'viem'
import Footer from '@/components/Footer'
import { inboxFor, type InboxItem } from '@/lib/inbox'

// /inbox/<address> — flip the arrow. The intents ADDRESSED to a wallet: an
// agent (broker_send) or another human sent them here, and one tap opens the
// same guarded /i runtime where only this wallet's own signature moves
// anything. A public, read-only view (the ask on each /i page is already
// public by slug); signing is still gated to the recipient.

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ address: string }> }

const short = (a: string) => `${a.slice(0, 6)}…${a.slice(-4)}`
const ago = (d: Date) => {
  const s = Math.max(1, Math.floor((Date.now() - d.getTime()) / 1000))
  if (s < 60) return `${s}s ago`
  const m = Math.floor(s / 60)
  if (m < 60) return `${m}m ago`
  const h = Math.floor(m / 60)
  if (h < 24) return `${h}h ago`
  return `${Math.floor(h / 24)}d ago`
}

export async function generateMetadata({ params }: Params): Promise<Metadata> {
  const { address } = await params
  if (!isAddress(address)) return { title: 'Wallet inbox — Pantessa' }
  const items = await inboxFor(address).catch(() => [])
  const title =
    items.length > 0
      ? `${items.length} intent${items.length === 1 ? '' : 's'} waiting for ${short(address)} — Pantessa inbox`
      : `Inbox for ${short(address)} — Pantessa`
  const description =
    'Intents addressed to this wallet: one tap opens the guarded build, and only this wallet’s own signature moves anything.'
  return { title, description, openGraph: { title, description } }
}

function InboxRow({ item }: { item: InboxItem }) {
  const from = item.senderLabel ?? item.agent ?? 'someone'
  return (
    <div className="flex flex-wrap items-center gap-x-4 gap-y-2.5 px-4 py-3">
      {/* min-w keeps the ask from being crushed into a word-per-line column
          beside the CTA at 375px — below ~14rem the button wraps under. */}
      <div className="min-w-[14rem] flex-1">
        <div className="text-[15px] text-[color:var(--fg)]">{item.ask}</div>
        <div className="mt-0.5 text-[12px] text-[color:var(--muted)]">
          from <span className="text-[color:var(--fg)]">{from}</span> · {ago(item.createdAt)}
        </div>
      </div>
      <Link href={`/i/${item.slug}`} className="btn btn--solid shrink-0">
        Review &amp; sign
      </Link>
    </div>
  )
}

export default async function InboxPage({ params }: Params) {
  const { address } = await params
  if (!isAddress(address)) notFound()
  const items = await inboxFor(address).catch(() => [])

  return (
    <>
      <main className="mx-auto max-w-2xl px-6 py-16">
        <p className="docs__crumbs mono">
          <Link href="/docs/desk">PANTESSA</Link> <span>/</span> INBOX
        </p>
        <h1 className="text-3xl font-semibold text-[color:var(--fg)]">Inbox</h1>
        <p className="mt-1 text-[13px] text-[color:var(--muted)] mono">{short(address)}</p>
        <p className="mt-4 text-[15px] leading-relaxed text-[color:var(--muted)]">
          Intents addressed to this wallet. Open one and Pantessa rebuilds and guard-checks the ask —
          only this wallet’s own signature moves anything. Nothing here can act on its own.
        </p>

        {items.length === 0 ? (
          <p className="mt-8 text-[13px] text-[color:var(--muted)]">
            Nothing waiting. When an agent or a friend sends this wallet an intent, it shows up here.
          </p>
        ) : (
          <div className="mt-8 divide-y divide-[var(--line)] rounded-2xl border border-[var(--line)]">
            {items.map((it) => (
              <InboxRow key={it.slug} item={it} />
            ))}
          </div>
        )}

        <p className="mt-8 text-[13px] text-[color:var(--muted)]">
          <Link href="/docs/desk" className="underline">
            Send an agent&apos;s intents to a wallet
          </Link>
          .
        </p>
      </main>
      <Footer />
    </>
  )
}
