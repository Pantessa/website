// Chain brand marks — vendored full-color SVGs for the chat chain picker and
// anywhere a chain needs a face (sibling of protocol-marks.tsx, which carries
// monochrome PROTOCOL logos; these are chains, rendered in brand color).
//
// Provenance: Ethereum / Base / Arbitrum vendored from the CoW Swap
// interface's public chain art (apps/cow-fi/public/images/*-chain.svg in the
// local fork — same source the EmbedAnywhere cards vendor from). Robinhood
// Chain's official mark only ships as a PNG, so the feather is hand-traced
// here as a compact path on the brand lime.
//
// ADDING A CHAIN: add a `<Name>ChainMark` below + a row in CHAIN_MARKS keyed
// by the lib/chains.ts `key`. The picker resolves marks via getChainMark().

import type { ComponentType } from 'react'

export type ChainMark = ComponentType<{ size?: number }>

export function EthereumChainMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} fill="none" aria-hidden style={{ display: 'block' }}>
      <path d="m30 60c16.569 0 30-13.431 30-30s-13.431-30-30-30-30 13.431-30 30 13.431 30 30 30z" fill="#627eea" />
      <path d="m30.12 9-.287.957v27.774l.287.281 13.122-7.62z" fill="#c0cbf6" />
      <path d="m30.122 9-13.122 21.392 13.122 7.62z" fill="#fff" />
      <path d="m30.12 40.45-.162.193v9.893l.162.464 13.13-18.167-13.13 7.616z" fill="#c0cbf6" />
      <path d="m30.122 51v-10.55l-13.122-7.619z" fill="#fff" />
      <path d="m30.12 38.027 13.122-7.62-13.122-5.86z" fill="#8197ee" />
      <path d="m17 30.406 13.122 7.621v-13.48z" fill="#c0cbf6" />
    </svg>
  )
}

export function BaseChainMark({ size = 20 }: { size?: number }) {
  return (
    <svg viewBox="0 0 146 146" width={size} height={size} fill="none" aria-hidden style={{ display: 'block' }}>
      <circle cx="73" cy="73" r="73" fill="#0052FF" />
      <path
        d="M73.323 123.729C101.617 123.729 124.553 100.832 124.553 72.5875C124.553 44.343 101.617 21.4463 73.323 21.4463C46.4795 21.4463 24.4581 42.0558 22.271 68.2887H89.9859V76.8864H22.271C24.4581 103.119 46.4795 123.729 73.323 123.729Z"
        fill="white"
      />
    </svg>
  )
}

export function ArbitrumChainMark({ size = 20 }: { size?: number }) {
  // The official shield mark, set on a white disc so it reads at chip size
  // next to the circular Ethereum/Base badges.
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} fill="none" aria-hidden style={{ display: 'block' }}>
      <circle cx="30" cy="30" r="30" fill="#ffffff" />
      <g fill="#1b4add" transform="translate(11.4, 8.9) scale(0.0653)">
        <path d="m286.083 39.75c1.56 0 3.04.39 4.44 1.17l235.08 136.79c2.73 1.56 4.36 4.52 4.36 7.64l-.86 271.95c0 3.12-1.71 6.08-4.44 7.64l-236.02 135.23c-1.33.78-2.88 1.17-4.44 1.17s-3.04-.39-4.44-1.17l-235-136.79c-2.73-1.56-4.36-4.52-4.36-7.64l.86-271.95c0-3.12 1.71-6.08 4.44-7.64l236.01-135.23a8.534 8.534 0 0 1 4.36-1.17m.16-39.75c-8.42 0-16.76 2.1-24.32 6.39l-236.02 135.23c-15.04 8.65-24.4 24.63-24.4 42.01l-.86 271.95a48.465 48.465 0 0 0 24.16 42.17l235.08 136.79c7.48 4.36 15.9 6.55 24.24 6.63s16.76-2.1 24.32-6.39l236.02-135.23c15.04-8.65 24.4-24.63 24.4-42.01l.86-271.95a48.465 48.465 0 0 0 -24.16-42.17l-235.07-136.79c-7.48-4.36-15.82-6.63-24.24-6.63h-.01z" />
        <path d="m333.861 148.25h-34.45c-2.57 0-4.91 1.64-5.77 4.05l-110.84 303.75c-.7 2.03.78 4.13 2.88 4.13h34.45c2.57 0 4.91-1.64 5.77-4.05l110.84-303.75c.7-2.03-.78-4.13-2.88-4.13zm-60.25 0h-34.45c-2.57 0-4.91 1.64-5.77 4.05l-110.84 303.75c-.7 2.03.78 4.13 2.88 4.13h34.45c2.57 0 4.91-1.64 5.77-4.05l110.84-303.75c.7-2.03-.78-4.13-2.88-4.13zm44.58 117.77c-1.01-2.73-4.83-2.73-5.77 0l-17.93 49.11a6.461 6.461 0 0 0 0 4.21l49.88 136.79c.86 2.42 3.2 4.05 5.77 4.05h34.45c2.1 0 3.59-2.1 2.88-4.13l-69.29-190.03zm129.62 190.03-99.46-272.57c-1.01-2.73-4.83-2.73-5.77 0l-17.93 49.11a6.461 6.461 0 0 0 0 4.21l80.05 219.42c.86 2.42 3.2 4.05 5.77 4.05h34.45c2.1-.08 3.59-2.18 2.88-4.21z" />
      </g>
    </svg>
  )
}

export function RobinhoodChainMark({ size = 20 }: { size?: number }) {
  // Robinhood's feather on the brand lime — hand-traced compact quill
  // (the official asset ships only as a raster; this keeps the picker crisp).
  return (
    <svg viewBox="0 0 60 60" width={size} height={size} fill="none" aria-hidden style={{ display: 'block' }}>
      <circle cx="30" cy="30" r="30" fill="#ccff00" />
      <path
        d="M40.5 13.5c2.2-.3 4.3-.1 5.5.4-.7 2.6-2.3 5.7-4.4 8.3-1.6 2-3.4 3.6-5.2 4.6l-5 12.6-8.2 8.1c-.5.5-1.2 0-1-.6l3.4-9.7-2.9 2 .4-9.3c.1-1.7.8-3.3 2-4.4l4.7-4.4c2.9-2.8 6.9-6.9 10.7-7.6z"
        fill="#0d0d0d"
      />
      <path
        d="M14.5 47.5l9.9-14.8 1.6-4 1.9 1.2-4.1 10.4c-2.6 3.1-6.1 5.9-8.7 7.6-.4.3-.9-.1-.6-.4z"
        fill="#0d0d0d"
      />
    </svg>
  )
}

export const CHAIN_MARKS: Record<string, ChainMark> = {
  ethereum: EthereumChainMark,
  base: BaseChainMark,
  arbitrum: ArbitrumChainMark,
  robinhood: RobinhoodChainMark,
}

export function getChainMark(key: string | null | undefined): ChainMark | null {
  return (key && CHAIN_MARKS[key.toLowerCase()]) || null
}
