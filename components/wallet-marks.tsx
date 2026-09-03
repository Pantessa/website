// components/wallet-marks.tsx
// Wallet brand marks for the sign-in door's lane strip.
//
// These are the OFFICIAL wallet icons that ship inside @rainbow-me/rainbowkit
// (src/wallets/walletConnectors/<wallet>/<wallet>.svg), vendored here as JSX
// so the door can render them without pulling a data-URI out of the bundle at
// runtime. Same rationale as components/protocol-marks.tsx — one source, no
// network fetch, no drift — with one difference: these keep their BRAND
// colors (a wallet lineup is only legible if MetaMask is orange), where the
// protocol marks render in `currentColor`.
//
// Each mark is a full-bleed square tile by design (the artwork includes its
// own background rect), so the door clips them to a rounded square rather
// than padding them.
//
// This is a supported-wallet lineup, not a claim of affiliation — the same
// use RainbowKit's own connect modal makes of them. Rule 7 (CLAUDE.md) is
// about wearing a third party's marks on something shaped like THEIR product;
// naming which wallets can sign here is the opposite of that.
//
// ADDING A WALLET: add its lane id to lib/wallet-lineup.ts, then add a
// `<Foo>WalletMark` below and a WALLET_MARKS row. The door picks it up.

import { useId, type ComponentType } from 'react'
import { Wallet } from 'lucide-react'
import type { WalletLaneId } from '@/lib/wallet-lineup'

export type WalletMark = ComponentType<{ size?: number }>

const box = { display: 'block' } as const

export function MetaMaskWalletMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} fill="none" aria-hidden style={box}>
      <rect width="28" height="28" fill="white"/>
