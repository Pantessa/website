'use client'

import { analytics } from '@/lib/analytics'
import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Zap, Check, Plus, Loader2, Bot, User, PanelLeft, PanelLeftClose } from 'lucide-react'
import { useAccount, useSignTypedData } from 'wagmi'
import { cn } from '@/lib/utils'
import MessageReceipts from '@/components/MessageReceipts'
import SignVoteButton from '@/components/SignVoteButton'
import { voteRequestOf } from '@/lib/snapshot-vote'
import { useYeetfulStore } from '@/lib/store'
import BrandIcon from '@/components/BrandIcon'
import ShareButton from '@/components/ShareButton'

// Typed-data signing request shipped from the server for the wallet to sign.
interface SigningRequest {
  domain: { name: string; version: string; chainId: number; verifyingContract: `0x${string}` }
  types: Record<string, { name: string; type: string }[]>
  primaryType: string
  message: {
    from: `0x${string}`
    to: `0x${string}`
    value: string
    validAfter: string
    validBefore: string
    nonce: `0x${string}`
  }
}
interface PaymentToSign {
  id: string
  name: string
  host: string
  priceUsd: string
  signing: SigningRequest
}


/** Build the assistant message meta from receipts + an optional vote request. */
function buildMeta(receipts: unknown, payer: unknown, voteRequest: unknown) {
  const meta: Record<string, unknown> = {}
  if (Array.isArray(receipts) && receipts.length) {
    meta.receipts = receipts
    if (typeof payer === 'string') meta.payer = payer
  }
  if (voteRequest && typeof voteRequest === 'object') meta.voteRequest = voteRequest
  return Object.keys(meta).length ? meta : undefined
}

/** Sum settled receipts into one chat_paid event (no-op when nothing paid). */
function trackPaidReceipts(receipts: unknown) {
  if (!Array.isArray(receipts)) return
  const paid = receipts.filter(
    (r): r is { ok: boolean; name?: string; priceUsd?: string } =>
      !!r && typeof r === 'object' && (r as { ok?: unknown }).ok === true,
  )
  if (paid.length === 0) return
  const totalUsd = paid.reduce((sum, r) => sum + (Number(r.priceUsd) || 0), 0)
  analytics.chatPaid(totalUsd, paid.length, paid.map((r) => r.name ?? '?').join(','))
}

