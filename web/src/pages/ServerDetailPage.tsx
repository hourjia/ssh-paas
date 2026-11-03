import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as api from '../api'
import type {
  CheckItem,
  CheckReport,
  JobSnapshot,
  JobStep,
  ServerConfig,
  ServerRecord,
} from '../types'
import { ConfigModal } from '../components/ConfigModal'
import { TerminalLog, type TerminalLine } from '../components/TerminalLog'
import { CheckIcon, ChevronIcon, RefreshIcon, ServerIcon } from '../icons'

interface ServerDetailPageProps {
  server: ServerRecord
  onBack: () => void
  onServerUpdate: (server: ServerRecord) => void
  onToast: (msg: string) => void
}

type Tab = 'overview' | 'checks' | 'init' | 'logs'

const TABS: { key: Tab; label: string }[] = [
  { key: 'overview', label: '概览' },
  { key: 'checks', label: '检查' },
  { key: 'init', label: '初始化' },
  { key: 'logs', label: '日志' },
]

const STATUS_TEXT: Record<CheckItem['status'], string> = { ok: '正常', warn: '注意', fail: '失败' }

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
  const unsubRef = useRef<(() => void) | null>(null)

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

  const attachStream = useCallback(
    (jobId: string) => {
      unsubRef.current?.()
      unsubRef.current = api.streamJob(jobId, {
        onState: (snap) => {
          setJob((prev) => ({ ...snap, logs: prev?.logs ?? snap.logs }))
          if (snap.status === 'done') onToast('初始化完成')
          if (snap.status === 'failed') onToast(`初始化失败：${snap.error || '未知错误'}`)
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

  const startInit = useCallback(async () => {
    if (!config) return
    setConfirmInit(false)
    setLogs([])
    setTab('init')
    try {
      const { job: created } = await api.startInit(server.id, config)
      setJob({ ...created, logs: [] })
      attachStream(created.id)
    } catch (e) {
      onToast(e instanceof Error ? e.message : '初始化启动失败')
    }
  }, [config, server.id, attachStream, onToast])

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
          <button className="btn primary" onClick={() => setConfirmInit(true)} disabled={running || !config}>
            {running ? '初始化中…' : report?.initialized ? '重新初始化' : '开始初始化'}
          </button>
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
                      ? '检测到配置与台账不一致，建议重新初始化以应用新配置。'
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
            <section className="glass-lite panel center-panel">
              <p className="init-lede">
                {report?.initialized
                  ? '服务器已初始化。若修改了配置，可重新执行以应用变更；已完成的步骤会自动跳过。'
                  : '将依次完成：预检 → 基础工具/时区 → 安装 Docker → 目录与网络 → Traefik → 台账。'}
              </p>
              <button className="btn primary" onClick={() => setConfirmInit(true)} disabled={!config}>
                {report?.initialized ? '重新初始化' : '开始初始化'}
              </button>
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
                  初始化失败：{job.error}
                  {job.currentStep && '，可从该步骤重试。'}
                </div>
              )}
              {job.status === 'done' && <div className="init-success">初始化已完成，服务器已就绪。</div>}
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
          initialized={Boolean(report?.initialized)}
          onCancel={() => setConfirmInit(false)}
          onConfirm={startInit}
        />
      )}
    </div>
  )
}

function ConfirmInit({
  server,
  config,
  initialized,
  onCancel,
  onConfirm,
}: {
  server: ServerRecord
  config: ServerConfig | null
  initialized: boolean
  onCancel: () => void
  onConfirm: () => void
}) {
  const changes = [
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
  return (
    <div className="modal open" role="dialog" aria-modal="true" onMouseDown={(e) => e.target === e.currentTarget && onCancel()}>
      <div className="modal-card glass sheen">
        <div className="modal-head">
          <h2>{initialized ? '重新初始化' : '确认初始化'}</h2>
        </div>
        <p className="confirm-lede">
          即将对 <strong>{server.name}</strong>（{server.host}）执行以下变更：
        </p>
        <ul className="confirm-list">
          {changes.map((c) => (
            <li key={c}>{c}</li>
          ))}
        </ul>
        <p className="form-hint">
          已完成的步骤会自动跳过，重复执行是安全的。防火墙策略不会被修改。若服务器上已有 Traefik 或占用 80/443 的服务，初始化会在预检阶段停止。初始化完成后会从平台侧实测公网 80/443，安全组未放行会显示在「检查」里。
        </p>
        <div className="modal-foot">
          <button className="btn ghost" onClick={onCancel}>
            取消
          </button>
          <button className="btn primary" onClick={onConfirm}>
            确认执行
          </button>
        </div>
      </div>
    </div>
  )
}
