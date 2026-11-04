'use client'

// components/desk/SettingsSection.tsx — the tenant's settings (squad
// five-million, CONSOLE lane, 2026-11-03).
//
// PATCH /api/tenants/:id: any admin edits the name, the signing lane, the
// status (pause / resume — a paused tenant refuses every key by name,
// TENANT_PAUSED) and the sandbox (leaving it needs the mainnet entitlement);
// only the OWNER edits admins and registered signers (the route refuses
// anyone else, and the console says so up front). Every change is a blotter
// row (tenant_paused / tenant_resumed / tenant_updated).

import { useEffect, useState } from 'react'
import { Card, CardTitle } from '@/lib/dashboard-ui'
import { call, type Answer } from './api'
import { shortAddr } from './derive'
import { AnswerNote, ConfirmButton } from './ui'
import type { DeskVocab, TenantDetailJson } from './types'

const WALLET_RE = /^0x[0-9a-fA-F]{40}$/

export default function SettingsSection({ detail, vocab, reload }: { detail: TenantDetailJson; vocab: DeskVocab; reload: () => Promise<void> }) {
  const t = detail.tenant
  const owner = detail.you.owner
  const ownerAddr = t.ownerAddress.toLowerCase()
  const [answer, setAnswer] = useState<{ a: Answer; ok: string; seat: string } | null>(null)
  const [name, setName] = useState(t.name)
  const [lane, setLane] = useState(t.signingLane)
  useEffect(() => setName(t.name), [t.name])
  useEffect(() => setLane(t.signingLane), [t.signingLane])

  const patch = async (seat: string, body: Record<string, unknown>, ok: string) => {
    const a = await call('PATCH', `/api/tenants/${t.id}`, body)
    setAnswer({ a, ok, seat })
    if (a.ok) await reload()
  }
  const note = (seat: string) => (answer?.seat === seat ? <AnswerNote answer={answer.a} ok={answer.ok} tag={seat} /> : null)
  const others = t.admins.filter((a) => a !== ownerAddr)

  return (
    <div className="dcx" data-desk-section="settings">
      <Card>
        <CardTitle serif eyebrow="STATUS">
          {t.status === 'active' ? 'The tenant is active' : 'The tenant is paused'}
        </CardTitle>
        <p className="dcx__p mb-3">
          {t.status === 'active'
            ? 'Pausing refuses every desk key by name (TENANT_PAUSED) on every tool but status and close, and every leg its jobs try to relay, until it is resumed.'
            : 'Every desk key refuses by name (TENANT_PAUSED) until the tenant is resumed.'}
        </p>
        <div className="dcx__row">
          {t.status === 'active' ? (
            <ConfirmButton label="Pause the tenant" confirm="Pause every key on this tenant?" yes="Pause" onYes={() => patch('status', { status: 'paused' }, 'Paused. Every key refuses by name until you resume.')} />
          ) : (
            <button type="button" className="dcx-btn dcx-btn--solid" onClick={() => void patch('status', { status: 'active' }, 'Resumed. The keys trade under the active policy again.')} data-desk-resume>
              Resume the tenant
            </button>
          )}
        </div>
        <div className="mt-3">{note('status')}</div>
      </Card>

      <Card>
        <CardTitle serif eyebrow="NAME AND SIGNING">
          What admins read, and how legs are signed
        </CardTitle>
        <div className="dcx-form dcx-form--pair">
          <label className="dcx-field">
            Name
            <input className="dcx-input" value={name} maxLength={80} onChange={(e) => setName(e.target.value)} name="name" />
          </label>
          <button type="button" className="dcx-btn" disabled={!name.trim() || name.trim() === t.name} onClick={() => void patch('name', { name: name.trim() }, 'Name saved.')}>
            Save name
          </button>
        </div>
        <div className="mt-2">{note('name')}</div>
        <div className="dcx-form dcx-form--pair mt-3">
          <label className="dcx-field">
            Signing lane
            <select className="dcx-select" value={lane} onChange={(e) => setLane(e.target.value)} name="signingLane">
              {vocab.lanes.map((l) => (
                <option key={l} value={l}>
                  {l}
                </option>
              ))}
            </select>
          </label>
          <button type="button" className="dcx-btn" disabled={lane === t.signingLane} onClick={() => void patch('lane', { signingLane: lane }, `Signing lane: ${lane}.`)}>
            Save lane
          </button>
        </div>
        <div className="mt-2">{note('lane')}</div>
        <div className="dcx__row dcx__row--between mt-4">
          <span className="dcx__p">
            {t.sandbox ? 'In the sandbox: orders reach only Base Sepolia and the Hyperliquid testnet (SANDBOX_ONLY otherwise).' : 'Out of the sandbox: orders reach the chains the policy admits.'}
          </span>
          <button
            type="button"
            className="dcx-btn"
            onClick={() => void patch('sandbox', { sandbox: !t.sandbox }, t.sandbox ? 'Out of the sandbox.' : 'Back in the sandbox.')}
            data-desk-sandbox
          >
            {t.sandbox ? 'Leave the sandbox' : 'Return to the sandbox'}
          </button>
        </div>
        <div className="mt-2">{note('sandbox')}</div>
      </Card>

      <AddressList
        title="Admins"
        eyebrow="WHO MAY APPROVE"
        words="Admins approve policy versions and over-threshold intents, mint and pause keys, and read the blotter. The owner is always an admin."
        fixed={ownerAddr}
        list={others}
        owner={owner}
        seat="admins"
        onSave={(next, ok) => patch('admins', { admins: next }, ok)}
        note={note('admins')}
      />
      <AddressList
        title="Registered signers"
        eyebrow="CUSTODY WALLETS"
        words="A wallet on this list executes a desk job without a per-intent personal_sign: the tenant registered it, and the wallet proved it controls the address. Every other wallet signs a consent message."
        fixed={null}
        list={t.signers}
        owner={owner}
        seat="signers"
        onSave={(next, ok) => patch('signers', { signers: next }, ok)}
        note={note('signers')}
        adder={owner ? <SignerProof tenantId={t.id} reload={reload} /> : null}
      />
    </div>
  )
}

