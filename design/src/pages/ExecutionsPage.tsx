import { useState } from 'react'
import { actionLabel, execStatusLabel, useApp } from '../state'
import { Capsule, EmptyState } from '../components/ui'
import { Icon } from '../components/Icons'
import type { ExecAction, ExecStatus } from '../types'
import type { Tone } from '../components/ui'

type Tab = 'all' | ExecAction
const tabs: { value: Tab; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'deploy', label: '部署' },
  { value: 'start', label: '启动' },
  { value: 'stop', label: '停止' },
]

const statusMeta: Record<ExecStatus, { tone: Tone; label: string; breathe?: boolean }> = {
  success: { tone: 'ok', label: '成功' },
  failed: { tone: 'err', label: '失败' },
  running: { tone: 'info', label: '进行中', breathe: true },
  cancelled: { tone: 'off', label: '已取消' },
}

export function ExecutionsPage() {
  const app = useApp()
  const [tab, setTab] = useState<Tab>('all')
  const rows = app.executions.filter((e) => tab === 'all' || e.action === tab)
  const running = app.executions.filter((e) => e.status === 'running').length

  return (
    <div className="page">
      <header className="page-head fade-up">
        <div>
          <h1 className="t1">执行记录</h1>
          <p className="caption mono">
            {app.executions.length} 条记录 · {running} 个任务进行中
          </p>
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
          <EmptyState title="暂无执行记录" desc="到服务配置页点击「执行」发起一次部署" />
        </div>
      ) : (
        <div className="table-frame fade-up">
          <table>
            <thead>
              <tr>
                <th>任务</th>
                <th>服务器</th>
                <th>类型</th>
                <th>状态</th>
                <th>耗时</th>
                <th>时间</th>
                <th style={{ textAlign: 'right' }}>操作</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((e) => {
                const meta = statusMeta[e.status]
                return (
                  <tr key={e.id}>
                    <td>
                      <span className="cell-task">
                        <span className="mono">{e.serviceName}</span>
                        <span className="chip">v{e.version}</span>
                      </span>
                    </td>
                    <td className="text-2">{e.serverName}</td>
                    <td>
                      <span className={`chip act-${e.action}`}>{actionLabel[e.action]}</span>
                    </td>
                    <td>
                      <Capsule tone={meta.tone} breathe={meta.breathe}>
                        {execStatusLabel[e.status]}
                      </Capsule>
                    </td>
                    <td className="mono text-2">{e.duration}</td>
                    <td className="caption mono">{e.time}</td>
                    <td style={{ textAlign: 'right' }}>
                      <button
                        type="button"
                        className="btn btn-glass btn-sm"
                        onClick={() => {
                          if (e.serverId && e.serviceId) app.openConsole({ mode: 'logs', serverId: e.serverId, serviceId: e.serviceId })
                          else app.toast('info', '该记录为历史数据，无法回放日志')
                        }}
                      >
                        <Icon name="list" size={12} />
                        日志
                      </button>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}
