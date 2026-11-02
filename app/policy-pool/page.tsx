import type { Metadata } from 'next'
import Footer from '@/components/Footer'
import PolicyPoolLive, { type LedgerPayload } from '@/components/policy-pool/PolicyPoolLive'
import { elide, explorerFor } from '@/components/policy-pool/format'
import { emptyPolicyPoolStats, listPolicyPoolEvents, policyPoolStats } from '@/lib/policy-pool/ledger'
import { policyPoolConfig, type PolicyPoolConfig } from '@/lib/policy-pool/config'
import { readHookState, type HookState } from '@/lib/policy-pool/indexer'
import { ATTESTATION_TYPE_STRING } from '@/lib/policy-pool/spec'
import { SITE_CARD } from '@/lib/og-defaults'
import '@/components/markets/look.css'
import '@/components/progress/progress.css'
import '@/components/policy-pool/policy-pool.css'

// /policy-pool — public (squad policy-pool, 2026-11-02; lib/app-entry
// isPublicAppPath lists it). The on-chain half of "Dune reads, Pantessa
// builds, their custody signs, the receipt lands back in Dune": a Uniswap v4
// pool whose hook refuses every swap without the desk's signed attestation,
// and this page watching every step land in the ledger. With no hook
// deployed it still renders the whole layout, honestly empty.

const TITLE = 'The policy pool — Pantessa'
const DESCRIPTION =
  'A Uniswap v4 pool whose hook refuses any swap without a signed desk attestation. Every guard verdict, attestation, signature and fill, live.'

export const metadata: Metadata = {
  title: TITLE,
  description: DESCRIPTION,
  openGraph: { title: TITLE, description: DESCRIPTION, siteName: 'Pantessa', type: 'website', images: SITE_CARD },
  twitter: { card: 'summary_large_image', title: TITLE, description: DESCRIPTION, images: SITE_CARD },
}

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

const SCENES: { n: string; title: string; body: string }[] = [
  { n: '1', title: 'Dune charts the pool', body: 'Every DeskFill the hook emits is decoded in Dune, provenance string included.' },
  { n: '2', title: 'A plain wallet is refused', body: 'A swap with no attestation reaches the hook and reverts NotAttested. Nothing moves.' },
  { n: '3', title: 'The desk builds, you sign', body: '"Buy $25 of ETH" passes the guard, the policy signer attests, your wallet signs, the fill lands.' },
  { n: '4', title: 'The cap holds twice', body: 'At $5,000 against a $500 cap the guard refuses; a hand-forged attestation reverts on-chain.' },
  { n: '5', title: 'The ledger shows it all', body: 'Each of those steps is a row on this page, and the Dune row closes the loop.' },
]

async function initialPayload(): Promise<LedgerPayload> {
  try {
    const [list, stats] = await Promise.all([listPolicyPoolEvents({ limit: 50 }), policyPoolStats()])
    return { ...list, stats }
  } catch (e) {
    console.warn(`[policy-pool page] ledger read failed: ${(e as Error).message}`)
    return { events: [], nextCursor: null, stats: emptyPolicyPoolStats() }
  }
}

