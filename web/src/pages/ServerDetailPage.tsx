import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import type {
  CheckItem,
  CheckReport,
  JobSnapshot,
  JobStep,
  ServerConfig,
  ServerRecord,
  ServerResources,
} from '../types'
import { ConfigModal } from '../components/ConfigModal'
import { Modal } from '../components/Modal'
import { TerminalLog, type TerminalLine } from '../components/TerminalLog'
import { CheckIcon, ChevronIcon, RefreshIcon, ServerIcon } from '../icons'

interface ServerDetailPageProps {
  server: ServerRecord
  onBack: () => void
  onServerUpdate: (server: ServerRecord) => void
  onToast: (msg: string) => void
}

type Tab = 'overview' | 'checks' | 'init' | 'resources' | 'logs'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'checks', label: '检查' },
  { key: 'init', label: '初始化' },
  { key: 'resources', label: '资源' },
  { key: 'logs', label: '日志' },
]

const STATUS_TEXT: Record<CheckItem['status'], string> = { ok: '正常', warn: '注意', fail: '失败' }

const DIR_LABEL: Record<'apps' | 'git' | 'data', string> = {
  apps: '部署目录',
  git: '交付仓库',
  data: '数据目录',
}

function stateBadge(server: ServerRecord) {
  const init = server.init
  if (!init || init.state === 'unknown') return { cls: 'st-stop', label: '未检查' }
  if (init.state === 'ready') return { cls: 'st-run', label: '已初始化' }
  if (init.state === 'drifted') return { cls: 'st-orphan', label: '配置已变更' }
  return { cls: 'st-stop', label: '未初始化' }
}

function fmtTime(iso: string | null | undefined) {
  if (!iso) return '—'
  try {
    return new Date(iso).toLocaleString()
  } catch {
    return iso
  }
}

function stepIcon(status: JobStep['status']) {
  if (status === 'done') return <CheckIcon />
  if (status === 'running') return <span className="spinner" />
  if (status === 'failed') return <span className="step-x">!</span>
  return <span className="step-dot" />
}

