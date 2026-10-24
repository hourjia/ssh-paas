import { useEffect, useRef, useState } from 'react'
import { actionLabel, execStatusLabel, useApp } from '../state'
import { Capsule } from './ui'
import { Icon } from './Icons'
import type { IconName } from './Icons'
import type { LogLine, LogTone, Server, Service } from '../types'
import { fmtClock, fmtElapsed } from '../util'

/* ================= 执行脚本（Mock 流水线） ================= */

interface ScriptLine {
  text: string
  tone: LogTone
  delay?: number
}
interface ScriptStep {
  label: string
  lines: ScriptLine[]
}
interface RunScript {
  steps: ScriptStep[]
}

function buildDeploy(s: Service, server: Server): RunScript {
  const img = `ourjia/${s.name}:${s.version}`
  const portHost = s.ports[0]?.host ?? '8080'
  return {
    steps: [
      {
        label: '拉取源码',
        lines: [
          { text: `$ ourjia deploy ${s.name}@${s.version} → ${server.name}`, tone: 'cmd' },
          {
            text: s.sourceType === 'git' ? `[git]  克隆 ${s.gitUrl} (branch: ${s.branch})` : `[git]  打包本地目录 ${s.localPath}`,
            tone: 'git',
          },
          { text: '[git]  HEAD 3f2a91c "fix: 数据库连接池泄漏"', tone: 'git' },
          { text: '[git]  检出完成 · 214 个文件 · 1.8 MB', tone: 'git' },
        ],
      },
      {
        label: '构建镜像',
        lines: [
          { text: `[docker] docker build -f ${s.dockerfile} -t ${img} .`, tone: 'docker' },
          { text: '[docker] Step 1/9 : FROM node:20-alpine', tone: 'docker' },
          { text: '[docker] Step 4/9 : COPY . .', tone: 'docker' },
          { text: '[docker] Step 7/9 : RUN npm ci --omit=dev && npm run build', tone: 'docker' },
          { text: '[docker] Step 9/9 : CMD ["node", "dist/main.js"]', tone: 'docker' },
          { text: '[docker] Successfully built 8f31c2a9b7d4 · 148 MB', tone: 'docker' },
        ],
      },
      {
        label: '推送镜像',
        lines: [
          { text: `[ssh]   通过 SSH 推送镜像层 → ${server.host}:${server.port}`, tone: 'ssh' },
          { text: '[ssh]   layer 3/5 · 46 MB/s ████████████░░░░ 68%', tone: 'ssh' },
          { text: '[ssh]   推送完成 · 耗时 6.2s', tone: 'ssh' },
        ],
      },
      {
        label: '启动容器',
        lines: [
          { text: `[docker] 停止旧容器 ourjia-${s.name} …`, tone: 'docker' },
          { text: `[docker] 启动 ourjia-${s.name}:${s.version}`, tone: 'docker' },
          { text: `[docker] 注入环境变量 × ${s.envVars.length} · 端口映射 × ${s.ports.length}`, tone: 'docker' },
        ],
      },
      {
        label: '健康检查',
        lines: [
          { text: `[health] GET http://${server.host}:${portHost}/healthz`, tone: 'health' },
          { text: '[health] → 200 OK · 31ms', tone: 'health' },
          { text: `✔ 部署成功 · ${s.name} 已上线`, tone: 'ok', delay: 900 },
        ],
      },
    ],
  }
}

