'use client'

import { motion, AnimatePresence } from 'framer-motion'
import { X, ArrowRight, Zap } from 'lucide-react'
import Image from 'next/image'
import Link from 'next/link'
import { useYeetfulStore } from '@/lib/store'
import { CATEGORY_ICONS } from '@/lib/mcp-data'
import { useState } from 'react'

export default function ActiveServerBar() {
  const { activeServerIds, servers, toggleServer, clearActiveServers } = useYeetfulStore()
  const [imgErrors, setImgErrors] = useState<Record<string, boolean>>({})

  const activeServers = servers.filter((s) => activeServerIds.includes(s.id))

  if (activeServers.length === 0) return null

  return (
    <motion.div
      initial={{ y: 100, opacity: 0 }}
      animate={{ y: 0, opacity: 1 }}
      exit={{ y: 100, opacity: 0 }}
      className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 w-[calc(100%-2rem)] max-w-2xl"
    >
      <div className="rounded-2xl border border-white/15 bg-zinc-950/95 backdrop-blur-2xl shadow-2xl shadow-black/60 p-3">
        <div className="flex items-center gap-3">
          {/* Active indicator */}
          <div className="flex-shrink-0 w-8 h-8 rounded-xl bg-white/10 flex items-center justify-center">
            <Zap className="w-4 h-4 text-white" />
          </div>

          {/* Server chips */}
          <div className="flex-1 flex items-center gap-2 overflow-x-auto scrollbar-none min-w-0 pb-0.5">
            <AnimatePresence mode="popLayout">
              {activeServers.map((server) => {
                const catIcon = CATEGORY_ICONS[server.category] || '⚡'
                const hasImgError = imgErrors[server.id]
                return (
                  <motion.div
                    key={server.id}
                    layout
                    initial={{ scale: 0.7, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.7, opacity: 0 }}
                    className="flex-shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-xl bg-white/8 border border-white/10 group"
                  >
                    <div className="w-4 h-4 rounded-md overflow-hidden flex items-center justify-center text-xs">
                      {server.iconUrl && !hasImgError ? (
                        <Image
                          src={server.iconUrl}
                          alt={server.name}
                          width={16}
                          height={16}
                          className="object-contain"
                          onError={() => setImgErrors((p) => ({ ...p, [server.id]: true }))}
                          unoptimized
                        />
                      ) : (
                        <span className="text-[10px]">{catIcon}</span>
                      )}
                    </div>
                    <span className="text-xs text-zinc-200 font-medium whitespace-nowrap">
                      {server.name}
                    </span>
                    <button
                      onClick={() => toggleServer(server.id)}
                      className="ml-0.5 text-zinc-600 hover:text-zinc-300 transition-colors"
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </motion.div>
                )
              })}
            </AnimatePresence>
          </div>

          {/* Actions */}
          <div className="flex items-center gap-2 flex-shrink-0">
            <button
              onClick={clearActiveServers}
              className="text-xs text-zinc-600 hover:text-zinc-400 transition-colors px-2 py-1"
            >
              Clear
            </button>
            <Link
              href="/chat"
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-white text-zinc-950 text-xs font-bold hover:bg-zinc-200 transition-colors"
            >
              Chat
              <ArrowRight className="w-3.5 h-3.5" />
            </Link>
          </div>
        </div>
      </div>
    </motion.div>
  )
}
