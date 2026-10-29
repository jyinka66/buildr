// Buildr logo — a geometric "B" built from stacked blocks, representing
// the "building blocks" metaphor for code/business construction. Uses the
// emerald→teal→cyan gradient that matches the brand.
//
// Renders inline SVG so it inherits color context and scales crisply.
// `withWordmark` shows "Buildr" text next to the mark.

import { cn } from '@/lib/utils'

interface BuildrLogoProps {
  className?: string
  withWordmark?: boolean
  size?: number
}

export function BuildrLogo({ className, withWordmark = true, size = 28 }: BuildrLogoProps) {
  return (
    <span className={cn('inline-flex items-center gap-2', className)}>
      <svg
        width={size}
        height={size}
        viewBox="0 0 40 40"
        fill="none"
        xmlns="http://www.w3.org/2000/svg"
        aria-hidden="true"
        className="shrink-0"
      >
        <defs>
          <linearGradient id="buildr-logo-grad" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#059669" />
            <stop offset="50%" stopColor="#0d9488" />
            <stop offset="100%" stopColor="#06b6d4" />
          </linearGradient>
          <linearGradient id="buildr-logo-spark" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#34d399" />
            <stop offset="100%" stopColor="#22d3ee" />
          </linearGradient>
        </defs>
        {/* Rounded square background */}
        <rect x="2" y="2" width="36" height="36" rx="9" fill="url(#buildr-logo-grad)" />
        {/* Top block */}
        <rect x="11" y="9" width="14" height="5" rx="1.5" fill="#ffffff" opacity="0.95" />
        {/* Middle block (wider — forms the B bump) */}
        <rect x="11" y="15.5" width="18" height="5" rx="1.5" fill="#ffffff" opacity="0.85" />
        {/* Bottom block */}
        <rect x="11" y="22" width="14" height="5" rx="1.5" fill="#ffffff" opacity="0.95" />
        {/* Left vertical stem */}
        <rect x="11" y="9" width="4.5" height="18" rx="1.5" fill="#ffffff" />
        {/* Sparkle dot (AI hint) */}
        <circle cx="29" cy="11" r="2" fill="url(#buildr-logo-spark)" />
        <circle cx="29" cy="11" r="1" fill="#ffffff" opacity="0.9" />
      </svg>
      {withWordmark && (
        <span className="text-base font-bold tracking-tight text-foreground">Buildr</span>
      )}
    </span>
  )
}
