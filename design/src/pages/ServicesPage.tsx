import { useState } from 'react'
import { useApp } from '../state'
import { Capsule, EmptyState, svcLabel, svcTone } from '../components/ui'
import { Icon } from '../components/Icons'
import { srcCaption } from '../util'
import type { Service, ServiceStatus, Server } from '../types'

type Tab = 'all' | ServiceStatus
const tabs: { value: Tab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'running', label: '运行中' },
  { value: 'stopped', label: '已停止' },
  { value: 'error', label: '异常' },
]

export function ServicesPage() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>('all')
  const rows = app.servers
    .flatMap((server) => server.services.map((service) => ({ server, service })))
    .filter(({ service }) => tab === 'all' || service.status === tab)

  return (
    <div className="page">
      <header className="page-head fade-up">
        <div>
          <h1 className="t1">服务</h1>
          <p className="caption">所有服务器上的服务清单 · 点击行进入配置</p>
        </div>
        <div className="page-actions">
          <div className="tabs">
            {tabs.map((t) => (
              <button key={t.value} type="button" className={tab === t.value ? 'is-active' : ''} onClick={() => setTab(t.value)}>
                {t.label}
              </button>
            ))}
          </div>
        </div>
      </header>

      {rows.length === 0 ? (
        <div className="glass-card fade-up">
          <EmptyState title="没有符合条件的服务" desc="换个筛选条件，或到服务器页新建服务" />
        </div>
      ) : (
        <div className="table-frame fade-up">
          <table>
            <thead>
              <tr>
                <th>服务</th>
                <th>服务器</th>
                <th>源</th>
                <th>状态</th>
                <th>资源</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ server, service }: { server: Server; service: Service }) => (
                <tr
                  key={service.id}
                  style={{ cursor: 'pointer' }}
                  onClick={() => app.navigate({ page: 'config', serverId: server.id, serviceId: service.id })}
                >
                  <td>
                    <span className="cell-task">
                      <span className="disc disc-service disc-sm">
                        <Icon name="cube" size={14} />
                      </span>
                      <span className="mono">{service.name}</span>
                      <span className="chip">v{service.version}</span>
                    </span>
                  </td>
                  <td className="text-2">{server.name}</td>
                  <td>
                    <span className="caption mono">{srcCaption(service)}</span>
                  </td>
                  <td>
                    <Capsule tone={svcTone(service.status)} breathe={service.status === 'running'}>
                      {svcLabel(service.status)}
                    </Capsule>
                  </td>
                  <td>
                    <span className="caption mono">
                      CPU {service.cpu}% · MEM {service.mem}%
                    </span>
                  </td>
                  <td>
                    <span className="cell-act" style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }} onClick={(e) => e.stopPropagation()}>
                      <button
                        type="button"
                        className="btn btn-glass btn-sm"
                        onClick={() => app.navigate({ page: 'config', serverId: server.id, serviceId: service.id })}
                      >
                        配置
                      </button>
                      <button
                        type="button"
                        className="btn btn-run btn-sm"
                        onClick={() => app.openConsole({ mode: 'run', action: 'deploy', serverId: server.id, serviceId: service.id })}
                      >
                        <Icon name="rocket" size={12} />
                        执行
                      </button>
                      <button
                        type="button"
                        className="btn btn-glass btn-sm"
                        onClick={() => app.openConsole({ mode: 'logs', serverId: server.id, serviceId: service.id })}
                      >
                        日志
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
