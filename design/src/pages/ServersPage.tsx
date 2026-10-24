import { useState } from 'react'
import { useApp } from '../state'
import { Capsule, DashEntry, Metric, serverLabel, serverTone } from '../components/ui'
import { Icon } from '../components/Icons'
import type { Server } from '../types'

function ServerCard({ server, index }: { server: Server; index: number }) {
  const app = useApp()
  return (
    <article
      className={`server-card glass-card is-hoverable fade-up${server.status !== 'online' ? ' is-dim' : ''}`}
      style={{ animationDelay: `${Math.min(index * 60, 300)}ms` }}
      onClick={() => app.navigate({ page: 'server', serverId: server.id })}
    >
      <div className="sc-head">
        <span className="disc disc-server">
          <Icon name="server" size={20} />
        </span>
        <div className="sc-title">
          <h3>{server.name}</h3>
          <span className="meta mono">
            {server.host}:{server.port} · {server.username}
          </span>
        </div>
        <Capsule tone={serverTone(server.status)} breathe={server.status === 'online'}>
          {serverLabel(server.status)}
        </Capsule>
      </div>
      <div className="sc-metrics">
        <Metric icon="cpu" label="CPU" value={server.cpu} />
        <Metric icon="chip" label="内存" value={server.mem} />
        <Metric icon="drive" label="磁盘" value={server.disk} />
      </div>
      <footer className="sc-foot">
        <span className="badge">
          <Icon name="cube" size={13} />
          {server.services.length} 个服务
        </span>
        <span className="foot-link">
          查看服务
          <Icon name="chevronRight" size={14} />
        </span>
      </footer>
    </article>
  )
}

export function ServersPage() {
  const app = useApp()
  const [q, setQ] = useState('')
  const kw = q.trim().toLowerCase()
  const list = app.servers.filter((s) => `${s.name} ${s.host}`.toLowerCase().includes(kw))
  const online = app.servers.filter((s) => s.status === 'online').length
  const svcCount = app.servers.reduce((n, s) => n + s.services.length, 0)

  return (
    <div className="page">
      <header className="page-head fade-up">
        <div>
          <h1 className="t1">服务器</h1>
          <p className="caption mono">
            {app.servers.length} 台已绑定 · {online} 台在线 · {svcCount} 个服务
          </p>
        </div>
        <div className="page-actions">
          <div className="search glass-control">
            <Icon name="search" size={15} />
            <input placeholder="搜索名称或 IP" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <button type="button" className="btn btn-primary" onClick={app.openBind}>
            <Icon name="plus" size={15} />
            绑定服务器
          </button>
        </div>
      </header>

      <div className="server-grid">
        {list.map((s, i) => (
          <ServerCard key={s.id} server={s} index={i} />
        ))}
        <DashEntry
          title="绑定服务器"
          sub="通过 SSH 连接你的主机 · 支持密码 / 私钥"
          onClick={app.openBind}
          delay={Math.min(list.length * 60, 300)}
        />
      </div>
    </div>
  )
}