function Facts({ pool, hook, misconfigured }: { pool: PolicyPoolConfig | null; hook: HookState | null; misconfigured: string | null }) {
  if (!pool) {
    return (
      <ul className="pp-facts" aria-label="Pool facts">
        <li className="pp-fact pp-fact--off" data-fact="status">
          <span className="pp-fact__k">Status</span>
          <span className="pp-fact__v">{misconfigured ? 'configuration incomplete' : 'not deployed yet'}</span>
        </li>
        <li className="pp-fact" data-fact="chain">
          <span className="pp-fact__k">Chain</span>
          <span className="pp-fact__v">Base Sepolia, then Base</span>
        </li>
        <li className="pp-fact" data-fact="cap">
          <span className="pp-fact__k">Cap</span>
          <span className="pp-fact__v">${Number(process.env.POLICY_POOL_MAX_USD ?? 500) || 500} per order</span>
        </li>
      </ul>
    )
  }
  const ex = explorerFor(pool.chainId)
  const facts: { k: string; v: string; href?: string; title?: string }[] = [
    { k: 'Chain', v: pool.chainName },
    { k: 'Hook', v: elide(pool.hook), href: `${ex}/address/${pool.hook}`, title: pool.hook },
    { k: 'Pool id', v: elide(pool.poolId, 8, 4), title: pool.poolId },
    // The signer the hook checks on-chain; env only when the chain can't be read.
    hook
      ? { k: 'Policy signer', v: elide(hook.policySigner), href: `${ex}/address/${hook.policySigner}`, title: `${hook.policySigner} (read from the hook)` }
      : pool.signer
        ? { k: 'Policy signer', v: elide(pool.signer), href: `${ex}/address/${pool.signer}`, title: `${pool.signer} (from env; the hook could not be read)` }
        : { k: 'Policy signer', v: 'unset' },
    ...(hook?.paused ? [{ k: 'Status', v: 'paused by the owner' }] : []),
    { k: 'Cap', v: `$${pool.maxUsd.toLocaleString('en-US')} per order` },
    { k: 'Deploy block', v: pool.deployBlock !== null ? pool.deployBlock.toLocaleString('en-US') : 'unset', href: pool.deployBlock ? `${ex}/block/${pool.deployBlock}` : undefined },
  ]
  return (
    <ul className="pp-facts" aria-label="Pool facts">
      {facts.map((f) => (
        <li className="pp-fact" key={f.k} data-fact={f.k.toLowerCase().replace(/\s+/g, '-')} title={f.title}>
          <span className="pp-fact__k">{f.k}</span>
          {f.href ? (
            <a className="pp-fact__v pp-mono" href={f.href} target="_blank" rel="noopener noreferrer">{f.v}</a>
          ) : (
            <span className="pp-fact__v pp-mono">{f.v}</span>
          )}
        </li>
      ))}
    </ul>
  )
}

export default async function PolicyPoolPage() {
  // A half-configured pool throws by name (lib/policy-pool/config): the page
  // renders the not-deployed layout and says the config is incomplete.
  let pool: PolicyPoolConfig | null = null
  let misconfigured: string | null = null
  try {
    pool = policyPoolConfig()
  } catch (e) {
    misconfigured = (e as Error).message
    console.warn(`[policy-pool page] ${misconfigured}`)
  }
  const [initial, hook] = await Promise.all([initialPayload(), pool ? readHookState(pool) : Promise.resolve(null)])
  return (
    <>
      <main className="x-main x-main--fluid pg pp" data-policy-pool={pool ? 'deployed' : 'not-deployed'}>
        <header className="pp-head">
          <div className="pg__eyebrow">The desk, on-chain</div>
          <h1 className="pg__title pp-title">The policy pool</h1>
          <p className="pg__sub">Every swap in this pool carries a signed desk attestation; the hook refuses the rest.</p>
          <Facts pool={pool} hook={hook} misconfigured={misconfigured} />
        </header>

        <PolicyPoolLive initial={initial} deployed={!!pool} />

        <section className="pg__sec pp-sec" aria-labelledby="pp-how">
          <div className="pg__sec-head">
            <h2 className="pg__sec-title" id="pp-how">How it works</h2>
            <span className="pg__sec-note">the five scenes</span>
          </div>
          <ol className="pp-scenes">
            {SCENES.map((s) => (
              <li className="pp-scene" key={s.n}>
                <span className="pp-scene__n">{s.n}</span>
                <div>
                  <div className="pp-scene__t">{s.title}</div>
                  <p className="pp-scene__b">{s.body}</p>
                </div>
              </li>
            ))}
          </ol>
          <div className="pp-code">
            <div className="pp-code__k">The attestation every swap carries (EIP-712, domain PantessaPolicyPool v1)</div>
            <pre><code>{ATTESTATION_TYPE_STRING.replace('(', '(\n  ').replace(/,/g, ',\n  ').replace(/\)$/, '\n)')}</code></pre>
          </div>
          <p className="pg__honest">
            The policy signer issues one attestation per intent: one pool, one side, a maximum input, a ten-minute expiry, single use.
            The hook checks all of it before the swap and never changes the swap&rsquo;s economics. Origins like <code>dune:9055910</code> are the
            desk&rsquo;s provenance label, emitted verbatim; they describe where an intent came from and authorize nothing.
          </p>
        </section>
      </main>
      <Footer />
    </>
  )
}
