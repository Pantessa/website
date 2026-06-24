'use client'

// Minimal, dependency-free toast system. A context holds a small queue; the
// provider renders a fixed bottom-right stack. Actions that used to give no
// feedback (freeze, key mint/revoke, budget save, approval toggle) call
// useToast().toast(...) to confirm or report failure. Accessible: the stack is
// an aria-live region; errors are role=alert.

import { createContext, useCallback, useContext, useRef, useState } from 'react'
import { CheckCircle2, AlertCircle, Info, X } from 'lucide-react'
import { cn } from '@/lib/utils'

export type ToastType = 'success' | 'error' | 'info'
interface Toast {
  id: number
  message: string
  type: ToastType
}

interface ToastApi {
  toast: (message: string, type?: ToastType) => void
}

// Default is a safe no-op so a component used outside the provider never crashes.
const ToastContext = createContext<ToastApi>({ toast: () => {} })

export function useToast(): ToastApi {
  return useContext(ToastContext)
}

const ICON = { success: CheckCircle2, error: AlertCircle, info: Info } as const
const ACCENT = {
  success: 'text-emerald-400',
  error: 'text-red-400',
  info: 'text-[color:var(--muted)]',
} as const

const DURATION_MS = 3800

export function ToastProvider({ children }: { children: React.ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([])
  const nextId = useRef(1)

  const dismiss = useCallback((id: number) => {
    setToasts((prev) => prev.filter((t) => t.id !== id))
  }, [])

  const toast = useCallback(
    (message: string, type: ToastType = 'info') => {
      const id = nextId.current++
      // Cap the stack at 4 so a burst of actions can't bury the screen.
      setToasts((prev) => [...prev.slice(-3), { id, message, type }])
      setTimeout(() => dismiss(id), DURATION_MS)
    },
    [dismiss],
  )

  return (
    <ToastContext.Provider value={{ toast }}>
      {children}
      <div
        className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 pointer-events-none max-w-[calc(100vw-2rem)]"
        aria-live="polite"
        aria-atomic="false"
      >
        {toasts.map((t) => {
          const Icon = ICON[t.type]
          return (
            <div
              key={t.id}
              role={t.type === 'error' ? 'alert' : 'status'}
              className="toast-in pointer-events-auto flex items-start gap-2.5 w-80 max-w-full px-3.5 py-3 rounded-xl border border-[var(--line)] bg-[var(--surf-1)] shadow-lg shadow-black/40"
            >
              <Icon className={cn('w-4 h-4 flex-shrink-0 mt-0.5', ACCENT[t.type])} />
              <p className="text-xs leading-relaxed text-white flex-1 min-w-0">{t.message}</p>
              <button
                onClick={() => dismiss(t.id)}
                aria-label="Dismiss"
                className="flex-shrink-0 -mr-1 -mt-0.5 p-1 rounded-md text-[color:var(--muted-2)] hover:text-white transition-colors"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            </div>
          )
        })}
      </div>
    </ToastContext.Provider>
  )
}
