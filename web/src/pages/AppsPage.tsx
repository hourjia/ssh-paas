import { GridIcon } from '../icons'

export function AppsPage({ onGoServers }: { onGoServers: () => void }) {
  return (
    <div className="empty glass-lite reveal">
      <div className="empty-icon">
        <GridIcon />
      </div>
      <h3>应用管理即将开放</h3>
      <p>这里将展示各服务器上部署的应用与服务状态。先到「服务器」页添加并连接你的服务器。</p>
      <button className="btn ghost" onClick={onGoServers}>
        去添加服务器
      </button>
    </div>
  )
}