<path d="M24.0891 3.1199L15.3446 9.61456L16.9617 5.7828L24.0891 3.1199Z" fill="#E2761B" stroke="#E2761B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M3.90207 3.1199L12.5763 9.67608L11.0383 5.7828L3.90207 3.1199Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M20.9429 18.1745L18.6139 21.7426L23.597 23.1136L25.0295 18.2536L20.9429 18.1745Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M2.97929 18.2536L4.40301 23.1136L9.38607 21.7426L7.05713 18.1745L2.97929 18.2536Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M9.10483 12.1456L7.71626 14.2461L12.6642 14.4658L12.4884 9.14877L9.10483 12.1456Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M18.8864 12.1456L15.4589 9.08725L15.3446 14.4658L20.2837 14.2461L18.8864 12.1456Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M9.38606 21.7426L12.3566 20.2925L9.79033 18.2888L9.38606 21.7426Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M15.6347 20.2925L18.6139 21.7426L18.2009 18.2888L15.6347 20.2925Z" fill="#E4761B" stroke="#E4761B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M18.6139 21.7426L15.6347 20.2925L15.8719 22.2348L15.8456 23.0521L18.6139 21.7426Z" fill="#D7C1B3" stroke="#D7C1B3" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M9.38606 21.7426L12.1544 23.0521L12.1368 22.2348L12.3566 20.2925L9.38606 21.7426Z" fill="#D7C1B3" stroke="#D7C1B3" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M12.1984 17.0056L9.72002 16.2762L11.4689 15.4765L12.1984 17.0056Z" fill="#233447" stroke="#233447" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M15.7928 17.0056L16.5223 15.4765L18.28 16.2762L15.7928 17.0056Z" fill="#233447" stroke="#233447" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M9.38606 21.7426L9.80791 18.1745L7.05712 18.2536L9.38606 21.7426Z" fill="#CD6116" stroke="#CD6116" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M18.1921 18.1745L18.6139 21.7426L20.9429 18.2536L18.1921 18.1745Z" fill="#CD6116" stroke="#CD6116" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M20.2837 14.2461L15.3446 14.4658L15.8016 17.0057L16.5311 15.4765L18.2888 16.2762L20.2837 14.2461Z" fill="#CD6116" stroke="#CD6116" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M9.72002 16.2762L11.4777 15.4765L12.1984 17.0057L12.6642 14.4658L7.71626 14.2461L9.72002 16.2762Z" fill="#CD6116" stroke="#CD6116" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M7.71626 14.2461L9.79033 18.2888L9.72002 16.2762L7.71626 14.2461Z" fill="#E4751F" stroke="#E4751F" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M18.2888 16.2762L18.2009 18.2888L20.2837 14.2461L18.2888 16.2762Z" fill="#E4751F" stroke="#E4751F" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M12.6642 14.4658L12.1984 17.0057L12.7784 20.0025L12.9102 16.0565L12.6642 14.4658Z" fill="#E4751F" stroke="#E4751F" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M15.3446 14.4658L15.1073 16.0477L15.2128 20.0025L15.8016 17.0057L15.3446 14.4658Z" fill="#E4751F" stroke="#E4751F" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M15.8016 17.0056L15.2128 20.0025L15.6347 20.2925L18.2009 18.2888L18.2888 16.2762L15.8016 17.0056Z" fill="#F6851B" stroke="#F6851B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M9.72002 16.2762L9.79033 18.2888L12.3566 20.2925L12.7784 20.0025L12.1984 17.0056L9.72002 16.2762Z" fill="#F6851B" stroke="#F6851B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M15.8456 23.0521L15.8719 22.2348L15.6522 22.0414H12.339L12.1368 22.2348L12.1544 23.0521L9.38606 21.7426L10.3528 22.5336L12.3126 23.8958H15.6786L17.6472 22.5336L18.6139 21.7426L15.8456 23.0521Z" fill="#C0AD9E" stroke="#C0AD9E" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M15.6347 20.2925L15.2128 20.0025H12.7784L12.3566 20.2925L12.1368 22.2348L12.339 22.0414H15.6522L15.8719 22.2348L15.6347 20.2925Z" fill="#161616" stroke="#161616" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M24.4583 10.0364L25.2053 6.45072L24.0891 3.1199L15.6347 9.39485L18.8864 12.1456L23.4827 13.4903L24.5022 12.3038L24.0628 11.9874L24.7658 11.3459L24.221 10.924L24.924 10.3879L24.4583 10.0364Z" fill="#763D16" stroke="#763D16" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M2.79472 6.45072L3.54174 10.0364L3.06717 10.3879L3.77024 10.924L3.23415 11.3459L3.93722 11.9874L3.4978 12.3038L4.50847 13.4903L9.10483 12.1456L12.3566 9.39485L3.90207 3.1199L2.79472 6.45072Z" fill="#763D16" stroke="#763D16" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M23.4827 13.4903L18.8864 12.1456L20.2837 14.2461L18.2009 18.2888L20.9429 18.2536H25.0295L23.4827 13.4903Z" fill="#F6851B" stroke="#F6851B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M9.10484 12.1456L4.50848 13.4903L2.97929 18.2536H7.05713L9.79033 18.2888L7.71626 14.2461L9.10484 12.1456Z" fill="#F6851B" stroke="#F6851B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
<path d="M15.3446 14.4658L15.6347 9.39485L16.9705 5.7828H11.0383L12.3566 9.39485L12.6642 14.4658L12.7696 16.0653L12.7784 20.0025H15.2128L15.2304 16.0653L15.3446 14.4658Z" fill="#F6851B" stroke="#F6851B" strokeWidth="0.0878845" strokeLinecap="round" strokeLinejoin="round"/>
    </svg>
  )
}

export function CoinbaseWalletMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} fill="none" aria-hidden style={box}>
      <rect width="28" height="28" fill="#2C5FF6"/>
<path fillRule="evenodd" clipRule="evenodd" d="M14 23.8C19.4124 23.8 23.8 19.4124 23.8 14C23.8 8.58761 19.4124 4.2 14 4.2C8.58761 4.2 4.2 8.58761 4.2 14C4.2 19.4124 8.58761 23.8 14 23.8ZM11.55 10.8C11.1358 10.8 10.8 11.1358 10.8 11.55V16.45C10.8 16.8642 11.1358 17.2 11.55 17.2H16.45C16.8642 17.2 17.2 16.8642 17.2 16.45V11.55C17.2 11.1358 16.8642 10.8 16.45 10.8H11.55Z" fill="white"/>
    </svg>
  )
}

