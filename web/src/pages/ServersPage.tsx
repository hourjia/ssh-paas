import type { ServerRecord } from '../types'
import { ServerCard } from '../components/ServerCard'
import { ServerIcon } from '../icons'

interface ServersPageProps {
  servers: ServerRecord[]
  testingIds: Set<string>
  onTest: (id: string) => void
  onDelete: (id: string) => void
  onManage: () => void
  onAdd: () => void
}

export function ServersPage({ servers, testingIds, onTest, onDelete, onManage, onAdd }: ServersPageProps) {
  if (!servers.length) {
    return (
      <div className="empty glass-lite reveal">
        <div className="empty-icon">
          <ServerIcon />
        </div>
        <h3>还没有服务器</h3>
        <p>点击右上角 + 添加第一台服务器，开始统一运维。</p>
        <button className="btn primary" onClick={onAdd}>
          添加服务器
        </button>
      </div>
    )
  }

  return (
    <div className="card-grid">
      {servers.map((s, i) => (
        <ServerCard
          key={s.id}
          server={s}
          index={i}
          testing={testingIds.has(s.id)}
          onTest={() => onTest(s.id)}
          onDelete={() => onDelete(s.id)}
          onManage={onManage}
        />
      ))}
    </div>
  )
}
