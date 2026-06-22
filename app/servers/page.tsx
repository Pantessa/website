'use client'

import Link from 'next/link'
import { Plus } from 'lucide-react'
import ServerDirectory from '@/components/ServerDirectory'
import ActiveServerBar from '@/components/ActiveServerBar'
import Footer from '@/components/Footer'

/** /servers — the full agent directory (search + category filter over the
 * grid). The marketing landing now lives at / (Switchboard); this is the
 * "See all servers" destination. Custom-server creation is at /servers/add. */
export default function ServersPage() {
  return (
    <>
      <main className="x-main x-main--fluid">
        <section className="srvpage">
          <div className="srvpage__head">
            <div>
              <span className="srvpage__eyebrow mono">THE DIRECTORY</span>
              <h1 className="srvpage__h1">Every x402 agent on the network.</h1>
            </div>
            <Link href="/servers/add" className="btn btn--ghost srvpage__add">
              <Plus width={16} height={16} /> Add a server
            </Link>
          </div>
          <ServerDirectory />
        </section>
      </main>
      <Footer />
      <ActiveServerBar />
    </>
  )
}
