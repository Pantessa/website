'use client'

import { useState, useRef, useEffect } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { Send, Zap, Server, X, Loader2, Bot, User } from 'lucide-react'
import Image from 'next/image'
import { cn } from '@/lib/utils'
import { useYeetfulStore } from '@/lib/store'
import { CATEGORY_ICONS } from '@/lib/mcp-data'

export default function ChatInterface() {
  const {
    servers,
    activeServerIds,
    toggleServer,
    chats,
    currentChatId,
    createChat,
    addMessage,
  } = useYeetfulStore()

  const [input, setInput] = useState('')
  const [loading, setLoading] = useState(false)
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({})
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const currentChat = chats.find((c) => c.id === currentChatId)
  const activeServers = servers.filter((s) => activeServerIds.includes(s.id))

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' })
  }, [currentChat?.messages])

  const handleSend = async () => {
    if (!input.trim() || loading) return

    let chatId = currentChatId
    if (!chatId) {
      chatId = createChat(input.slice(0, 40) + (input.length > 40 ? '...' : ''))
    }

    const userMsg = input.trim()
    setInput('')
    setLoading(true)

    addMessage(chatId, { role: 'user', content: userMsg })

    try {
      const res = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          chatId,
          activeServerIds,
          // Full objects so the server knows each x402 endpoint/protocol/price.
          activeServers,
        }),
      })

      const data = await res.json()
      addMessage(chatId, {
        role: 'assistant',
        content: data.reply || data.error || 'No response.',
      })
    } catch {
      addMessage(chatId, {
        role: 'assistant',
        content: '⚠️ Failed to reach the server. Make sure your API key is configured.',
      })
    } finally {
      setLoading(false)
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
      {/* Active servers strip */}
      {activeServers.length > 0 && (
        <div className="flex-shrink-0 px-4 py-2 border-b border-zinc-800/60 bg-zinc-950/50">
          <div className="flex items-center gap-2 overflow-x-auto scrollbar-none">
            <span className="text-[11px] text-zinc-600 whitespace-nowrap font-medium">
              Active:
            </span>
            {activeServers.map((server) => {
              const catIcon = CATEGORY_ICONS[server.category] || '⚡'
              const hasErr = imgErrors[server.id]
              return (
                <div
                  key={server.id}
                  className="flex-shrink-0 flex items-center gap-1.5 px-2 py-1 rounded-lg bg-white/6 border border-white/8"
                >
                  <div className="w-3.5 h-3.5 flex items-center justify-center">
                    {server.iconUrl && !hasErr ? (
                      <Image
                        src={server.iconUrl}
                        alt={server.name}
                        width={14}
                        height={14}
                        className="object-contain rounded-sm"
                        onError={() => setImgErrors((p) => ({ ...p, [server.id]: true }))}
                        unoptimized
                      />
                    ) : (
                      <span className="text-[10px]">{catIcon}</span>
                    )}
                  </div>
                  <span className="text-[11px] text-zinc-300 whitespace-nowrap">
                    {server.name}
                  </span>
                  <button
                    onClick={() => toggleServer(server.id)}
                    className="text-zinc-600 hover:text-zinc-400 transition-colors"
                  >
                    <X className="w-2.5 h-2.5" />
                  </button>
                </div>
              )
            })}
          </div>
        </div>
      )}

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
                        ? 'bg-white text-zinc-950'
                        : 'bg-zinc-800 text-zinc-400'
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
                      'max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed',
                      msg.role === 'user'
                        ? 'bg-white text-zinc-950 rounded-tr-sm'
                        : 'bg-zinc-900 text-zinc-200 border border-zinc-800/60 rounded-tl-sm'
                    )}
                  >
                    <pre className="whitespace-pre-wrap font-sans">{msg.content}</pre>
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
                <div className="w-8 h-8 rounded-xl bg-zinc-800 flex items-center justify-center">
                  <Bot className="w-4 h-4 text-zinc-400" />
                </div>
                <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-zinc-900 border border-zinc-800/60">
                  <Loader2 className="w-4 h-4 text-zinc-400 animate-spin" />
                </div>
              </motion.div>
            )}

            <div ref={messagesEndRef} />
          </>
        )}
      </div>

      {/* Input area */}
      <div className="flex-shrink-0 p-4 border-t border-zinc-800/60">
        <div className="flex items-end gap-3 p-3 rounded-2xl border border-zinc-700/60 bg-zinc-900/80 focus-within:border-zinc-600 transition-colors">
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
            className="flex-1 bg-transparent text-sm text-white placeholder-zinc-600 resize-none outline-none max-h-40 overflow-y-auto leading-relaxed"
            style={{ minHeight: '24px' }}
          />
          <button
            onClick={handleSend}
            disabled={!input.trim() || loading}
            className={cn(
              'flex-shrink-0 w-8 h-8 rounded-xl flex items-center justify-center transition-all duration-200',
              input.trim() && !loading
                ? 'bg-white text-zinc-950 hover:bg-zinc-200 scale-100'
                : 'bg-zinc-800 text-zinc-600 cursor-not-allowed scale-95'
            )}
          >
            {loading ? (
              <Loader2 className="w-4 h-4 animate-spin" />
            ) : (
              <Send className="w-4 h-4" />
            )}
          </button>
        </div>
        <p className="text-[11px] text-zinc-700 mt-2 text-center">
          Enter to send · Shift+Enter for newline
        </p>
      </div>
    </div>
  )
}

function EmptyState({ activeCount }: { activeCount: number }) {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center py-20">
      <div className="w-16 h-16 rounded-2xl bg-zinc-900 border border-zinc-800 flex items-center justify-center mb-6">
        <Zap className="w-8 h-8 text-zinc-600" />
      </div>
      {activeCount === 0 ? (
        <>
          <h3 className="text-zinc-300 font-semibold mb-2">No servers selected</h3>
          <p className="text-zinc-600 text-sm max-w-xs">
            Go to the Servers page and add some MCP servers to power up your chat.
          </p>
        </>
      ) : (
        <>
          <h3 className="text-zinc-300 font-semibold mb-2">
            {activeCount} server{activeCount > 1 ? 's' : ''} ready
          </h3>
          <p className="text-zinc-600 text-sm max-w-xs">
            Start chatting! Your message will be powered by the active MCP servers.
          </p>
        </>
      )}
    </div>
  )
}
