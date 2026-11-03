import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import type { AppRecord, ServerRecord } from '../types'
import { Modal } from '../components/Modal'
import { TerminalLog, type TerminalLine } from '../components/TerminalLog'
import { ContainerIcon, DeployIcon, PlusIcon } from '../icons'

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

const EMPTY_FORM = {
  name: '',
  image: '',
  domain: '',
  port: '80',
  env: '',
  notes: '',
  alias: '',
  dataDir: '',
  containerPath: '',
  dataOwner: '',
  healthCmd: '',
}

const POSTGRES_PRESET = {
  image: 'postgres:16-alpine',
  port: '5432',
  alias: 'postgres',
  containerPath: '/var/lib/postgresql/data',
  dataOwner: '',
  healthCmd: 'pg_isready -U appuser -d appdb',
  env: 'POSTGRES_DB=appdb\nPOSTGRES_USER=appuser\nPOSTGRES_PASSWORD=change-me',
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24)
}

export function AppsPage({ servers, createOpen, onOpenCreate, onCloseCreate, onGoServers, onToast }: AppsPageProps) {
  const [apps, setApps] = useState<AppRecord[]>([])
  const [loaded, setLoaded] = useState(false)
  const [busyId, setBusyId] = useState<string | null>(null)
  const [logs, setLogs] = useState<TerminalLine[]>([])
  const [logTitle, setLogTitle] = useState('部署 · 终端输出')
  const unsubRef = useRef<(() => void) | null>(null)

  const [kind, setKind] = useState<'image' | 'service'>('image')
  const [form, setForm] = useState(EMPTY_FORM)
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

  const setField = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm((cur) => ({ ...cur, [key]: value }))
  }

  const applyPostgres = () => {
    setKind('service')
    setForm((cur) => ({
      ...cur,
      name: cur.name || 'postgres',
      image: POSTGRES_PRESET.image,
      port: POSTGRES_PRESET.port,
      alias: cur.alias || POSTGRES_PRESET.alias,
      containerPath: POSTGRES_PRESET.containerPath,
      dataOwner: POSTGRES_PRESET.dataOwner,
      healthCmd: POSTGRES_PRESET.healthCmd,
      env: cur.env.trim() ? cur.env : POSTGRES_PRESET.env,
    }))
  }

  const fillPassword = () => {
    const pwd = randomPassword()
    setForm((cur) => {
      const line = `POSTGRES_PASSWORD=${pwd}`
      const env = /^POSTGRES_PASSWORD=.*$/m.test(cur.env)
        ? cur.env.replace(/^POSTGRES_PASSWORD=.*$/m, line)
        : `${cur.env}${cur.env.trim() ? '\n' : ''}${line}`
      return { ...cur, env }
    })
    onToast('已生成随机密码，请记得保存')
  }

  const submit = useCallback(async () => {
    if (creating) return
    if (!serverId) {
      setFormError('请先添加服务器')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      const { app } = await api.createApp({
        serverId,
        kind,
        name: form.name.trim(),
        image: form.image.trim(),
        domain: kind === 'image' ? form.domain.trim() : undefined,
        port: Number(form.port) || (kind === 'service' ? 5432 : 80),
        env: form.env,
        notes: form.notes.trim(),
        alias: kind === 'service' ? form.alias.trim() : undefined,
        dataDir: kind === 'service' ? form.dataDir.trim() || undefined : undefined,
        containerPath: kind === 'service' ? form.containerPath.trim() : undefined,
        dataOwner: kind === 'service' ? form.dataOwner.trim() : undefined,
        healthCmd: kind === 'service' ? form.healthCmd.trim() : undefined,
      })
      setApps((prev) => [app, ...prev])
      setForm(EMPTY_FORM)
      onCloseCreate()
      onToast(kind === 'service' ? '共享服务已创建，可以开始部署' : '应用已创建，可以开始部署')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [creating, form, kind, onCloseCreate, onToast, serverId])

  return (
    <div className="apps-page">
      <div className="apps-head">
        <div>
          <p className="eyebrow">Apps</p>
          <h2 className="apps-title">应用</h2>
          <p className="apps-sub">Web 应用经 Traefik 暴露域名；共享服务只挂 shared-net，不暴露公网。</p>
        </div>
        <button className="btn primary" onClick={onOpenCreate} disabled={!servers.length}>
          <PlusIcon /> 新建
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
            <ContainerIcon />
          </div>
          <h3>还没有应用</h3>
          <p>
            {servers.length
              ? '新建一个 Web 应用或共享服务（如 PostgreSQL），部署到服务器。'
              : '先到「服务器」页添加并初始化一台服务器。'}
          </p>
          {servers.length ? (
            <button className="btn primary" onClick={onOpenCreate}>
              <PlusIcon /> 新建
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
            const isService = app.kind === 'service'
            return (
              <article key={app.id} className="glass-lite app-card reveal">
                <div className="app-card-head">
                  <div>
                    <h3 className="app-name">
                      {app.name}
                      {isService && <span className="app-tag">共享服务</span>}
                    </h3>
                    {isService ? (
                      <span className="app-domain mono">
                        {app.service?.alias || `ourjia_${app.id}`}:{app.runtime.port}
                      </span>
                    ) : (
                      <a className="app-domain mono" href={`https://${app.domain}`} target="_blank" rel="noreferrer">
                        {app.domain}
                      </a>
                    )}
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
                    <dt>镜像</dt>
                    <dd className="mono" title={app.image || undefined}>
                      {app.image || '示例构建'}
                    </dd>
                  </div>
                  <div>
                    <dt>{isService ? '数据目录' : '部署时间'}</dt>
                    <dd className="mono" title={isService ? app.service?.dataDir : undefined}>
                      {isService
                        ? app.service?.dataDir || '—'
                        : app.delivery.deployedAt
                          ? new Date(app.delivery.deployedAt).toLocaleString()
                          : '—'}
                    </dd>
                  </div>
                </dl>

                {app.notes && <p className="app-notes">{app.notes}</p>}
                {app.envKeys.length > 0 && <p className="app-notes">环境变量：{app.envKeys.join('、')}</p>}
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
                        <DeployIcon /> {app.status === 'running' ? '重新部署' : '部署'}
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

      <Modal open={createOpen} onClose={onCloseCreate} title="新建应用">
        <div className="form-grid">
          <div className="segmented">
            <button type="button" className={kind === 'image' ? 'active' : ''} onClick={() => setKind('image')}>
              Web 应用
            </button>
            <button type="button" className={kind === 'service' ? 'active' : ''} onClick={() => setKind('service')}>
              共享服务
            </button>
          </div>

          {kind === 'service' && (
            <button type="button" className="link-btn" onClick={applyPostgres}>
              填入 PostgreSQL 默认值
            </button>
          )}

          <div className="field">
            <label>名称</label>
            <input value={form.name} onChange={(e) => setField('name', e.target.value)} placeholder="例如 主数据库" />
          </div>

          <div className="field">
            <label>Docker 镜像地址</label>
            <input
              value={form.image}
              onChange={(e) => setField('image', e.target.value)}
              placeholder={kind === 'service' ? 'postgres:16-alpine' : 'registry.example.com/team/app:v1'}
            />
            <p className="form-hint">
              {kind === 'service'
                ? '服务器会直接拉取镜像；私有仓库需提前在服务器上 docker login。'
                : '服务器会直接拉取这个镜像，私有仓库需提前在服务器上 docker login。'}
            </p>
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

          {kind === 'image' ? (
            <div className="field-row-split">
              <div className="field">
                <label>域名</label>
                <input value={form.domain} onChange={(e) => setField('domain', e.target.value)} placeholder="app.example.com" />
              </div>
              <div className="field">
                <label>容器端口</label>
                <input type="number" min={1} max={65535} value={form.port} onChange={(e) => setField('port', e.target.value)} />
              </div>
            </div>
          ) : (
            <>
              <div className="field-row-split">
                <div className="field">
                  <label>网络别名（可选）</label>
                  <input value={form.alias} onChange={(e) => setField('alias', e.target.value)} placeholder="postgres" />
                </div>
                <div className="field">
                  <label>服务端口</label>
                  <input type="number" min={1} max={65535} value={form.port} onChange={(e) => setField('port', e.target.value)} />
                </div>
              </div>
              <p className="form-hint">同一服务器上别名唯一，应用内通过「别名:端口」访问，例如 postgres:5432。</p>

              <div className="field">
                <label>数据目录（宿主机）</label>
                <input
                  value={form.dataDir}
                  onChange={(e) => setField('dataDir', e.target.value)}
                  placeholder="留空则使用 /srv/data/<应用 ID>"
                />
              </div>
              <div className="field">
                <label>容器内数据路径</label>
                <input
                  value={form.containerPath}
                  onChange={(e) => setField('containerPath', e.target.value)}
                  placeholder="/var/lib/postgresql/data"
                />
              </div>

              <div className="field-row-split">
                <div className="field">
                  <label>目录所有者（可选）</label>
                  <input value={form.dataOwner} onChange={(e) => setField('dataOwner', e.target.value)} placeholder="999:999" />
                </div>
                <div className="field">
                  <label>健康检查命令（可选）</label>
                  <input
                    value={form.healthCmd}
                    onChange={(e) => setField('healthCmd', e.target.value)}
                    placeholder="pg_isready -U appuser -d appdb"
                  />
                </div>
              </div>
              <p className="form-hint">目录所有者只在数据目录为空时应用；官方 postgres 镜像会自行处理权限，通常留空。</p>
            </>
          )}
          {kind === 'image' && <p className="form-hint">域名解析由你自行配置；未解析时 HTTPS 会显示警告，不影响容器启动。</p>}

          <div className="field">
            <label>环境变量（可选）</label>
            <textarea
              rows={4}
              value={form.env}
              onChange={(e) => setField('env', e.target.value)}
              placeholder={'每行一个 KEY=VALUE\nPOSTGRES_DB=appdb\nPOSTGRES_USER=appuser\nPOSTGRES_PASSWORD=...'}
            />
            <div className="env-hint-row">
              <span className="form-hint">保存时整体加密，部署时写入容器；日志中只显示变量名。</span>
              {kind === 'service' && (
                <button type="button" className="link-btn" onClick={fillPassword}>
                  生成随机密码
                </button>
              )}
            </div>
          </div>

          <div className="field">
            <label>备注（可选）</label>
            <textarea
              rows={2}
              value={form.notes}
              onChange={(e) => setField('notes', e.target.value)}
              placeholder="用途、负责人、上线注意事项…"
            />
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