function buildStart(s: Service, server: Server): RunScript {
  const portHost = s.ports[0]?.host ?? '8080'
  return {
    steps: [
      {
        label: '检查镜像',
        lines: [
          { text: `$ ourjia start ${s.name}@${s.version} → ${server.name}`, tone: 'cmd' },
          { text: `[docker] 镜像 ourjia/${s.name}:${s.version} 已存在 · 148 MB`, tone: 'docker' },
        ],
      },
      {
        label: '启动容器',
        lines: [
          { text: `[docker] 启动 ourjia-${s.name}:${s.version}`, tone: 'docker' },
          { text: `[docker] 注入环境变量 × ${s.envVars.length} · 端口映射 × ${s.ports.length}`, tone: 'docker' },
        ],
      },
      {
        label: '健康检查',
        lines: [
          { text: `[health] GET http://${server.host}:${portHost}/healthz`, tone: 'health' },
          { text: '[health] → 200 OK · 28ms', tone: 'health' },
          { text: `✔ 启动成功 · ${s.name} 正在运行`, tone: 'ok', delay: 800 },
        ],
      },
    ],
  }
}

function buildStop(s: Service, server: Server): RunScript {
  return {
    steps: [
      {
        label: '通知进程',
        lines: [
          { text: `$ ourjia stop ${s.name} → ${server.name}`, tone: 'cmd' },
          { text: `[docker] 发送 SIGTERM · 等待优雅退出（最多 10s）`, tone: 'docker' },
        ],
      },
      {
        label: '停止容器',
        lines: [
          { text: `[docker] 容器 ourjia-${s.name} 已停止`, tone: 'docker' },
          { text: `[docker] 镜像与配置已保留，可随时重新启动`, tone: 'dim' },
          { text: `■ ${s.name} 已停止`, tone: 'ok', delay: 700 },
        ],
      },
    ],
  }
}

const LOG_TEMPLATES: ScriptLine[] = [
  { text: '[info]   GET /api/v1/users/10382 · 200 · 12ms', tone: 'info' },
  { text: '[info]   POST /api/v1/orders · 201 · 34ms', tone: 'info' },
  { text: '[docker] ourjia-app · CPU 4% · 内存 236 MB · 正常', tone: 'docker' },
  { text: '[warn]   慢查询 SELECT * FROM orders WHERE … · 842ms', tone: 'err' },
  { text: '[health] 心跳正常 · uptime 3d 4h · 重启 0 次', tone: 'health' },
  { text: '[info]   GET /healthz · 200 · 3ms', tone: 'health' },
  { text: '[git]    webhook: push to main by @ernestina', tone: 'git' },
  { text: '[info]   GET /api/v1/services · 200 · 8ms · qps 126', tone: 'info' },
]

/* ================= 组件 ================= */

type RunStatus = 'running' | 'success' | 'cancelled'

