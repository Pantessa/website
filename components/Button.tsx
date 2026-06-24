'use client'

// The canonical dashboard/app button. Before this, dashboard buttons were
// hand-rolled Tailwind strings repeated across files (bg-white solids, bordered
// ghosts, amber/emerald variants) with slightly different padding, focus, and
// loading handling. <Button> centralizes those into typed variants so new
// buttons are consistent and every button gets the same focus-visible ring,
// 44px mobile tap target, and built-in loading spinner.
//
// Variant classes are intentionally identical to the patterns they replace, so
// migrating an existing button is a no-op visually. The landing pages keep their
// own .btn BEM system (a separate, larger marketing-CTA visual language).

import { Loader2 } from 'lucide-react'
import { cn } from '@/lib/utils'

type Variant = 'primary' | 'secondary' | 'accent' | 'danger' | 'warning'
type Size = 'sm' | 'md'

const BASE =
  'inline-flex items-center justify-center gap-1.5 font-medium rounded-lg transition-colors ' +
  'disabled:opacity-50 disabled:cursor-not-allowed ' +
  'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent)] focus-visible:ring-offset-2 focus-visible:ring-offset-black'

const SIZE: Record<Size, string> = {
  sm: 'text-xs px-3 py-2 max-lg:min-h-10',
  md: 'text-sm px-4 py-2.5 max-lg:min-h-11',
}

const VARIANT: Record<Variant, string> = {
  primary: 'bg-white text-zinc-950 hover:bg-zinc-200',
  secondary: 'border border-[var(--line-2)] text-[color:var(--muted)] hover:text-white hover:border-white',
  accent: 'bg-emerald-400 text-black hover:bg-emerald-300',
  danger: 'border border-red-500/40 text-red-400 hover:bg-red-500/10',
  warning: 'border border-amber-500/40 text-amber-400 hover:bg-amber-500/10',
}

export interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: Size
  /** Shows a spinner (replacing `icon`), disables the button, and sets aria-busy. */
  loading?: boolean
  /** Leading icon (hidden while loading). */
  icon?: React.ComponentType<{ className?: string }>
}

export default function Button({
  variant = 'secondary',
  size = 'sm',
  loading = false,
  icon: Icon,
  disabled,
  className,
  children,
  ...rest
}: ButtonProps) {
  const iconCls = size === 'sm' ? 'w-3.5 h-3.5' : 'w-4 h-4'
  return (
    <button
      {...rest}
      disabled={disabled || loading}
      aria-busy={loading || undefined}
      className={cn(BASE, SIZE[size], VARIANT[variant], className)}
    >
      {loading ? (
        <Loader2 className={cn(iconCls, 'animate-spin')} />
      ) : (
        Icon && <Icon className={iconCls} />
      )}
      {children}
    </button>
  )
}
