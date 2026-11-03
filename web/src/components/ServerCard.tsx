import { useEffect, useRef, useState } from 'react'
import type { ServerRecord } from '../types'
import { KeyIcon, LockIcon, MoreIcon, RefreshIcon, ServerIcon, TrashIcon } from '../icons'

interface ServerCardProps {
  server: ServerRecord
  index: number
  testing: boolean
  onOpen: () => void
  onTest: () => void
  onDelete: () => void
}

function statusInfo(server: ServerRecord, testing: boolean): { cls: string; label: string } {
  if (testing) return { cls: 'st-stop', label: '检测中' }
  if (server.init?.state === 'ready') return { cls: 'st-run', label: '已初始化' }
  if (server.status === 'online') return { cls: 'st-up', label: '在线' }
  if (server.status === 'offline') return { cls: 'st-err', label: '连接失败' }
  return { cls: 'st-stop', label: '未验证' }
}

export function ServerCard({ server, index, testing, onOpen, onTest, onDelete }: ServerCardProps) {
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
  const tip = [server.lastError, server.lastCheckAt ? `检测于 ${new Date(server.lastCheckAt).toLocaleString()}` : '']
    .filter(Boolean)
    .join(' · ')

  return (
    <article
      className="server-card glass-lite reveal"
      style={{ animationDelay: `${index * 55}ms` }}
      role="button"
      tabIndex={0}
      onClick={onOpen}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault()
          onOpen()
        }
      }}
    >
      <div className="sc-head">
        <div className="server-icon">
          <ServerIcon />
        </div>
        <div className="sc-id">
          <div className="sc-title-row">
            <h3 className="server-name">{server.name}</h3>
            <span className={`status-pill ${st.cls}`} title={tip || undefined}>
              <i />
              {st.label}
            </span>
          </div>
          <p className="server-ip">{target}</p>
        </div>
        <div className="sc-right" ref={menuZone} onClick={(e) => e.stopPropagation()} onKeyDown={(e) => e.stopPropagation()}>
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
      </div>

      <div className="sc-foot">
        <span className="auth-badge">
          {server.authType === 'key' ? <KeyIcon /> : <LockIcon />}
          {server.authType === 'key' ? (server.keyInstalled ? '密钥' : '密钥未装') : '密码'}
        </span>
        {server.os && <span className="sc-os">{server.os.split(' · ')[0]}</span>}
        {server.latencyMs != null && <span className="sc-latency">{server.latencyMs}ms</span>}
      </div>
    </article>
  )
}