export function ServerDetailPage({ server, onBack, onServerUpdate, onToast }: ServerDetailPageProps) {
  const [tab, setTab] = useState<Tab>('overview')
  const [config, setConfig] = useState<ServerConfig | null>(server.config ?? null)
  const [configOpen, setConfigOpen] = useState(false)

  const [report, setReport] = useState<CheckReport | null>(null)
  const [checking, setChecking] = useState(false)
  const [checkError, setCheckError] = useState<string | null>(null)

  const [job, setJob] = useState<JobSnapshot | null>(null)
  const [logs, setLogs] = useState<TerminalLine[]>([])
  const [confirmInit, setConfirmInit] = useState(false)
  const [initMode, setInitMode] = useState<'init' | 'apply'>('init')
  const unsubRef = useRef<(() => void) | null>(null)

  const [resources, setResources] = useState<ServerResources | null>(null)
  const [loadingResources, setLoadingResources] = useState(false)
  const [resourcesError, setResourcesError] = useState<string | null>(null)
  const [selectedResources, setSelectedResources] = useState<Set<string>>(new Set())
  const [cleanupOpen, setCleanupOpen] = useState(false)
  const [cleaning, setCleaning] = useState(false)

  const running = job?.status === 'running' || job?.status === 'pending'

  useEffect(() => {
    setConfig(server.config ?? null)
  }, [server.config])

  useEffect(() => {
    return () => unsubRef.current?.()
  }, [])

  const runCheck = useCallback(
    async (refreshMirrors = false, quiet = false) => {
      setChecking(true)
      setCheckError(null)
      try {
        const result = await api.runCheck(server.id, refreshMirrors)
        setReport(result)
        if (result.server) onServerUpdate(result.server)
        if (!quiet) onToast(result.initialized ? '检查完成' : '检查完成，服务器尚未初始化')
      } catch (e) {
        const msg = e instanceof Error ? e.message : '检查失败'
        setCheckError(msg)
        onToast(msg)
      } finally {
        setChecking(false)
      }
    },
    [server.id, onServerUpdate, onToast],
  )

  useEffect(() => {
    if (!report && !checking && !checkError) {
      runCheck(false, true)
    }
  }, [report, checking, checkError, runCheck])

  const loadResources = useCallback(
    async (quiet = false) => {
      setLoadingResources(true)
      setResourcesError(null)
      try {
        const data = await api.getServerResources(server.id)
        setResources(data)
        setSelectedResources(new Set())
        if (!quiet) onToast('资源已刷新')
      } catch (e) {
        const msg = e instanceof Error ? e.message : '资源扫描失败'
        setResourcesError(msg)
        onToast(msg)
      } finally {
        setLoadingResources(false)
      }
    },
    [server.id, onToast],
  )

  useEffect(() => {
    if (tab === 'resources' && !resources && !loadingResources && !resourcesError) {
      loadResources(true)
    }
  }, [tab, resources, loadingResources, resourcesError, loadResources])

  const toggleResource = (key: string) => {
    setSelectedResources((prev) => {
      const next = new Set(prev)
      if (next.has(key)) next.delete(key)
      else next.add(key)
      return next
    })
  }

  const selectedContainers = useMemo(
    () => (resources?.orphans.containers || []).filter((c) => selectedResources.has(`c:${c.name}`)),
    [resources, selectedResources],
  )
  const selectedDirs = useMemo(
    () => (resources?.orphans.dirs || []).filter((d) => selectedResources.has(`d:${d.path}`)),
    [resources, selectedResources],
  )

  const runCleanup = useCallback(async () => {
    if (cleaning) return
    setCleaning(true)
    try {
      await api.cleanupServerResources(server.id, {
        containers: selectedContainers.map((c) => c.name),
        paths: selectedDirs.map((d) => d.path),
      })
      onToast('孤儿资源已清理')
      setCleanupOpen(false)
      await loadResources(true)
    } catch (e) {
      onToast(e instanceof Error ? e.message : '清理失败')
    } finally {
      setCleaning(false)
    }
  }, [cleaning, loadResources, onToast, selectedContainers, selectedDirs, server.id])

  const attachStream = useCallback(
    (jobId: string) => {
      unsubRef.current?.()
      unsubRef.current = api.streamJob(jobId, {
        onState: (snap) => {
          setJob((prev) => ({ ...snap, logs: prev?.logs ?? snap.logs }))
          if (snap.status === 'done') {
            onToast(
              snap.mode === 'apply' ? '配置变更已应用' : snap.mode === 'status' ? '已获取服务器状态' : '初始化完成',
            )
          }
          if (snap.status === 'failed') onToast(`执行失败：${snap.error || '未知错误'}`)
          if (snap.status === 'done' || snap.status === 'failed') {
            runCheck(false, true)
          }
        },
        onStep: (step) => {
          setJob((prev) =>
            prev ? { ...prev, steps: prev.steps.map((s) => (s.id === step.id ? step : s)) } : prev,
          )
        },
        onLog: (log) => setLogs((prev) => [...prev.slice(-3000), log]),
      })
    },
    [onToast, runCheck],
  )

  const startInit = useCallback(
    async (mode: 'init' | 'apply') => {
      if (!config) return
      setConfirmInit(false)
      setLogs([])
      setTab('init')
      try {
        const { job: created } = await api.startInit(server.id, config, mode)
        setJob({ ...created, logs: [] })
        attachStream(created.id)
      } catch (e) {
        onToast(e instanceof Error ? e.message : '初始化启动失败')
      }
    },
    [config, server.id, attachStream, onToast],
  )

  const grouped = useMemo(() => {
    if (!report) return []
    const map = new Map<string, CheckItem[]>()
    for (const item of report.checks) {
      const list = map.get(item.group) || []
      list.push(item)
      map.set(item.group, list)
    }
    return report.groups.filter((g) => map.has(g)).map((g) => ({ group: g, items: map.get(g)! }))
  }, [report])

  const initChanges = useMemo(
    () => describeConfigChanges(report?.record?.config, config),
    [report, config],
  )

  const badge = stateBadge(server)
  const target = `${server.user}@${server.host}${server.port !== 22 ? `:${server.port}` : ''}`

  return (
    <div className="detail">
      <div className="detail-head">
        <button className="icon-btn sm back-btn" onClick={onBack} aria-label="返回">
          <ChevronIcon className="flip" />
        </button>
        <div>
          <p className="eyebrow">Server · {server.host}</p>
          <h1 className="detail-title">{server.name}</h1>
          <p className="detail-sub">
            <span className="mono">{target}</span>
            <span className="sep" />
            <span className={`status-pill ${badge.cls}`}>
              <i />
              {badge.label}
            </span>
            {server.init?.summary && (
              <>
                <span className="sep" />
                <span>
                  {server.init.summary.ok} 正常 · {server.init.summary.warn} 注意 ·{' '}
                  {server.init.summary.fail} 失败
                </span>
              </>
            )}
          </p>
        </div>
        <div className="detail-actions">
          <button className="btn ghost" onClick={() => setConfigOpen(true)}>
            配置
          </button>
          <button className="btn ghost" onClick={() => runCheck(true)} disabled={checking}>
            {checking ? <span className="spinner" /> : <RefreshIcon />}
            重新检查
          </button>
          {!report?.initialized ? (
            <button
              className="btn primary"
              onClick={() => {
                setInitMode('init')
                setConfirmInit(true)
              }}
              disabled={running || !config}
            >
              {running ? '初始化中…' : '开始初始化'}
            </button>
          ) : report.upToDate ? null : (
            <button
              className="btn primary"
              onClick={() => {
                setInitMode('apply')
                setConfirmInit(true)
              }}
              disabled={running || !config}
            >
              {running ? '执行中…' : '应用配置变更'}
            </button>
          )}
        </div>
      </div>

      <div className="tabs">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`tab${tab === t.key ? ' active' : ''}`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            {t.key === 'checks' && report && (
              <span className={`tab-count ${report.summary.fail ? 'bad' : report.summary.warn ? 'warn' : 'good'}`}>
                {report.summary.fail || report.summary.warn || report.summary.ok}
              </span>
            )}
            {t.key === 'logs' && logs.length > 0 && <span className="tab-count">{logs.length}</span>}
          </button>
        ))}
      </div>

      {tab === 'overview' && (
        <div className="panel-stack">
          <section className="glass-lite panel">
            <h2 className="panel-title">
              <ServerIcon /> 服务器
            </h2>
            <dl className="kv-grid">
              <div>
                <dt>系统</dt>
                <dd>{report?.facts?.OS_PRETTY || server.os || '—'}</dd>
              </div>
              <div>
                <dt>内核</dt>
                <dd className="mono">{report?.facts?.KERNEL || '—'}</dd>
              </div>
              <div>
                <dt>架构</dt>
                <dd className="mono">{report?.facts?.ARCH || '—'}</dd>
              </div>
              <div>
                <dt>内存</dt>
                <dd>{report?.facts?.MEM_TOTAL_MB ? `${report.facts.MEM_TOTAL_MB} MB` : '—'}</dd>
              </div>
              <div>
                <dt>Swap</dt>
                <dd>{report?.facts?.SWAP_TOTAL_MB !== undefined ? `${report.facts.SWAP_TOTAL_MB} MB` : '—'}</dd>
              </div>
              <div>
                <dt>Docker</dt>
                <dd>{String(report?.facts?.DOCKER_VERSION || '未安装')}</dd>
              </div>
              <div>
                <dt>Compose</dt>
                <dd className="mono">{String(report?.facts?.COMPOSE_VERSION || '—')}</dd>
              </div>
              <div>
                <dt>时区</dt>
                <dd>{String(report?.facts?.TZ || '—')}</dd>
              </div>
              <div>
                <dt>公网 IP</dt>
                <dd className="mono">{String(report?.facts?.PUBLIC_IP || '—')}</dd>
              </div>
              <div>
                <dt>地址池</dt>
                <dd className="mono">
                  {config?.advanced.dockerAddressPool ||
                    String(report?.facts?.DAEMON_JSON_POOLS || report?.record?.addressPool || '自动')}
                </dd>
              </div>
              <div>
                <dt>初始化</dt>
                <dd>{report?.record?.finishedAt ? fmtTime(report.record.finishedAt) : '未初始化'}</dd>
              </div>
            </dl>
          </section>

          <section className="glass-lite panel">
            <h2 className="panel-title">配置摘要</h2>
            <dl className="kv-grid">
              <div>
                <dt>镜像加速</dt>
                <dd>{config?.dockerHubMirrors.length ? config.dockerHubMirrors.join('、') : '直连官方'}</dd>
              </div>
              <div>
                <dt>apt 镜像</dt>
                <dd className="mono">{config?.aptMirror || '跟随系统'}</dd>
              </div>
              <div>
                <dt>Docker 源</dt>
                <dd>{config?.dockerInstallSource === 'auto' ? '自动（系统源优先）' : config?.dockerInstallSource === 'system' ? '系统源' : '官方源'}</dd>
              </div>
              <div>
                <dt>Swap 目标</dt>
                <dd>{config?.swapMb === 'auto' ? '自动' : `${config?.swapMb} MB`}</dd>
              </div>
              <div>
                <dt>vm.swappiness</dt>
                <dd>{config?.swappiness}</dd>
              </div>
              <div>
                <dt>Traefik</dt>
                <dd className="mono">{config?.traefikVersion}</dd>
              </div>
              <div>
                <dt>ACME</dt>
                <dd>
                  {config?.acme.ca === 'none'
                    ? '未启用'
                    : `${
                        config?.acme.ca === 'letsencrypt-staging' ? 'LE 测试环境' : "Let's Encrypt"
                      }${config?.acme.email ? ` · ${config.acme.email}` : ' · 邮箱待填'}`}
                </dd>
              </div>
              <div>
                <dt>容器 DNS</dt>
                <dd className="mono">{config?.advanced.containerDns?.join('、') || '自动探测'}</dd>
              </div>
            </dl>
          </section>
        </div>
      )}

      {tab === 'checks' && (
        <div className="panel-stack">
          {checking && !report && (
            <div className="glass-lite panel center-panel">
              <span className="spinner" /> 正在采集服务器状态…
            </div>
          )}
          {checkError && (
            <div className="glass-lite panel">
              <div className="form-error">{checkError}</div>
            </div>
          )}
          {report && (
            <>
              <div className="glass-lite panel check-summary">
                <div className="score">
                  <strong>{report.summary.ok}</strong>
                  <span>正常</span>
                </div>
                <div className="score warn">
                  <strong>{report.summary.warn}</strong>
                  <span>注意</span>
                </div>
                <div className="score fail">
                  <strong>{report.summary.fail}</strong>
                  <span>失败</span>
                </div>
                <div className="summary-note">
                  {report.upToDate
                    ? '服务器已按当前配置完成初始化。'
                    : report.initialized
                      ? '检测到配置与台账不一致，可在「初始化」中应用配置变更（只执行受影响步骤）。'
                      : '服务器尚未初始化，可前往「初始化」执行。'}
                </div>
              </div>

              {grouped.map(({ group, items }) => (
                <section key={group} className="glass-lite panel">
                  <h2 className="panel-title">{group}</h2>
                  <ul className="check-list">
                    {items.map((item) => (
                      <li key={item.id} className={`check-item ${item.status}`}>
                        <span className="check-mark" />
                        <div className="check-body">
                          <div className="check-line">
                            <strong>{item.label}</strong>
                            <span className={`check-tag ${item.status}`}>{STATUS_TEXT[item.status]}</span>
                          </div>
                          <p>{item.detail}</p>
                        </div>
                      </li>
                    ))}
                  </ul>
                </section>
              ))}
            </>
          )}
        </div>
      )}

      {tab === 'init' && (
        <div className="panel-stack">
          {!job && (
            <section className="glass-lite panel">
              {!report ? (
                <p className="init-lede">
                  <span className="spinner" /> 正在读取服务器状态…
                </p>
              ) : !report.initialized ? (
                <>
                  <p className="init-lede">
                    这台服务器还没有初始化台账。将依次完成：预检 → 基础工具/时区 → 安装 Docker → 目录与网络
                    → Traefik → 台账。
                  </p>
                  <button
                    className="btn primary"
                    onClick={() => {
                      setInitMode('init')
                      setConfirmInit(true)
                    }}
                    disabled={!config}
                  >
                    开始初始化
                  </button>
                </>
              ) : (
                <>
                  <h2 className="panel-title">服务器已初始化</h2>
                  <p className="init-lede">
                    台账完成于{' '}
                    {report.record?.finishedAt ? fmtTime(String(report.record.finishedAt)) : '未知'}。
                    已初始化的服务器不会再重复执行初始化步骤：不会重装 Docker、不会重新拉取 Traefik 镜像，
                    只会读取服务器状态。
                  </p>
                  {report.upToDate ? (
                    <p className="muted-note">当前配置与台账一致，没有需要应用的变更。</p>
                  ) : (
                    <>
                      <p className="muted-note">当前配置与台账不一致，只有下列变更会影响执行步骤：</p>
                      <ul className="confirm-list">
                        {(initChanges.length
                          ? initChanges
                          : ['配置指纹与台账不同（具体变更项无法从台账还原）']
                        ).map((c) => (
                          <li key={c}>{c}</li>
                        ))}
                      </ul>
                      <button
                        className="btn primary"
                        onClick={() => {
                          setInitMode('apply')
                          setConfirmInit(true)
                        }}
                        disabled={!config || running}
                      >
                        {running ? '执行中…' : '应用配置变更'}
                      </button>
                    </>
                  )}
                  <div className="res-actions" style={{ marginTop: 16 }}>
                    <button className="btn ghost" onClick={() => runCheck(true)} disabled={checking || running}>
                      {checking ? <span className="spinner" /> : <RefreshIcon />}
                      获取服务器状态
                    </button>
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setInitMode('init')
                        setConfirmInit(true)
                      }}
                      disabled={!config || running}
                    >
                      强制重新初始化…
                    </button>
                  </div>
                  <p className="form-hint">
                    「应用配置变更」只执行受影响步骤（例如只改 daemon.json 就只重载 Docker），不会重装组件；
                    「强制重新初始化」才会完整执行全部步骤，仅在服务器环境损坏时使用。
                  </p>
                </>
              )}
            </section>
          )}

          {job && (
            <section className="glass-lite panel">
              <h2 className="panel-title">执行进度</h2>
              <ol className="step-list">
                {job.steps.map((step) => (
                  <li key={step.id} className={`step-item ${step.status}`}>
                    <span className="step-icon">{stepIcon(step.status)}</span>
                    <div>
                      <strong>{step.title}</strong>
                      <span className="step-meta">
                        {step.status === 'running'
                          ? '进行中…'
                          : step.status === 'done'
                            ? `完成 ${step.finishedAt ? new Date(step.finishedAt).toLocaleTimeString() : ''}`
                            : step.status === 'failed'
                              ? step.error || '失败'
                              : '等待'}
                      </span>
                    </div>
                  </li>
                ))}
              </ol>
              {job.status === 'failed' && (
                <div className="form-error init-error">
                  执行失败：{job.error}
                  {job.currentStep && '，可从该步骤重试。'}
                </div>
              )}
              {job.status === 'done' && (
                <div className="init-success">
                  {job.mode === 'apply'
                    ? '配置变更已应用，台账已更新。'
                    : job.mode === 'status'
                      ? '已获取服务器状态，未做任何修改。'
                      : '初始化已完成，服务器已就绪。'}
                </div>
              )}
            </section>
          )}

          {logs.length > 0 && (
            <section className="glass-lite panel">
              <h2 className="panel-title">执行日志</h2>
              <TerminalLog lines={logs} title="初始化 · 终端输出" />
            </section>
          )}
        </div>
      )}

      {tab === 'resources' && (
        <div className="panel-stack">
          <section className="glass-lite panel">
            <div className="res-head">
              <div>
                <h2 className="panel-title">服务器资源</h2>
                <p className="muted-note">
                  扫描平台容器与 /srv 下的目录，标出不在应用记录里的资源。
                  {resources &&
                    ` 共 ${resources.containers.length} 个容器、${resources.dirs.length} 个目录。`}
                </p>
              </div>
              <button className="btn ghost" onClick={() => loadResources()} disabled={loadingResources}>
                {loadingResources ? <span className="spinner" /> : <RefreshIcon />}
                刷新
              </button>
            </div>
            {resourcesError && <div className="form-error">{resourcesError}</div>}
            {loadingResources && !resources && <p className="muted-note">正在扫描…</p>}
          </section>

          {resources && (
            <>
              <section className="glass-lite panel">
                <h2 className="panel-title">
                  孤儿资源
                  <span className="tab-count bad">
                    {resources.orphans.containers.length + resources.orphans.dirs.length}
                  </span>
                </h2>
                {resources.orphans.containers.length + resources.orphans.dirs.length === 0 ? (
                  <p className="muted-note">没有发现孤儿资源。</p>
                ) : (
                  <>
                    <ul className="res-list">
                      {resources.orphans.containers.map((c) => (
                        <li key={`c:${c.name}`} className="res-row">
                          <label className="check-row">
                            <input
                              type="checkbox"
                              checked={selectedResources.has(`c:${c.name}`)}
                              onChange={() => toggleResource(`c:${c.name}`)}
                            />
                            <span>
                              <span className="res-kind">容器</span>
                              <span className="mono">{c.name}</span>
                              <span className="res-meta">
                                {c.state} · {c.status}
                              </span>
                            </span>
                          </label>
                        </li>
                      ))}
                      {resources.orphans.dirs.map((d) => (
                        <li key={`d:${d.path}`} className="res-row">
                          <label className="check-row">
                            <input
                              type="checkbox"
                              checked={selectedResources.has(`d:${d.path}`)}
                              onChange={() => toggleResource(`d:${d.path}`)}
                            />
                            <span>
                              <span className="res-kind">{DIR_LABEL[d.group]}</span>
                              <span className="mono">{d.path}</span>
                            </span>
                          </label>
                        </li>
                      ))}
                    </ul>
                    <div className="res-actions">
                      <button
                        className="btn danger"
                        onClick={() => setCleanupOpen(true)}
                        disabled={!selectedResources.size || cleaning}
                      >
                        清理选中（{selectedResources.size}）
                      </button>
                    </div>
                  </>
                )}
              </section>

              <section className="glass-lite panel">
                <h2 className="panel-title">已知资源</h2>
                {resources.containers.filter((c) => !c.orphan).length === 0 &&
                resources.dirs.filter((d) => !d.orphan).length === 0 ? (
                  <p className="muted-note">暂无可识别的应用资源。</p>
                ) : (
                  <ul className="res-list">
                    {resources.containers
                      .filter((c) => !c.orphan)
                      .map((c) => (
                        <li key={`kc:${c.name}`} className="res-row static">
                          <span className="res-kind">容器</span>
                          <span className="mono">{c.name}</span>
                          <span className="res-meta">
                            {c.state} · 应用 {c.appId}
                          </span>
                        </li>
                      ))}
                    {resources.dirs
                      .filter((d) => !d.orphan)
                      .map((d) => (
                        <li key={`kd:${d.path}`} className="res-row static">
                          <span className="res-kind">{DIR_LABEL[d.group]}</span>
                          <span className="mono">{d.path}</span>
                        </li>
                      ))}
                  </ul>
                )}
              </section>
            </>
          )}
        </div>
      )}

      {tab === 'logs' && (
        <div className="panel-stack">
          <section className="glass-lite panel">
            <h2 className="panel-title">任务日志</h2>
            <TerminalLog
              lines={logs}
              height="tall"
              title="初始化 · 终端输出"
            />
            {logs.length === 0 && (
              <p className="muted-note" style={{ marginTop: 12 }}>
                暂无日志。执行初始化后，命令与输出会实时显示在这里，可整段复制到服务器终端复现。
              </p>
            )}
          </section>
        </div>
      )}

      <Modal open={cleanupOpen} onClose={() => !cleaning && setCleanupOpen(false)} title="清理孤儿资源">
        <div className="form-grid">
          <p className="confirm-lede">以下资源会从服务器删除，且不可恢复：</p>
          <ul className="res-confirm">
            {selectedContainers.map((c) => (
              <li key={`c:${c.name}`}>
                <span className="res-kind">容器</span>
                <span className="mono">{c.name}</span>
              </li>
            ))}
            {selectedDirs.map((d) => (
              <li key={`d:${d.path}`}>
                <span className="res-kind">{DIR_LABEL[d.group]}</span>
                <span className="mono">{d.path}</span>
              </li>
            ))}
          </ul>
          <p className="form-hint">
            容器会执行 docker rm -f，目录会执行 rm -rf。删除数据目录前请确认没有需要保留的数据；属于现有应用的资源不会被允许清理。
          </p>
          <div className="modal-foot">
            <button className="btn ghost" onClick={() => setCleanupOpen(false)} disabled={cleaning}>
              取消
            </button>
            <button className="btn danger" onClick={runCleanup} disabled={cleaning}>
              {cleaning ? (
                <>
                  <span className="spinner" /> 清理中…
                </>
              ) : (
                '确认清理'
              )}
            </button>
          </div>
        </div>
      </Modal>

      <ConfigModal
        open={configOpen}
        serverName={server.name}
        config={config}
        onClose={() => setConfigOpen(false)}
        onSave={async (next) => {
          try {
            const { config: saved } = await api.saveConfig(server.id, next)
            setConfig(saved)
            setConfigOpen(false)
            onToast('配置已保存，重新检查可确认差异')
            runCheck(false, true)
            return null
          } catch (e) {
            return e instanceof Error ? e.message : '保存失败'
          }
        }}
      />

      {confirmInit && (
        <ConfirmInit
          server={server}
          config={config}
          mode={initMode}
          initialized={Boolean(report?.initialized)}
          changes={initChanges}
          onCancel={() => setConfirmInit(false)}
          onConfirm={() => startInit(initMode)}
        />
      )}
    </div>
  )
}

