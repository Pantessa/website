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
        className="absolute top-4 -right-3 z-20 w-6 h-6 rounded-full bg-zinc-800 border border-zinc-700 flex items-center justify-center text-zinc-400 hover:text-white hover:bg-zinc-700 transition-all"
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
            className="flex-shrink-0 border-r border-zinc-800/60 bg-zinc-950/80 overflow-hidden h-full"
          >
            <div className="w-60 flex flex-col h-full">
              <div className="p-3 border-b border-zinc-800/60">
                <button
                  onClick={() => createChat()}
                  className="w-full flex items-center gap-2 px-3 py-2 rounded-xl bg-white/8 border border-white/10 text-zinc-300 hover:text-white hover:bg-white/12 transition-all text-sm font-medium"
                >
                  <Plus className="w-4 h-4" />
                  New Chat
                </button>
              </div>

              <div className="flex-1 overflow-y-auto p-2 space-y-1">
                {chats.length === 0 && (
                  <p className="text-xs text-zinc-600 text-center py-6 px-3">
                    No chats yet. Start one by selecting servers and clicking Chat.
                  </p>
                )}
                {chats.map((chat) => (
                  <div
                    key={chat.id}
                    className={cn(
                      'group flex items-center gap-2 px-3 py-2 rounded-xl cursor-pointer transition-all',
                      currentChatId === chat.id
                        ? 'bg-white/10 text-white'
                        : 'text-zinc-400 hover:text-zinc-200 hover:bg-white/5'
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
