import { Fragment } from 'react'
import { useApp } from '../state'
import type { Route } from '../types'

interface Crumb {
  label: string
  route?: Route
}

export function TopBar({ scrolled }: { scrolled: boolean }) {
  const app = useApp()
  const { route, servers } = app

  const crumbs: Crumb[] = []
  if (route.page === 'servers') {
    crumbs.push({ label: '服务器' })
  } else if (route.page === 'server') {
    const s = servers.find((v) => v.id === route.serverId)
    crumbs.push({ label: '服务器', route: { page: 'servers' } }, { label: s?.name ?? '…' })
  } else if (route.page === 'config') {
    const s = servers.find((v) => v.id === route.serverId)
    const svc = s?.services.find((v) => v.id === route.serviceId)
    crumbs.push(
      { label: '服务器', route: { page: 'servers' } },
      { label: s?.name ?? '…', route: { page: 'server', serverId: route.serverId } },
      { label: `${svc?.name ?? '…'} · 配置` },
    )
  } else if (route.page === 'services') {
    crumbs.push({ label: '服务' })
  } else if (route.page === 'executions') {
    crumbs.push({ label: '执行记录' })
  } else {
    crumbs.push({ label: '设置' })
  }

  return (
    <header className={`topbar${scrolled ? ' is-scrolled' : ''}`}>
      <div className="crumbs">
        {crumbs.map((c, i) => (
          <Fragment key={i}>
            {i > 0 && <span className="crumb-sep">/</span>}
            {c.route ? (
              <button type="button" className="crumb" onClick={() => app.navigate(c.route!)}>
                {c.label}
              </button>
            ) : (
              <span className="crumb-cur">{c.label}</span>
            )}
          </Fragment>
        ))}
      </div>
      <div className="topbar-right">
        {app.runningCount > 0 && (
          <button type="button" className="exec-indicator" onClick={() => app.navigate({ page: 'executions' })}>
            <span className="breath-dot" />
            <span className="mono">{app.runningCount}</span> 个任务运行中
          </button>
        )}
        <span className="avatar">E</span>
      </div>
    </header>
  )
}
