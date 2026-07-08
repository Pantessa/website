/**
 * Fine dropdown caret — replaces lucide's ChevronDown in the top nav. Drawn at
 * 9px with a 1.3 stroke + round caps so it sits like punctuation next to the
 * label instead of reading as a UI control. Rotation is handled by the
 * caller's class (e.g. .navm__chev / .navacct__chev).
 */
export default function Caret({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      width={9}
      height={9}
      viewBox="0 0 10 10"
      fill="none"
      aria-hidden
    >
      <path
        d="M2 3.6 5 6.4 8 3.6"
        stroke="currentColor"
        strokeWidth={1.3}
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  )
}
