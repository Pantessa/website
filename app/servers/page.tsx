'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import ServerDirectory from '@/components/ServerDirectory'
import ActiveServerBar from '@/components/ActiveServerBar'
import ShortlistBar from '@/components/ShortlistBar'
import Footer from '@/components/Footer'

/** /servers — the MCP directory, free-first: the free working set is the
 * default view, the paid x402 catalog sits behind the flip. A ?category=
 * param deep-links a paid-catalog filter. Bring-your-own lives at
 * /servers/add. */
function Directory() {
  const category = useSearchParams().get('category') ?? undefined
  return <ServerDirectory initialCategory={category} />
}

export default function ServersPage() {
  return (
    <>
      <main className="x-main x-main--fluid">
        <section className="srvpage">
          <div className="srvpage__head">
            <div>
              <span className="srvpage__eyebrow mono">THE DIRECTORY</span>
              <h1 className="srvpage__h1">
                Free MCPs first.
                <br />
                Bring your <em className="hero__em">own</em>.
              </h1>
            </div>
            <Link href="/servers/add" className="btn btn--ghost srvpage__add">
              <Plus width={16} height={16} /> Add your MCP
            </Link>
          </div>
          <ShortlistBar />
          <Suspense fallback={null}>
            <Directory />
          </Suspense>
        </section>
      </main>
      <Footer />
      <ActiveServerBar />
    </>
  )
}
