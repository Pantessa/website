'use client'

// The voice door: a mic in the composer pill. Press → the browser's own
// speech recognizer listens (Web Speech API — keyless, on-device or the
// browser vendor's service, no audio ever touches our servers); words land in
// the composer as they're heard; the final transcript is normalized
// (lib/voice-ask.ts) and SENT as an ordinary ask. "Show me the ETH chart"
// pops the overlay, "buy ten dollars of ETH" builds the swap — and the
// wallet signature stays the only real gate, exactly as with a typed ask or
// a chip tap (the chip-send contract: the gesture is the send).
//
// Renders NOTHING where the API is missing (Firefox) — a dead mic is worse
// than no mic. A blocked microphone (permission denied, or an embed host
// that didn't delegate `microphone`) reports through onStateChange so the
// composer can say so in words instead of failing silently.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export type VoiceState = 'idle' | 'listening' | 'denied' | 'unsupported'

interface SpeechResultLike {
  isFinal: boolean
  0: { transcript: string }
}
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onresult: ((e: { results: ArrayLike<SpeechResultLike> }) => void) | null
  onerror: ((e: { error: string }) => void) | null
  onend: (() => void) | null
  start(): void
  stop(): void
  abort(): void
}
type SpeechRecognitionCtor = new () => SpeechRecognitionLike

/** The browser's recognizer constructor, or null (SSR / unsupported). */
export function speechRecognitionCtor(): SpeechRecognitionCtor | null {
  if (typeof window === 'undefined') return null
  const w = window as unknown as { SpeechRecognition?: SpeechRecognitionCtor; webkitSpeechRecognition?: SpeechRecognitionCtor }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

export default function VoiceButton({
  onInterim,
  onFinal,
  onCancel,
  onStateChange,
  disabled = false,
  className,
}: {
  /** Words as they're recognized — the composer mirrors them live. */
  onInterim: (text: string) => void
  /** The finished transcript — the caller normalizes + sends. */
  onFinal: (text: string) => void
  /** Listening ended with nothing to send (Esc, no speech, error). */
  onCancel?: () => void
  onStateChange?: (state: VoiceState) => void
  disabled?: boolean
  className?: string
}) {
  const [state, setStateRaw] = useState<VoiceState | null>(null)
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // Latest text seen + whether the user asked to cancel — read in onend,
  // which fires after every path (final, stop(), abort(), error).
  const textRef = useRef('')
  const cancelRef = useRef(false)
  const deniedRef = useRef(false)
  const cbRef = useRef({ onInterim, onFinal, onCancel, onStateChange })
  cbRef.current = { onInterim, onFinal, onCancel, onStateChange }

  const setState = useCallback((s: VoiceState) => {
    setStateRaw(s)
    cbRef.current.onStateChange?.(s)
  }, [])

  // Feature-detect after mount (SSR renders nothing; hydration stays clean).
  useEffect(() => {
    setStateRaw(speechRecognitionCtor() ? 'idle' : 'unsupported')
  }, [])

  const stop = useCallback((cancel: boolean) => {
    const rec = recRef.current
    if (!rec) return
    cancelRef.current = cancel
    try {
      if (cancel) rec.abort()
      else rec.stop()
    } catch {
      /* already ended */
    }
  }, [])

  const start = useCallback(() => {
    const Ctor = speechRecognitionCtor()
    if (!Ctor || recRef.current) return
    const rec = new Ctor()
    rec.lang = (typeof navigator !== 'undefined' && navigator.language) || 'en-US'
    rec.interimResults = true
    rec.continuous = false
    rec.maxAlternatives = 1
    textRef.current = ''
    cancelRef.current = false
    deniedRef.current = false
    rec.onresult = (e) => {
      let text = ''
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        text += r[0]?.transcript ?? ''
      }
      text = text.trim()
      textRef.current = text
      if (text) cbRef.current.onInterim(text)
    }
    rec.onerror = (e) => {
      // 'not-allowed' / 'service-not-allowed' = the mic is blocked (site
      // permission, or an embed host that didn't delegate it). Everything
      // else ('no-speech', 'aborted', 'network') just returns to idle.
      cancelRef.current = true
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') deniedRef.current = true
    }
    rec.onend = () => {
      recRef.current = null
      const text = textRef.current
      if (!cancelRef.current && text) {
        // Chrome delivers the final result before onend on stop(); Safari
        // sometimes ends on interim text alone — the last thing heard is
        // what the user meant to send.
        cbRef.current.onFinal(text)
      } else {
        cbRef.current.onCancel?.()
      }
      setState(deniedRef.current ? 'denied' : 'idle')
    }
    recRef.current = rec
    try {
      rec.start()
      setState('listening')
    } catch {
      recRef.current = null
      setState('idle')
    }
  }, [setState])

  // Esc cancels while listening; unmount aborts.
  useEffect(() => {
    if (state !== 'listening') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, stop])
  useEffect(() => () => stop(true), [stop])

  if (state === null || state === 'unsupported') return null

  const listening = state === 'listening'
  const denied = state === 'denied'
  const label = listening ? 'Stop listening and send' : denied ? 'Microphone is blocked' : 'Speak your ask'
  return (
    <button
      type="button"
      onClick={() => (listening ? stop(false) : start())}
      disabled={disabled && !listening}
      aria-label={label}
      aria-pressed={listening}
      title={label}
      data-voice-state={state}
      className={cn(
        'relative flex-shrink-0 w-11 h-11 md:w-9 md:h-9 rounded-full flex items-center justify-center transition-all duration-200',
        listening
          ? 'voice-live bg-[color:var(--accent)] text-black shadow-[0_0_18px_rgba(52,227,160,0.35)]'
          : denied
            ? 'text-[color:var(--muted-2)]'
            : 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)]',
        disabled && !listening && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {denied ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
    </button>
  )
}
