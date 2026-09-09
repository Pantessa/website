'use client'

// The voice door: a mic in the composer pill. Press → the browser's own
// speech recognizer listens (Web Speech API — keyless, no audio on our
// servers); words land in the composer AS THEY'RE HEARD; the final
// transcript is normalized (lib/voice-ask.ts) and SENT as an ordinary ask.
// "Show me the ETH chart" pops the overlay, "buy ten dollars of ETH" builds
// the swap — and the wallet signature stays the only real gate, exactly as
// with a typed ask or a chip tap (the chip-send contract).
//
// Two lanes, one utterance (learned on the first real drill, 2026-09-09,
// when "show me my position on Morpho" came back "addition on Mortal"):
//   1. The recognizer — instant interim words for the composer. It has no
//      DeFi vocabulary and its first half-second is deaf: the button reads
//      "starting" until the recognizer's OWN start event, so nobody speaks
//      into a mic that isn't listening yet.
//   2. A parallel MediaRecorder capture → POST /api/voice/transcribe, a
//      model that takes our vocabulary (lib/voice-lexicon.ts). When that
//      lane is on, ITS words are what gets sent; the recognizer's are the
//      live preview. Off (no key, no MediaRecorder, iOS refusing a second
//      capture) → the recognizer's final is sent, and a low-confidence one
//      lands in the composer for a look instead of firing.
//
// Renders NOTHING where the recognizer is missing (Firefox) — a dead mic is
// worse than no mic. A blocked microphone reports through onStateChange so
// the composer can say so in words.

import { useCallback, useEffect, useRef, useState } from 'react'
import { Mic, MicOff } from 'lucide-react'
import { cn } from '@/lib/utils'

export type VoiceState = 'idle' | 'starting' | 'listening' | 'transcribing' | 'denied' | 'unsupported'

interface SpeechResultLike {
  isFinal: boolean
  0: { transcript: string; confidence?: number }
}
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  maxAlternatives: number
  onstart: (() => void) | null
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

/** Below this the recognizer's own final is shown, not sent (no accurate
 *  lane to override it). Chrome reports ~0.9 for clean speech; Safari often
 *  reports nothing at all, which counts as "no opinion" and sends. */
export const VOICE_SEND_CONFIDENCE = 0.5
/** How long the accurate lane may take before the recognizer's words go. */
const TRANSCRIBE_TIMEOUT_MS = 6000

/** Result of a finished utterance. */
export interface VoiceFinal {
  text: string
  /** 'transcriber' = the vocabulary lane's words; 'recognizer' = the browser's. */
  source: 'transcriber' | 'recognizer'
  /** Recognizer confidence when it gave one (0–1), else null. */
  confidence: number | null
}

let transcribeLaneCache: Promise<boolean> | null = null
/** Is the accurate lane on this deploy? Probed once per page. */
function transcribeLaneEnabled(): Promise<boolean> {
  if (!transcribeLaneCache) {
    transcribeLaneCache = fetch('/api/voice/transcribe', { method: 'GET' })
      .then((r) => (r.ok ? r.json() : { enabled: false }))
      .then((j: { enabled?: unknown }) => j.enabled === true)
      .catch(() => false)
  }
  return transcribeLaneCache
}

