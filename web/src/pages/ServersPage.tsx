import type { ServerRecord } from '../types'
import { ServerCard } from '../components/ServerCard'
import { PageHeader } from '../components/PageHeader'
import { PlusIcon, RefreshIcon, ServerIcon } from '../icons'

interface ServersPageProps {
  servers: ServerRecord[]
  loading: boolean
  refreshing: boolean
  testingIds: Set<string>
  onRefresh: () => void
  onTest: (id: string) => void
  onDelete: (id: string) => void
  onManage: (id: string) => void
  onAdd: () => void
}

export function ServersPage({
  servers,
  loading,
  refreshing,
  testingIds,
  onRefresh,
  onTest,
  onDelete,
  onManage,
  onAdd,
}: ServersPageProps) {
  return (
    <div className="page">
      <PageHeader title="服务器" subtitle="通过 SSH 接入服务器，检查环境、执行初始化并清理资源。">
        <button className="btn ghost" onClick={onRefresh} disabled={loading || refreshing || !servers.length}>
          {refreshing ? <span className="spinner" /> : <RefreshIcon />}
          刷新状态
        </button>
        <button className="btn primary" onClick={onAdd}>
          <PlusIcon />
          添加服务器
        </button>
      </PageHeader>

      {loading && (
        <div className="glass-lite panel center-panel">
          <span className="spinner" /> 正在加载服务器…
        </div>
      )}

      {!loading && servers.length === 0 && (
        <div className="empty glass-lite reveal">
          <div className="empty-icon">
            <ServerIcon />
          </div>
          <h3>还没有服务器</h3>
          <p>点击右上角「添加服务器」，接入第一台服务器后即可检查环境、初始化并部署应用。</p>
        </div>
      )}

      {!loading && servers.length > 0 && (
        <div className="card-grid">
          {servers.map((s, i) => (
            <ServerCard
              key={s.id}
              server={s}
              index={i}
              testing={testingIds.has(s.id)}
              onOpen={() => onManage(s.id)}
              onTest={() => onTest(s.id)}
              onDelete={() => onDelete(s.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
