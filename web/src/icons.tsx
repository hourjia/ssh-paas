interface IconProps {
  className?: string
}

const S = {
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.8,
  strokeLinecap: 'round' as const,
  strokeLinejoin: 'round' as const,
}

export function GridIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S}>
      <rect x="3" y="3" width="7.5" height="7.5" rx="2.4" />
      <rect x="13.5" y="3" width="7.5" height="7.5" rx="2.4" />
      <rect x="3" y="13.5" width="7.5" height="7.5" rx="2.4" />
      <rect x="13.5" y="13.5" width="7.5" height="7.5" rx="2.4" />
    </svg>
  )
}

export function ServerIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S}>
      <rect x="2.5" y="3.5" width="19" height="7" rx="2.4" />
      <rect x="2.5" y="13.5" width="19" height="7" rx="2.4" />
      <path d="M6.5 7h.01M6.5 17h.01" />
    </svg>
  )
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S}>
      <path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S} strokeWidth={1.9}>
      <path d="M12 5v14M5 12h14" />
    </svg>
  )
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S} strokeWidth={1.9}>
      <path d="M21 12a9 9 0 1 1-2.6-6.36" />
      <polyline points="21 3 21 9 15 9" />
    </svg>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S} strokeWidth={1.9}>
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S} strokeWidth={2}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

export function MoreIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" stroke="none">
      <circle cx="5.5" cy="12" r="1.7" />
      <circle cx="12" cy="12" r="1.7" />
      <circle cx="18.5" cy="12" r="1.7" />
    </svg>
  )
}

export function ExternalIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S}>
      <path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6" />
      <polyline points="15 3 21 3 21 9" />
      <line x1="10" y1="14" x2="21" y2="3" />
    </svg>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S}>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-3.6-3.6" />
    </svg>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S} strokeWidth={2}>
      <polyline points="4 12.5 9.5 18 20 6.5" />
    </svg>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S}>
      <path d="M3 6h18M8 6V4.5A1.5 1.5 0 0 1 9.5 3h5A1.5 1.5 0 0 1 16 4.5V6M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6" />
    </svg>
  )
}

export function KeyIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S}>
      <circle cx="8" cy="14" r="4.5" />
      <path d="M11.5 10.5 20 2M16 6l3 3M13 9l2.5 2.5" />
    </svg>
  )
}

export function LockIcon({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 24 24" {...S}>
      <rect x="4.5" y="10.5" width="15" height="10" rx="2.5" />
      <path d="M8 10.5V8a4 4 0 0 1 8 0v2.5" />
    </svg>
  )
}

export function BrandMark({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 44 44" fill="none">
      <defs>
        <linearGradient id="bm" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#7ce6d6" />
          <stop offset="1" stopColor="#0c6e66" />
        </linearGradient>
      </defs>
      <rect x="2" y="2" width="40" height="40" rx="15" fill="url(#bm)" />
      <path d="M22 11c4.6 5.4 7.6 9.2 7.6 12.7a7.6 7.6 0 1 1-15.2 0c0-3.5 3-7.3 7.6-12.7z" fill="rgba(255,255,255,.88)" />
      <circle cx="18.6" cy="24" r="2.3" fill="rgba(12,110,102,.5)" />
    </svg>
  )
}