function describeConfigChanges(prevRaw: unknown, cur: ServerConfig | null): string[] {
  if (!cur || !prevRaw || typeof prevRaw !== 'object') return []
  const prev = prevRaw as Partial<ServerConfig>
  const list = (v?: string[] | null) => (v && v.length ? v.join('、') : '未设置')
  const source = (v?: ServerConfig['dockerInstallSource']) =>
    v === 'official' ? '官方源' : v === 'system' ? '系统源' : '自动'
  const out: string[] = []

  if (JSON.stringify(prev.dockerHubMirrors ?? []) !== JSON.stringify(cur.dockerHubMirrors)) {
    out.push(`镜像加速：${list(prev.dockerHubMirrors)} → ${list(cur.dockerHubMirrors)}`)
  }
  if ((prev.aptMirror ?? null) !== cur.aptMirror) {
    out.push(`apt 镜像：${prev.aptMirror || '跟随系统'} → ${cur.aptMirror || '跟随系统'}`)
  }
  if ((prev.dockerInstallSource ?? 'auto') !== cur.dockerInstallSource) {
    out.push(`Docker 安装源：${source(prev.dockerInstallSource)} → ${source(cur.dockerInstallSource)}`)
  }
  if (String(prev.swapMb ?? 'auto') !== String(cur.swapMb)) {
    out.push(`swap：${prev.swapMb ?? 'auto'} → ${cur.swapMb}`)
  }
  if ((prev.swappiness ?? 10) !== cur.swappiness) {
    out.push(`vm.swappiness：${prev.swappiness ?? 10} → ${cur.swappiness}`)
  }
  if ((prev.traefikVersion ?? '') !== cur.traefikVersion) {
    out.push(`Traefik：${prev.traefikVersion ?? '未知'} → ${cur.traefikVersion}`)
  }
  if ((prev.acme?.ca ?? '') !== cur.acme.ca) {
    out.push(`ACME CA：${prev.acme?.ca ?? '未知'} → ${cur.acme.ca}`)
  }
  if ((prev.acme?.email ?? '') !== cur.acme.email) {
    out.push(`ACME 邮箱：${prev.acme?.email || '未填'} → ${cur.acme.email || '未填'}`)
  }
  if (JSON.stringify(prev.advanced?.containerDns ?? null) !== JSON.stringify(cur.advanced.containerDns)) {
    out.push(`容器 DNS：${list(prev.advanced?.containerDns)} → ${list(cur.advanced.containerDns)}`)
  }
  if ((prev.advanced?.dockerAddressPool ?? null) !== cur.advanced.dockerAddressPool) {
    out.push(`地址池：${prev.advanced?.dockerAddressPool ?? '自动'} → ${cur.advanced.dockerAddressPool ?? '自动'}`)
  }
  return out
}

