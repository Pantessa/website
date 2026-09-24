// The sign card's primary-button class lives in components/sign-cta.ts, where
// Tailwind's content scan can see it (lib/ is not scanned — squad
// mobile-native, 2026-09-24). Re-exported here so every importer is unchanged.
export { SIGN_CTA_CLASS } from '@/components/sign-cta'
