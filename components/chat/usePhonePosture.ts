'use client'

// True while the viewport is in the phone posture (lib/phone-shell PHONE_MQ:
// below lg, where the spine is the bottom tab bar). False on the server and on
// the first client render, so a render never guesses and hydration never
// differs; the chat-surface overlays read it to become the Sheet on a phone
// and stay the desktop modal at lg+ (squad mobile-native, 2026-09-24).

import { useEffect, useState } from 'react'
import { PHONE_MQ } from '@/lib/phone-shell'

export function usePhonePosture(): boolean {
  const [phone, setPhone] = useState(false)
  useEffect(() => {
    const mql = window.matchMedia(PHONE_MQ)
    const on = () => setPhone(mql.matches)
    on()
    mql.addEventListener('change', on)
    return () => mql.removeEventListener('change', on)
  }, [])
  return phone
}
