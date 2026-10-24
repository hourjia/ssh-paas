import { useState } from 'react'
import { useApp } from '../state'
import { Capsule, DashEntry, EmptyState, Metric, Segmented, Sparkline, Spinner, serverLabel, serverTone, svcLabel, svcTone } from '../components/ui'
import { Icon } from '../components/Icons'
import { srcCaption } from '../util'
import type { Server, Service } from '../types'

/* ---------- 服务卡（卡片模式） ---------- */
function ServiceCard({ server, service: s, index }: { server: Server; service: Service; index: number }) {
  const app = useApp()
  const goConfig = () => app.navigate({ page: 'config', serverId: server.id, serviceId: s.id })
  return (
    <article
      className={`svc-card glass-card is-hoverable is-${s.status} fade-up`}
      style={{ animationDelay: `${Math.min(index * 60, 300)}ms` }}
      onClick={goConfig}
    >
      <div className="svc-top">
        <span className="disc disc-service">
          <Icon name="cube" size={19} />
        </span>
        <div className="svc-name">
          <h3>
            {s.name}
            <span className="chip">v{s.version}</span>
          </h3>
          <span className="svc-src mono">{srcCaption(s)}</span>
        </div>
        <Capsule tone={svcTone(s.status)} breathe={s.status === 'running'}>
          {svcLabel(s.status)}
        </Capsule>
      </div>
      <div className="svc-spark">
        <Sparkline data={s.cpuHistory} stroke={s.status === 'error' ? 'var(--st-error)' : 'var(--c-service)'} />
        <div className="spark-mono mono">
          <span>
            CPU <b>{s.cpu}%</b>
          </span>
          <span>
            MEM <b>{s.mem}%</b>
          </span>
        </div>
      </div>
      <div className="svc-actions" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="btn btn-glass btn-sm" onClick={goConfig}>
          <Icon name="settings" size={13} />
          配置
        </button>
        <button
          type="button"
          className="btn btn-run btn-sm"
          onClick={() => app.openConsole({ mode: 'run', action: 'deploy', serverId: server.id, serviceId: s.id })}
        >
          <Icon name="rocket" size={13} />
          执行
        </button>
        <button
          type="button"
          className="btn btn-glass btn-sm"
          onClick={() => app.openConsole({ mode: 'logs', serverId: server.id, serviceId: s.id })}
        >
          <Icon name="list" size={13} />
          日志
        </button>
        <span className="flex-spacer" />
        <button
          type="button"
          className="icon-btn-sm danger"
          title="删除服务"
          onClick={() =>
            app.requestConfirm({
              title: '删除服务',
              desc: (
                <>
                  将停止并移除服务 <b className="mono">{s.name}</b> 的容器与全部配置，操作不可恢复。
                </>
              ),
              confirmText: '确认删除',
              onConfirm: () => app.deleteService(server.id, s.id),
            })
          }
        >
          <Icon name="trash" size={14} />
        </button>
      </div>
    </article>
  )
}

/* ---------- 服务行（列表模式） ---------- */
function ServiceRow({ server, service: s }: { server: Server; service: Service }) {
  const app = useApp()
  return (
    <div className="svc-row" onClick={() => app.navigate({ page: 'config', serverId: server.id, serviceId: s.id })}>
      <span className={`dot is-${s.status}`} />
      <span className="cell-name">
        <b>{s.name}</b>
        <span className="chip">v{s.version}</span>
      </span>
      <span className="cell-src mono">{srcCaption(s)}</span>
      <span className="cell-res mono">
        <span>
          CPU <b>{s.cpu}%</b>
        </span>
        <span>
          MEM <b>{s.mem}%</b>
        </span>
      </span>
      <Capsule tone={svcTone(s.status)} breathe={s.status === 'running'}>
        {svcLabel(s.status)}
      </Capsule>
      <span className="cell-act" onClick={(e) => e.stopPropagation()}>
        <button type="button" className="icon-btn-sm" title="配置" onClick={() => app.navigate({ page: 'config', serverId: server.id, serviceId: s.id })}>
          <Icon name="settings" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn-sm"
          title="执行部署"
          onClick={() => app.openConsole({ mode: 'run', action: 'deploy', serverId: server.id, serviceId: s.id })}
        >
          <Icon name="rocket" size={14} />
        </button>
        <button
          type="button"
          className="icon-btn-sm"
          title="日志"
          onClick={() => app.openConsole({ mode: 'logs', serverId: server.id, serviceId: s.id })}
        >
          <Icon name="list" size={14} />
        </button>
      </span>
    </div>
  )
}

/* ---------- 服务节点（拓扑模式） ---------- */
function TopoNode({ server, service: s }: { server: Server; service: Service }) {
  const app = useApp()
  return (
    <div className="topo-node glass-card is-hoverable" onClick={() => app.navigate({ page: 'config', serverId: server.id, serviceId: s.id })}>
      <span className={`dot is-${s.status}`} style={{ width: 8, height: 8, borderRadius: 999, flex: 'none', background: s.status === 'running' ? 'var(--st-running)' : s.status === 'error' ? 'var(--st-error)' : 'var(--st-stopped)' }} />
      <span className="cell-name">
        <b>{s.name}</b>
        <span className="chip">v{s.version}</span>
      </span>
      <span className="cell-src mono">{srcCaption(s)}</span>
      <Capsule tone={svcTone(s.status)} breathe={s.status === 'running'}>
        {svcLabel(s.status)}
      </Capsule>
      <Icon name="chevronRight" size={15} className="text-2" />
    </div>
  )
}

