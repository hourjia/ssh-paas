import type { ReactNode } from 'react'

/** 内联 SVG 图标集：stroke currentColor / 24 viewBox / 线宽 1.7 */
const icons = {
  stack: (
    <>
      <path d="M12 3 3 8l9 5 9-5-9-5Z" />
      <path d="m3 13 9 5 9-5" />
      <path d="m3 17.5 9 5 9-5" opacity={0.45} />
    </>
  ),
  server: (
    <>
      <rect x="3" y="4" width="18" height="7" rx="2" />
      <rect x="3" y="13" width="18" height="7" rx="2" />
      <path d="M7 7.5h.01M7 16.5h.01" />
      <path d="M11 7.5h5M11 16.5h5" opacity={0.5} />
    </>
  ),
  cube: (
    <>
      <path d="M12 2.5 21 7.3v9.4l-9 4.8-9-4.8V7.3l9-4.8Z" />
      <path d="M3.4 7.5 12 12.1l8.6-4.6M12 12.1v9" />
    </>
  ),
  rocket: (
    <>
      <path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09z" />
      <path d="m12 15-3-3a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.35 22.35 0 0 1-4 2z" />
      <path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 0 5 0" />
      <path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5" />
    </>
  ),
  terminal: (
    <>
      <path d="m4 17 6-5-6-5" />
      <path d="M12 19h8" />
    </>
  ),
  settings: (
    <>
      <path d="M4 6h9M17.5 6H20" />
      <circle cx="15" cy="6" r="2.2" />
      <path d="M4 12h3M11.5 12H20" />
      <circle cx="9" cy="12" r="2.2" />
      <path d="M4 18h11M19.5 18H20" />
      <circle cx="17" cy="18" r="2.2" />
    </>
  ),
  plus: <path d="M12 5v14M5 12h14" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  check: <path d="m4.5 12.5 5 5 10-11" />,
  alert: (
    <>
      <path d="M12 3 2.5 20h19L12 3Z" />
      <path d="M12 10v4.5M12 17.5h.01" />
    </>
  ),
  refresh: (
    <>
      <path d="M21 12a9 9 0 1 1-9-9c2.5 0 4.9 1 6.7 2.7L21 8" />
      <path d="M21 3v5h-5" />
    </>
  ),
  plug: (
    <>
      <path d="M9 3v4M15 3v4" />
      <path d="M7 7h10v4a5 5 0 0 1-10 0V7Z" />
      <path d="M12 16v5" />
    </>
  ),
  key: (
    <>
      <circle cx="8" cy="15.5" r="4.5" />
      <path d="m11.4 12.1 8.1-8.1M16 5l3 3M13 8l2.5 2.5" />
    </>
  ),
  lock: (
    <>
      <rect x="5" y="11" width="14" height="9" rx="2" />
      <path d="M8 11V8a4 4 0 0 1 8 0v3" />
    </>
  ),
  eye: (
    <>
      <path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" />
      <circle cx="12" cy="12" r="3" />
    </>
  ),
  eyeOff: (
    <>
      <path d="M4 4l16 16" />
      <path d="M10.6 6a10.8 10.8 0 0 1 1.4-.1c6 0 9.5 6.1 9.5 6.1a17.4 17.4 0 0 1-2.4 3.1M14.1 14.1a3 3 0 1 1-4.2-4.2" />
      <path d="M6.6 6.8C4 8.6 2.5 12 2.5 12S6 18.5 12 18.5c1.4 0 2.7-.3 3.9-.9" />
    </>
  ),
  folder: <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" />,
  branch: (
    <>
      <path d="M6 3v12" />
      <circle cx="18" cy="6" r="3" />
      <circle cx="6" cy="18" r="3" />
      <path d="M18 9a9 9 0 0 1-9 9" />
    </>
  ),
  play: <path d="M7.5 4.5 19 12 7.5 19.5v-15Z" />,
  pause: <path d="M8.5 5v14M15.5 5v14" />,
  list: (
    <>
      <path d="M8.5 6H20M8.5 12H20M8.5 18H20" />
      <path d="M4 6h.01M4 12h.01M4 18h.01" strokeWidth={2.4} />
    </>
  ),
  chevronDown: <path d="m6 9 6 6 6-6" />,
  chevronRight: <path d="m9 6 6 6-6 6" />,
  chevronsLeft: <path d="m11 17-5-5 5-5M18 17l-5-5 5-5" />,
  download: (
    <>
      <path d="M12 3v11" />
      <path d="m7 10 5 5 5-5" />
      <path d="M4 20h16" />
    </>
  ),
  cpu: (
    <>
      <rect x="6" y="6" width="12" height="12" rx="2" />
      <rect x="10" y="10" width="4" height="4" />
      <path d="M9 2v3M15 2v3M9 19v3M15 19v3M2 9h3M2 15h3M19 9h3M19 15h3" />
    </>
  ),
  chip: (
    <>
      <rect x="4.5" y="7" width="15" height="10" rx="1.5" />
      <path d="M8 17v3M12 17v3M16 17v3M8 4v3M12 4v3M16 4v3" />
      <path d="M8.5 10.5h7M8.5 13.5h7" opacity={0.6} />
    </>
  ),
  drive: (
    <>
      <rect x="3" y="8" width="18" height="8" rx="2" />
      <path d="M7 12h.01" strokeWidth={2.4} />
      <path d="M16.5 12H17" opacity={0.6} />
      <path d="M6.5 8 8 4h8l1.5 4" opacity={0.55} />
    </>
  ),
  trash: (
    <>
      <path d="M4 7h16" />
      <path d="M9 7V5a1.5 1.5 0 0 1 1.5-1.5h3A1.5 1.5 0 0 1 15 5v2" />
      <path d="m6.5 7 .9 13a1.8 1.8 0 0 0 1.8 1.7h5.6a1.8 1.8 0 0 0 1.8-1.7l.9-13" />
      <path d="M10 11v6M14 11v6" />
    </>
  ),
  clock: (
    <>
      <circle cx="12" cy="12" r="9" />
      <path d="M12 7v5l3 2" />
    </>
  ),
  braces: (
    <>
      <path d="M8.5 3c-2 0-3 1-3 3v3.5c0 1.4-.9 2.5-2.5 2.5 1.6 0 2.5 1.1 2.5 2.5V18c0 2 1 3 3 3" />
      <path d="M15.5 3c2 0 3 1 3 3v3.5c0 1.4.9 2.5 2.5 2.5-1.6 0-2.5 1.1-2.5 2.5V18c0 2-1 3-3 3" />
    </>
  ),
  swap: (
    <>
      <path d="M7 4 3 8l4 4" />
      <path d="M3 8h13" />
      <path d="m17 12 4 4-4 4" />
      <path d="M21 16H8" />
    </>
  ),
  search: (
    <>
      <circle cx="11" cy="11" r="7" />
      <path d="m20 20-4-4" />
    </>
  ),
  file: (
    <>
      <path d="M6 3h8l4 4v14H6V3Z" />
      <path d="M14 3v4h4" />
    </>
  ),
} satisfies Record<string, ReactNode>

export type IconName = keyof typeof icons

export function Icon({ name, size = 18, className }: { name: IconName; size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
      aria-hidden
    >
      {icons[name]}
    </svg>
  )
}