export function RainbowWalletMark({ size = 22 }: { size?: number }) {
  const uid = useId().replace(/:/g, '')
  return (
    <svg viewBox="0 0 120 120" width={size} height={size} fill="none" aria-hidden style={box}>
      <rect width="120" height="120" fill={`url(#paint0_linear_${uid})`}/>
<path d="M20 38H26C56.9279 38 82 63.0721 82 94V100H94C97.3137 100 100 97.3137 100 94C100 53.1309 66.8691 20 26 20C22.6863 20 20 22.6863 20 26V38Z" fill={`url(#paint1_radial_${uid})`}/>
<path d="M84 94H100C100 97.3137 97.3137 100 94 100H84V94Z" fill={`url(#paint2_linear_${uid})`}/>
<path d="M26 20L26 36H20L20 26C20 22.6863 22.6863 20 26 20Z" fill={`url(#paint3_linear_${uid})`}/>
<path d="M20 36H26C58.0325 36 84 61.9675 84 94V100H66V94C66 71.9086 48.0914 54 26 54H20V36Z" fill={`url(#paint4_radial_${uid})`}/>
<path d="M68 94H84V100H68V94Z" fill={`url(#paint5_linear_${uid})`}/>
<path d="M20 52L20 36L26 36L26 52H20Z" fill={`url(#paint6_linear_${uid})`}/>
<path d="M20 62C20 65.3137 22.6863 68 26 68C40.3594 68 52 79.6406 52 94C52 97.3137 54.6863 100 58 100H68V94C68 70.804 49.196 52 26 52H20V62Z" fill={`url(#paint7_radial_${uid})`}/>
<path d="M52 94H68V100H58C54.6863 100 52 97.3137 52 94Z" fill={`url(#paint8_radial_${uid})`}/>
<path d="M26 68C22.6863 68 20 65.3137 20 62L20 52L26 52L26 68Z" fill={`url(#paint9_radial_${uid})`}/>
<defs>
<linearGradient id={`paint0_linear_${uid}`} x1="60" y1="0" x2="60" y2="120" gradientUnits="userSpaceOnUse">
<stop stopColor="#174299"/>
<stop offset="1" stopColor="#001E59"/>
</linearGradient>
<radialGradient id={`paint1_radial_${uid}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(26 94) rotate(-90) scale(74)">
<stop offset="0.770277" stopColor="#FF4000"/>
<stop offset="1" stopColor="#8754C9"/>
</radialGradient>
<linearGradient id={`paint2_linear_${uid}`} x1="83" y1="97" x2="100" y2="97" gradientUnits="userSpaceOnUse">
<stop stopColor="#FF4000"/>
<stop offset="1" stopColor="#8754C9"/>
</linearGradient>
<linearGradient id={`paint3_linear_${uid}`} x1="23" y1="20" x2="23" y2="37" gradientUnits="userSpaceOnUse">
<stop stopColor="#8754C9"/>
<stop offset="1" stopColor="#FF4000"/>
</linearGradient>
<radialGradient id={`paint4_radial_${uid}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(26 94) rotate(-90) scale(58)">
<stop offset="0.723929" stopColor="#FFF700"/>
<stop offset="1" stopColor="#FF9901"/>
</radialGradient>
<linearGradient id={`paint5_linear_${uid}`} x1="68" y1="97" x2="84" y2="97" gradientUnits="userSpaceOnUse">
<stop stopColor="#FFF700"/>
<stop offset="1" stopColor="#FF9901"/>
</linearGradient>
<linearGradient id={`paint6_linear_${uid}`} x1="23" y1="52" x2="23" y2="36" gradientUnits="userSpaceOnUse">
<stop stopColor="#FFF700"/>
<stop offset="1" stopColor="#FF9901"/>
</linearGradient>
<radialGradient id={`paint7_radial_${uid}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(26 94) rotate(-90) scale(42)">
<stop offset="0.59513" stopColor="#00AAFF"/>
<stop offset="1" stopColor="#01DA40"/>
</radialGradient>
<radialGradient id={`paint8_radial_${uid}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(51 97) scale(17 45.3333)">
<stop stopColor="#00AAFF"/>
<stop offset="1" stopColor="#01DA40"/>
</radialGradient>
<radialGradient id={`paint9_radial_${uid}`} cx="0" cy="0" r="1" gradientUnits="userSpaceOnUse" gradientTransform="translate(23 69) rotate(-90) scale(17 322.37)">
<stop stopColor="#00AAFF"/>
<stop offset="1" stopColor="#01DA40"/>
</radialGradient>
</defs>
    </svg>
  )
}

export function WalletConnectWalletMark({ size = 22 }: { size?: number }) {
  return (
    <svg viewBox="0 0 28 28" width={size} height={size} fill="none" aria-hidden style={box}>
      <rect width="28" height="28" fill="#3B99FC"/>
<path d="M8.38969 10.3739C11.4882 7.27538 16.5118 7.27538 19.6103 10.3739L19.9832 10.7468C20.1382 10.9017 20.1382 11.1529 19.9832 11.3078L18.7076 12.5835C18.6301 12.6609 18.5045 12.6609 18.4271 12.5835L17.9139 12.0703C15.7523 9.9087 12.2477 9.9087 10.0861 12.0703L9.53655 12.6198C9.45909 12.6973 9.3335 12.6973 9.25604 12.6198L7.98039 11.3442C7.82547 11.1893 7.82547 10.9381 7.98039 10.7832L8.38969 10.3739ZM22.2485 13.012L23.3838 14.1474C23.5387 14.3023 23.5387 14.5535 23.3838 14.7084L18.2645 19.8277C18.1096 19.9827 17.8584 19.9827 17.7035 19.8277C17.7035 19.8277 17.7035 19.8277 17.7035 19.8277L14.0702 16.1944C14.0314 16.1557 13.9686 16.1557 13.9299 16.1944C13.9299 16.1944 13.9299 16.1944 13.9299 16.1944L10.2966 19.8277C10.1417 19.9827 9.89053 19.9827 9.73561 19.8278C9.7356 19.8278 9.7356 19.8277 9.7356 19.8277L4.61619 14.7083C4.46127 14.5534 4.46127 14.3022 4.61619 14.1473L5.75152 13.012C5.90645 12.857 6.15763 12.857 6.31255 13.012L9.94595 16.6454C9.98468 16.6841 10.0475 16.6841 10.0862 16.6454C10.0862 16.6454 10.0862 16.6454 10.0862 16.6454L13.7194 13.012C13.8743 12.857 14.1255 12.857 14.2805 13.012C14.2805 13.012 14.2805 13.012 14.2805 13.012L17.9139 16.6454C17.9526 16.6841 18.0154 16.6841 18.0541 16.6454L21.6874 13.012C21.8424 12.8571 22.0936 12.8571 22.2485 13.012Z" fill="white"/>
    </svg>
  )
}

/** The catch-all lane has no brand of its own — whatever extension is
 *  installed. A neutral wallet glyph on a surface tile keeps the strip's
 *  rhythm without inventing a logo for it. */
export function InjectedWalletMark({ size = 22 }: { size?: number }) {
  return (
    <span
      style={{
        width: size, height: size, borderRadius: 5, display: 'grid', placeItems: 'center',
        background: 'var(--surf-2)', color: 'var(--muted)',
      }}
    >
      <Wallet width={Math.round(size * 0.6)} height={Math.round(size * 0.6)} />
    </span>
  )
}

/** Lane id → mark. Every id in lib/wallet-lineup's WalletLaneId is covered, so
 *  the door never renders a hole when the lineup grows. */
export const WALLET_MARKS: Record<WalletLaneId, WalletMark> = {
  metaMask: MetaMaskWalletMark,
  coinbase: CoinbaseWalletMark,
  rainbow: RainbowWalletMark,
  walletConnect: WalletConnectWalletMark,
  injected: InjectedWalletMark,
}