/* ============ 服务器详情页：Glass-Shell 容器 ============ */
export function ServerDetailPage({ id }: { id: string }) {
  const app = useApp()
  const server = app.servers.find((s) => s.id === id)
  const [density, setDensity] = useState<'card' | 'list' | 'topo'>('card')
  const [testing, setTesting] = useState(false)

  if (!server) {
    return (
      <div className="page">
        <EmptyState title="服务器不存在" desc="它可能已被解绑" />
      </div>
    )
  }

  const testConn = () => {
    setTesting(true)
    window.setTimeout(() => {
      setTesting(false)
      app.toast('success', `SSH 连接正常 · ${server.host} · 延迟 ${18 + Math.floor(Math.random() * 20)}ms`)
    }, 1100)
  }

  return (
    <div className="page">
      <section className="server-shell glass-shell fade-up">
        <header className="shell-head">
          <div className="shell-id">
            <span className="disc disc-server disc-lg">
              <Icon name="server" size={23} />
            </span>
            <div>
              <h2>
                {server.name}
                <Capsule tone={serverTone(server.status)} breathe={server.status === 'online'}>
                  {serverLabel(server.status)}
                </Capsule>
              </h2>
              <span className="meta mono">
                {server.username}@{server.host}:{server.port} · {server.os} · {server.authType === 'key' ? 'SSH 私钥' : 'SSH 密码'}
              </span>
            </div>
          </div>
          <div className="shell-metrics">
            <Metric icon="cpu" label="CPU" value={server.cpu} />
            <Metric icon="chip" label="内存" value={server.mem} />
            <Metric icon="drive" label="磁盘" value={server.disk} />
          </div>
          <div className="shell-actions">
            <Segmented
              value={density}
              onChange={setDensity}
              options={[
                { value: 'card', label: '卡片' },
                { value: 'list', label: '列表' },
                { value: 'topo', label: '拓扑' },
              ]}
            />
            <button type="button" className="btn btn-glass" disabled={testing} onClick={testConn}>
              {testing ? <Spinner /> : <Icon name="plug" size={15} />}
              测试连接
            </button>
            <button type="button" className="btn btn-glass" onClick={() => app.restartServer(server.id)}>
              <Icon name="refresh" size={15} />
              重启
            </button>
            <button
              type="button"
              className="btn btn-danger-ghost"
              onClick={() =>
                app.requestConfirm({
                  title: '解绑服务器',
                  desc: (
                    <>
                      将断开与 <b className="mono">{server.name}</b> 的 SSH 连接，并移除其下{' '}
                      <b>{server.services.length}</b> 个服务的配置。
                    </>
                  ),
                  confirmText: '确认解绑',
                  onConfirm: () => app.unbindServer(server.id),
                })
              }
            >
              解绑
            </button>
            <button type="button" className="btn btn-primary" onClick={() => app.addService(server.id)}>
              <Icon name="plus" size={15} />
              添加服务
            </button>
          </div>
        </header>

        <div className="shell-body">
          {server.services.length === 0 ? (
            <EmptyState
              title="这台服务器上还没有服务"
              desc="每个服务对应一份独立的部署配置：源码来源、分支、版本、Dockerfile 与环境变量"
              action={
                <button type="button" className="btn btn-primary" onClick={() => app.addService(server.id)}>
                  <Icon name="plus" size={15} />
                  创建第一个服务
                </button>
              }
            />
          ) : density === 'card' ? (
            <div className="svc-grid">
              {server.services.map((s, i) => (
                <ServiceCard key={s.id} server={server} service={s} index={i} />
              ))}
              <DashEntry title="新建服务" sub="Git 仓库或本地目录" delay={Math.min(server.services.length * 60, 300)} onClick={() => app.addService(server.id)} />
            </div>
          ) : density === 'list' ? (
            <div className="svc-list solid-screen">
              <div className="svc-row-head">
                <span />
                <span>服务</span>
                <span>源</span>
                <span>资源</span>
                <span>状态</span>
                <span style={{ textAlign: 'right' }}>操作</span>
              </div>
              {server.services.map((s) => (
                <ServiceRow key={s.id} server={server} service={s} />
              ))}
            </div>
          ) : (
            <div className="topo">
              <div className="topo-root" style={{ gridRow: `1 / span ${server.services.length}` }}>
                <span className="disc disc-server disc-lg">
                  <Icon name="server" size={22} />
                </span>
                <div>
                  <h3>{server.name}</h3>
                  <span className="meta mono">
                    {server.host} · {server.services.length} 个服务
                  </span>
                </div>
              </div>
              <div className="topo-trunk" style={{ gridRow: `1 / span ${server.services.length}` }} />
              {server.services.map((s) => (
                <TopoNode key={s.id} server={server} service={s} />
              ))}
            </div>
          )}
        </div>
      </section>
    </div>
  )
}
