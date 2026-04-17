'use client'

import { useState } from 'react'
import Image from 'next/image'
import { Check, Plus, Minus, ExternalLink, ChevronDown, ChevronUp } from 'lucide-react'
import { motion, AnimatePresence } from 'framer-motion'
import { cn } from '@/lib/utils'
import { McpServer, useYeetfulStore } from '@/lib/store'
import { CATEGORY_ICONS } from '@/lib/mcp-data'

interface McpServerCardProps {
  server: McpServer
  index: number
}

export default function McpServerCard({ server, index }: McpServerCardProps) {
  const { activeServerIds, toggleServer } = useYeetfulStore()
  const [expanded, setExpanded] = useState(false)
  const [imgError, setImgError] = useState(false)

  const isActive = activeServerIds.includes(server.id)
  const catIcon = CATEGORY_ICONS[server.category] || '⚡'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.35, delay: index * 0.04, ease: 'easeOut' }}
      className={cn(
        'group relative rounded-2xl border transition-all duration-300 overflow-hidden cursor-pointer',
        isActive
          ? 'border-white/25 bg-white/8 shadow-lg shadow-white/5'
          : 'border-zinc-800/60 bg-zinc-900/40 hover:border-zinc-700/80 hover:bg-zinc-900/70'
      )}
      onClick={() => toggleServer(server.id)}
    >
      {/* Active glow */}
      {isActive && (
        <div
          className="absolute inset-0 opacity-10 pointer-events-none"
          style={{
            background: `radial-gradient(ellipse at 50% 0%, ${server.color || '#ffffff'}, transparent 70%)`,
          }}
        />
      )}

      <div className="p-4">
        {/* Header row */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            {/* Icon */}
            <div
              className={cn(
                'w-11 h-11 rounded-xl flex items-center justify-center flex-shrink-0 text-xl transition-transform duration-200',
                isActive ? 'scale-110' : 'group-hover:scale-105'
              )}
              style={{
                background: `linear-gradient(135deg, ${server.color || '#333'}22, ${server.color || '#333'}44)`,
                border: `1px solid ${server.color || '#555'}33`,
              }}
            >
              {server.iconUrl && !imgError ? (
                <Image
                  src={server.iconUrl}
                  alt={server.name}
                  width={28}
                  height={28}
                  className="rounded-lg object-contain"
                  onError={() => setImgError(true)}
                  unoptimized
                />
              ) : (
                <span>{catIcon}</span>
              )}
            </div>

            {/* Name + category */}
            <div className="min-w-0">
              <h3 className="font-semibold text-white text-sm leading-tight truncate">
                {server.name}
              </h3>
              <span className="text-[11px] text-zinc-500 font-medium">{server.category}</span>
            </div>
          </div>

          {/* Toggle button */}
          <button
            onClick={(e) => {
              e.stopPropagation()
              toggleServer(server.id)
            }}
            className={cn(
              'flex-shrink-0 w-8 h-8 rounded-full flex items-center justify-center transition-all duration-200',
              isActive
                ? 'bg-white text-zinc-950 hover:bg-zinc-200'
                : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-white'
            )}
          >
            {isActive ? (
              <Check className="w-3.5 h-3.5" strokeWidth={3} />
            ) : (
              <Plus className="w-3.5 h-3.5" strokeWidth={2.5} />
            )}
          </button>
        </div>

        {/* Description */}
        <p className="mt-3 text-xs text-zinc-500 leading-relaxed line-clamp-2 group-hover:text-zinc-400 transition-colors">
          {server.description}
        </p>

        {/* Footer */}
        <div className="mt-3 flex items-center justify-between">
          <div className="flex items-center gap-2">
            {server.isCustom && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-amber-500/15 text-amber-400 border border-amber-500/20 font-medium">
                Custom
              </span>
            )}
            {isActive && (
              <span className="text-[10px] px-2 py-0.5 rounded-full bg-emerald-500/15 text-emerald-400 border border-emerald-500/20 font-medium flex items-center gap-1">
                <span className="w-1 h-1 rounded-full bg-emerald-400 inline-block" />
                Active
              </span>
            )}
          </div>

          <div className="flex items-center gap-1">
            {server.websiteUrl && (
              <a
                href={server.websiteUrl}
                target="_blank"
                rel="noopener noreferrer"
                onClick={(e) => e.stopPropagation()}
                className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors rounded"
              >
                <ExternalLink className="w-3 h-3" />
              </a>
            )}
            {server.configSchema && (
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  setExpanded(!expanded)
                }}
                className="p-1 text-zinc-600 hover:text-zinc-300 transition-colors rounded"
              >
                {expanded ? (
                  <ChevronUp className="w-3 h-3" />
                ) : (
                  <ChevronDown className="w-3 h-3" />
                )}
              </button>
            )}
          </div>
        </div>

        {/* Config fields expansion */}
        <AnimatePresence>
          {expanded && server.configSchema && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.2 }}
              className="overflow-hidden"
            >
              <div className="mt-3 pt-3 border-t border-zinc-800/60 space-y-2">
                <p className="text-[10px] text-zinc-600 font-medium uppercase tracking-wider">
                  Config Required
                </p>
                {Object.entries(server.configSchema).map(([key, field]) => (
                  <div key={key} className="flex items-center justify-between">
                    <span className="text-xs text-zinc-400">{field.label}</span>
                    {field.required && (
                      <span className="text-[10px] text-red-400/70">required</span>
                    )}
                  </div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </motion.div>
  )
}
