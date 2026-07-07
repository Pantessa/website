import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Bot, User, Globe } from 'lucide-react'
import prisma from '@/lib/db'
import { YeetfulMark } from '@/components/Logo'
import MessageReceipts from '@/components/MessageReceipts'
import RouterTraceLines from '@/components/RouterTraceLines'
import ChatMarkdown from '@/components/ChatMarkdown'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Params = { params: Promise<{ slug: string }> }

async function getSharedChat(slug: string) {
  try {
    const chat = await prisma.chat.findUnique({
      where: { publicSlug: slug },
      include: { messages: { orderBy: { createdAt: 'asc' } } },
    })
    if (!chat || !chat.isPublic) return null
    return chat
  } catch {
    return null
  }
}

export async function generateMetadata({ params }: Params) {
  const { slug } = await params
  const chat = await getSharedChat(slug)
  return {
    title: chat ? `${chat.title} · Shared on Yeetful` : 'Shared chat · Yeetful',
    robots: { index: false, follow: false },
  }
}

export default async function SharedChatPage({ params }: Params) {
  const { slug } = await params
  const chat = await getSharedChat(slug)
  if (!chat) notFound()

  return (
    <div className="min-h-[calc(100vh-4rem)] max-w-3xl mx-auto px-4 py-8">
      {/* Header */}
      <div className="flex items-center justify-between gap-4 pb-5 mb-6 border-b border-[var(--line)]">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-[11px] text-emerald-400/90 mb-1">
            <Globe className="w-3.5 h-3.5" />
            <span className="mono uppercase tracking-wide">Shared chat · read-only</span>
          </div>
          <h1 className="text-lg font-semibold text-white truncate">{chat.title}</h1>
        </div>
        <Link
          href="/"
          className="flex-shrink-0 flex items-center gap-2 px-3 py-1.5 rounded-full bg-white text-zinc-950 text-xs font-semibold hover:bg-zinc-200 transition-colors"
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
        {chat.messages.map((msg) => (
          <div
            key={msg.id}
            className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
          >
            <div
              className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center ${
                msg.role === 'user'
                  ? 'bg-white text-black'
                  : 'bg-[var(--surf-2)] border border-[var(--line)] text-[color:var(--muted)]'
              }`}
            >
              {msg.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
            </div>
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
              {msg.role === 'assistant' && <RouterTraceLines meta={msg.meta} />}
            </div>
          </div>
        ))}
      </div>

      <p className="text-[11px] text-[color:var(--muted-2)] mt-10 text-center mono">
        Shared via Yeetful — pay-per-call x402 agents, no API keys.
      </p>
    </div>
  )
}
