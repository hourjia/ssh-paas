import { BrandMark, GridIcon, ScriptIcon, ServerIcon, SettingsIcon } from '../icons'

export type PageKey = 'apps' | 'servers' | 'scripts'

const NAV_ITEMS: { key: PageKey; label: string; icon: typeof GridIcon }[] = [
  { key: 'servers', label: '服务器', icon: ServerIcon },
  { key: 'apps', label: '应用', icon: GridIcon },
  { key: 'scripts', label: '脚本', icon: ScriptIcon },
]

interface SidebarProps {
  page: PageKey
  onPage: (page: PageKey) => void
  onSettings: () => void
}

export function Sidebar({ page, onPage, onSettings }: SidebarProps) {
  return (
    <aside className="sidebar">
      <div className="brand">
        <BrandMark className="brand-mark" />
        <div className="brand-text">
          <strong>OURJIA PAAS</strong>
          <span>SSH 运维平台</span>
        </div>
      </div>

      <nav className="nav" aria-label="主导航">
        {NAV_ITEMS.map(({ key, label, icon: Icon }) => (
          <button key={key} className={`nav-item${page === key ? ' active' : ''}`} onClick={() => onPage(key)}>
            <Icon />
            <span>{label}</span>
          </button>
        ))}
      </nav>

      <div className="sidebar-foot">
        <div className="node-chip">
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