function recorderMime(): string | null {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg;codecs=opus']) {
    try {
      if (MediaRecorder.isTypeSupported(t)) return t
    } catch {
      /* older engines throw on unknown types */
    }
  }
  return null
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
  /** The finished utterance — the caller normalizes + sends (or shows it). */
  onFinal: (result: VoiceFinal) => void
  /** Listening ended with nothing to send (Esc, no speech, error). */
  onCancel?: () => void
  onStateChange?: (state: VoiceState) => void
  disabled?: boolean
  className?: string
}) {
  const [state, setStateRaw] = useState<VoiceState | null>(null)
  const stateRef = useRef<VoiceState>('idle')
  const recRef = useRef<SpeechRecognitionLike | null>(null)
  // Latest text seen + whether the user asked to cancel — read in onend,
  // which fires after every path (final, stop(), abort(), error).
  const textRef = useRef('')
  const confRef = useRef<number | null>(null)
  const cancelRef = useRef(false)
  const deniedRef = useRef(false)
  // The accurate lane's capture for this utterance.
  const recorderRef = useRef<{ rec: MediaRecorder; chunks: Blob[]; mime: string; stream: MediaStream; done: Promise<Blob | null> } | null>(null)
  const cbRef = useRef({ onInterim, onFinal, onCancel, onStateChange })
  cbRef.current = { onInterim, onFinal, onCancel, onStateChange }

  const setState = useCallback((s: VoiceState) => {
    stateRef.current = s
    setStateRaw(s)
    cbRef.current.onStateChange?.(s)
  }, [])

  // Feature-detect after mount (SSR renders nothing; hydration stays clean).
  useEffect(() => {
    setStateRaw(speechRecognitionCtor() ? 'idle' : 'unsupported')
  }, [])

  /** Start the parallel capture. Fail-soft: any refusal = recognizer-only. */
  const startRecorder = useCallback(async () => {
    const mime = recorderMime()
    if (!mime || typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return
    if (!(await transcribeLaneEnabled())) return
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      // The user may have cancelled while the permission prompt was up.
      if (stateRef.current !== 'starting' && stateRef.current !== 'listening') {
        stream.getTracks().forEach((t) => t.stop())
        return
      }
      const rec = new MediaRecorder(stream, { mimeType: mime })
      const chunks: Blob[] = []
      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunks.push(e.data)
      }
      const done = new Promise<Blob | null>((resolve) => {
        rec.onstop = () => {
          stream.getTracks().forEach((t) => t.stop())
          resolve(chunks.length ? new Blob(chunks, { type: mime.split(';')[0] }) : null)
        }
        rec.onerror = () => resolve(null)
      })
      rec.start(250)
      recorderRef.current = { rec, chunks, mime, stream, done }
    } catch {
      /* no second capture (permission, iOS) — the recognizer lane carries it */
    }
  }, [])

  const stopRecorder = useCallback((): Promise<Blob | null> => {
    const r = recorderRef.current
    recorderRef.current = null
    if (!r) return Promise.resolve(null)
    try {
      if (r.rec.state !== 'inactive') r.rec.stop()
      else r.stream.getTracks().forEach((t) => t.stop())
    } catch {
      return Promise.resolve(null)
    }
    return r.done
  }, [])

  /** The accurate lane: audio → our words. null on any failure. */
  const transcribe = useCallback(async (audio: Blob, heard: string): Promise<string | null> => {
    try {
      const form = new FormData()
      form.append('audio', audio, 'voice')
      if (heard) form.append('heard', heard)
      if (typeof navigator !== 'undefined' && navigator.language) form.append('lang', navigator.language.slice(0, 2))
      const res = await fetch('/api/voice/transcribe', { method: 'POST', body: form, signal: AbortSignal.timeout(TRANSCRIBE_TIMEOUT_MS) })
      if (!res.ok) return null
      const j = (await res.json()) as { text?: unknown }
      return typeof j.text === 'string' && j.text.trim() ? j.text.trim() : null
    } catch {
      return null
    }
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
    confRef.current = null
    cancelRef.current = false
    deniedRef.current = false
    // "Listening" only when the recognizer says so — its first half-second
    // is deaf, and a ring that lights on the press invites speaking into it.
    rec.onstart = () => {
      if (stateRef.current === 'starting') setState('listening')
    }
    rec.onresult = (e) => {
      let text = ''
      let conf: number | null = null
      for (let i = 0; i < e.results.length; i++) {
        const r = e.results[i]
        text += r[0]?.transcript ?? ''
        if (r.isFinal && typeof r[0]?.confidence === 'number' && r[0].confidence > 0) conf = r[0].confidence
      }
      text = text.trim()
      textRef.current = text
      if (conf !== null) confRef.current = conf
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
      const heard = textRef.current
      const cancelled = cancelRef.current
      const denied = deniedRef.current
      // Chrome delivers the final result before onend on stop(); Safari
      // sometimes ends on interim text alone — the last thing heard is
      // what the user meant to send.
      void (async () => {
        const audio = await stopRecorder()
        if (cancelled || (!heard && !audio)) {
          cbRef.current.onCancel?.()
          setState(denied ? 'denied' : 'idle')
          return
        }
        if (audio) {
          setState('transcribing')
          const text = await transcribe(audio, heard)
          if (text) {
            cbRef.current.onInterim(text)
            cbRef.current.onFinal({ text, source: 'transcriber', confidence: null })
            setState('idle')
            return
          }
        }
        if (heard) cbRef.current.onFinal({ text: heard, source: 'recognizer', confidence: confRef.current })
        else cbRef.current.onCancel?.()
        setState('idle')
      })()
    }
    recRef.current = rec
    try {
      setState('starting')
      rec.start()
      void startRecorder()
    } catch {
      recRef.current = null
      setState('idle')
    }
  }, [setState, startRecorder, stopRecorder, transcribe])

  // Esc cancels while listening; unmount aborts.
  useEffect(() => {
    if (state !== 'listening' && state !== 'starting') return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') stop(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [state, stop])
  useEffect(() => () => stop(true), [stop])

  if (state === null || state === 'unsupported') return null

  const live = state === 'listening' || state === 'starting'
  const busy = state === 'transcribing'
  const denied = state === 'denied'
  const label = live ? 'Stop listening and send' : busy ? 'Getting the words right…' : denied ? 'Microphone is blocked' : 'Speak your ask'
  return (
    <button
      type="button"
      onClick={() => (live ? stop(false) : busy ? undefined : start())}
      disabled={(disabled && !live) || busy}
      aria-label={label}
      aria-pressed={live}
      title={label}
      data-voice-state={state}
      className={cn(
        'relative flex-shrink-0 w-11 h-11 md:w-9 md:h-9 rounded-full flex items-center justify-center transition-all duration-200',
        state === 'listening' && 'voice-live bg-[color:var(--accent)] text-black shadow-[0_0_18px_rgba(52,227,160,0.35)]',
        state === 'starting' && 'bg-[color:var(--accent)]/40 text-black',
        busy && 'text-[color:var(--accent)] animate-pulse',
        denied && 'text-[color:var(--muted-2)]',
        state === 'idle' && 'text-[color:var(--muted)] hover:text-white hover:bg-[var(--surf-2)]',
        disabled && !live && 'opacity-40 cursor-not-allowed',
        className,
      )}
    >
      {denied ? <MicOff className="w-4 h-4" /> : <Mic className="w-4 h-4" />}
    </button>
  )
}
