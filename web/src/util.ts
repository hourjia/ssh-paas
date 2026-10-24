let seq = 0

export function uid(prefix = 'id'): string {
  return `${prefix}-${Date.now().toString(36)}-${(seq++).toString(36)}${Math.random().toString(36).slice(2, 6)}`
}

const p2 = (n: number) => String(n).padStart(2, '0')

export function nowLabel(): string {
  const d = new Date()
  return `${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}`
}

/** 执行耗时：12.6s / 1m 08s */
export function fmtElapsed(ms: number): string {
  const s = Math.floor(ms / 100) / 10
  const m = Math.floor(s / 60)
  return m > 0 ? `${m}m ${p2(Math.round(s % 60))}s` : `${s.toFixed(1)}s`
}

/** 控制台计时器：00:08.4 */
export function fmtClock(ms: number): string {
  const t = Math.floor(ms / 100)
  const s = Math.floor(t / 10)
  const m = Math.floor(s / 60)
  return `${p2(m)}:${p2(s % 60)}.${t % 10}`
}

/** 服务来源的单行摘要（Mono 展示） */
export function srcCaption(s: { sourceType: string; branch: string; gitUrl: string; localPath: string }): string {
  if (s.sourceType === 'git') {
    const repo = s.gitUrl.split('/').filter(Boolean).pop() ?? ''
    return `git:${s.branch || '?'} · ${repo}`
  }
  return s.localPath || 'local'
}