function AddressList({ title, eyebrow, words, fixed, list, owner, seat, onSave, note, adder }: { title: string; eyebrow: string; words: string; fixed: string | null; list: string[]; owner: boolean; seat: string; onSave: (next: string[], ok: string) => Promise<void>; note: React.ReactNode; adder?: React.ReactNode }) {
  const [add, setAdd] = useState('')
  const valid = WALLET_RE.test(add.trim())
  return (
    <Card>
      <CardTitle serif eyebrow={eyebrow}>
        {title}
      </CardTitle>
      <p className="dcx__p mb-3">
        {words} {owner ? '' : 'Only the tenant owner edits this list.'}
      </p>
      <div className="dcx-list" data-desk-addresses={seat}>
        {fixed && (
          <div className="dcx-addr">
            <span>{fixed}</span>
            <span className="dcx-pill">owner</span>
          </div>
        )}
        {list.map((w) => (
          <div className="dcx-addr" key={w}>
            <span title={w}>{w}</span>
            {owner && (
              <button type="button" className="dcx-btn dcx-btn--small dcx-btn--danger" onClick={() => void onSave(list.filter((x) => x !== w), `Removed ${shortAddr(w)}.`)}>
                Remove
              </button>
            )}
          </div>
        ))}
        {!fixed && list.length === 0 && <p className="dcx__faint text-[12.5px]">None registered.</p>}
      </div>
      {owner && adder}
      {owner && !adder && (
        <form
          className="dcx-form dcx-form--pair mt-3"
          onSubmit={(e) => {
            e.preventDefault()
            const w = add.trim().toLowerCase()
            if (!WALLET_RE.test(w)) return
            void onSave([...list, w], `Added ${shortAddr(w)}.`).then(() => setAdd(''))
          }}
        >
          <label className="dcx-field">
            Add a wallet
            <input className="dcx-input dcx-input--mono" value={add} onChange={(e) => setAdd(e.target.value)} placeholder="0x…" autoComplete="off" spellCheck={false} name={`${seat}-add`} />
          </label>
          <button type="submit" className="dcx-btn" disabled={!valid}>
            Add
          </button>
        </form>
      )}
      <div className="mt-2">{note}</div>
    </Card>
  )
}

/** "Add a signer" — proof of control, three steps (2026-11-03 QA change):
 *  1. the address → GET /api/tenants/:id/signers/challenge?address= answers a
 *     short ASCII message (15 minutes, single use);
 *  2. the signer's wallet signs that message (personal_sign for a wallet; a
 *     Safe signs it as a message in its own UI, checked with EIP-1271);
 *  3. the signature (+ the chain id for a smart account) → POST
 *     /api/tenants/:id/signers { address, signature, chainId? }.
 *  The console never signs anything itself: the custody wallet does, wherever
 *  it lives. PATCH { signers } only removes. */
