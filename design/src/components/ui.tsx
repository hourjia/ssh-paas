import { useId } from 'react'
import type { CSSProperties, ReactNode } from 'react'
import { Icon } from './Icons'
import type { IconName } from './Icons'
import type { ServerStatus, ServiceStatus } from '../types'
import { uid } from '../util'

/* ---------- 状态胶囊：颜色 + 圆点 + 文字三通道 ---------- */
export type Tone = 'ok' | 'warn' | 'err' | 'off' | 'info'

export function Capsule({ tone, children, breathe = false }: { tone: Tone; children: ReactNode; breathe?: boolean }) {
  return (
    <span className={`capsule tone-${tone}${breathe ? ' breathe' : ''}`}>
      <span className="capsule-dot" />
      {children}
    </span>
  )
}

export const serverTone = (s: ServerStatus): Tone => (s === 'online' ? 'ok' : s === 'error' ? 'err' : 'off')
export const serverLabel = (s: ServerStatus) => (s === 'online' ? '在线' : s === 'error' ? '连接异常' : '已离线')
export const svcTone = (s: ServiceStatus): Tone => (s === 'running' ? 'ok' : s === 'error' ? 'err' : 'off')
export const svcLabel = (s: ServiceStatus) => (s === 'running' ? '运行中' : s === 'error' ? '运行异常' : '已停止')

/* ---------- 指标条（CPU / 内存 / 磁盘） ---------- */
export function Metric({ icon, label, value }: { icon: IconName; label: string; value: number }) {
  const tone = value >= 90 ? 'err' : value >= 70 ? 'warn' : 'ok'
  return (
    <div className="metric">
      <span className="metric-label caption">
        <Icon name={icon} size={13} />
        {label}
      </span>
      <div className="progress">
        <div className="progress-fill" data-tone={tone} style={{ width: `${value}%` }} />
      </div>
      <span className="metric-val mono">{value}%</span>
    </div>
  )
}

/* ---------- CPU 迷你曲线 ---------- */
export function Sparkline({ data, stroke = 'var(--c-service)' }: { data: number[]; stroke?: string }) {
  const gid = useId().replace(/:/g, '')
  const W = 160
  const H = 38
  if (data.length < 2) {
    return (
      <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
        <line x1="4" y1={H - 4} x2={W - 4} y2={H - 4} stroke="rgba(255,255,255,.14)" strokeWidth="1.4" strokeDasharray="3 5" />
      </svg>
    )
  }
  const max = Math.max(...data, 60)
  const pts = data.map((v, i) => [(i / (data.length - 1)) * (W - 8) + 4, H - 4 - (v / max) * (H - 10)] as const)
  const line = pts.map((p) => p.join(',')).join(' ')
  const area = `4,${H - 2} ${line} ${W - 4},${H - 2}`
  return (
    <svg className="sparkline" viewBox={`0 0 ${W} ${H}`} width="100%" height={H} preserveAspectRatio="none">
      <defs>
        <linearGradient id={gid} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" stopColor={stroke} stopOpacity="0.26" />
          <stop offset="1" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon points={area} fill={`url(#${gid})`} stroke="none" />
      <polyline points={line} fill="none" stroke={stroke} strokeWidth="1.6" strokeLinejoin="round" strokeLinecap="round" />
      <circle cx={pts[pts.length - 1][0]} cy={pts[pts.length - 1][1]} r="2.2" fill={stroke} />
    </svg>
  )
}

/* ---------- 分段选择 ---------- */
export interface SegOpt<T extends string> {
  value: T
  label: string
  icon?: IconName
}

export function Segmented<T extends string>({
  value,
  options,
  onChange,
}: {
  value: T
  options: SegOpt<T>[]
  onChange: (v: T) => void
}) {
  return (
    <div className="segmented glass-control">
      {options.map((o) => (
        <button key={o.value} className={o.value === value ? 'is-active' : ''} onClick={() => onChange(o.value)} type="button">
          {o.icon && <Icon name={o.icon} size={14} />}
          {o.label}
        </button>
      ))}
    </div>
  )
}

/* ---------- 开关 ---------- */
export function Switch({ checked, onChange }: { checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <button type="button" role="switch" aria-checked={checked} className={`switch${checked ? ' is-on' : ''}`} onClick={() => onChange(!checked)}>
      <span className="knob" />
    </button>
  )
}

/* ---------- 表单字段 ---------- */
export function Field({
  label,
  hint,
  required,
  children,
  className,
}: {
  label: string
  hint?: string
  required?: boolean
  children: ReactNode
  className?: string
}) {
  return (
    <div className={`field${className ? ` ${className}` : ''}`}>
      <span className="field-label">
        {label}
        {required && <em>*</em>}
        {hint && <i className="field-hint">{hint}</i>}
      </span>
      {children}
    </div>
  )
}

/* ---------- 空状态（玻璃框 + 线性插画 + 主操作） ---------- */
export function EmptyState({ title, desc, action }: { title: string; desc?: string; action?: ReactNode }) {
  return (
    <div className="empty">
      <svg className="empty-art" width="120" height="76" viewBox="0 0 120 76" fill="none" stroke="currentColor" strokeWidth="1.5">
        <rect x="18" y="8" width="52" height="18" rx="4" />
        <rect x="18" y="32" width="52" height="18" rx="4" />
        <path d="M26 17h.01M26 41h.01" strokeWidth="2.6" strokeLinecap="round" />
        <path d="M40 17h20M40 41h14" opacity="0.5" />
        <rect x="82" y="26" width="24" height="24" rx="5" strokeDasharray="4 4" />
        <path d="M70 41h6M94 20v-4M100 26h6" opacity="0.6" />
        <path d="M32 58c8 6 20 9 34 9s26-3 34-9" opacity="0.35" strokeDasharray="3 5" />
      </svg>
      <h3>{title}</h3>
      {desc && <p>{desc}</p>}
      {action}
    </div>
  )
}

/* ---------- Spinner ---------- */
export function Spinner() {
  return <span className="spinner" />
}

/* ---------- 虚线流光入口（绑定服务器 / 新建服务） ---------- */
export function DashEntry({
  title,
  sub,
  icon = 'plus',
  onClick,
  delay = 0,
}: {
  title: string
  sub?: string
  icon?: IconName
  onClick: () => void
  delay?: number
}) {
  return (
    <button type="button" className="bind-entry fade-up" style={{ animationDelay: `${delay}ms` }} onClick={onClick}>
      <svg className="bind-dash" aria-hidden>
        <rect x="1" y="1" rx="15" />
      </svg>
      <span className="bind-plus">
        <Icon name={icon} size={20} />
      </span>
      <span className="bind-title">{title}</span>
      {sub && <span className="caption">{sub}</span>}
    </button>
  )
}

/* ---------- Toast 容器 ---------- */
import { useApp } from '../state'
import type { ToastKind } from '../state'

const toastIcon: Record<ToastKind, IconName> = { success: 'check', error: 'alert', info: 'clock' }

export function Toasts() {
  const app = useApp()
  return (
    <div className="toasts">
      {app.toasts.map((t) => (
        <div key={t.id} className={`toast tone-${t.kind}`}>
          <span className="toast-ic">
            <Icon name={toastIcon[t.kind]} size={15} />
          </span>
          <span>{t.text}</span>
        </div>
      ))}
    </div>
  )
}

/* ---------- 滑杆填充进度 ---------- */
export function rangeFill(min: number, max: number, v: number): CSSProperties {
  return { '--fill': `${((v - min) / (max - min)) * 100}%` } as CSSProperties
}

export { uid }
