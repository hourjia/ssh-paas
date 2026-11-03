import type { ReactNode } from 'react'

interface IconProps {
  className?: string
}

function Icon({ className, children }: IconProps & { children: ReactNode }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
      {children}
    </svg>
  )
}

export function GridIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="3" y="3" width="8" height="8" rx="2.2" />
      <rect x="13" y="3" width="8" height="8" rx="2.2" />
      <rect x="3" y="13" width="8" height="8" rx="2.2" />
      <rect x="13" y="13" width="8" height="8" rx="2.2" />
    </Icon>
  )
}

export function ContainerIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M5.4 3.2h13.2c1.2 0 2.2 1 2.2 2.2v2.2H3.2V5.4c0-1.2 1-2.2 2.2-2.2Zm-2.2 6.2h17.6v9.4c0 1.2-1 2.2-2.2 2.2H5.4c-1.2 0-2.2-1-2.2-2.2V9.4Z"
      />
    </Icon>
  )
}

export function DeployIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12 2.6 17.8 8.4h-3.5v6.1H9.7V8.4H6.2L12 2.6Z" />
      <rect x="4" y="17.2" width="16" height="3.2" rx="1.6" />
    </Icon>
  )
}

export function ServerIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M4.7 3.4h14.6a2.2 2.2 0 0 1 2.2 2.2v3.2a2.2 2.2 0 0 1-2.2 2.2H4.7a2.2 2.2 0 0 1-2.2-2.2V5.6a2.2 2.2 0 0 1 2.2-2.2Zm.95 3.8a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 1 0-2.3 0ZM4.7 13h14.6a2.2 2.2 0 0 1 2.2 2.2v3.2a2.2 2.2 0 0 1-2.2 2.2H4.7a2.2 2.2 0 0 1-2.2-2.2v-3.2A2.2 2.2 0 0 1 4.7 13Zm.95 3.8a1.15 1.15 0 1 0 2.3 0 1.15 1.15 0 1 0-2.3 0Z"
      />
    </Icon>
  )
}

export function SettingsIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="3" y="4.4" width="18" height="2.8" rx="1.4" />
      <rect x="3" y="10.6" width="18" height="2.8" rx="1.4" />
      <rect x="3" y="16.8" width="18" height="2.8" rx="1.4" />
      <circle cx="8.4" cy="5.8" r="3" />
      <circle cx="15.6" cy="12" r="3" />
      <circle cx="10.2" cy="18.2" r="3" />
    </Icon>
  )
}

export function PlusIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="10.6" y="2.6" width="2.8" height="18.8" rx="1.4" />
      <rect x="2.6" y="10.6" width="18.8" height="2.8" rx="1.4" />
    </Icon>
  )
}

export function RefreshIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M17.65 6.35A7.96 7.96 0 0 0 12 4c-4.42 0-7.99 3.58-7.99 8s3.57 8 7.99 8c3.73 0 6.84-2.55 7.73-6h-2.08c-.82 2.33-3.04 4-5.65 4-3.31 0-6-2.69-6-6s2.69-6 6-6c1.66 0 3.14.69 4.22 1.78L13 11h7V4l-2.35 2.35Z" />
    </Icon>
  )
}

export function CloseIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect
        x="10.6"
        y="2.6"
        width="2.8"
        height="18.8"
        rx="1.4"
        transform="rotate(45 12 12)"
      />
      <rect
        x="10.6"
        y="2.6"
        width="2.8"
        height="18.8"
        rx="1.4"
        transform="rotate(-45 12 12)"
      />
    </Icon>
  )
}

export function ChevronIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="4.95" y="11.4" width="9.5" height="3" rx="1.5" transform="rotate(45 9.7 12.9)" />
      <rect x="9.55" y="11.4" width="9.5" height="3" rx="1.5" transform="rotate(-45 14.3 12.9)" />
    </Icon>
  )
}

export function MoreIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <circle cx="5.5" cy="12" r="1.9" />
      <circle cx="12" cy="12" r="1.9" />
      <circle cx="18.5" cy="12" r="1.9" />
    </Icon>
  )
}

export function ExternalIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M19 19H5V5h7V3H5c-1.11 0-2 .9-2 2v14c0 1.1.89 2 2 2h14c1.1 0 2-.9 2-2v-7h-2v7ZM14 3v2h3.59l-9.83 9.83 1.41 1.41L19 6.41V10h2V3h-7Z" />
    </Icon>
  )
}

export function SearchIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M15.5 14h-.79l-.28-.27A6.47 6.47 0 0 0 16 9.5 6.5 6.5 0 1 0 9.5 16c1.61 0 3.09-.59 4.23-1.57l.27.28v.79l5 4.99L20.49 19l-4.99-5Zm-6 0C7.01 14 5 11.99 5 9.5S7.01 5 9.5 5 14 7.01 14 9.5 11.99 14 9.5 14Z" />
    </Icon>
  )
}

export function CheckIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <rect x="2.75" y="12.4" width="9.5" height="3" rx="1.5" transform="rotate(45 7.5 13.9)" />
      <rect x="6.45" y="10.2" width="15.7" height="3" rx="1.5" transform="rotate(-45 14.3 11.7)" />
    </Icon>
  )
}

export function TrashIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12ZM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4Z" />
    </Icon>
  )
}

export function KeyIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M12.65 10A5.99 5.99 0 0 0 7 6c-3.31 0-6 2.69-6 6s2.69 6 6 6a5.99 5.99 0 0 0 5.65-4H17v4h4v-4h2v-4H12.65ZM7 14c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Z" />
    </Icon>
  )
}

export function LockIcon({ className }: IconProps) {
  return (
    <Icon className={className}>
      <path d="M18 8h-1V6c0-2.76-2.24-5-5-5S7 3.24 7 6v2H6c-1.1 0-2 .9-2 2v10c0 1.1.9 2 2 2h12c1.1 0 2-.9 2-2V10c0-1.1-.9-2-2-2Zm-6 9c-1.1 0-2-.9-2-2s.9-2 2-2 2 .9 2 2-.9 2-2 2Zm3.1-9H8.9V6c0-1.71 1.39-3.1 3.1-3.1 1.71 0 3.1 1.39 3.1 3.1v2Z" />
    </Icon>
  )
}

export function BrandMark({ className }: IconProps) {
  return (
    <svg className={className} viewBox="0 0 44 44" fill="currentColor" aria-hidden="true">
      <rect x="2" y="2" width="40" height="40" rx="14" />
      <path
        d="M22 11c4.6 5.4 7.6 9.2 7.6 12.7a7.6 7.6 0 1 1-15.2 0c0-3.5 3-7.3 7.6-12.7Z"
        fill="#fff"
      />
    </svg>
  )
}
