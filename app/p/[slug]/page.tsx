import Link from 'next/link'
import { notFound } from 'next/navigation'
import { Bot, User, Globe } from 'lucide-react'
import prisma from '@/lib/db'
import { YeetfulMark } from '@/components/Logo'
import MessageReceipts from '@/components/MessageReceipts'
import RouterTraceLines from '@/components/RouterTraceLines'
import ChatMarkdown from '@/components/ChatMarkdown'
import SharedJobLog, { type SharedJob } from '@/components/SharedJobLog'
import SignedTxLines, { signedTxsOf } from '@/components/SignedTxLines'
import { respondingMark } from '@/lib/responding-mcp'

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

/** The job a message compiled, when its meta says so. */
function jobIdOf(meta: unknown): string | null {
  if (!meta || typeof meta !== 'object') return null
  const id = (meta as { jobId?: unknown }).jobId
  return typeof id === 'string' && id ? id : null
}

/** Jobs referenced by this chat's messages — each carries its full persisted
 * step log (artifacts, guard reports, settlement results), so the shared page
 * can show the execution story without any live polling session. */
async function getJobs(messages: Array<{ meta: unknown }>): Promise<Map<string, SharedJob>> {
  const ids = [...new Set(messages.map((m) => jobIdOf(m.meta)).filter((id): id is string => !!id))]
  if (ids.length === 0) return new Map()
  try {
    const jobs = await prisma.job.findMany({
      where: { id: { in: ids } },
      include: { steps: { orderBy: { seq: 'asc' } } },
    })
    return new Map(jobs.map((j) => [j.id, j]))
  } catch {
    return new Map()
  }
}

export async function generateMetadata({ params }: Params) {
  const { slug } = await params
  const chat = await getSharedChat(slug)
  if (!chat) return { title: 'Shared chat · Yeetful', robots: { index: false, follow: false } }
  const jobs = await getJobs(chat.messages)
  const moved = [...jobs.values()]
    .filter((j) => j.status === 'done')
    .reduce((sum, j) => sum + (j.valueUsd ?? 0), 0)
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

export default async function SharedChatPage({ params }: Params) {
  const { slug } = await params
  const chat = await getSharedChat(slug)
  if (!chat) notFound()
  const jobs = await getJobs(chat.messages)

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
        {chat.messages.map((msg) => {
          const job = msg.role === 'assistant' ? jobs.get(jobIdOf(msg.meta) ?? '') : undefined
          return (
            <div
              key={msg.id}
              className={`flex gap-3 ${msg.role === 'user' ? 'flex-row-reverse' : 'flex-row'}`}
            >
              {(() => {
                const Mark = msg.role === 'assistant' ? respondingMark(msg.meta) : null
                return (
                  <div
                    className={`flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center overflow-hidden ${
                      msg.role === 'user'
                        ? 'bg-white text-black'
                        : `bg-[var(--surf-2)] border border-[var(--line)] ${Mark ? 'text-[color:var(--fg)]' : 'text-[color:var(--muted)]'}`
                    }`}
                  >
                    {msg.role === 'user' ? (
                      <User className="w-4 h-4" />
                    ) : Mark ? (
                      <Mark size={18} />
                    ) : (
                      <Bot className="w-4 h-4" />
                    )}
                  </div>
                )
              })()}
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

      <p className="text-[11px] text-[color:var(--muted-2)] mt-10 text-center mono">
        Shared via Yeetful — pay-per-call x402 agents, no API keys.
      </p>
    </div>
  )
}
