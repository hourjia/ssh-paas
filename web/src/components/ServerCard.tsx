import { useEffect, useRef, useState } from 'react'
import type { ServerRecord } from '../types'
import { ExternalIcon, KeyIcon, LockIcon, MoreIcon, RefreshIcon, ServerIcon, TrashIcon } from '../icons'

interface ServerCardProps {
  server: ServerRecord
  index: number
  testing: boolean
  onTest: () => void
  onDelete: () => void
  onManage: () => void
}

function statusInfo(server: ServerRecord, testing: boolean): { cls: string; label: string } {
  if (testing) return { cls: 'st-stop', label: '检测中…' }
  if (server.status === 'online') return { cls: 'st-run', label: '在线' }
  if (server.status === 'offline') return { cls: 'st-err', label: '连接失败' }
  return { cls: 'st-stop', label: '未验证' }
}

export function ServerCard({ server, index, testing, onTest, onDelete, onManage }: ServerCardProps) {
  const [menu, setMenu] = useState<'closed' | 'open' | 'confirm'>('closed')
  const menuZone = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (menu === 'closed') return
    const onDocDown = (e: MouseEvent) => {
      if (!menuZone.current?.contains(e.target as Node)) setMenu('closed')
    }
    document.addEventListener('mousedown', onDocDown)
    return () => document.removeEventListener('mousedown', onDocDown)
  }, [menu])

  const st = statusInfo(server, testing)
  const target = `${server.user}@${server.host}${server.port !== 22 ? `:${server.port}` : ''}`
  const pillTitle = [server.lastError, server.lastCheckAt ? `检测于 ${new Date(server.lastCheckAt).toLocaleString()}` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <article className="server-card glass-lite reveal" style={{ animationDelay: `${index * 85}ms` }}>
      <div className="card-top" ref={menuZone}>
        <div className="server-icon">
          <ServerIcon />
        </div>
        <span className={`status-pill ${st.cls}`} title={pillTitle || undefined}>
          <i />
          {st.label}
        </span>
        <button
          className="icon-btn sm"
          data-tip="更多操作"
          aria-label="更多操作"
          onClick={() => setMenu(menu === 'closed' ? 'open' : 'closed')}
        >
          <MoreIcon />
        </button>
        {menu !== 'closed' && (
          <div className="card-menu glass">
            <button
              onClick={() => {
                setMenu('closed')
                onTest()
              }}
            >
              <RefreshIcon />
              测试连接
            </button>
            {menu === 'confirm' ? (
              <button
                className="danger"
                onClick={() => {
                  setMenu('closed')
                  onDelete()
                }}
              >
                <TrashIcon />
                确认删除？
              </button>
            ) : (
              <button className="danger" onClick={() => setMenu('confirm')}>
                <TrashIcon />
                删除服务器
              </button>
            )}
          </div>
        )}
      </div>

      <h3 className="server-name">{server.name}</h3>
      <p className="server-ip">{target}</p>
      {(server.os || server.latencyMs != null) && (
        <p className="server-os">
          {server.os ?? '—'}
          {server.latencyMs != null ? ` · ${server.latencyMs}ms` : ''}
        </p>
      )}

      <div className="server-foot">
        <span className="auth-badge">
          {server.authType === 'key' ? <KeyIcon /> : <LockIcon />}
          {server.authType === 'key' ? (server.keyInstalled ? '密钥认证' : '密钥未安装') : '密码认证'}
        </span>
        <span
          className="go"
          role="button"
          tabIndex={0}
          onClick={onManage}
          onKeyDown={(e) => e.key === 'Enter' && onManage()}
        >
          管理
          <ExternalIcon />
        </span>
      </div>
    </article>
  )
}
