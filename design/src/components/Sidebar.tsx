import { Icon } from './Icons'
import type { IconName } from './Icons'
import { useApp } from '../state'
import type { Route } from '../types'

const items: { page: Route['page']; icon: IconName; label: string }[] = [
  { page: 'servers', icon: 'server', label: '服务器' },
  { page: 'services', icon: 'cube', label: '服务' },
  { page: 'executions', icon: 'terminal', label: '执行记录' },
  { page: 'settings', icon: 'settings', label: '设置' },
]

export function Sidebar() {
  const app = useApp()
  const activePage: Route['page'] =
    app.route.page === 'server' || app.route.page === 'config' ? 'servers' : app.route.page

  return (
    <aside className={`sidebar${app.collapsed ? ' is-collapsed' : ''}`}>
      <div className="logo">
        <span className="logo-mark">
          <Icon name="stack" size={19} />
        </span>
        <span className="logo-text">
          <strong>Ourjia PaaS</strong>
          <span className="caption">服务器服务管理</span>
        </span>
      </div>
      <nav className="nav">
        {items.map((it) => (
          <button
            key={it.page}
            type="button"
            className={`nav-item${activePage === it.page ? ' is-active' : ''}`}
            onClick={() => app.navigate({ page: it.page } as Route)}
            title={it.label}
          >
            <span className="nav-ic">
              <Icon name={it.icon} size={17} />
            </span>
            <span className="nav-label">{it.label}</span>
            {it.page === 'executions' && app.runningCount > 0 && <span className="nav-badge mono">{app.runningCount}</span>}
          </button>
        ))}
      </nav>
      <div className="sidebar-foot">
        <span className="caption sidebar-ver">v0.1.0 · 设计原型</span>
        <button type="button" className="collapse-btn" onClick={app.toggleCollapsed}>
          <Icon name="chevronsLeft" size={15} className="chev" />
          <span className="nav-label">收起侧栏</span>
        </button>
      </div>
    </aside>
  )
}