export default function ChatInterface() {
  const {
    servers,
    activeServerIds,
    setActiveServerIds,
    updateChatServers,
    chats,
    currentChatId,
    createChat,
    addMessage,
    sidebarOpen,
    setSidebarOpen,
    mobileSidebarOpen,
    setMobileSidebarOpen,
  } = useYeetfulStore()

  // Toggle an agent for this chat; persist the set to the open chat (and DB).
  const handleToggleServer = (id: string) => {
    const next = activeServerIds.includes(id)
      ? activeServerIds.filter((x) => x !== id)
      : [...activeServerIds, id]
    setActiveServerIds(next)
    if (currentChatId) updateChatServers(currentChatId, next)
  }

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const { address, isConnected } = useAccount()
  const { signTypedDataAsync } = useSignTypedData()

  const currentChat = chats.find((c) => c.id === currentChatId)
  const activeServers = servers.filter((s) => activeServerIds.includes(s.id))

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentChat?.messages])

  const handleSend = async () => {
    if (!input.trim() || loading) return
    analytics.chatMessage(activeServers.length, isConnected)

    let chatId = currentChatId
    if (!chatId) {
      chatId = await createChat(input.slice(0, 40) + (input.length > 40 ? '...' : ''))
      // Reflect the new chat in the URL without a remount (which would refetch
      // an empty message list and clobber the optimistic messages below).
      window.history.replaceState(null, '', `/chat/${chatId}`)
    }

    const userMsg = input.trim()
    setInput('')
    setLoading(true)

    addMessage(chatId, { role: 'user', content: userMsg })

    try {
      // Phase 1 — plan. If a wallet is connected, the server returns the
      // payments to sign; otherwise it pays with the house wallet and replies.
      setStatus(isConnected ? 'Planning x402 calls…' : null)
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          chatId,
          activeServerIds,
          activeServers, // full objects: endpoint/protocol/price per server
          walletAddress: isConnected ? address : undefined,
        }),
      })
      const data = await res.json()

      if (data.phase === 'awaiting-signatures') {
        const out = await payWithWalletThenAnswer(userMsg, data)
        trackPaidReceipts(out.receipts)
        addMessage(chatId, {
          role: 'assistant',
          content: out.reply,
          // voteRequest is produced by the burner path; wallet mode has none yet.
          meta: buildMeta(out.receipts, out.payer, undefined),
        })
      } else {
        trackPaidReceipts(data.receipts)
        addMessage(chatId, {
          role: 'assistant',
          content: data.reply || data.error || 'No response.',
          meta: buildMeta(data.receipts, data.payer, data.voteRequest),
        })
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : ''
      addMessage(chatId, {
        role: 'assistant',
        content: /rejected|denied|User rejected/i.test(msg)
          ? '🚫 Payment signature rejected — nothing was charged.'
          : '⚠️ Failed to complete the request. ' + (msg || 'Try again.'),
      })
    } finally {
      setLoading(false)
      setStatus(null)
    }
  }

  /** Sign each x402 payment with the connected wallet, then run the calls. */
  const payWithWalletThenAnswer = async (
    userMsg: string,
    data: { plan: unknown; payments: PaymentToSign[]; listedOnly: unknown; notes?: unknown },
  ): Promise<{ reply: string; receipts?: unknown[]; payer?: string }> => {
    const signatures: Record<string, string> = {}
    let i = 0
    for (const p of data.payments) {
      i += 1
      setStatus(`Sign payment ${i}/${data.payments.length} in your wallet — ${p.name} ($${p.priceUsd})`)
      signatures[p.id] = await signTypedDataAsync({
        domain: p.signing.domain,
        types: p.signing.types,
        primaryType: p.signing.primaryType,
        message: {
          from: p.signing.message.from,
          to: p.signing.message.to,
          value: BigInt(p.signing.message.value),
          validAfter: BigInt(p.signing.message.validAfter),
          validBefore: BigInt(p.signing.message.validBefore),
          nonce: p.signing.message.nonce,
        },
      })
    }

    setStatus('Settling payments and fetching results…')
    const res = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        phase: 'execute',
        message: userMsg,
        plan: data.plan,
        signatures,
        listedOnly: data.listedOnly,
        notes: data.notes, // plan-time diagnostics, echoed into the final reply
      }),
    })
    const out = await res.json()
    return {
      reply: out.reply || out.error || 'No response.',
      receipts: Array.isArray(out.receipts) ? out.receipts : undefined,
      payer: typeof out.payer === 'string' ? out.payer : undefined,
    }
  }

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSend()
    }
  }

  return (
    <div className="flex flex-col h-full">
      {/* Toolbar: sidebar toggle + agent picker (toggle x402 MCPs from chat) */}
      <div className="flex-shrink-0 px-3 py-2.5 border-b border-[var(--line)] bg-black/40 flex items-center gap-2">
        <div className="flex items-center gap-2 overflow-x-auto scrollbar-none flex-1 min-w-0">
          <button
            onClick={() =>
              window.matchMedia('(max-width: 1023px)').matches
                ? setMobileSidebarOpen(!mobileSidebarOpen)
                : setSidebarOpen(!sidebarOpen)
            }
            aria-label={sidebarOpen || mobileSidebarOpen ? 'Collapse chats sidebar' : 'Expand chats sidebar'}
            title={sidebarOpen || mobileSidebarOpen ? 'Collapse chats' : 'Show chats'}
            className="flex-shrink-0 w-10 h-10 md:w-8 md:h-8 grid place-items-center rounded-lg border border-[var(--line)] bg-[var(--surf-1)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-colors"
          >
            {sidebarOpen ? <PanelLeftClose className="w-4 h-4" /> : <PanelLeft className="w-4 h-4" />}
          </button>
          <span className="text-[11px] text-[color:var(--muted-2)] whitespace-nowrap font-medium mono pl-1">
            AGENTS · {activeServers.length}
          </span>
            {servers.map((server) => {
              const active = activeServerIds.includes(server.id)
              return (
                <button
                  key={server.id}
                  onClick={() => handleToggleServer(server.id)}
                  aria-pressed={active}
                  className={cn(
                    'flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1 min-h-[40px] md:min-h-0 rounded-lg border transition-colors',
                    active
                      ? 'bg-[var(--surf-2)] border-white/40 text-white'
                      : 'bg-[var(--surf-1)] border-[var(--line)] text-[color:var(--muted)] hover:border-[var(--line-2)] hover:text-white'
                  )}
                >
                  <span className="w-3.5 h-3.5 grid place-items-center opacity-90">
                    <BrandIcon server={server} size={13} />
                  </span>
                  <span className="text-[11px] whitespace-nowrap">{server.name}</span>
                  {active ? (
                    <Check className="w-2.5 h-2.5 flex-shrink-0" strokeWidth={3} style={{ color: 'var(--accent)' }} />
                  ) : (
                    <Plus className="w-2.5 h-2.5 flex-shrink-0 opacity-70" strokeWidth={2.5} />
                  )}
                </button>
              )
            })}
          </div>
          <ShareButton />
        </div>

      {/* Messages area */}
      <div className="flex-1 overflow-y-auto px-4 py-6 space-y-4">
        {!currentChat || currentChat.messages.length === 0 ? (
          <EmptyState activeCount={activeServers.length} />
        ) : (
          <>
            <AnimatePresence initial={false}>
              {currentChat.messages.map((msg, i) => (
                <motion.div
                  key={msg.id}
                  initial={{ opacity: 0, y: 12 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ duration: 0.25 }}
                  className={cn(
                    'flex gap-3',
                    msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'
                  )}
                >
                  {/* Avatar */}
                  <div
                    className={cn(
                      'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center',
                      msg.role === 'user'
                        ? 'bg-white text-black'
                        : 'bg-[var(--surf-2)] border border-[var(--line)] text-[color:var(--muted)]'
                    )}
                  >
                    {msg.role === 'user' ? (
                      <User className="w-4 h-4" />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )}
                  </div>

                  {/* Bubble */}
                  <div
                    className={cn(
                      'max-w-[85vw] lg:max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-white text-black rounded-tr-sm'
                        : 'bg-[var(--surf-1)] text-[color:var(--fg)] border border-[var(--line)] rounded-tl-sm'
                    )}
                  >
                    <pre className="whitespace-pre-wrap font-sans [overflow-wrap:anywhere]">{msg.content}</pre>
                    {msg.role === 'assistant' && <MessageReceipts meta={msg.meta} />}
                    {msg.role === 'assistant' &&
                      (() => {
                        const vote = voteRequestOf(msg.meta)
                        return vote ? <SignVoteButton vote={vote} /> : null
                      })()}
                  </div>
                </motion.div>
              ))}
            </AnimatePresence>

            {loading && (
              <motion.div
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                className="flex gap-3"
              >
                <div className="w-8 h-8 rounded-xl bg-[var(--surf-2)] border border-[var(--line)] flex items-center justify-center">
                  <Bot className="w-4 h-4 text-[color:var(--muted)]" />
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-[var(--surf-1)] border border-[var(--line)] flex items-center gap-2">
                  <Loader2 className="w-4 h-4 text-[color:var(--muted)] animate-spin flex-shrink-0" />
                  {status && <span className="text-xs text-[color:var(--muted)]">{status}</span>}
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 p-4 max-lg:pb-[max(1rem,env(safe-area-inset-bottom))] border-t border-[var(--line)]">
        <div className="flex items-end gap-3 p-3 rounded-2xl border border-[var(--line)] bg-[var(--surf-1)] transition-[border-color,box-shadow] duration-200 focus-within:border-white/25 focus-within:shadow-[0_0_0_4px_rgba(255,255,255,0.05)]">
          <textarea
            ref={textareaRef}
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={
              activeServers.length > 0
                ? `Message with ${activeServers.map((s) => s.name).join(', ')}...`
                : 'Type a message...'
            }
            rows={1}
            className="flex-1 bg-transparent text-sm max-lg:text-base text-white placeholder:text-[color:var(--muted-2)] resize-none border-0 focus:outline-none focus-visible:outline-none max-h-40 overflow-y-auto leading-relaxed"
            style={{ minHeight: '24px', outline: 'none', boxShadow: 'none' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className={cn(
              'flex-shrink-0 w-11 h-11 md:w-8 md:h-8 rounded-xl flex items-center justify-center transition-all duration-200',
              input.trim() && !loading
                ? 'bg-white text-black hover:bg-zinc-200 scale-100'
                : 'bg-[var(--surf-2)] text-[color:var(--muted-2)] cursor-not-allowed scale-95'
            )}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-[11px] text-[color:var(--muted-2)] mt-2 text-center mono">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}

function EmptyState({ activeCount }: { activeCount: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20">
      <div className="w-16 h-16 rounded-2xl bg-[var(--surf-1)] border border-[var(--line)] flex items-center justify-center mb-6">
        <Zap className="w-8 h-8 text-[color:var(--muted-2)]" />
      </div>
      {activeCount === 0 ? (
        <>
          <h3 className="text-white font-semibold mb-2">No agents selected</h3>
          <p className="text-[color:var(--muted)] text-sm max-w-xs">
            Pick x402 agents from the bar above (or the directory) to power up your chat.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-white font-semibold mb-2">
            {activeCount} agent{activeCount > 1 ? 's' : ''} ready
          </h3>
          <p className="text-[color:var(--muted)] text-sm max-w-xs">
            Start chatting — your message is paid for and answered over x402.
          </p>
        </>
      )}
    </div>
  )
}