export function SignerProof({ tenantId, reload }: { tenantId: string; reload: () => Promise<void> }) {
  const [address, setAddress] = useState('')
  const [challenge, setChallenge] = useState<{ address: string; text: string; expiresAt: string | null } | null>(null)
  const [signature, setSignature] = useState('')
  const [chainId, setChainId] = useState('')
  const [busy, setBusy] = useState<'challenge' | 'submit' | null>(null)
  const [answer, setAnswer] = useState<Answer | null>(null)
  const [done, setDone] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const addrOk = WALLET_RE.test(address.trim())
  // Hex, whole bytes: an EOA's personal_sign is 65 bytes, a Safe's can be
  // longer (several owners) — the route checks it (ecrecover or EIP-1271).
  const sigOk = /^0x(?:[0-9a-fA-F]{2})+$/.test(signature.trim())
  const chainOk = chainId.trim() === '' || /^[1-9]\d{0,9}$/.test(chainId.trim())

  const ask = async () => {
    const a0 = address.trim().toLowerCase()
    setBusy('challenge')
    setAnswer(null)
    setDone(null)
    setCopied(false)
    const a = await call<{ challenge?: string; message?: string; text?: string; expiresAt?: string }>('GET', `/api/tenants/${tenantId}/signers/challenge?address=${encodeURIComponent(a0)}`)
    setBusy(null)
    const text = a.json?.challenge ?? a.json?.message ?? a.json?.text
    if (a.ok && typeof text === 'string' && text) {
      setChallenge({ address: a0, text, expiresAt: a.json?.expiresAt ?? null })
      setSignature('')
    } else setAnswer(a.status === 404 && !a.json ? { ...a, json: { error: 'This server has no signer-proof route yet (GET …/signers/challenge answered 404).' } } : a)
  }
  const submit = async () => {
    if (!challenge) return
    setBusy('submit')
    setAnswer(null)
    const a = await call('POST', `/api/tenants/${tenantId}/signers`, { address: challenge.address, signature: signature.trim(), ...(chainId.trim() ? { chainId: Number(chainId.trim()) } : {}) })
    setBusy(null)
    if (a.ok) {
      setDone(`Registered ${shortAddr(challenge.address)}: its signature checked out.`)
      setChallenge(null)
      setAddress('')
      setSignature('')
      setChainId('')
      await reload()
    } else setAnswer(a)
  }
  const copy = async () => {
    if (!challenge) return
    try {
      await navigator.clipboard.writeText(challenge.text)
      setCopied(true)
    } catch {
      const el = document.getElementById('dcx-signer-challenge')
      if (el) window.getSelection()?.selectAllChildren(el)
    }
  }

  return (
    <div className="dcx__stack mt-3" data-desk-signer-proof={challenge ? 'sign' : 'address'}>
      <span className="dcx__eyebrow">Add a signer · proof of control</span>
      <div className="dcx-form dcx-form--pair">
        <label className="dcx-field">
          1 · The signer’s address
          <input
            className="dcx-input dcx-input--mono"
            value={address}
            onChange={(e) => {
              setAddress(e.target.value)
              if (challenge && e.target.value.trim().toLowerCase() !== challenge.address) setChallenge(null)
            }}
            placeholder="0x… (a wallet or a Safe)"
            autoComplete="off"
            spellCheck={false}
            name="signer-address"
          />
        </label>
        <button type="button" className="dcx-btn" disabled={!addrOk || busy !== null} onClick={() => void ask()}>
          {busy === 'challenge' ? 'Asking…' : challenge ? 'New message' : 'Get the message'}
        </button>
      </div>
      {challenge && (
        <>
          <div className="dcx-secret" data-desk-signer-challenge>
            <span className="dcx__eyebrow">2 · The message to sign</span>
            <p className="dcx__p">
              The signer’s wallet signs this message (a Safe signs it as a message in its UI). It is good once
              {challenge.expiresAt ? `, until ${new Date(challenge.expiresAt).toISOString().slice(11, 16)}Z` : ', for 15 minutes'}.
            </p>
            <pre id="dcx-signer-challenge" className="dcx-json dcx-json--wrap">
              {challenge.text}
            </pre>
            <span className="dcx__row">
              <button type="button" className="dcx-btn dcx-btn--accent" onClick={() => void copy()}>
                {copied ? 'Copied' : 'Copy the message'}
              </button>
            </span>
          </div>
          <label className="dcx-field">
            3 · The signature it returned
            <textarea className="dcx-input dcx-input--mono dcx-input--area" value={signature} onChange={(e) => setSignature(e.target.value)} placeholder="0x…" spellCheck={false} name="signer-signature" />
          </label>
          <div className="dcx-form dcx-form--pair">
            <label className="dcx-field">
              Chain id (only for a smart account such as a Safe)
              <input className="dcx-input dcx-input--mono" value={chainId} onChange={(e) => setChainId(e.target.value)} inputMode="numeric" placeholder="8453" autoComplete="off" name="signer-chain" />
            </label>
            <button type="button" className="dcx-btn dcx-btn--solid" disabled={!sigOk || !chainOk || busy !== null} onClick={() => void submit()} data-desk-signer-submit>
              {busy === 'submit' ? 'Checking…' : 'Register signer'}
            </button>
          </div>
        </>
      )}
      <AnswerNote answer={answer} ok={null} tag="signer" />
      {done && <p className="dcx-note dcx-note--ok" role="status">{done}</p>}
    </div>
  )
}
