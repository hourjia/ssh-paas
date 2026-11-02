import { useLayoutEffect, useRef, useState } from 'react'
import { BrandMark, GridIcon, ServerIcon, SettingsIcon } from '../icons'

export type PageKey = 'apps' | 'servers'

const NAV_ITEMS: { key: PageKey; label: string; icon: typeof GridIcon }[] = [
  { key: 'apps', label: '应用', icon: GridIcon },
  { key: 'servers', label: '服务器', icon: ServerIcon },
]

interface SidebarProps {
  page: PageKey
  onPage: (page: PageKey) => void
  onSettings: () => void
}

export function Sidebar({ page, onPage, onSettings }: SidebarProps) {
  const navRef = useRef<HTMLElement>(null)
  const [pill, setPill] = useState({ top: 0, height: 52 })

  const measure = () => {
    const active = navRef.current?.querySelector<HTMLElement>('.nav-item.active')
    if (active) setPill({ top: active.offsetTop, height: active.offsetHeight })
  }

  useLayoutEffect(() => {
    measure()
    window.addEventListener('resize', measure)
    return () => window.removeEventListener('resize', measure)
  }, [page])

  return (
    <aside className="sidebar glass sheen">
      <div className="brand">
        <BrandMark className="brand-mark" />
        <div className="brand-text">
          <strong>Ourjia PaaS</strong>
          <span>SSH 运维</span>
        </div>
      </div>

      <nav className="nav" ref={navRef} aria-label="主导航">
        <div className="nav-indicator" style={{ transform: `translateY(${pill.top}px)`, height: pill.height }} />
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
          <button
            key={key}
            className={`nav-item${page === key ? ' active' : ''}`}
            onClick={() => onPage(key)}
          >
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="node-chip glass-lite">
          <i />
          本地节点 · 已连接
        </div>
        <button className="settings-btn" onClick={onSettings}>
          <SettingsIcon />
          <span>设置</span>
        </button>
      </div>
    </aside>
  )
}