export function ExecConsole() {
  const app = useApp()
  const task = app.consoleTask
  const server = app.servers.find((s) => s.id === task?.serverId)
  const service = server?.services.find((v) => v.id === task?.serviceId)

  const [lines, setLines] = useState<LogLine[]>([])
  const [doneSteps, setDoneSteps] = useState(0)
  const [status, setStatus] = useState<RunStatus | null>(task?.mode === 'run' ? 'running' : null)
  const [elapsed, setElapsed] = useState(0)
  const [runSeq, setRunSeq] = useState(0)

  const lineId = useRef(0)
  const statusRef = useRef(status)
  statusRef.current = status
  const elapsedRef = useRef(0)
  elapsedRef.current = elapsed
  const logRef = useRef<HTMLDivElement>(null)
  const appRef = useRef(app)
  appRef.current = app

  const isRun = task?.mode === 'run'
  const action = task?.action

  const script = useRef<RunScript | null>(null)
  if (task && isRun && action && server && service && script.current === null) {
    script.current = action === 'deploy' ? buildDeploy(service, server) : action === 'start' ? buildStart(service, server) : buildStop(service, server)
  }

  /* ---- 运行模式引擎：逐行推送 + 步骤推进 + 计时 ---- */
  useEffect(() => {
    if (!task || !isRun || !script.current) return
    const sc = script.current
    let alive = true
    const timers: number[] = []
    let failed = false

    const tickStart = Date.now()
    const tick = () => {
      if (!alive || statusRef.current !== 'running') return
      setElapsed(Date.now() - tickStart)
      timers.push(window.setTimeout(tick, 100))
    }
    timers.push(window.setTimeout(tick, 100))

    const all = sc.steps.flatMap((st, si) => st.lines.map((l) => ({ line: l, step: si })))
    let i = 0
    const pushNext = () => {
      if (!alive) return
      if (i >= all.length) {
        setDoneSteps(sc.steps.length)
        setStatus('success')
        return
      }
      const cur = all[i]
      setLines((ls) => [...ls, { id: lineId.current++, text: cur.line.text, tone: cur.line.tone }])
      setDoneSteps(cur.step)
      i++
      timers.push(window.setTimeout(pushNext, cur.line.delay ?? 420 + Math.random() * 360))
    }
    timers.push(window.setTimeout(pushNext, 350))

    return () => {
      alive = false
      timers.forEach((t) => window.clearTimeout(t))
      if (!failed && statusRef.current === 'running' && task.action) {
        // 未完成即关闭：记录为已取消
        appRef.current.recordExecution({
          action: task.action,
          status: 'cancelled',
          serviceName: service?.name ?? '',
          version: service?.version ?? '',
          serverName: server?.name ?? '',
          serverId: server?.id,
          serviceId: service?.id,
          duration: fmtElapsed(elapsedRef.current),
        })
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runSeq])

  /* ---- 运行模式引擎：逐行推送 + 步骤推进 + 计时 ---- */
  useEffect(() => {
    if (!task || task.mode !== 'logs') return
    let alive = true
    let timer = 0
    // 先注入一段历史日志
    for (let k = 0; k < 12; k++) {
      const tpl = LOG_TEMPLATES[(k * 3 + 1) % LOG_TEMPLATES.length]
      setLines((ls) => [...ls, { id: lineId.current++, text: tpl.text, tone: tpl.tone }])
    }
    const loop = () => {
      if (!alive) return
      const tpl = LOG_TEMPLATES[Math.floor(Math.random() * LOG_TEMPLATES.length)]
      setLines((ls) => [...ls.slice(-240), { id: lineId.current++, text: tpl.text, tone: tpl.tone }])
      timer = window.setTimeout(loop, 850 + Math.random() * 600)
    }
    timer = window.setTimeout(loop, 700)
    return () => {
      alive = false
      window.clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  /* ---- 成功后：落执行记录 + 更新服务状态 + 全局提示 ---- */
  const recordedRef = useRef(false)
  useEffect(() => {
    if (status !== 'success' || recordedRef.current || !task || !action || !server || !service) return
    recordedRef.current = true
    const dur = fmtElapsed(elapsedRef.current)
    appRef.current.setServiceStatus(task.serverId, task.serviceId, action === 'stop' ? 'stopped' : 'running')
    appRef.current.recordExecution({
      action,
      status: 'success',
      serviceName: service.name,
      version: service.version,
      serverName: server.name,
      serverId: server.id,
      serviceId: service.id,
      duration: dur,
    })
    appRef.current.toast('success', `${actionLabel[action]}成功 · 耗时 ${dur}`)
  }, [status, task, action, server, service])

  /* ---- 日志自动滚动 ---- */
  useEffect(() => {
    const el = logRef.current
    if (el) el.scrollTop = el.scrollHeight
  }, [lines])

  /* ---- ESC 关闭 ---- */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') appRef.current.closeConsole()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  if (!task || !server || !service) return null

  const steps = script.current?.steps ?? []
  const stopRun = () => {
    if (status !== 'running') return
    setStatus('cancelled')
    setLines((ls) => [...ls, { id: lineId.current++, text: '■ 执行已被手动停止', tone: 'err' }])
    if (action) {
      app.recordExecution({
        action,
        status: 'cancelled',
        serviceName: service.name,
        version: service.version,
        serverName: server.name,
        serverId: server.id,
        serviceId: service.id,
        duration: fmtElapsed(elapsed),
      })
    }
  }
  const retry = () => {
    recordedRef.current = false
    script.current = action === 'deploy' ? buildDeploy(service, server) : action === 'start' ? buildStart(service, server) : buildStop(service, server)
    setLines([])
    setDoneSteps(0)
    setElapsed(0)
    setStatus('running')
    setRunSeq((n) => n + 1)
  }
  const exportLogs = () => {
    const text = lines.map((l) => l.text).join('\n')
    const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
    const a = document.createElement('a')
    a.href = URL.createObjectURL(blob)
    a.download = `ourjia-${service.name}-${isRun ? action : 'runtime'}-log.txt`
    a.click()
    URL.revokeObjectURL(a.href)
    app.toast('info', '日志已导出为 txt 文件')
  }

  const title = isRun ? `${actionLabel[action!]} ${service.name} · v${service.version}` : `${service.name} 运行日志`
  const sub = isRun ? `→ ${server.name} · ${server.host}:${server.port} (SSH)` : `${server.name} · 容器 ourjia-${service.name} · 实时`
  const headIcon: IconName = isRun ? (action === 'stop' ? 'pause' : 'rocket') : 'list'

  return (
    <div className="console-overlay" role="dialog" aria-label="执行控制台">
      <div className="console glass-shell">
        <header className={`console-head${status === 'success' ? ' flash-ok' : status === 'cancelled' ? ' flash-err' : ''}`}>
          <div className="console-title">
            <span className="disc disc-lg">
              <Icon name={headIcon} size={21} />
            </span>
            <div className="grow">
              <h3>{title}</h3>
              <p className="mono">{sub}</p>
            </div>
            {isRun && (
              <Capsule tone={status === 'running' ? 'info' : status === 'success' ? 'ok' : 'err'} breathe={status === 'running'}>
                {status === 'running' ? '执行中' : execStatusLabel[status === 'success' ? 'success' : 'cancelled']}
              </Capsule>
            )}
          </div>
          {isRun && (
            <div className="console-elapsed mono">
              耗时 <b>{fmtClock(elapsed)}</b>
            </div>
          )}
          <button type="button" className="icon-btn-sm" onClick={app.closeConsole} aria-label="关闭控制台">
            <Icon name="close" size={17} />
          </button>
          {isRun && (
            <div className="pipeline">
              <div className="pipe">
                {steps.map((st, i) => (
                  <div key={st.label} className={`pipe-seg${i < doneSteps ? ' is-done' : i === doneSteps && status === 'running' ? ' is-active' : ''}`}>
                    <div className="pipe-label">
                      <span>
                        {i + 1}. {st.label}
                      </span>
                      {i < doneSteps && (
                        <span className="pipe-ic">
                          <Icon name="check" size={12} />
                        </span>
                      )}
                    </div>
                    <div className="pipe-track">
                      <div className="pipe-fill" />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}
        </header>

        <div className="console-log solid-screen" ref={logRef}>
          {lines.map((l) => (
            <div key={l.id} className={`log-line tone-${l.tone}`}>
              {l.text}
            </div>
          ))}
          {(isRun ? status === 'running' : true) && <span className="log-cursor" />}
        </div>

        <footer className="console-dock glass-floating">
          {isRun ? (
            status === 'running' ? (
              <button type="button" className="btn btn-danger-glow" onClick={stopRun}>
                <Icon name="pause" size={15} />
                停止执行
              </button>
            ) : (
              <>
                {status === 'cancelled' && (
                  <button type="button" className="btn btn-glass" onClick={retry}>
                    <Icon name="refresh" size={15} />
                    重试
                  </button>
                )}
                <button type="button" className="btn btn-glass" onClick={exportLogs}>
                  <Icon name="download" size={15} />
                  导出日志
                </button>
              </>
            )
          ) : (
            <button type="button" className="btn btn-glass" onClick={exportLogs}>
              <Icon name="download" size={15} />
              导出日志
            </button>
          )}
          <span className="flex-spacer" />
          <button type="button" className="btn btn-glass" onClick={app.closeConsole}>
            关闭
          </button>
        </footer>
      </div>
    </div>
  )
}
