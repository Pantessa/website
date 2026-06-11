'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, Plus, Trash2, Globe, Loader2 } from 'lucide-react'
import { useRouter } from 'next/navigation'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { useSession } from '@/lib/session'

export default function ChatSidebar() {
  const router = useRouter()
  const {
    chats,
    currentChatId,
    deleteChat,
    chatsLoading,
    sidebarOpen,
  } = useYeetfulStore()
  const { address, needsSignIn, signIn, signingIn } = useSession()

  const handleDelete = (id: string) => {
    deleteChat(id)
    if (currentChatId === id) router.push('/chat')
  }

  return (
    <AnimatePresence initial={false}>
      {sidebarOpen && (
        <motion.aside
          initial={{ width: 0, opacity: 0 }}
          animate={{ width: 240, opacity: 1 }}
          exit={{ width: 0, opacity: 0 }}
          transition={{ duration: 0.25, ease: 'easeInOut' }}
          className="flex-shrink-0 border-r border-[var(--line)] bg-black/40 overflow-hidden h-full"
        >
          <div className="w-60 flex flex-col h-full">
            <div className="p-3 border-b border-[var(--line)]">
              <button
                onClick={() => router.push('/chat')}
                className="w-full flex items-center gap-2 px-3 py-2 min-h-[44px] md:min-h-0 rounded-xl bg-[var(--surf-2)] border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-all text-sm font-medium"
              >
                <Plus className="w-4 h-4" />
                New Chat
              </button>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-1">
              {chatsLoading && chats.length === 0 && (
                <div className="flex items-center justify-center gap-2 py-6 text-xs text-[color:var(--muted-2)]">
                  <Loader2 className="w-3.5 h-3.5 animate-spin" /> Loading chats…
                </div>
              )}

              {!chatsLoading && chats.length === 0 && (
                <div className="text-center py-6 px-3 space-y-3">
                  <p className="text-xs text-[color:var(--muted-2)]">
                    {address
                      ? 'No chats yet. Add agents, then start one here.'
                      : 'Your chats are saved when you sign in with your wallet.'}
                  </p>
                  {needsSignIn && (
                    <button
                      onClick={() => signIn()}
                      disabled={signingIn}
                      className="text-xs font-semibold text-white underline underline-offset-2 hover:text-zinc-300 disabled:opacity-60"
                    >
                      {signingIn ? 'Signing in…' : 'Sign in to save chats'}
                    </button>
                  )}
                </div>
              )}

              {chats.map((chat) => (
                <div
                  key={chat.id}
                  className={cn(
                    'group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all',
                    currentChatId === chat.id
                      ? 'bg-[var(--surf-2)] text-white'
                      : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-1)]'
                  )}
                  onClick={() => router.push(`/chat/${chat.id}`)}
                >
                  <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                  <span className="flex-1 text-xs truncate">{chat.title}</span>
                  {chat.isPublic && (
                    <Globe
                      className="w-3 h-3 flex-shrink-0 text-emerald-400/80"
                      aria-label="Shared publicly"
                    />
                  )}
                  <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    {chat.activeServerIds.length > 0 && (
                      <span className="text-[10px] text-zinc-600">
                        {chat.activeServerIds.length}
                      </span>
                    )}
                    <button
                      onClick={(e) => {
                        e.stopPropagation()
                        handleDelete(chat.id)
                      }}
                      className="p-0.5 text-zinc-700 hover:text-red-400 transition-colors"
                      aria-label="Delete chat"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.aside>
      )}
    </AnimatePresence>
  )
}
