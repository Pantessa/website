import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Bot, User, Globe } from 'lucide-react'
import { YeetfulMark } from '@/components/Logo'
import MessageReceipts from '@/components/MessageReceipts'
import RouterTraceLines from '@/components/RouterTraceLines'
import ChatMarkdown from '@/components/ChatMarkdown'
import SharedJobLog from '@/components/SharedJobLog'
import SignedTxLines, { signedTxsOf } from '@/components/SignedTxLines'
import BrandIcon from '@/components/BrandIcon'
import Footer from '@/components/Footer'
import { respondingServers } from '@/lib/responding-mcp'
import { getSharedChat, getJobs, getChatServers, jobIdOf, moneyMovedOf } from '@/lib/shared-chat'
import type { McpServer } from '@/lib/store'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

export async function generateMetadata({ params }: Params) {
  const { slug } = await params
  const chat = await getSharedChat(slug)
  if (!chat) return { title: 'Shared chat · Yeetful', robots: { index: false, follow: false } }
  const jobs = await getJobs(chat.messages)
  const moved = moneyMovedOf(jobs)
  const description =
    moved > 0
      ? `$${moved.toFixed(2)} moved on-chain from one chat — every step guarded, signed, and receipted. Shared via Yeetful.`
      : 'A real Yeetful chat — guarded transactions from plain English. Shared read-only.'
  const title = `${chat.title} · Shared on Yeetful`
  return {
    title,
    description,
    openGraph: { title, description, siteName: 'Yeetful', type: 'article' },
    twitter: { card: 'summary_large_image', title, description },
    robots: { index: false, follow: false },
  }
}

/** The stacked agent avatar for an assistant turn — the same marks the live
 *  chat shows (receipts first, the chat's own working set as fallback), so a
 *  turn built by NEAR Intents + Lido reads as those agents, not a robot. */
function TurnAvatar({ responders }: { responders: McpServer[] }) {
  const stack = responders.slice(0, 3)
  if (stack.length > 1) {
    return (
      <div className="flex-shrink-0 flex items-center self-start" title={stack.map((s) => s.name).join(' + ')}>
        {stack.map((s, i) => (
          <div
            key={s.slug}
            className={`relative w-8 h-8 rounded-full flex items-center justify-center overflow-hidden bg-[var(--surf-2)] border border-[var(--line-2)] ring-2 ring-[var(--bg)] text-[color:var(--fg)] ${i > 0 ? '-ml-3' : ''}`}
            style={{ zIndex: stack.length - i }}
          >
            <BrandIcon server={s} size={16} />
          </div>
        ))}
      </div>
    )
  }
  const responder = stack[0] ?? null
  return (
    <div
      title={responder?.name}
      className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center overflow-hidden bg-[var(--surf-2)] border border-[var(--line)] ${
        responder ? 'text-[color:var(--fg)]' : 'text-[color:var(--muted)]'
      }`}
    >
      {responder ? <BrandIcon server={responder} size={18} /> : <Bot className="w-4 h-4" />}
    </div>
  )
}

export default async function SharedChatPage({ params }: Params) {
  const { slug } = await params
  const chat = await getSharedChat(slug)
  if (!chat) notFound()
  const [jobs, { catalog, display, tryHref }] = await Promise.all([
    getJobs(chat.messages),
    getChatServers(chat),
  ])

  return (
    <>
      <div className="min-h-[calc(100vh-4rem)] max-w-3xl mx-auto px-4 py-8">
        {/* Header */}
        <div className="flex items-center justify-between gap-4 pb-5 mb-6 border-b border-[var(--line)]">
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-[11px] text-emerald-400/90 mb-1">
              <Globe className="w-3.5 h-3.5" />
              <span className="mono uppercase tracking-wide">Shared chat · read-only</span>
            </div>
            <h1 className="text-lg font-semibold text-white truncate">{chat.title}</h1>
            {display.length > 0 && (
              <div className="flex items-center gap-2 mt-2 flex-wrap">
                <span className="text-[11px] text-[color:var(--muted-2)] mono uppercase tracking-wide">
                  Agents at work
                </span>
                {display.map((s) => (
                  <span
                    key={s.slug}
                    className="flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-[var(--surf-2)] border border-[var(--line)] text-[11px] text-[color:var(--muted)]"
                  >
                    <span className="text-[color:var(--fg)]">
                      <BrandIcon server={s} size={12} />
                    </span>
                    {s.name}
                  </span>
                ))}
              </div>
            )}
          </div>
          <Link
            href={tryHref}
            className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 transition-colors"
            title="Open Yeetful chat with these agents enabled and this chat's opening ask ready to run"
          >
            <YeetfulMark size={16} />
            <span>Try Yeetful</span>
          </Link>
        </div>

        {/* Messages */}
        <div className="space-y-4">
          {chat.messages.length === 0 && (
            <p className="text-sm text-[color:var(--muted-2)] text-center py-12">
              This shared chat has no messages yet.
            </p>
          )}
          {chat.messages.map((msg) => {
            const job = msg.role === 'assistant' ? jobs.get(jobIdOf(msg.meta) ?? '') : undefined
            return (
              <div
                key={msg.id}
                className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
              >
                {msg.role === 'user' ? (
                  <div className="flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center bg-white text-black">
                    <User className="w-4 h-4" />
                  </div>
                ) : (
                  <TurnAvatar responders={respondingServers(msg.meta, catalog, display)} />
                )}
                <div
                  className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
                    msg.role === 'user'
                      ? 'bg-white text-black rounded-tr-sm'
                      : 'bg-[var(--surf-1)] text-[color:var(--fg)] border border-[var(--line)] rounded-tl-sm'
                  }`}
                >
                  {msg.role === 'assistant' ? (
                    <ChatMarkdown content={msg.content} />
                  ) : (
                    <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
                  )}
                  {msg.role === 'assistant' && <MessageReceipts meta={msg.meta} />}
                  {msg.role === 'assistant' && signedTxsOf(msg.meta).length > 0 && <SignedTxLines meta={msg.meta} />}
                  {job && <SharedJobLog job={job} />}
                  {msg.role === 'assistant' && <RouterTraceLines meta={msg.meta} />}
                </div>
              </div>
            )
          })}
        </div>

        {/* Handoff — the share page is an entry point, so close with the ask. */}
        <div className="mt-10 mb-2 flex flex-col items-center gap-3">
          <p className="text-[11px] text-[color:var(--muted-2)] text-center mono">
            Shared via Yeetful — every dapp, one chat. Your wallet signs, every call receipted.
          </p>
          <Link
            href={tryHref}
            className="flex items-center gap-2 px-4 py-2 rounded-full bg-[var(--accent)] text-black text-sm font-semibold hover:opacity-90 transition-opacity"
          >
            <YeetfulMark size={16} />
            <span>{display.length > 0 ? 'Run this chat yourself' : 'Try Yeetful'}</span>
          </Link>
        </div>
      </div>
      <Footer />
    </>
  )
}
