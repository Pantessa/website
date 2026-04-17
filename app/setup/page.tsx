'use client'

import { motion } from 'framer-motion'
import { Database, Key, Terminal, CheckCircle2, ArrowRight, Copy } from 'lucide-react'
import { useState } from 'react'
import Link from 'next/link'
import { cn } from '@/lib/utils'

const steps = [
  {
    icon: Database,
    title: 'Set up PostgreSQL',
    description: 'Create a free database on Neon, Supabase, or Railway.',
    color: '#336791',
    commands: [
      '# Create a free Neon database at neon.tech',
      '# Then copy your connection string',
    ],
    links: [
      { label: 'Neon (free)', href: 'https://neon.tech' },
      { label: 'Supabase (free)', href: 'https://supabase.com' },
      { label: 'Railway', href: 'https://railway.app' },
    ],
  },
  {
    icon: Key,
    title: 'Configure environment',
    description: 'Add your DATABASE_URL and optional AI API keys.',
    color: '#6366f1',
    commands: [
      'cp .env.example .env.local',
      '',
      '# Edit .env.local:',
      'DATABASE_URL="postgresql://user:pass@host/db"',
      'ANTHROPIC_API_KEY="sk-ant-..."   # optional',
      'OPENAI_API_KEY="sk-..."          # optional',
    ],
    links: [],
  },
  {
    icon: Terminal,
    title: 'Install & migrate',
    description: 'Install dependencies, run migrations, and seed the default servers.',
    color: '#10b981',
    commands: [
      'npm install',
      'npm run db:generate',
      'npm run db:push',
      'npm run db:seed',
      'npm run dev',
    ],
    links: [],
  },
]

function CodeBlock({ lines }: { lines: string[] }) {
  const [copied, setCopied] = useState(false)
  const text = lines.filter((l) => !l.startsWith('#')).join('\n')

  const copy = () => {
    navigator.clipboard.writeText(text)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div className="relative group mt-3 rounded-xl bg-zinc-950 border border-zinc-800/60 overflow-hidden">
      <button
        onClick={copy}
        className="absolute top-2 right-2 p-1.5 rounded-lg bg-zinc-800/80 text-zinc-500 hover:text-zinc-300 opacity-0 group-hover:opacity-100 transition-all"
      >
        {copied ? <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
      </button>
      <pre className="p-4 text-xs font-mono text-zinc-400 overflow-x-auto">
        {lines.map((line, i) => (
          <span
            key={i}
            className={cn(
              'block',
              line.startsWith('#') ? 'text-zinc-600' : ''
            )}
          >
            {line || '\u00A0'}
          </span>
        ))}
      </pre>
    </div>
  )
}

export default function SetupPage() {
  return (
    <div className="min-h-screen py-10 px-4">
      <div className="max-w-2xl mx-auto">
        <motion.div
          initial={{ opacity: 0, y: -16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-10"
        >
          <h1 className="text-3xl font-black text-white mb-2">Setup Guide</h1>
          <p className="text-zinc-500 text-sm">
            Get Yeetful running with a live database and AI backend in minutes.
          </p>
        </motion.div>

        <div className="space-y-6">
          {steps.map((step, i) => {
            const Icon = step.icon
            return (
              <motion.div
                key={step.title}
                initial={{ opacity: 0, y: 20 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: i * 0.1 }}
                className="p-6 rounded-2xl border border-zinc-800/60 bg-zinc-900/40"
              >
                <div className="flex items-start gap-4">
                  <div
                    className="w-10 h-10 rounded-xl flex items-center justify-center flex-shrink-0 mt-0.5"
                    style={{ background: `${step.color}22`, border: `1px solid ${step.color}33` }}
                  >
                    <Icon className="w-5 h-5" style={{ color: step.color }} />
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2 mb-1">
                      <span className="text-xs text-zinc-600 font-mono">Step {i + 1}</span>
                    </div>
                    <h3 className="font-semibold text-white mb-1">{step.title}</h3>
                    <p className="text-sm text-zinc-500">{step.description}</p>

                    <CodeBlock lines={step.commands} />

                    {step.links.length > 0 && (
                      <div className="flex items-center gap-3 mt-3">
                        {step.links.map((link) => (
                          <a
                            key={link.href}
                            href={link.href}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs text-zinc-400 hover:text-white underline underline-offset-2 transition-colors"
                          >
                            {link.label}
                          </a>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              </motion.div>
            )
          })}
        </div>

        {/* CTA */}
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 0.4 }}
          className="mt-8 p-6 rounded-2xl border border-emerald-500/20 bg-emerald-500/5 text-center"
        >
          <CheckCircle2 className="w-8 h-8 text-emerald-400 mx-auto mb-3" />
          <h3 className="text-white font-semibold mb-1">Ready to go?</h3>
          <p className="text-zinc-500 text-sm mb-4">
            Once configured, your servers will be persisted in PostgreSQL and AI responses will be powered by your chosen LLM.
          </p>
          <Link
            href="/"
            className="inline-flex items-center gap-2 px-5 py-2.5 rounded-xl bg-white text-zinc-950 text-sm font-bold hover:bg-zinc-200 transition-colors"
          >
            Go to Servers
            <ArrowRight className="w-4 h-4" />
          </Link>
        </motion.div>
      </div>
    </div>
  )
}
