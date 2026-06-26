'use client'

import { Suspense } from 'react'
import Link from 'next/link'
import { useSearchParams } from 'next/navigation'
import { Plus } from 'lucide-react'
import ServerDirectory from '@/components/ServerDirectory'
import ActiveServerBar from '@/components/ActiveServerBar'
import Footer from '@/components/Footer'

/** /servers — the full agent directory (search + category filter over the
 * grid). The marketing landing now lives at / (Switchboard); this is the
 * "See all servers" destination. A ?category= param (e.g. set by the landing
 * pills) pre-selects a filter. Custom-server creation is at /servers/add. */
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
                Every x402 agent
                <br />
                on the <em className="hero__em">network</em>.
              </h1>
            </div>
            <Link href="/servers/add" className="btn btn--ghost srvpage__add">
              <Plus width={16} height={16} /> Add a server
            </Link>
          </div>
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
