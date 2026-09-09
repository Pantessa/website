// The voice door's accurate lane. The browser's recognizer (Web Speech API)
// gives the composer its live words, but it has no DeFi vocabulary — the
// first real drill (2026-09-09) heard "show me my position on Morpho" as
// "addition on Mortal". This route transcribes the SAME utterance (recorded
// in parallel by MediaRecorder) with a model that takes a vocabulary prompt
// (lib/voice-lexicon.ts), and the composer sends ITS words instead. Audio is
// forwarded once and never stored. Fails closed: no key → 503 and the
// client keeps the browser's transcript; oversize / wrong type → 4xx.
//
// Connect-to-act: no session needed (a stranger's first spoken ask is the
// funnel), so the per-IP hourly fence is the only meter — every call is a
// paid model call on the house key.

import { NextResponse } from 'next/server'
import { voiceVocabularyPrompt } from '@/lib/voice-lexicon'
import { bumpAndCheckVoiceTranscribe, clientIpFrom } from '@/lib/turn-limits'

export const runtime = 'nodejs'

/** ~30s of opus at 32kbps is ~120KB; 2MB is a generous ceiling. */
export const VOICE_AUDIO_MAX_BYTES = 2 * 1024 * 1024
const ACCEPTED_TYPES = /^audio\/(webm|ogg|mp4|mpeg|wav|x-wav|aac|x-m4a|m4a|flac)|^video\/(webm|mp4)/i
/** The vocabulary-prompted transcriber. */
const TRANSCRIBE_MODEL = process.env.VOICE_TRANSCRIBE_MODEL || 'gpt-4o-mini-transcribe'

export function voiceTranscribeEnabled(): boolean {
  return !!process.env.OPENAI_API_KEY
}

/** Feature probe for the composer: is the accurate lane on this deploy? */
export async function GET() {
  return NextResponse.json({ enabled: voiceTranscribeEnabled(), maxBytes: VOICE_AUDIO_MAX_BYTES })
}

export async function POST(req: Request) {
  if (!voiceTranscribeEnabled()) {
    return NextResponse.json({ error: 'transcription unavailable', enabled: false }, { status: 503 })
  }
  const ip = clientIpFrom(req.headers)
  if (await bumpAndCheckVoiceTranscribe(ip)) {
    return NextResponse.json({ error: 'hourly voice cap reached — type the ask, or try again within the hour' }, { status: 429 })
  }
  let form: FormData
  try {
    form = await req.formData()
  } catch {
    return NextResponse.json({ error: 'expected multipart form data with an `audio` file' }, { status: 400 })
  }
  const audio = form.get('audio')
  if (!(audio instanceof Blob) || audio.size === 0) {
    return NextResponse.json({ error: 'missing `audio` file' }, { status: 400 })
  }
  if (audio.size > VOICE_AUDIO_MAX_BYTES) {
    return NextResponse.json({ error: `audio too large (max ${VOICE_AUDIO_MAX_BYTES} bytes)` }, { status: 413 })
  }
  const type = audio.type || 'audio/webm'
  if (!ACCEPTED_TYPES.test(type)) {
    return NextResponse.json({ error: `unsupported audio type ${type}` }, { status: 415 })
  }
  // The browser's own transcript rides along as a hint of what was said —
  // the model weighs it with the vocabulary, never copies it.
  const heard = typeof form.get('heard') === 'string' ? (form.get('heard') as string).slice(0, 200) : ''
  const ext = /webm/.test(type) ? 'webm' : /ogg/.test(type) ? 'ogg' : /mp4|m4a|aac/.test(type) ? 'mp4' : /wav/.test(type) ? 'wav' : /flac/.test(type) ? 'flac' : 'mp3'

  const upstream = new FormData()
  upstream.append('file', audio, `voice.${ext}`)
  upstream.append('model', TRANSCRIBE_MODEL)
  upstream.append('prompt', heard ? `${voiceVocabularyPrompt()} The speaker may have said: "${heard}".` : voiceVocabularyPrompt())
  upstream.append('response_format', 'json')
  const lang = typeof form.get('lang') === 'string' ? (form.get('lang') as string).slice(0, 2).toLowerCase() : ''
  if (/^[a-z]{2}$/.test(lang)) upstream.append('language', lang)

  try {
    const res = await fetch('https://api.openai.com/v1/audio/transcriptions', {
      method: 'POST',
      headers: { authorization: `Bearer ${process.env.OPENAI_API_KEY}` },
      body: upstream,
      signal: AbortSignal.timeout(12_000),
    })
    if (!res.ok) {
      const detail = (await res.text().catch(() => '')).slice(0, 200)
      console.warn(`[voice/transcribe] upstream ${res.status}: ${detail}`)
      return NextResponse.json({ error: 'transcription failed upstream' }, { status: 502 })
    }
    const json = (await res.json()) as { text?: unknown }
    const text = typeof json.text === 'string' ? json.text.trim() : ''
    return NextResponse.json({ text, model: TRANSCRIBE_MODEL })
  } catch (err) {
    console.warn(`[voice/transcribe] ${err instanceof Error ? err.message : String(err)}`)
    return NextResponse.json({ error: 'transcription timed out' }, { status: 504 })
  }
}
