import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import type { AppRecord, AppTemplate, EnvEntry, ServerRecord, UpdateAppPayload } from '../types'
import { Modal } from '../components/Modal'
import { TerminalLog, type TerminalLine } from '../components/TerminalLog'
import { PageHeader } from '../components/PageHeader'
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
  stopped: { cls: 'st-stop', label: '已停止' },
  failed: { cls: 'st-err', label: '部署失败' },
}

const EMPTY_FORM = {
  name: '',
  image: '',
  domain: '',
  port: '80',
  notes: '',
  alias: '',
  dataDir: '',
  containerPath: '',
  dataOwner: '',
  healthCmd: '',
}

function randomPassword() {
  const bytes = crypto.getRandomValues(new Uint8Array(24))
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 24)
}

function randomSecret() {
  const bytes = crypto.getRandomValues(new Uint8Array(48))
  return Array.from(bytes, (b) => b.toString(36).padStart(2, '0')).join('').slice(0, 64)
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
  const [healthPath, setHealthPath] = useState('/')
  const [mediaEnabled, setMediaEnabled] = useState(false)
  const [mediaMount, setMediaMount] = useState('/data/media')
  const [mediaUrl, setMediaUrl] = useState('/media/')
  const [mediaOwner, setMediaOwner] = useState('')
  const [editing, setEditing] = useState<AppRecord | null>(null)
  const [templates, setTemplates] = useState<AppTemplate[]>([])
  const [templateId, setTemplateId] = useState<string | null>(null)
  const [envRows, setEnvRows] = useState<EnvEntry[]>([])
  const [envLoaded, setEnvLoaded] = useState(false)

  const [deleteTarget, setDeleteTarget] = useState<AppRecord | null>(null)
  const [cleanup, setCleanup] = useState(true)
  const [removeData, setRemoveData] = useState(false)
  const [deleting, setDeleting] = useState(false)

  const [stopTarget, setStopTarget] = useState<AppRecord | null>(null)
  const [stopping, setStopping] = useState(false)
  const [startingId, setStartingId] = useState<string | null>(null)

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
    api
      .listTemplates()
      .then(({ templates: list }) => setTemplates(list))
      .catch(() => {
        /* 模板加载失败时仍可手动填写 */
      })
  }, [])

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

  const askRemove = useCallback((app: AppRecord) => {
    setDeleteTarget(app)
    setCleanup(true)
    setRemoveData(false)
  }, [])

  const confirmRemove = useCallback(async () => {
    if (!deleteTarget || deleting) return
    setDeleting(true)
    try {
      await api.deleteApp(deleteTarget.id, { cleanup, data: cleanup && removeData })
      setApps((prev) => prev.filter((a) => a.id !== deleteTarget.id))
      onToast(cleanup ? '应用及服务器资源已清理' : '应用记录已删除，服务器资源保留')
      setDeleteTarget(null)
    } catch (e) {
      onToast(e instanceof Error ? e.message : '删除失败')
    } finally {
      setDeleting(false)
    }
  }, [cleanup, deleteTarget, deleting, onToast, removeData])

  const confirmStop = useCallback(async () => {
    if (!stopTarget || stopping) return
    setStopping(true)
    try {
      const { app: updated } = await api.stopApp(stopTarget.id)
      setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
      setStopTarget(null)
      onToast(`服务「${updated.name}」已停止`)
    } catch (e) {
      onToast(e instanceof Error ? e.message : '停止失败')
    } finally {
      setStopping(false)
    }
  }, [onToast, stopTarget, stopping])

  const startService = useCallback(
    async (app: AppRecord) => {
      if (busyId || startingId) return
      setStartingId(app.id)
      try {
        const { app: updated } = await api.startApp(app.id)
        setApps((prev) => prev.map((a) => (a.id === updated.id ? updated : a)))
        onToast(`服务「${updated.name}」已启动`)
      } catch (e) {
        onToast(e instanceof Error ? e.message : '启动失败')
      } finally {
        setStartingId(null)
      }
    },
    [busyId, onToast, startingId],
  )

  const setField = (key: keyof typeof EMPTY_FORM, value: string) => {
    setForm((cur) => ({ ...cur, [key]: value }))
  }

  const applyTemplate = (template: AppTemplate) => {
    setTemplateId(template.id)
    setKind(template.kind)
    const secret = randomSecret()
    setForm((cur) => ({
      ...EMPTY_FORM,
      name: cur.name,
      domain: cur.domain,
      notes: cur.notes,
      image: template.defaults.image || '',
      port: String(template.defaults.port ?? (template.kind === 'service' ? 5432 : 80)),
      alias: template.defaults.alias || '',
      containerPath: template.defaults.containerPath || '',
      healthCmd: template.defaults.healthCmd || '',
    }))
    setEnvRows(
      template.env.map((entry) => ({
        key: entry.key,
        values: [(entry.value ?? entry.template ?? '').replaceAll('{{secret}}', secret)],
        note: '',
      })),
    )
    setEnvLoaded(true)
    if (template.kind === 'image') {
      setHealthPath(template.defaults.healthPath || '/')
      const volume = template.defaults.volumes?.[0]
      setMediaEnabled(Boolean(volume))
      setMediaMount(volume?.mountPath || '/data/media')
      setMediaUrl(volume?.serveUrl || '/media/')
      setMediaOwner('')
    } else {
      setHealthPath('/')
      setMediaEnabled(false)
    }
  }

  const fillPassword = () => {
    const pwd = randomPassword()
    setEnvRows((rows) => {
      const idx = rows.findIndex((row) => row.key === 'POSTGRES_PASSWORD')
      if (idx >= 0) return rows.map((row, i) => (i === idx ? { ...row, values: [pwd] } : row))
      return [...rows, { key: 'POSTGRES_PASSWORD', values: [pwd], note: '数据库密码' }]
    })
    onToast('已生成随机密码，请记得保存')
  }

  const addEnvRow = () => setEnvRows((rows) => [...rows, { key: '', values: [''], note: '' }])
  const removeEnvRow = (index: number) => setEnvRows((rows) => rows.filter((_, i) => i !== index))
  const updateEnvRow = (index: number, patch: Partial<EnvEntry>) =>
    setEnvRows((rows) => rows.map((row, i) => (i === index ? { ...row, ...patch } : row)))
  const addEnvValue = (index: number) =>
    setEnvRows((rows) => rows.map((row, i) => (i === index ? { ...row, values: [...row.values, ''] } : row)))
  const updateEnvValue = (index: number, valueIndex: number, value: string) =>
    setEnvRows((rows) =>
      rows.map((row, i) =>
        i === index ? { ...row, values: row.values.map((v, j) => (j === valueIndex ? value : v)) } : row,
      ),
    )
  const removeEnvValue = (index: number, valueIndex: number) =>
    setEnvRows((rows) =>
      rows.map((row, i) =>
        i === index ? { ...row, values: row.values.filter((_, j) => j !== valueIndex) } : row,
      ),
    )

  const resetForm = () => {
    setForm(EMPTY_FORM)
    setHealthPath('/')
    setMediaEnabled(false)
    setMediaMount('/data/media')
    setMediaUrl('/media/')
    setMediaOwner('')
    setEnvRows([])
    setEnvLoaded(false)
  }

  const openEdit = (app: AppRecord) => {
    setEditing(app)
    setKind(app.kind)
    setFormError(null)
    setForm({
      ...EMPTY_FORM,
      name: app.name,
      image: app.image || '',
      domain: app.domain || '',
      port: String(app.runtime.port),
      notes: app.notes || '',
      alias: app.service?.alias || '',
      dataDir: app.service?.dataDir || '',
      containerPath: app.service?.containerPath || '',
      dataOwner: app.service?.dataOwner || '',
      healthCmd: app.service?.healthCmd || '',
    })
    setEnvRows([])
    setEnvLoaded(false)
    setHealthPath(app.runtime.healthPath || '/')
    const volume = app.volumes?.[0]
    setMediaEnabled(Boolean(volume))
    setMediaMount(volume?.mountPath || '/data/media')
    setMediaUrl(volume?.serveUrl || '/media/')
    setMediaOwner(volume?.owner || '')
    api
      .getAppEnv(app.id)
      .then(({ env }) => {
        setEnvRows(env)
        setEnvLoaded(true)
      })
      .catch(() => {
        onToast('环境变量读取失败，本次保存将保留原环境变量')
      })
  }

  const closeForm = () => {
    setEditing(null)
    resetForm()
    setFormError(null)
    onCloseCreate()
  }

  const submit = useCallback(async () => {
    if (creating) return
    if (!editing && !serverId) {
      setFormError('请先添加服务器')
      return
    }
    setCreating(true)
    setFormError(null)
    try {
      const domain = form.domain.trim()
      const env: EnvEntry[] = envRows
        .filter((row) => row.key.trim())
        .map((row) => ({
          key: row.key.trim(),
          values: (row.values.length ? row.values : ['']).map((value) => value.replaceAll('{{domain}}', domain)),
          note: row.note.trim(),
        }))
      const volumes =
        kind === 'image' && mediaEnabled
          ? [
              {
                name: 'media',
                mountPath: mediaMount.trim(),
                serveUrl: mediaUrl.trim() || null,
                owner: mediaOwner.trim() || null,
              },
            ]
          : []

      if (editing) {
        const payload: UpdateAppPayload = {
          name: form.name.trim(),
          image: form.image.trim(),
          port: Number(form.port) || (kind === 'service' ? 5432 : 80),
          notes: form.notes.trim(),
        }
        if (envLoaded || envRows.length > 0) payload.env = env
        if (kind === 'service') {
          Object.assign(payload, {
            alias: form.alias.trim(),
            dataDir: form.dataDir.trim() || undefined,
            containerPath: form.containerPath.trim(),
            dataOwner: form.dataOwner.trim(),
            healthCmd: form.healthCmd.trim(),
          })
        } else {
          Object.assign(payload, {
            domain,
            healthPath,
            volumes,
          })
        }
        const { app } = await api.updateApp(editing.id, payload)
        setApps((prev) => prev.map((a) => (a.id === app.id ? app : a)))
        closeForm()
        onToast('配置已保存，重新部署后生效')
        return
      }

      const { app } = await api.createApp({
        serverId,
        kind,
        name: form.name.trim(),
        image: form.image.trim(),
        domain: kind === 'image' ? domain : undefined,
        port: Number(form.port) || (kind === 'service' ? 5432 : 80),
        env,
        notes: form.notes.trim(),
        healthPath: kind === 'image' ? healthPath : undefined,
        volumes,
        alias: kind === 'service' ? form.alias.trim() : undefined,
        dataDir: kind === 'service' ? form.dataDir.trim() || undefined : undefined,
        containerPath: kind === 'service' ? form.containerPath.trim() : undefined,
        dataOwner: kind === 'service' ? form.dataOwner.trim() : undefined,
        healthCmd: kind === 'service' ? form.healthCmd.trim() : undefined,
      })
      setApps((prev) => [app, ...prev])
      closeForm()
      onToast(kind === 'service' ? '共享服务已创建，可以开始部署' : '应用已创建，可以开始部署')
    } catch (e) {
      setFormError(e instanceof Error ? e.message : editing ? '保存失败' : '创建失败')
    } finally {
      setCreating(false)
    }
  }, [creating, editing, envLoaded, envRows, form, kind, healthPath, mediaEnabled, mediaMount, mediaOwner, mediaUrl, onCloseCreate, onToast, serverId])

  return (
    <div className="page">
      <PageHeader
        title="应用"
        subtitle="Web 应用经 Traefik 暴露域名；共享服务只挂 shared-net，不暴露公网。"
      >
        <button className="btn primary" onClick={onOpenCreate} disabled={!servers.length}>
          <PlusIcon />
          新建应用
        </button>
      </PageHeader>

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
              ? '点击右上角「新建应用」，创建 Web 应用或共享服务（如 PostgreSQL）。'
              : '先到「服务器」页添加并初始化一台服务器。'}
          </p>
          {!servers.length && (
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
            const stopped = app.status === 'stopped'
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
                      {app.image || '—'}
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
                {app.envKeys.length > 0 && (
                  <p className="app-notes" title={app.envKeys.join('、')}>
                    环境变量：
                    {app.envKeys.length > 4
                      ? `${app.envKeys.slice(0, 4).join('、')} 等 ${app.envKeys.length} 个`
                      : app.envKeys.join('、')}
                  </p>
                )}
                {app.volumes?.some((v) => v.serveUrl) && (
                  <p className="app-notes">
                    媒体：{app.volumes.filter((v) => v.serveUrl).map((v) => v.serveUrl).join('、')}
                  </p>
                )}
                {app.warning && <p className="app-note warn">{app.warning}</p>}
                {app.lastError && <p className="app-note err">{app.lastError}</p>}

                <div className="app-actions">
                  {stopped ? (
                    <button
                      className="btn primary sm"
                      onClick={() => startService(app)}
                      disabled={deploying || Boolean(busyId) || Boolean(startingId) || stopping}
                    >
                      {startingId === app.id ? (
                        <>
                          <span className="spinner" /> 启动中…
                        </>
                      ) : (
                        <>
                          <DeployIcon /> 启动
                        </>
                      )}
                    </button>
                  ) : (
                    <button
                      className="btn primary sm"
                      onClick={() => deploy(app)}
                      disabled={deploying || Boolean(busyId) || Boolean(startingId) || stopping}
                    >
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
                  )}
                  {stopped && (
                    <button
                      className="btn ghost sm"
                      onClick={() => deploy(app)}
                      disabled={deploying || Boolean(busyId) || Boolean(startingId) || stopping}
                    >
                      重新部署
                    </button>
                  )}
                  {app.status === 'running' && (
                    <button
                      className="btn ghost sm"
                      onClick={() => setStopTarget(app)}
                      disabled={deploying || Boolean(busyId) || Boolean(startingId) || stopping}
                    >
                      停止
                    </button>
                  )}
                  <button
                    className="btn ghost sm"
                    onClick={() => openEdit(app)}
                    disabled={deploying || Boolean(startingId) || stopping}
                  >
                    编辑
                  </button>
                  <button
                    className="btn ghost sm"
                    onClick={() => askRemove(app)}
                    disabled={deploying || Boolean(startingId) || stopping}
                  >
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

      <Modal
        open={createOpen || Boolean(editing)}
        onClose={closeForm}
        title={editing ? `编辑 · ${editing.name}` : '新建应用'}
      >
        <div className="form-grid">
          {!editing && (
            <div className="segmented">
              <button
                type="button"
                className={kind === 'image' ? 'active' : ''}
                onClick={() => {
                  setKind('image')
                  setTemplateId(null)
                }}
              >
                Web 应用
              </button>
              <button
                type="button"
                className={kind === 'service' ? 'active' : ''}
                onClick={() => {
                  setKind('service')
                  setTemplateId(null)
                }}
              >
                共享服务
              </button>
            </div>
          )}

          {!editing && (
            <div className="preset-row">
              <span className="form-hint">模板：</span>
              {templates
                .filter((t) => t.kind === kind)
                .map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    className={`link-btn${templateId === t.id ? ' active' : ''}`}
                    onClick={() => applyTemplate(t)}
                  >
                    {t.label}
                  </button>
                ))}
              {templates.length === 0 && <span className="form-hint">加载中…</span>}
            </div>
          )}
          {!editing && templateId && (
            <p className="form-hint">{templates.find((t) => t.id === templateId)?.description}</p>
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

          {!editing && (
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
          )}

          {kind === 'image' ? (
            <>
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

              <div className="field">
                <label>健康检查路径</label>
                <input value={healthPath} onChange={(e) => setHealthPath(e.target.value)} placeholder="/" />
                <p className="form-hint">部署后按此路径经 Traefik 检查，应返回 2xx/3xx；默认 /。</p>
              </div>

              <div className="field">
                <label className="check-row">
                  <input
                    type="checkbox"
                    checked={mediaEnabled}
                    onChange={(e) => setMediaEnabled(e.target.checked)}
                  />
                  <span>媒体目录（上传文件持久化，并由 nginx 提供访问）</span>
                </label>
                {mediaEnabled && (
                  <>
                    <div className="field-row-split">
                      <div className="field">
                        <label>容器内路径</label>
                        <input value={mediaMount} onChange={(e) => setMediaMount(e.target.value)} placeholder="/data/media" />
                      </div>
                      <div className="field">
                        <label>访问 URL</label>
                        <input value={mediaUrl} onChange={(e) => setMediaUrl(e.target.value)} placeholder="/media/" />
                      </div>
                    </div>
                    <div className="field">
                      <label>目录所有者（可选）</label>
                      <input value={mediaOwner} onChange={(e) => setMediaOwner(e.target.value)} placeholder="1000:1000" />
                    </div>
                    <p className="form-hint">
                      平台会创建 /srv/data/&lt;应用ID&gt;/media 并挂载；填写 URL 后自动生成 nginx sidecar。
                    </p>
                  </>
                )}
              </div>
            </>
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
            <div className="env-editor">
              {envRows.map((row, index) => (
                <div className="env-row" key={index}>
                  <input
                    className="env-key mono"
                    value={row.key}
                    placeholder="变量名"
                    onChange={(e) => updateEnvRow(index, { key: e.target.value })}
                  />
                  <div className="env-values">
                    {row.values.map((value, valueIndex) => (
                      <div className="env-value" key={valueIndex}>
                        <input
                          className="mono"
                          value={value}
                          placeholder="变量值"
                          onChange={(e) => updateEnvValue(index, valueIndex, e.target.value)}
                        />
                        {row.values.length > 1 && (
                          <button
                            type="button"
                            className="env-row-btn"
                            title="删除这个值"
                            onClick={() => removeEnvValue(index, valueIndex)}
                          >
                            −
                          </button>
                        )}
                      </div>
                    ))}
                    <button type="button" className="link-btn" onClick={() => addEnvValue(index)}>
                      + 多值
                    </button>
                  </div>
                  <input
                    className="env-note"
                    value={row.note}
                    placeholder="备注"
                    onChange={(e) => updateEnvRow(index, { note: e.target.value })}
                  />
                  <button type="button" className="env-row-btn" title="删除变量" onClick={() => removeEnvRow(index)}>
                    ×
                  </button>
                </div>
              ))}
              <button type="button" className="link-btn" onClick={addEnvRow}>
                + 添加变量
              </button>
            </div>
            <div className="env-hint-row">
              <span className="form-hint">多值会用逗号连接成一个变量（如 ALLOWED_HOSTS=a,b）；保存时整体加密。</span>
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
            <button className="btn ghost" onClick={closeForm} disabled={creating}>
              取消
            </button>
            <button className="btn primary" onClick={submit} disabled={creating || (!editing && !servers.length)}>
              {creating ? (
                <>
                  <span className="spinner" /> {editing ? '保存中…' : '创建中…'}
                </>
              ) : editing ? (
                '保存'
              ) : (
                '创建'
              )}
            </button>
          </div>
        </div>
      </Modal>

      <Modal
        open={Boolean(stopTarget)}
        onClose={() => {
          if (!stopping) setStopTarget(null)
        }}
        title={stopTarget?.kind === 'service' ? '停止服务' : '停止应用'}
      >
        {stopTarget && (
          <div className="form-grid">
            <p className="confirm-lede">
              {stopTarget.kind === 'service' ? '停止共享服务 ' : '停止应用 '}
              <strong>{stopTarget.name}</strong>（
              {stopTarget.kind === 'service'
                ? `${stopTarget.service?.alias || `ourjia_${stopTarget.id}`}:${stopTarget.runtime.port}`
                : stopTarget.domain || stopTarget.image || stopTarget.id}
              ）？
            </p>
            <p className="form-hint">
              容器会停止，
              {stopTarget.kind === 'service' ? (
                <>
                  数据目录 <code>{stopTarget.service?.dataDir || '—'}</code> 会保留；依赖该服务的应用将暂时无法连接。
                </>
              ) : (
                <>部署目录与数据卷会保留；期间域名 {stopTarget.domain || '—'} 无法访问。</>
              )}
              之后点「启动」即可重新拉起；需要应用配置变更时用「重新部署」。
            </p>
            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setStopTarget(null)} disabled={stopping}>
                取消
              </button>
              <button className="btn danger" onClick={confirmStop} disabled={stopping}>
                {stopping ? (
                  <>
                    <span className="spinner" /> 停止中…
                  </>
                ) : (
                  '停止'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>

      <Modal open={Boolean(deleteTarget)} onClose={() => setDeleteTarget(null)} title="删除应用">
        {deleteTarget && (
          <div className="form-grid">
            <p className="confirm-lede">
              删除 <strong>{deleteTarget.name}</strong>（{deleteTarget.domain || deleteTarget.service?.alias || deleteTarget.id}）？
            </p>

            <label className="check-row">
              <input type="checkbox" checked={cleanup} onChange={(e) => setCleanup(e.target.checked)} />
              <span>
                同时停止容器并删除服务器上的部署目录
                <code>/srv/apps/{deleteTarget.id}</code>
              </span>
            </label>

            {deleteTarget.kind === 'service' && (
              <label className={`check-row${removeData ? ' danger' : ''}`}>
                <input
                  type="checkbox"
                  checked={removeData}
                  disabled={!cleanup}
                  onChange={(e) => setRemoveData(e.target.checked)}
                />
                <span>
                  同时删除数据目录 <code>{deleteTarget.service?.dataDir}</code>（不可恢复）
                </span>
              </label>
            )}

            {deleteTarget.kind === 'image' && deleteTarget.volumes?.length > 0 && (
              <label className={`check-row${removeData ? ' danger' : ''}`}>
                <input
                  type="checkbox"
                  checked={removeData}
                  disabled={!cleanup}
                  onChange={(e) => setRemoveData(e.target.checked)}
                />
                <span>
                  同时删除媒体目录{' '}
                  <code>{deleteTarget.volumes.map((v) => v.hostPath).join('、')}</code>（不可恢复）
                </span>
              </label>
            )}

            <p className="form-hint">
              {cleanup
                ? '容器会先 docker compose down，再删除部署目录；共享服务的数据目录默认保留。'
                : '仅删除本地记录，服务器上的容器和目录会保留，需要你手工清理。'}
            </p>

            <div className="modal-foot">
              <button className="btn ghost" onClick={() => setDeleteTarget(null)} disabled={deleting}>
                取消
              </button>
              <button className="btn danger" onClick={confirmRemove} disabled={deleting}>
                {deleting ? (
                  <>
                    <span className="spinner" /> 删除中…
                  </>
                ) : (
                  '删除'
                )}
              </button>
            </div>
          </div>
        )}
      </Modal>
    </div>
  )
}
