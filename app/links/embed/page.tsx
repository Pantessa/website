import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import { YeetfulMark } from '@/components/Logo'
import ButtonGenerator from './generator'

// /links/embed — the host button generator: the OpenSea-style redirect flow
// productized. A form that mints an intent link (ask + validated https
// return URL) and emits the copy-paste <a> snippet + optional trust badge.
// Zero new runtime — the button is just an intent link a site can wear.

const TITLE = 'Put a money button on your site — Pantessa intent links'
const DESCRIPTION =
  'Generate a copy-paste button that carries an ask — "Buy $10 of X on ours". Visitors tap it, connect their own wallet, sign, and come back to your site. Non-custodial; you earn on conversions.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website' },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION },
}

export default function LinksEmbedPage() {
  return (
    <>
      <main className="x-main">
        <section className="max-w-2xl mx-auto px-4 py-16">
          <div className="flex items-center gap-2 mb-6">
            <YeetfulMark size={15} />
            <span className="mono text-[11px] uppercase tracking-widest text-[color:var(--muted-2)]">
              Intent links · host button
            </span>
          </div>
          <h1 className="text-3xl font-semibold text-[color:var(--fg)] mb-3">
            A button on your site that moves money.
          </h1>
          <p className="text-[15px] leading-relaxed text-[color:var(--muted)] max-w-xl mb-10">
            Type the ask, mint the link, paste the snippet. Visitors tap the button, connect their
            own wallet on Pantessa, and the path builds itself — guarded, signed only by them,
            receipted. After they sign, a &ldquo;Return to your site&rdquo; button brings them back.
            You never touch keys, funds, or calldata.
          </p>
          <ButtonGenerator />
        </section>
      </main>
      <Footer />
    </>
  )
}