function ConfirmInit({
  server,
  config,
  mode,
  initialized,
  changes,
  onCancel,
  onConfirm,
}: {
  server: ServerRecord
  config: ServerConfig | null
  mode: 'init' | 'apply'
  initialized: boolean
  changes: string[]
  onCancel: () => void
  onConfirm: () => void
}) {
  const fullChanges = [
    '安装 git / curl，校准时区与 NTP',
    config?.swapMb === 'auto' ? '按内存自动配置 swap' : `配置 ${config?.swapMb} MB swap`,
    `vm.swappiness = ${config?.swappiness}`,
    config?.dockerHubMirrors.length ? `写入镜像加速：${config.dockerHubMirrors.join('、')}` : '不写入镜像加速',
    '安装/确认 Docker、Compose、Buildx',
    '创建 /srv 目录与 proxy-net、shared-net',
    `部署 Traefik ${config?.traefikVersion || ''}`,
    config?.acme.ca === 'none' ? '不启用 ACME（仅 HTTP）' : '启用 ACME，并将 HTTP 永久跳转到 HTTPS',
    '配置 Traefik 访问日志轮转（保留 14 天）',
    '写入 /srv/.ourjia/init.json 台账',
  ]
  const isApply = mode === 'apply'
  const isForce = mode === 'init' && initialized
  const items = isApply
    ? changes.length
      ? changes
      : ['配置指纹不同，但服务器状态已一致：只会更新台账文件']
    : fullChanges
  return (
    <div className="modal open" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card glass sheen">
        <div className="modal-head">
          <h2>{isApply ? '应用配置变更' : isForce ? '强制重新初始化' : '确认初始化'}</h2>
        </div>
        <p className="confirm-lede">
          {isApply ? (
            <>
              将只对 <strong>{server.name}</strong>（{server.host}）执行受影响的步骤：
            </>
          ) : (
            <>
              即将对 <strong>{server.name}</strong>（{server.host}）执行以下变更：
            </>
          )}
        </p>
        <ul className="confirm-list">
          {items.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="form-hint">
          {isApply
            ? '只会执行需要的步骤：不会重装 Docker 或 Traefik；若仅 daemon.json 变化，只会重载 Docker。执行完会更新 /srv/.ourjia/init.json 台账。'
            : isForce
              ? '这是完整初始化：会重新执行全部步骤，包括重写 daemon.json、拉取 Traefik 镜像与 docker compose up。仅在服务器环境被破坏时使用。'
              : '已完成的步骤会自动跳过，重复执行是安全的。防火墙策略不会被修改。若服务器上已有 Traefik 或占用 80/443 的服务，初始化会在预检阶段停止。初始化完成后会从平台侧实测公网 80/443，安全组未放行会显示在「检查」里。'}
        </p>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className={`btn ${isForce ? 'danger' : 'primary'}`} onClick={onConfirm}>
            {isApply ? '应用变更' : isForce ? '强制重新初始化' : '确认执行'}
          </button>
        </div>
      </div>
    </div>
  )
}
