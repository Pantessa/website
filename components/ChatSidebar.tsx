'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { MessageSquare, Plus, Trash2, ChevronLeft, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'

export default function ChatSidebar() {
  const {
    chats,
    currentChatId,
    setCurrentChatId,
    createChat,
    deleteChat,
    sidebarOpen,
    setSidebarOpen,
  } = useYeetfulStore()

  return (
    <>
      {/* Toggle button */}
      <button
        onClick={() => setSidebarOpen(!sidebarOpen)}
        className="absolute top-4 -right-3 z-20 w-6 h-6 rounded-full bg-[var(--surf-2)] border border-[var(--line-2)] flex items-center justify-center text-[color:var(--muted)] hover:text-white transition-all"
      >
        {sidebarOpen ? (
          <ChevronLeft className="w-3.5 h-3.5" />
        ) : (
          <ChevronRight className="w-3.5 h-3.5" />
        )}
      </button>

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
                  onClick={() => createChat()}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-[var(--surf-2)] border border-[var(--line)] text-[color:var(--muted)] hover:text-white hover:border-[var(--line-2)] transition-all text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  New Chat
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {chats.length === 0 && (
                  <p className="text-xs text-[color:var(--muted-2)] text-center py-6 px-3">
                    No chats yet. Add agents from the directory, then start one here.
                  </p>
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
                    onClick={() => setCurrentChatId(chat.id)}
                  >
                    <MessageSquare className="w-3.5 h-3.5 flex-shrink-0" />
                    <span className="flex-1 text-xs truncate">{chat.title}</span>
                    <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      {chat.activeServerIds.length > 0 && (
                        <span className="text-[10px] text-zinc-600">
                          {chat.activeServerIds.length}
                        </span>
                      )}
                      <button
                        onClick={(e) => {
                          e.stopPropagation()
                          deleteChat(chat.id)
                        }}
                        className="p-0.5 text-zinc-700 hover:text-red-400 transition-colors"
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
    </>
  )
}
