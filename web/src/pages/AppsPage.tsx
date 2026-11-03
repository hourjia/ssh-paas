import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import type { AppRecord, ServerRecord } from '../types'
import { Modal } from '../components/Modal'
import { TerminalLog, type TerminalLine } from '../components/TerminalLog'
import { GridIcon, RefreshIcon } from '../icons'

interface AppsPageProps {
  servers: ServerRecord[]
  createOpen: boolean
  onOpenCreate: () => void
  onCloseCreate: () => void
  onGoServers: () => void
  onToast: (msg: string) => void
}

const STATUS: Record<AppRecord['status'], { cls: string; label: string }> = {
  idle: { cls: 'st-stop', label: '未部署' },
  deploying: { cls: 'st-stop', label: '部署中' },
  running: { cls: 'st-run', label: '运行中' },
  failed: { cls: 'st-err', label: '部署失败' },
}

function hostOf(domain: string) {
  return domain.startsWith('http') ? domain : `https://${domain}`
}

export function AppsPage({ servers, createOpen, onOpenCreate, onCloseCreate, onGoServers, onToast }: AppsPageProps) {
  const [apps, setApps] = useState<AppRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [logs, setLogs] = useState<TerminalLine[]>([])
  const [logTitle, setLogTitle] = useState('部署 · 终端输出')
  const unsubRef = useRef<(() => void) | null>(null)

  const [name, setName] = useState('')
  const [domain, setDomain] = useState('')
  const [serverId, setServerId] = useState('')
  const [creating, setCreating] = useState(false)
  const [formError, setFormError] = useState<string | null>(null)

  const load = useCallback(async () => {
    try {
      const { apps: list } = await api.listApps()
      setApps(list)
    } catch (e) {
      onToast(e instanceof Error ? e.message : '加载应用失败')
    } finally {
      setLoaded(true)
    }
  }, [onToast])

  useEffect(() => {
    load()
    return () => unsubRef.current?.()
  }, [load])

  useEffect(() => {
    if (!createOpen) return
    setServerId((cur) => cur || servers[0]?.id || '')
  }, [createOpen, servers])

  const serverName = useMemo(() => {
    const map = new Map(servers.map((s) => [s.id, s.name]))
    return (id: string) => map.get(id) || '未知服务器'
  }, [servers])

  const attachStream = useCallback(
    (jobId: string) => {
      unsubRef.current?.()
      unsubRef.current = api.streamJob(jobId, {
        onState: (snap) => {
          if (snap.status === 'done') {
            onToast('部署完成')
            setBusyId(null)
            load()
          }
          if (snap.status === 'failed') {
            onToast(`部署失败：${snap.error || '未知错误'}`)
            setBusyId(null)
            load()
          }
        },
        onLog: (log) => setLogs((prev) => [...prev.slice(-3000), log]),
      })
    },
    [load, onToast],
  )

  const deploy = useCallback(
    async (app: AppRecord) => {
      if (busyId) return
      setBusyId(app.id)
      setLogs([])
      setLogTitle(`部署 ${app.name} · 终端输出`)
      setApps((prev) => prev.map((a) => (a.id === app.id ? { ...a, status: 'deploying' } : a)))
      try {
        const { job } = await api.deployApp(app.id)
        attachStream(job.id)
      } catch (e) {
        setBusyId(null)
        onToast(e instanceof Error ? e.message : '启动部署失败')
        load()
      }
    },
    [attachStream, busyId, load, onToast],
  )

  const remove = useCallback(
    async (app: AppRecord) => {
      if (busyId) return
      if (!window.confirm(`删除应用「${app.name}」？服务器上的容器与目录不会自动清理。`)) return
      try {
        await api.deleteApp(app.id)
        setApps((prev) => prev.filter((a) => a.id !== app.id))
        onToast('应用已删除')
      } catch (e) {
        onToast(e instanceof Error ? e.message : '删除失败')
      }
    },
    [busyId, onToast],
  )

  const submit = useCallback(async () => {
    if (creating) return
    if (!serverId) {
      setFormError('请先添加服务器')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      const { app } = await api.createApp({ serverId, name: name.trim(), domain: domain.trim() })
      setApps((prev) => [app, ...prev])
      setName('')
      setDomain('')
      onCloseCreate()
      onToast('应用已创建，可以开始部署')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [creating, domain, name, onCloseCreate, onToast, serverId])

  return (
    <div className="apps-page">
      <div className="apps-head">
        <div>
          <p className="eyebrow">Apps</p>
          <h2 className="apps-title">应用</h2>
          <p className="apps-sub">部署后由 Traefik 按域名路由并自动申请证书。</p>
        </div>
        <button className="btn primary" onClick={onOpenCreate} disabled={!servers.length}>
          <GridIcon /> 新建示例应用
        </button>
      </div>

      {!loaded && (
        <div className="glass-lite panel center-panel">
          <span className="spinner" /> 正在加载应用…
        </div>
      )}

      {loaded && apps.length === 0 && (
        <div className="empty glass-lite reveal">
          <div className="empty-icon">
            <GridIcon />
          </div>
          <h3>还没有应用</h3>
          <p>
            {servers.length
              ? '先创建一个示例应用，跑通构建、交付、部署与 HTTPS 的完整链路。'
              : '先到「服务器」页添加并初始化一台服务器。'}
          </p>
          {servers.length ? (
            <button className="btn primary" onClick={onOpenCreate}>
              新建示例应用
            </button>
          ) : (
            <button className="btn ghost" onClick={onGoServers}>
              去添加服务器
            </button>
          )}
        </div>
      )}

      {apps.length > 0 && (
        <div className="app-grid">
          {apps.map((app) => {
            const st = STATUS[app.status] || STATUS.idle
            const deploying = app.status === 'deploying' || busyId === app.id
            return (
              <article key={app.id} className="glass-lite app-card reveal">
                <div className="app-card-head">
                  <div>
                    <h3 className="app-name">{app.name}</h3>
                    <a className="app-domain mono" href={hostOf(app.domain)} target="_blank" rel="noreferrer">
                      {app.domain}
                    </a>
                  </div>
                  <span className={`status-pill ${st.cls}`}>
                    <i />
                    {st.label}
                  </span>
                </div>

                <dl className="app-meta">
                  <div>
                    <dt>服务器</dt>
                    <dd>{serverName(app.serverId)}</dd>
                  </div>
                  <div>
                    <dt>版本</dt>
                    <dd className="mono">{app.delivery.version || '—'}</dd>
                  </div>
                  <div>
                    <dt>部署时间</dt>
                    <dd>{app.delivery.deployedAt ? new Date(app.delivery.deployedAt).toLocaleString() : '—'}</dd>
                  </div>
                </dl>

                {app.warning && <p className="app-note warn">{app.warning}</p>}
                {app.lastError && <p className="app-note err">{app.lastError}</p>}

                <div className="app-actions">
                  <button className="btn primary sm" onClick={() => deploy(app)} disabled={deploying || Boolean(busyId)}>
                    {deploying ? (
                      <>
                        <span className="spinner" /> 部署中…
                      </>
                    ) : (
                      <>
                        <RefreshIcon /> {app.status === 'running' ? '重新部署' : '部署'}
                      </>
                    )}
                  </button>
                  <button className="btn ghost sm" onClick={() => remove(app)} disabled={deploying}>
                    删除
                  </button>
                </div>
              </article>
            )
          })}
        </div>
      )}

      {(logs.length > 0 || busyId) && (
        <section className="glass-lite panel">
          <h2 className="panel-title">部署日志</h2>
          <TerminalLog lines={logs} height="tall" title={logTitle} />
        </section>
      )}

      <Modal open={createOpen} onClose={onCloseCreate} title="新建示例应用">
        <div className="form-grid">
          <div className="field">
            <label>应用名称</label>
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="例如 示例站点" />
          </div>
          <div className="field">
            <label>服务器</label>
            <select value={serverId} onChange={(e) => setServerId(e.target.value)}>
              {servers.length === 0 && <option value="">请先添加服务器</option>}
              {servers.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}（{s.host}）
                </option>
              ))}
            </select>
          </div>
          <div className="field">
            <label>域名</label>
            <input value={domain} onChange={(e) => setDomain(e.target.value)} placeholder="demo.example.com" />
            <p className="form-hint">
              解析由你自行配置，平台只按此域名生成 Traefik 路由并申请证书；未解析时 HTTPS 会显示警告。
            </p>
          </div>
          {formError && <div className="form-error">{formError}</div>}
          <div className="modal-foot">
            <button className="btn ghost" onClick={onCloseCreate} disabled={creating}>
              取消
            </button>
            <button className="btn primary" onClick={submit} disabled={creating || !servers.length}>
              {creating ? (
                <>
                  <span className="spinner" /> 创建中…
                </>
              ) : (
                '创建'
              )}
            </button>
          </div>
        </div>
      </Modal>
    </div>
  )
}
