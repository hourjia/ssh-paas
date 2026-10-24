import { useEffect, useRef, useState } from 'react'
import { api } from '../api'
import type { ApiTask } from '../api'
import { useApp } from '../state'
import { Capsule, Spinner } from './ui'
import { Icon } from './Icons'
import type { IconName } from './Icons'
import { checkItemMeta, envMetaForTask } from './envMeta'
import { fmtElapsed } from '../util'

/** 连接检查报告：轮询任务、流式展示日志、展示检查项与修复动作。 */
export function EnvReportModal() {
  const app = useApp()
  const task = app.envTask

  const [data, setData] = useState<ApiTask | null>(null)
  const [loadErr, setLoadErr] = useState('')
  const [shown, setShown] = useState(0)
  const logRef = useRef<HTMLDivElement>(null)
  const appRef = useRef(app)
  appRef.current = app

  /* 轮询任务直到结束 */
  useEffect(() => {
    if (!task) return
    let alive = true
    let timer = 0
    setData(null)
    setShown(0)
    setLoadErr('')

    const poll = async () => {
      try {
        const t = await api.getTask(task.taskId)
        if (!alive) return
        setData(t)
        setLoadErr('')
        if (t.status === 'running') {
          timer = window.setTimeout(poll, 1000)
        } else {
          appRef.current.refreshServers().catch(() => {})
          const text =
            t.status === 'success'
              ? `${task.serverName} 环境就绪`
              : t.status === 'needs_manual'
                ? `${task.serverName} 有未修复项，请人工确认`
                : `${task.serverName} 环境检查失败`
          appRef.current.toast(t.status === 'success' ? 'success' : 'error', text)
        }
      } catch (e) {
        if (!alive) return
        setLoadErr(e instanceof Error ? e.message : '加载任务失败')
        timer = window.setTimeout(poll, 2000)
      }
    }
    timer = window.setTimeout(poll, 300)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
  }, [task])

  /* 日志逐行流式显现 */
  useEffect(() => {
    const total = data?.report?.logs?.length ?? 0
    if (shown >= total) return
    const timer = window.setTimeout(() => setShown((s) => Math.min(total, s + 2)), 36)
    return () => window.clearTimeout(timer)
  }, [shown, data])

  /* 自动滚动 */
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [shown])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') appRef.current.closeEnvTask()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!task) return null

  const status = data?.status ?? 'running'
  const meta = envMetaForTask(status)
  const logs = data?.report?.logs ?? []
  const items = data?.report?.items ?? []
  const needsManual = data?.report?.needs_manual ?? []
  const actions = data?.report?.actions ?? []

  const reconnect = () => {
    app.connectServer(task.serverId).catch((e: unknown) => {
      app.toast('error', e instanceof Error ? e.message : '发起连接失败')
    })
  }

  const headIcon: IconName = status === 'success' ? 'check' : status === 'failed' ? 'alert' : 'plug'

  return (
    <div className="console-overlay" role="dialog" aria-label="连接检查报告">
      <div className="console glass-shell">
        <header className={`console-head${status === 'success' ? ' flash-ok' : status === 'failed' ? ' flash-err' : ''}`}>
          <div className="console-title">
            <span className="disc disc-lg">
              <Icon name={headIcon} size={21} />
            </span>
            <div className="grow">
              <h3>连接检查 · {task.serverName}</h3>
              <p className="mono">SSH 连接 → 环境检查 → 自动准备 → 复查</p>
            </div>
            <Capsule tone={meta.tone} breathe={status === 'running'}>
              {meta.text}
            </Capsule>
          </div>
          {data?.duration_ms != null && (
            <div className="console-elapsed mono">
              耗时 <b>{fmtElapsed(data.duration_ms)}</b>
            </div>
          )}
          <button type="button" className="icon-btn-sm" onClick={app.closeEnvTask} aria-label="关闭报告">
            <Icon name="close" size={17} />
          </button>
        </header>

        {items.length > 0 && (
          <div className="env-items">
            {items.map((it) => {
              const m = checkItemMeta[it.status] ?? checkItemMeta.broken
              return (
                <div key={it.key} className="env-item glass-control" title={it.detail}>
                  <span className={`env-item-dot tone-${m.tone}`} />
                  <span className="env-item-label">{it.label}</span>
                  <span className={`env-item-state tone-${m.tone}`}>{m.text}</span>
                </div>
              )
            })}
          </div>
        )}

        {needsManual.length > 0 && (
          <div className="env-manual">
            <Icon name="alert" size={15} />
            <div>
              <b>以下问题自动修复失败，需要人工确认：</b>
              <ul>
                {needsManual.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
              {actions.length > 0 && (
                <p className="caption">
                  已尝试：{actions.map((a) => a.message).join('；')}
                </p>
              )}
            </div>
          </div>
        )}

        <div className="console-log solid-screen" ref={logRef}>
          {logs.slice(0, shown).map((l, i) => (
            <div key={i} className={`log-line tone-${l.t}`}>
              {l.s}
            </div>
          ))}
          {status === 'running' && !loadErr && (
            <span className="conn-testing" style={{ padding: '8px 2px' }}>
              <Spinner /> 正在执行…
            </span>
          )}
          {loadErr && <div className="log-line tone-err">{loadErr}</div>}
          {status !== 'running' && !loadErr && <span className="log-cursor" />}
        </div>

        <footer className="console-dock glass-floating">
          <button type="button" className="btn btn-glass" onClick={reconnect} disabled={status === 'running'}>
            <Icon name="refresh" size={15} />
            {needsManual.length > 0 ? '人工处理后重新检查' : '重新检查'}
          </button>
          <span className="flex-spacer" />
          <button type="button" className="btn btn-glass" onClick={app.closeEnvTask}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
